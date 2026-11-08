import { StrKey } from '@stellar/stellar-sdk';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FINAL_STATES, PROPOSAL_STATES } from '../chain/types.js';
import { NotFoundError } from '../errors.js';
import type { IndexGap, StoredProposal, StoredVote } from '../store/types.js';
import { draftJson, limitParam } from './discussion-routes.js';
import { parse, type ApiDeps } from './http.js';

const address = z
  .string()
  .refine((s) => StrKey.isValidEd25519PublicKey(s) || StrKey.isValidContract(s), {
    message: 'not a Stellar address',
  });
const proposalIdParam = z.object({
  id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const listProposalsQuery = z
  .object({
    state: z.enum(PROPOSAL_STATES).optional(),
    proposer: address.optional(),
    cursor: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: limitParam,
  })
  .strict();
const eventCursorQuery = z
  .object({
    cursor: z
      .string()
      .regex(/^[0-9]{1,24}-[0-9]{1,12}$/, 'not a cursor')
      .optional(),
    limit: limitParam,
  })
  .strict();
const statsProposalsQuery = z
  .object({
    cursor: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    limit: limitParam,
  })
  .strict();

/** JSON shape of a proposal. Amounts are decimal strings of the token's smallest unit. */
export function proposalJson(p: StoredProposal) {
  return {
    id: p.id,
    proposer: p.proposer,
    title: p.title,
    descriptionHash: p.descriptionHash,
    uri: p.uri,
    actions: p.actions,
    snapshotLedger: p.snapshotLedger,
    voteStart: p.voteStart,
    voteEnd: p.voteEnd,
    totalPower: p.totalPower,
    quorum: p.quorum,
    timelockSecs: p.timelockSecs,
    gracePeriodSecs: p.gracePeriodSecs,
    forVotes: p.forVotes,
    againstVotes: p.againstVotes,
    abstainVotes: p.abstainVotes,
    eta: p.eta,
    executed: p.executed,
    canceled: p.canceled,
    state: p.state,
    final: FINAL_STATES.has(p.state),
    /** Ledger close time when the state was last read from the chain. */
    checkedAt: p.checkedAt,
  };
}

function voteJson(v: StoredVote) {
  return {
    proposalId: v.proposalId,
    voter: v.voter,
    choice: v.choice,
    power: v.power,
    ledger: v.ledger,
    closedAt: v.closedAt,
    txHash: v.txHash,
    eventId: v.eventId,
  };
}

function eventPage(votes: StoredVote[], limit: number) {
  const last = votes.at(-1);
  return {
    items: votes.map(voteJson),
    next: votes.length === limit && last !== undefined ? last.eventId : null,
  };
}

function gapsJson(gaps: IndexGap[]) {
  return gaps.map((g) => ({
    fromLedger: g.fromLedger,
    toLedger: g.toLedger,
    recordedAt: g.recordedAt,
  }));
}

/**
 * Read API:
 * - `GET /health`
 * - `GET /proposals?state=&proposer=&cursor=&limit=` (newest first)
 * - `GET /proposals/:id` (with the public texts whose hash matches), `GET /proposals/:id/votes`
 * - `GET /accounts/:address`
 * - `GET /stats/summary`, `GET /stats/proposals` (oldest first), `GET /stats/votes`
 *
 * Votes and deposits come from events, which RPC keeps for a limited time; `gaps` lists ledger
 * ranges that could not be read. Proposal tallies come from contract state and are complete.
 */
export function registerReadRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const info = deps.service;
  app.get('/health', async () => {
    const cursor = await deps.store.getCursor();
    const gaps = await deps.store.listGaps();
    return {
      status: 'ok',
      version: info.version,
      network: info.network,
      contractId: info.contractId,
      indexer: { ...info.health(), nextLedger: cursor?.nextLedger ?? null, gaps: gaps.length },
    };
  });

  app.get('/proposals', async (req) => {
    const q = parse(listProposalsQuery, req.query, 'query');
    const rows = await deps.store.listProposals({
      state: q.state,
      proposer: q.proposer,
      beforeId: q.cursor,
      limit: q.limit,
    });
    const last = rows.at(-1);
    return {
      items: rows.map(proposalJson),
      next: rows.length === q.limit && last !== undefined ? String(last.id) : null,
    };
  });

  app.get('/proposals/:id', async (req) => {
    const { id } = parse(proposalIdParam, req.params, 'path');
    const p = await deps.store.getProposal(id);
    if (p === undefined) throw new NotFoundError(`proposal ${String(id)}`);
    const texts = await deps.drafts.forProposal(id);
    return { ...proposalJson(p), texts: texts.map(draftJson) };
  });

  app.get('/proposals/:id/votes', async (req) => {
    const { id } = parse(proposalIdParam, req.params, 'path');
    const q = parse(eventCursorQuery, req.query, 'query');
    if ((await deps.store.getProposal(id)) === undefined) {
      throw new NotFoundError(`proposal ${String(id)}`);
    }
    return eventPage(
      await deps.store.listVotes(id, { afterEventId: q.cursor, limit: q.limit }),
      q.limit,
    );
  });

  app.get('/accounts/:address', async (req) => {
    const { address: account } = parse(z.object({ address }), req.params, 'path');
    const acct = await deps.store.getAccount(account);
    const votes = await deps.store.votesByVoter(account);
    return {
      address: account,
      /** Latest deposit seen in events, or null if none was seen. */
      deposit: acct?.deposit ?? null,
      depositLedger: acct?.ledger ?? null,
      votes: votes.map(voteJson),
    };
  });

  app.get('/stats/summary', async () => {
    const s = await deps.store.stats();
    const total = Object.values(s.proposalsByState).reduce((a, b) => a + b, 0);
    return {
      asOf: s.asOf,
      proposals: { total, byState: s.proposalsByState },
      votes: { indexed: s.votes, uniqueVoters: s.uniqueVoters },
      accounts: { withDeposit: s.accountsWithDeposit },
      gaps: gapsJson(await deps.store.listGaps()),
    };
  });

  app.get('/stats/proposals', async (req) => {
    const q = parse(statsProposalsQuery, req.query, 'query');
    const rows = await deps.store.listProposals({
      afterId: q.cursor,
      order: 'asc',
      limit: q.limit,
    });
    const counts = await deps.store.voteCounts();
    const s = await deps.store.stats();
    const last = rows.at(-1);
    return {
      asOf: s.asOf,
      gaps: gapsJson(await deps.store.listGaps()),
      items: rows.map((p) => ({
        id: p.id,
        state: p.state,
        final: FINAL_STATES.has(p.state),
        totalPower: p.totalPower,
        quorum: p.quorum,
        forVotes: p.forVotes,
        againstVotes: p.againstVotes,
        abstainVotes: p.abstainVotes,
        /** Voters seen in events; can be lower than the real number when a gap covers the vote. */
        indexedVoters: counts.get(p.id) ?? 0,
        snapshotLedger: p.snapshotLedger,
        voteStart: p.voteStart,
        voteEnd: p.voteEnd,
        eta: p.eta,
        executed: p.executed,
        canceled: p.canceled,
        checkedAt: p.checkedAt,
      })),
      next: rows.length === q.limit && last !== undefined ? String(last.id) : null,
    };
  });

  app.get('/stats/votes', async (req) => {
    const q = parse(eventCursorQuery, req.query, 'query');
    const page = eventPage(
      await deps.store.allVotes({ afterEventId: q.cursor, limit: q.limit }),
      q.limit,
    );
    return { ...page, gaps: gapsJson(await deps.store.listGaps()) };
  });
}
