import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Indexer } from '../indexer/indexer.js';
import { testApi, type TestApi } from '../testing/api.js';
import { FakeChain, sampleProposal } from '../testing/fake-chain.js';
import { MAX_COMMENT_BYTES } from './comments.js';
import { contentHash, MAX_DRAFT_BODY_BYTES } from './drafts.js';

interface DraftJson {
  id: string;
  author: string;
  title: string;
  body: string;
  contentHash: string;
  status: 'draft' | 'published';
  proposalId: number | null;
  updatedAt: number;
}
interface CommentJson {
  id: number;
  author: string;
  body: string;
  editedAt: number | null;
}

const apis: TestApi[] = [];
afterEach(async () => {
  for (const a of apis.splice(0)) await a.close();
});
function api(options: Parameters<typeof testApi>[0] = {}): TestApi {
  const a = testApi(options);
  apis.push(a);
  return a;
}

async function createDraft(
  a: TestApi,
  headers: { authorization: string },
  payload: Record<string, unknown> = { title: 'Raise quorum', body: '## Summary\n\nRaise it.' },
) {
  const res = await a.app.inject({ method: 'POST', url: '/drafts', headers, payload });
  expect(res.statusCode).toBe(201);
  return res.json<DraftJson>();
}

describe('drafts', () => {
  it('serves the built-in template', async () => {
    const a = api();
    const res = await a.app.inject({ method: 'GET', url: '/drafts/template' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string; body: string }>()).toMatchObject({ id: 'generic' });
    expect(res.json<{ body: string }>().body).toContain('## Summary');
  });

  it('creates a private draft whose hash is the sha256 of the exact body', async () => {
    const a = api();
    const alice = await a.signIn();
    const body = 'Line one\nLíne twø ✓\n';
    const d = await createDraft(a, alice.headers, { title: 'T', body });
    expect(d).toMatchObject({ author: alice.address, status: 'draft', proposalId: null, body });
    expect(d.contentHash).toBe(
      createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex'),
    );
    expect(d.contentHash).toBe(contentHash(body));
    expect(d.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it('keeps private drafts visible to their author only', async () => {
    const a = api();
    const alice = await a.signIn();
    const bob = await a.signIn();
    const d = await createDraft(a, alice.headers);
    const anon = await a.app.inject({ method: 'GET', url: `/drafts/${d.id}` });
    expect(anon.statusCode).toBe(404);
    const other = await a.app.inject({
      method: 'GET',
      url: `/drafts/${d.id}`,
      headers: bob.headers,
    });
    expect(other.statusCode).toBe(404);
    const own = await a.app.inject({
      method: 'GET',
      url: `/drafts/${d.id}`,
      headers: alice.headers,
    });
    expect(own.statusCode).toBe(200);
    const pub = await a.app.inject({ method: 'GET', url: '/drafts' });
    expect(pub.json<{ items: unknown[] }>().items).toEqual([]);
    const mine = await a.app.inject({
      method: 'GET',
      url: '/drafts?mine=true',
      headers: alice.headers,
    });
    expect(mine.json<{ items: DraftJson[] }>().items.map((x) => x.id)).toEqual([d.id]);
    const mineAnon = await a.app.inject({ method: 'GET', url: '/drafts?mine=true' });
    expect(mineAnon.statusCode).toBe(401);
  });

  it('lets the author edit and publish, and recomputes the hash', async () => {
    const a = api();
    const alice = await a.signIn();
    const d = await createDraft(a, alice.headers);
    a.clock.now += 10;
    const res = await a.app.inject({
      method: 'PATCH',
      url: `/drafts/${d.id}`,
      headers: alice.headers,
      payload: { body: 'New text', status: 'published' },
    });
    expect(res.statusCode).toBe(200);
    const edited = res.json<DraftJson>();
    expect(edited).toMatchObject({ status: 'published', body: 'New text', title: 'Raise quorum' });
    expect(edited.contentHash).toBe(contentHash('New text'));
    expect(edited.updatedAt).toBe(a.clock.now);
    const list = await a.app.inject({ method: 'GET', url: `/drafts?author=${alice.address}` });
    expect(list.json<{ items: DraftJson[] }>().items).toHaveLength(1);
    const back = await a.app.inject({
      method: 'PATCH',
      url: `/drafts/${d.id}`,
      headers: alice.headers,
      payload: { status: 'draft' },
    });
    expect(back.statusCode).toBe(409);
  });

  it('refuses edits by anyone but the author', async () => {
    const a = api();
    const alice = await a.signIn();
    const bob = await a.signIn();
    const d = await createDraft(a, alice.headers, { title: 'T', body: 'B', status: 'published' });
    const res = await a.app.inject({
      method: 'PATCH',
      url: `/drafts/${d.id}`,
      headers: bob.headers,
      payload: { title: 'Hijacked' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
    const anon = await a.app.inject({
      method: 'PATCH',
      url: `/drafts/${d.id}`,
      payload: { title: 'x' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('validates titles and bodies by UTF-8 bytes', async () => {
    const a = api();
    const alice = await a.signIn();
    const post = (payload: unknown) =>
      a.app.inject({
        method: 'POST',
        url: '/drafts',
        headers: alice.headers,
        payload: payload as object,
      });
    // 61 two-byte characters are 122 bytes: over the 120-byte limit although only 61 characters.
    expect((await post({ title: 'é'.repeat(61), body: 'b' })).statusCode).toBe(400);
    expect((await post({ title: 'é'.repeat(60), body: 'b' })).statusCode).toBe(201);
    expect((await post({ title: ' ', body: 'b' })).statusCode).toBe(400);
    expect((await post({ title: 't', body: '' })).statusCode).toBe(400);
    expect(
      (await post({ title: 't', body: 'x'.repeat(MAX_DRAFT_BODY_BYTES + 1) })).statusCode,
    ).toBe(400);
    expect((await post({ title: 't', body: 'b', author: 'someone else' })).statusCode).toBe(400);
    expect((await post({ title: 't', body: 'b', status: 'secret' })).statusCode).toBe(400);
    const nothing = await a.app.inject({
      method: 'PATCH',
      url: '/drafts/abcdefgh',
      headers: alice.headers,
      payload: {},
    });
    expect(nothing.statusCode).toBe(400);
    const missing = await a.app.inject({
      method: 'PATCH',
      url: '/drafts/abcdefgh',
      headers: alice.headers,
      payload: { title: 'x' },
    });
    expect(missing.statusCode).toBe(404);
    const badId = await a.app.inject({ method: 'GET', url: '/drafts/not%20an%20id' });
    expect(badId.statusCode).toBe(400);
  });

  it('pages published drafts newest first', async () => {
    const a = api();
    const alice = await a.signIn();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        (
          await createDraft(a, alice.headers, {
            title: `T${String(i)}`,
            body: `B${String(i)}`,
            status: 'published',
          })
        ).id,
      );
    }
    const first = await a.app.inject({ method: 'GET', url: '/drafts?limit=2' });
    const page1 = first.json<{ items: DraftJson[]; next: string | null }>();
    expect(page1.items.map((d) => d.id)).toEqual([ids[2], ids[1]]);
    expect(page1.next).not.toBeNull();
    const second = await a.app.inject({
      method: 'GET',
      url: `/drafts?limit=2&cursor=${String(page1.next)}`,
    });
    const page2 = second.json<{ items: DraftJson[]; next: string | null }>();
    expect(page2.items.map((d) => d.id)).toEqual([ids[0]]);
    expect(page2.next).toBeNull();
    expect((await a.app.inject({ method: 'GET', url: '/drafts?limit=500' })).statusCode).toBe(400);
  });
});

describe('linking drafts to on-chain proposals by hash', () => {
  it('links a published draft when the indexer sees a proposal with its hash, then freezes it', async () => {
    const a = api();
    const alice = await a.signIn();
    const body = 'The exact proposal text.';
    const published = await createDraft(a, alice.headers, {
      title: 'P',
      body,
      status: 'published',
    });
    const privateCopy = await createDraft(a, alice.headers, { title: 'P', body });
    const chain = new FakeChain();
    chain.proposals.push({
      proposal: sampleProposal({ descriptionHash: contentHash(body), proposer: alice.address }),
      state: 'Pending',
    });
    await new Indexer({ chain, store: a.store, startLedger: 1 }).runOnce();
    const linked = await a.app.inject({ method: 'GET', url: `/drafts/${published.id}` });
    expect(linked.json<DraftJson>().proposalId).toBe(1);
    expect((await a.drafts.forProposal(1)).map((d) => d.id)).toEqual([published.id]);
    // A private draft with the same text is not linked: only public text is shown with a proposal.
    expect((await a.store.getDraft(privateCopy.id))?.proposalId).toBeNull();
    const edit = await a.app.inject({
      method: 'PATCH',
      url: `/drafts/${published.id}`,
      headers: alice.headers,
      payload: { title: 'Changed' },
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json<{ error: { message: string } }>().error.message).toMatch(
      /linked to on-chain proposal 1/,
    );
  });

  it('links a draft published after the proposal already exists', async () => {
    const a = api();
    const alice = await a.signIn();
    const body = 'Text written before, published after.';
    const chain = new FakeChain();
    chain.proposals.push({
      proposal: sampleProposal({ descriptionHash: contentHash(body) }),
      state: 'Active',
    });
    await new Indexer({ chain, store: a.store, startLedger: 1 }).runOnce();
    const d = await createDraft(a, alice.headers, { title: 'P', body });
    expect(d.proposalId).toBeNull();
    const res = await a.app.inject({
      method: 'PATCH',
      url: `/drafts/${d.id}`,
      headers: alice.headers,
      payload: { status: 'published' },
    });
    expect(res.json<DraftJson>().proposalId).toBe(1);
    const other = await createDraft(a, alice.headers, {
      title: 'Q',
      body: `${body} `,
      status: 'published',
    });
    expect(other.proposalId).toBeNull();
  });
});

describe('comments', () => {
  async function publishedDraft(a: TestApi) {
    const author = await a.signIn();
    return createDraft(a, author.headers, { title: 'T', body: 'B', status: 'published' });
  }

  it('posts and lists flat comments on a published draft, oldest first', async () => {
    const a = api();
    const d = await publishedDraft(a);
    const bob = await a.signIn();
    const carol = await a.signIn();
    for (const [who, text] of [
      [bob, 'First'],
      [carol, 'Second'],
    ] as const) {
      const res = await a.app.inject({
        method: 'POST',
        url: `/drafts/${d.id}/comments`,
        headers: who.headers,
        payload: { body: text },
      });
      expect(res.statusCode).toBe(201);
    }
    const list = await a.app.inject({ method: 'GET', url: `/drafts/${d.id}/comments` });
    const items = list.json<{ items: CommentJson[] }>().items;
    expect(items.map((c) => [c.author, c.body])).toEqual([
      [bob.address, 'First'],
      [carol.address, 'Second'],
    ]);
    const page = await a.app.inject({ method: 'GET', url: `/drafts/${d.id}/comments?limit=1` });
    const p1 = page.json<{ items: CommentJson[]; next: string | null }>();
    expect(p1.items).toHaveLength(1);
    const p2 = await a.app.inject({
      method: 'GET',
      url: `/drafts/${d.id}/comments?limit=1&cursor=${String(p1.next)}`,
    });
    expect(p2.json<{ items: CommentJson[] }>().items[0]?.body).toBe('Second');
  });

  it('accepts comments on indexed proposals only, and not on private drafts', async () => {
    const a = api();
    const bob = await a.signIn();
    const unknown = await a.app.inject({
      method: 'POST',
      url: '/proposals/1/comments',
      headers: bob.headers,
      payload: { body: 'Hi' },
    });
    expect(unknown.statusCode).toBe(404);
    const chain = new FakeChain();
    chain.proposals.push({ proposal: sampleProposal(), state: 'Active' });
    await new Indexer({ chain, store: a.store, startLedger: 1 }).runOnce();
    const ok = await a.app.inject({
      method: 'POST',
      url: '/proposals/1/comments',
      headers: bob.headers,
      payload: { body: 'Hi' },
    });
    expect(ok.statusCode).toBe(201);
    const list = await a.app.inject({ method: 'GET', url: '/proposals/1/comments' });
    expect(list.json<{ items: CommentJson[] }>().items).toHaveLength(1);
    expect((await a.app.inject({ method: 'GET', url: '/proposals/2/comments' })).statusCode).toBe(
      404,
    );
    const alice = await a.signIn();
    const priv = await createDraft(a, alice.headers);
    const onPrivate = await a.app.inject({
      method: 'POST',
      url: `/drafts/${priv.id}/comments`,
      headers: alice.headers,
      payload: { body: 'note to self' },
    });
    expect(onPrivate.statusCode).toBe(404);
  });

  it('lets authors edit and delete their own comments within the window only', async () => {
    const a = api();
    const d = await publishedDraft(a);
    const bob = await a.signIn();
    const mallory = await a.signIn();
    const post = async () =>
      (
        await a.app.inject({
          method: 'POST',
          url: `/drafts/${d.id}/comments`,
          headers: bob.headers,
          payload: { body: 'Original' },
        })
      ).json<CommentJson>();
    const c = await post();
    const byOther = await a.app.inject({
      method: 'PATCH',
      url: `/comments/${String(c.id)}`,
      headers: mallory.headers,
      payload: { body: 'Changed by someone else' },
    });
    expect(byOther.statusCode).toBe(403);
    const delOther = await a.app.inject({
      method: 'DELETE',
      url: `/comments/${String(c.id)}`,
      headers: mallory.headers,
    });
    expect(delOther.statusCode).toBe(403);
    a.clock.now += 60;
    const edited = await a.app.inject({
      method: 'PATCH',
      url: `/comments/${String(c.id)}`,
      headers: bob.headers,
      payload: { body: 'Fixed typo' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<CommentJson>()).toMatchObject({ body: 'Fixed typo', editedAt: a.clock.now });
    const del = await a.app.inject({
      method: 'DELETE',
      url: `/comments/${String(c.id)}`,
      headers: bob.headers,
    });
    expect(del.statusCode).toBe(204);
    expect(
      (await a.app.inject({ method: 'GET', url: `/drafts/${d.id}/comments` })).json<{
        items: unknown[];
      }>().items,
    ).toEqual([]);

    const late = await post();
    a.clock.now += 15 * 60 + 1;
    const tooLate = await a.app.inject({
      method: 'PATCH',
      url: `/comments/${String(late.id)}`,
      headers: bob.headers,
      payload: { body: 'Too late' },
    });
    expect(tooLate.statusCode).toBe(409);
    const tooLateDelete = await a.app.inject({
      method: 'DELETE',
      url: `/comments/${String(late.id)}`,
      headers: bob.headers,
    });
    expect(tooLateDelete.statusCode).toBe(409);
    const gone = await a.app.inject({
      method: 'DELETE',
      url: '/comments/999',
      headers: bob.headers,
    });
    expect(gone.statusCode).toBe(404);
  });

  it('validates comment bodies and requires a session', async () => {
    const a = api();
    const d = await publishedDraft(a);
    const bob = await a.signIn();
    const post = (payload: object, headers?: { authorization: string }) =>
      a.app.inject({
        method: 'POST',
        url: `/drafts/${d.id}/comments`,
        payload,
        ...(headers ? { headers } : {}),
      });
    expect((await post({ body: '   ' }, bob.headers)).statusCode).toBe(400);
    expect((await post({ body: 'x'.repeat(MAX_COMMENT_BYTES + 1) }, bob.headers)).statusCode).toBe(
      400,
    );
    expect((await post({ body: 'ok', extra: 1 }, bob.headers)).statusCode).toBe(400);
    expect((await post({ body: 'ok' })).statusCode).toBe(401);
  });

  it('rate-limits each address', async () => {
    const a = api({ commentLimit: 3 });
    const d = await publishedDraft(a);
    const bob = await a.signIn();
    const carol = await a.signIn();
    const post = (who: { headers: { authorization: string } }) =>
      a.app.inject({
        method: 'POST',
        url: `/drafts/${d.id}/comments`,
        headers: who.headers,
        payload: { body: 'spam' },
      });
    for (let i = 0; i < 3; i++) expect((await post(bob)).statusCode).toBe(201);
    const limited = await post(bob);
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Other addresses are not affected, and the window moves on.
    expect((await post(carol)).statusCode).toBe(201);
    a.clock.now += 61;
    expect((await post(bob)).statusCode).toBe(201);
  });
});
