// GENERATED FILE: do not edit by hand. Regenerate with the command in ./README.md.
// Source: governance contract CAOERDLG52UU6X5JENOXNKN4DWWJPVPNK7AD4RYXE3MA4TRBY62O5I5F (testnet),
// wasm sha256 b08f42668fb100075b215766c5b3a278d5888fbfab57cb2c8b358fc57b1b30ef,
// generated 2026-11-07 by @stellar/stellar-sdk 17.4.0 (stellar-js generate).
/* eslint-disable */

import {ProposalState, Action, VoteRecord, VoteChoice, Config, Proposal, ContractEvent} from './types.js';
import {Result, Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions, ExternalExecutableRef} from '@stellar/stellar-sdk/contract';
import {Address, xdr} from '@stellar/stellar-sdk';

export interface Client {
  /**
   * Queues a Succeeded proposal: `eta = now + timelock`. Anyone may call. Returns the eta.
   */
  queue(args: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, Error>>>;
  /**
   * Current state of a proposal, derived from the ledger time and its flags.
   */
  state(args: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<ProposalState, Error>>>;
  /**
   * The governance token.
   */
  token(options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Cancels a proposal. Needs `caller`'s authorization, and `caller` must be the proposer.
   * Allowed while Pending, Active, Succeeded or Queued.
   */
  cancel(args: { caller: string | Address; proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Moves `amount` of the token from `from` into the contract and raises its voting power.
   * Returns the new deposit. Needs `from`'s authorization.
   */
  deposit(args: { from: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, Error>>>;
  /**
   * Executes a Queued proposal when `eta <= now < eta + grace`. Anyone may call.
   * Marks it executed, then runs its actions in order. If any action fails the call returns
   * `ActionFailed` and every change, including the executed flag, is rolled back.
   */
  execute(args: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Creates a proposal and returns its id (ids start at 1). Needs `proposer`'s authorization.
   *
   * The snapshot is the current ledger: power and total power come from earlier ledgers.
   * The proposer's power there must reach the threshold. Title <= 120 bytes, uri <= 200 bytes,
   * at most 5 actions and 8 arguments per `Invoke`; `UpdateConfig` is validated now and again
   * at execution; an `Invoke` on the governance token or this contract is `ForbiddenTarget`.
   */
  propose(args: { proposer: string | Address; title: string; description_hash: Uint8Array; uri: string; actions: Array<Action> }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, Error>>>;
  /**
   * How `voter` voted on a proposal, if at all.
   */
  get_vote(args: { proposal_id: bigint; voter: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<VoteRecord | null>>;
  /**
   * Power of `account` from all changes in ledgers strictly before `ledger`.
   * `ledger` must not be after the current ledger (`SnapshotNotPast`).
   */
  power_at(args: { account: string | Address; ledger: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, Error>>>;
  /**
   * Returns `amount` of the deposit to `from`. Allowed at any time: it lowers power only for
   * snapshots taken after this ledger, and votes already cast stay counted.
   * Returns the remaining deposit. Needs `from`'s authorization.
   */
  withdraw(args: { from: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, Error>>>;
  /**
   * Casts `voter`'s vote and returns the power counted. Needs `voter`'s authorization.
   * Only while Active (`vote_start <= now < vote_end`). The weight is the voter's power at the
   * proposal's snapshot and must be > 0. One vote per voter; it cannot be changed.
   */
  cast_vote(args: { voter: string | Address; proposal_id: bigint; choice: VoteChoice }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, Error>>>;
  /**
   * Current deposit of `account` (0 if none).
   */
  deposit_of(args: { account: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Current settings.
   */
  get_config(options?: MethodOptions): Promise<AssembledTransaction<Config>>;
  /**
   * A stored proposal.
   */
  get_proposal(args: { proposal_id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<Proposal, Error>>>;
  /**
   * Number of proposals created so far.
   */
  proposal_count(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Total deposited power from all changes in ledgers strictly before `ledger`.
   * `ledger` must not be after the current ledger (`SnapshotNotPast`).
   */
  total_power_at(args: { ledger: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, Error>>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAAAAAFZRdWV1ZXMgYSBTdWNjZWVkZWQgcHJvcG9zYWw6IGBldGEgPSBub3cgKyB0aW1lbG9ja2AuIEFueW9uZSBtYXkgY2FsbC4gUmV0dXJucyB0aGUgZXRhLgAAAAAABXF1ZXVlAAAAAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAPpAAAABgAAAAM=", "AAAAAAAAAEhDdXJyZW50IHN0YXRlIG9mIGEgcHJvcG9zYWwsIGRlcml2ZWQgZnJvbSB0aGUgbGVkZ2VyIHRpbWUgYW5kIGl0cyBmbGFncy4AAAAFc3RhdGUAAAAAAAABAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAA+kAAAfQAAAADVByb3Bvc2FsU3RhdGUAAAAAAAAD", "AAAAAAAAABVUaGUgZ292ZXJuYW5jZSB0b2tlbi4AAAAAAAAFdG9rZW4AAAAAAAAAAAAAAQAAABM=", "AAAAAAAAAIpDYW5jZWxzIGEgcHJvcG9zYWwuIE5lZWRzIGBjYWxsZXJgJ3MgYXV0aG9yaXphdGlvbiwgYW5kIGBjYWxsZXJgIG11c3QgYmUgdGhlIHByb3Bvc2VyLgpBbGxvd2VkIHdoaWxlIFBlbmRpbmcsIEFjdGl2ZSwgU3VjY2VlZGVkIG9yIFF1ZXVlZC4AAAAAAAZjYW5jZWwAAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAAI1Nb3ZlcyBgYW1vdW50YCBvZiB0aGUgdG9rZW4gZnJvbSBgZnJvbWAgaW50byB0aGUgY29udHJhY3QgYW5kIHJhaXNlcyBpdHMgdm90aW5nIHBvd2VyLgpSZXR1cm5zIHRoZSBuZXcgZGVwb3NpdC4gTmVlZHMgYGZyb21gJ3MgYXV0aG9yaXphdGlvbi4AAAAAAAAHZGVwb3NpdAAAAAACAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAALAAAAAw==", "AAAAAAAAAPJFeGVjdXRlcyBhIFF1ZXVlZCBwcm9wb3NhbCB3aGVuIGBldGEgPD0gbm93IDwgZXRhICsgZ3JhY2VgLiBBbnlvbmUgbWF5IGNhbGwuCk1hcmtzIGl0IGV4ZWN1dGVkLCB0aGVuIHJ1bnMgaXRzIGFjdGlvbnMgaW4gb3JkZXIuIElmIGFueSBhY3Rpb24gZmFpbHMgdGhlIGNhbGwgcmV0dXJucwpgQWN0aW9uRmFpbGVkYCBhbmQgZXZlcnkgY2hhbmdlLCBpbmNsdWRpbmcgdGhlIGV4ZWN1dGVkIGZsYWcsIGlzIHJvbGxlZCBiYWNrLgAAAAAAB2V4ZWN1dGUAAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAAb1DcmVhdGVzIGEgcHJvcG9zYWwgYW5kIHJldHVybnMgaXRzIGlkIChpZHMgc3RhcnQgYXQgMSkuIE5lZWRzIGBwcm9wb3NlcmAncyBhdXRob3JpemF0aW9uLgoKVGhlIHNuYXBzaG90IGlzIHRoZSBjdXJyZW50IGxlZGdlcjogcG93ZXIgYW5kIHRvdGFsIHBvd2VyIGNvbWUgZnJvbSBlYXJsaWVyIGxlZGdlcnMuClRoZSBwcm9wb3NlcidzIHBvd2VyIHRoZXJlIG11c3QgcmVhY2ggdGhlIHRocmVzaG9sZC4gVGl0bGUgPD0gMTIwIGJ5dGVzLCB1cmkgPD0gMjAwIGJ5dGVzLAphdCBtb3N0IDUgYWN0aW9ucyBhbmQgOCBhcmd1bWVudHMgcGVyIGBJbnZva2VgOyBgVXBkYXRlQ29uZmlnYCBpcyB2YWxpZGF0ZWQgbm93IGFuZCBhZ2FpbgphdCBleGVjdXRpb247IGFuIGBJbnZva2VgIG9uIHRoZSBnb3Zlcm5hbmNlIHRva2VuIG9yIHRoaXMgY29udHJhY3QgaXMgYEZvcmJpZGRlblRhcmdldGAuAAAAAAAAB3Byb3Bvc2UAAAAABQAAAAAAAAAIcHJvcG9zZXIAAAATAAAAAAAAAAV0aXRsZQAAAAAAABAAAAAAAAAAEGRlc2NyaXB0aW9uX2hhc2gAAAPuAAAAIAAAAAAAAAADdXJpAAAAABAAAAAAAAAAB2FjdGlvbnMAAAAD6gAAB9AAAAAGQWN0aW9uAAAAAAABAAAD6QAAAAYAAAAD", "AAAAAAAAACtIb3cgYHZvdGVyYCB2b3RlZCBvbiBhIHByb3Bvc2FsLCBpZiBhdCBhbGwuAAAAAAhnZXRfdm90ZQAAAAIAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAAAAAAABXZvdGVyAAAAAAAAEwAAAAEAAAPoAAAH0AAAAApWb3RlUmVjb3JkAAA=", "AAAAAAAAAItQb3dlciBvZiBgYWNjb3VudGAgZnJvbSBhbGwgY2hhbmdlcyBpbiBsZWRnZXJzIHN0cmljdGx5IGJlZm9yZSBgbGVkZ2VyYC4KYGxlZGdlcmAgbXVzdCBub3QgYmUgYWZ0ZXIgdGhlIGN1cnJlbnQgbGVkZ2VyIChgU25hcHNob3ROb3RQYXN0YCkuAAAAAAhwb3dlcl9hdAAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGbGVkZ2VyAAAAAAAEAAAAAQAAA+kAAAALAAAAAw==", "AAAAAAAAAN1SZXR1cm5zIGBhbW91bnRgIG9mIHRoZSBkZXBvc2l0IHRvIGBmcm9tYC4gQWxsb3dlZCBhdCBhbnkgdGltZTogaXQgbG93ZXJzIHBvd2VyIG9ubHkgZm9yCnNuYXBzaG90cyB0YWtlbiBhZnRlciB0aGlzIGxlZGdlciwgYW5kIHZvdGVzIGFscmVhZHkgY2FzdCBzdGF5IGNvdW50ZWQuClJldHVybnMgdGhlIHJlbWFpbmluZyBkZXBvc2l0LiBOZWVkcyBgZnJvbWAncyBhdXRob3JpemF0aW9uLgAAAAAAAAh3aXRoZHJhdwAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAsAAAAD", "AAAAAAAAAPxDYXN0cyBgdm90ZXJgJ3Mgdm90ZSBhbmQgcmV0dXJucyB0aGUgcG93ZXIgY291bnRlZC4gTmVlZHMgYHZvdGVyYCdzIGF1dGhvcml6YXRpb24uCk9ubHkgd2hpbGUgQWN0aXZlIChgdm90ZV9zdGFydCA8PSBub3cgPCB2b3RlX2VuZGApLiBUaGUgd2VpZ2h0IGlzIHRoZSB2b3RlcidzIHBvd2VyIGF0IHRoZQpwcm9wb3NhbCdzIHNuYXBzaG90IGFuZCBtdXN0IGJlID4gMC4gT25lIHZvdGUgcGVyIHZvdGVyOyBpdCBjYW5ub3QgYmUgY2hhbmdlZC4AAAAJY2FzdF92b3RlAAAAAAAAAwAAAAAAAAAFdm90ZXIAAAAAAAATAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAAAAAAZjaG9pY2UAAAAAB9AAAAAKVm90ZUNob2ljZQAAAAAAAQAAA+kAAAALAAAAAw==", "AAAAAAAAAClDdXJyZW50IGRlcG9zaXQgb2YgYGFjY291bnRgICgwIGlmIG5vbmUpLgAAAAAAAApkZXBvc2l0X29mAAAAAAABAAAAAAAAAAdhY2NvdW50AAAAABMAAAABAAAACw==", "AAAAAAAAABFDdXJyZW50IHNldHRpbmdzLgAAAAAAAApnZXRfY29uZmlnAAAAAAAAAAAAAQAAB9AAAAAGQ29uZmlnAAA=", "AAAAAAAAABJBIHN0b3JlZCBwcm9wb3NhbC4AAAAAAAxnZXRfcHJvcG9zYWwAAAABAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAA+kAAAfQAAAACFByb3Bvc2FsAAAAAw==", "AAAAAAAAAFxCaW5kcyB0aGUgY29udHJhY3QgdG8gYHRva2VuYCBhbmQgc3RvcmVzIGBjb25maWdgLiBSdW5zIG9uY2UsIGF0IGRlcGxveS4gTm8gYWRtaW4gaXMgc3RvcmVkLgAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAgAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAZjb25maWcAAAAAB9AAAAAGQ29uZmlnAAAAAAABAAAD6QAAAAIAAAAD", "AAAAAAAAACNOdW1iZXIgb2YgcHJvcG9zYWxzIGNyZWF0ZWQgc28gZmFyLgAAAAAOcHJvcG9zYWxfY291bnQAAAAAAAAAAAABAAAABg==", "AAAAAAAAAI5Ub3RhbCBkZXBvc2l0ZWQgcG93ZXIgZnJvbSBhbGwgY2hhbmdlcyBpbiBsZWRnZXJzIHN0cmljdGx5IGJlZm9yZSBgbGVkZ2VyYC4KYGxlZGdlcmAgbXVzdCBub3QgYmUgYWZ0ZXIgdGhlIGN1cnJlbnQgbGVkZ2VyIChgU25hcHNob3ROb3RQYXN0YCkuAAAAAAAOdG90YWxfcG93ZXJfYXQAAAAAAAEAAAAAAAAABmxlZGdlcgAAAAAABAAAAAEAAAPpAAAACwAAAAM=", "AAAABAAAACNFdmVyeSB3YXkgYSBjb250cmFjdCBjYWxsIGNhbiBmYWlsLgAAAAAAAAAABUVycm9yAAAAAAAAEgAAAC1BIGNvbmZpZyB2YWx1ZSBpcyBvdXRzaWRlIGl0cyBhbGxvd2VkIGJvdW5kcy4AAAAAAAANSW52YWxpZENvbmZpZwAAAAAAAAEAAAAlVGhlIGFtb3VudCBtdXN0IGJlIGdyZWF0ZXIgdGhhbiB6ZXJvLgAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAAAgAAADRUaGUgd2l0aGRyYXdhbCBpcyBsYXJnZXIgdGhhbiB0aGUgYWNjb3VudCdzIGRlcG9zaXQuAAAAE0luc3VmZmljaWVudERlcG9zaXQAAAAAAwAAAEVUaGUgcHJvcG9zZXIncyBwb3dlciBhdCB0aGUgc25hcHNob3QgaXMgYmVsb3cgdGhlIHByb3Bvc2FsIHRocmVzaG9sZC4AAAAAAAAOQmVsb3dUaHJlc2hvbGQAAAAAAAQAAABJQSBwcm9wb3NhbCBtYXkgaG9sZCBhdCBtb3N0IDUgYWN0aW9ucywgYW5kIGFuIEludm9rZSBhdCBtb3N0IDggYXJndW1lbnRzLgAAAAAAAA5Ub29NYW55QWN0aW9ucwAAAAAABQAAAEZBbiBJbnZva2UgYWN0aW9uIG1heSBub3QgdGFyZ2V0IHRoZSBnb3Zlcm5hbmNlIHRva2VuIG9yIHRoaXMgY29udHJhY3QuAAAAAAAPRm9yYmlkZGVuVGFyZ2V0AAAAAAYAAAA9VGhlIHRpdGxlIChtYXggMTIwIGJ5dGVzKSBvciBVUkkgKG1heCAyMDAgYnl0ZXMpIGlzIHRvbyBsb25nLgAAAAAAAAtUZXh0VG9vTG9uZwAAAAAHAAAAIE5vIHByb3Bvc2FsIGV4aXN0cyB3aXRoIHRoaXMgaWQuAAAAEFByb3Bvc2FsTm90Rm91bmQAAAAIAAAAJVZvdGluZyBpcyBub3Qgb3BlbiBmb3IgdGhpcyBwcm9wb3NhbC4AAAAAAAAMVm90aW5nQ2xvc2VkAAAACQAAADBUaGlzIGFkZHJlc3MgaGFzIGFscmVhZHkgdm90ZWQgb24gdGhpcyBwcm9wb3NhbC4AAAAMQWxyZWFkeVZvdGVkAAAACgAAADxUaGlzIGFkZHJlc3MgaGFkIG5vIHZvdGluZyBwb3dlciBhdCB0aGUgcHJvcG9zYWwncyBzbmFwc2hvdC4AAAANTm9Wb3RpbmdQb3dlcgAAAAAAAAsAAAA1VGhlIHByb3Bvc2FsIGlzIG5vdCBpbiBhIHN0YXRlIHRoYXQgYWxsb3dzIHRoaXMgY2FsbC4AAAAAAAAKV3JvbmdTdGF0ZQAAAAAADAAAADtUaGUgcHJvcG9zYWwgaXMgcXVldWVkIGJ1dCBpdHMgdGltZWxvY2sgaGFzIG5vdCBwYXNzZWQgeWV0LgAAAAAOVGltZWxvY2tBY3RpdmUAAAAAAA0AAAAlVGhlIGNhbGxlciBpcyBub3QgYWxsb3dlZCB0byBkbyB0aGlzLgAAAAAAAA1Ob3RBdXRob3JpemVkAAAAAAAADgAAAD5BIHByb3Bvc2FsIGFjdGlvbiBmYWlsZWQgd2hpbGUgZXhlY3V0aW5nOyBub3RoaW5nIHdhcyBjaGFuZ2VkLgAAAAAADEFjdGlvbkZhaWxlZAAAAA8AAABEVGhlIHRva2VuIHRyYW5zZmVyIGZhaWxlZCAoZm9yIGV4YW1wbGUsIGluc3VmZmljaWVudCB0b2tlbiBiYWxhbmNlKS4AAAALVG9rZW5GYWlsZWQAAAAAEAAAACZBbiBhcml0aG1ldGljIHJlc3VsdCB3YXMgb3V0IG9mIHJhbmdlLgAAAAAACE92ZXJmbG93AAAAEQAAACZUaGUgcmVxdWVzdGVkIGxlZGdlciBpcyBpbiB0aGUgZnV0dXJlLgAAAAAAD1NuYXBzaG90Tm90UGFzdAAAAAAS", "AAAAAQAAAEdBIGNhbGwgdGhlIGNvbnRyYWN0IG1ha2VzIHRvIGFub3RoZXIgY29udHJhY3Qgd2hlbiBhIHByb3Bvc2FsIGV4ZWN1dGVzLgAAAAAAAAAABENhbGwAAAADAAAAHkFyZ3VtZW50cywgYXQgbW9zdCBgTUFYX0FSR1NgLgAAAAAABGFyZ3MAAAPqAAAAAAAAAFFUYXJnZXQgY29udHJhY3QuIE5ldmVyIHRoZSBnb3Zlcm5hbmNlIHRva2VuIG9yIHRoaXMgY29udHJhY3QgKGBGb3JiaWRkZW5UYXJnZXRgKS4AAAAAAAAIY29udHJhY3QAAAATAAAAHEZ1bmN0aW9uIG5hbWUgb24gdGhlIHRhcmdldC4AAAAIZnVuY3Rpb24AAAAR", "AAAAAgAAABdPbmUgc3RlcCBvZiBhIHByb3Bvc2FsLgAAAAAAAAAABkFjdGlvbgAAAAAAAgAAAAEAAABGUmVwbGFjZSB0aGUgZ292ZXJuYW5jZSBzZXR0aW5ncy4gQWZmZWN0cyBvbmx5IHByb3Bvc2FscyBjcmVhdGVkIGxhdGVyLgAAAAAADFVwZGF0ZUNvbmZpZwAAAAEAAAfQAAAABkNvbmZpZwAAAAAAAQAAADFDYWxsIGFub3RoZXIgY29udHJhY3QgYXMgdGhlIGdvdmVybmFuY2UgY29udHJhY3QuAAAAAAAABkludm9rZQAAAAAAAQAAB9AAAAAEQ2FsbA==", "AAAAAQAAAIFHb3Zlcm5hbmNlIHNldHRpbmdzLiBUaW1lcyBhcmUgbGVkZ2VyIHRpbWVzdGFtcHMgaW4gc2Vjb25kcy4KQ2hhbmdlZCBvbmx5IGJ5IGEgcGFzc2VkIHByb3Bvc2FsIGNhcnJ5aW5nIFtgQWN0aW9uOjpVcGRhdGVDb25maWdgXS4AAAAAAAAAAAAABkNvbmZpZwAAAAAABgAAAGFTZWNvbmRzIGFmdGVyIHRoZSB0aW1lbG9jayBkdXJpbmcgd2hpY2ggYGV4ZWN1dGVgIGlzIGFsbG93ZWQ7IGFmdGVyIHRoYXQgdGhlIHByb3Bvc2FsIGlzIEV4cGlyZWQuAAAAAAAAEWdyYWNlX3BlcmlvZF9zZWNzAAAAAAAABgAAAEVQb3dlciBhdCB0aGUgc25hcHNob3QgbGVkZ2VyIG5lZWRlZCB0byBjcmVhdGUgYSBwcm9wb3NhbCAoMCBhbGxvd2VkKS4AAAAAAAAScHJvcG9zYWxfdGhyZXNob2xkAAAAAAALAAAAYFF1b3J1bSBpbiBiYXNpcyBwb2ludHMgKDEuLj0xMF8wMDApIG9mIHRvdGFsIHBvd2VyIGF0IHRoZSBzbmFwc2hvdC4gRm9yICsgQWJzdGFpbiBtdXN0IHJlYWNoIGl0LgAAAApxdW9ydW1fYnBzAAAAAAAEAAAAM1NlY29uZHMgYmV0d2VlbiBgcXVldWVgIGFuZCB0aGUgZWFybGllc3QgYGV4ZWN1dGVgLgAAAAANdGltZWxvY2tfc2VjcwAAAAAAAAYAAAAyU2Vjb25kcyBmcm9tIHByb3Bvc2FsIGNyZWF0aW9uIHVudGlsIHZvdGluZyBvcGVucy4AAAAAABF2b3RpbmdfZGVsYXlfc2VjcwAAAAAAAAYAAAAnTGVuZ3RoIG9mIHRoZSB2b3Rpbmcgd2luZG93IGluIHNlY29uZHMuAAAAABJ2b3RpbmdfcGVyaW9kX3NlY3MAAAAAAAY=", "AAAAAQAAABJBIHN0b3JlZCBwcm9wb3NhbC4AAAAAAAAAAAAIUHJvcG9zYWwAAAASAAAAAAAAAA1hYnN0YWluX3ZvdGVzAAAAAAAACwAAAAAAAAAHYWN0aW9ucwAAAAPqAAAH0AAAAAZBY3Rpb24AAAAAAAAAAAANYWdhaW5zdF92b3RlcwAAAAAAAAsAAAAAAAAACGNhbmNlbGVkAAAAAQAAADFzaGEyNTYgb2YgdGhlIGZ1bGwgcHJvcG9zYWwgdGV4dCwga2VwdCBvZmYtY2hhaW4uAAAAAAAAEGRlc2NyaXB0aW9uX2hhc2gAAAPuAAAAIAAAAChFYXJsaWVzdCBleGVjdXRpb24gdGltZTsgMCB1bnRpbCBxdWV1ZWQuAAAAA2V0YQAAAAAGAAAAAAAAAAhleGVjdXRlZAAAAAEAAAAAAAAACWZvcl92b3RlcwAAAAAAAAsAAAA/R3JhY2UgcGVyaW9kIGNvcGllZCBmcm9tIHRoZSBjb25maWcgYXQgY3JlYXRpb24gKGRlY2lzaW9uIEQxOSkuAAAAABFncmFjZV9wZXJpb2Rfc2VjcwAAAAAAAAYAAAAAAAAACHByb3Bvc2VyAAAAEwAAADBWb3RlcyAoRm9yICsgQWJzdGFpbikgbmVlZGVkLCBmaXhlZCBhdCBjcmVhdGlvbi4AAAAGcXVvcnVtAAAAAAALAAAARlZvdGluZyBwb3dlciBpcyByZWFkIGZyb20gY2hhbmdlcyBpbiBsZWRnZXJzIHN0cmljdGx5IGJlZm9yZSB0aGlzIG9uZS4AAAAAAA9zbmFwc2hvdF9sZWRnZXIAAAAABAAAADtUaW1lbG9jayBjb3BpZWQgZnJvbSB0aGUgY29uZmlnIGF0IGNyZWF0aW9uIChkZWNpc2lvbiBEMTkpLgAAAAANdGltZWxvY2tfc2VjcwAAAAAAAAYAAAAAAAAABXRpdGxlAAAAAAAAEAAAADlUb3RhbCBkZXBvc2l0ZWQgcG93ZXIgYXQgdGhlIHNuYXBzaG90LCBmaXhlZCBhdCBjcmVhdGlvbi4AAAAAAAALdG90YWxfcG93ZXIAAAAACwAAACBXaGVyZSB0aGUgZnVsbCB0ZXh0IGNhbiBiZSByZWFkLgAAAAN1cmkAAAAAEAAAAAAAAAAIdm90ZV9lbmQAAAAGAAAAAAAAAAp2b3RlX3N0YXJ0AAAAAAAG", "AAAAAwAAAD9BIHZvdGVyJ3MgY2hvaWNlLiBUaGUgbnVtZXJpYyB2YWx1ZXMgYXJlIHBhcnQgb2YgdGhlIGludGVyZmFjZS4AAAAAAAAAAApWb3RlQ2hvaWNlAAAAAAADAAAAAAAAAAdBZ2FpbnN0AAAAAAAAAAAAAAAAA0ZvcgAAAAABAAAAAAAAAAdBYnN0YWluAAAAAAI=", "AAAAAQAAACZIb3cgb25lIGFkZHJlc3Mgdm90ZWQgb24gb25lIHByb3Bvc2FsLgAAAAAAAAAAAApWb3RlUmVjb3JkAAAAAAACAAAAAAAAAAZjaG9pY2UAAAAAB9AAAAAKVm90ZUNob2ljZQAAAAAAAAAAAAVwb3dlcgAAAAAAAAs=", "AAAAAwAAADtMaWZlY3ljbGUgc3RhdGUgb2YgYSBwcm9wb3NhbCwgZGVyaXZlZCBmcm9tIHRpbWUgYW5kIGZsYWdzLgAAAAAAAAAADVByb3Bvc2FsU3RhdGUAAAAAAAAIAAAAH0NyZWF0ZWQ7IHZvdGluZyBoYXMgbm90IG9wZW5lZC4AAAAAB1BlbmRpbmcAAAAAAAAAAA9Wb3RpbmcgaXMgb3Blbi4AAAAABkFjdGl2ZQAAAAAAAQAAAENWb3RpbmcgZW5kZWQgd2l0aG91dCBwYXNzaW5nIChxdW9ydW0gbWlzc2VkLCB0aWUsIG9yIG1vcmUgQWdhaW5zdCkuAAAAAAhEZWZlYXRlZAAAAAIAAAA6Vm90aW5nIGVuZGVkIGFuZCB0aGUgcHJvcG9zYWwgcGFzc2VkOyB3YWl0aW5nIGZvciBgcXVldWVgLgAAAAAACVN1Y2NlZWRlZAAAAAAAAAMAAAAyUXVldWVkOyBleGVjdXRhYmxlIGZyb20gYGV0YWAgdW50aWwgYGV0YSArIGdyYWNlYC4AAAAAAAZRdWV1ZWQAAAAAAAQAAAAQRXhlY3V0ZWQuIEZpbmFsLgAAAAhFeGVjdXRlZAAAAAUAAAAgQ2FuY2VsZWQgYnkgaXRzIHByb3Bvc2VyLiBGaW5hbC4AAAAIQ2FuY2VsZWQAAAAGAAAAN1F1ZXVlZCBidXQgbm90IGV4ZWN1dGVkIHdpdGhpbiB0aGUgZ3JhY2UgcGVyaW9kLiBGaW5hbC4AAAAAB0V4cGlyZWQAAAAABw==", "AAAABQAAABBBIHZvdGUgd2FzIGNhc3QuAAAAAAAAAAhWb3RlQ2FzdAAAAAEAAAAJdm90ZV9jYXN0AAAAAAAABAAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAAAAAABXZvdGVyAAAAAAAAEwAAAAEAAAAAAAAABmNob2ljZQAAAAAH0AAAAApWb3RlQ2hvaWNlAAAAAAAAAAAAAAAAAAVwb3dlcgAAAAAAAAsAAAAAAAAAAg==", "AAAABQAAAFFgZnJvbWAgZGVwb3NpdGVkIGBhbW91bnRgLiBgZGVwb3NpdGAgYW5kIGB0b3RhbGAgYXJlIHRoZSB2YWx1ZXMgYWZ0ZXIgdGhlIGNoYW5nZS4AAAAAAAAAAAAACURlcG9zaXRlZAAAAAAAAAEAAAAJZGVwb3NpdGVkAAAAAAAABAAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAHZGVwb3NpdAAAAAALAAAAAAAAAAAAAAAFdG90YWwAAAAAAAALAAAAAAAAAAI=", "AAAABQAAAFNgYWNjb3VudGAgd2l0aGRyZXcgYGFtb3VudGAuIGBkZXBvc2l0YCBhbmQgYHRvdGFsYCBhcmUgdGhlIHZhbHVlcyBhZnRlciB0aGUgY2hhbmdlLgAAAAAAAAAACVdpdGhkcmF3bgAAAAAAAAEAAAAJd2l0aGRyYXduAAAAAAAABAAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAHZGVwb3NpdAAAAAALAAAAAAAAAAAAAAAFdG90YWwAAAAAAAALAAAAAAAAAAI=", "AAAABQAAADNUaGUgc2V0dGluZ3Mgd2VyZSByZXBsYWNlZCBieSBhbiBleGVjdXRlZCBwcm9wb3NhbC4AAAAAAAAAAA1Db25maWdVcGRhdGVkAAAAAAAAAQAAAA5jb25maWdfdXBkYXRlZAAAAAAAAgAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAZDb25maWcAAAAAAAAAAAAC", "AAAABQAAADVBIHByb3Bvc2FsIHdhcyBxdWV1ZWQ7IGl0IGNhbiBiZSBleGVjdXRlZCBmcm9tIGBldGFgLgAAAAAAAAAAAAAOUHJvcG9zYWxRdWV1ZWQAAAAAAAEAAAAPcHJvcG9zYWxfcXVldWVkAAAAAAIAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAABAAAAAAAAAANldGEAAAAABgAAAAAAAAAC", "AAAABQAAABdBIHByb3Bvc2FsIHdhcyBjcmVhdGVkLgAAAAAAAAAAD1Byb3Bvc2FsQ3JlYXRlZAAAAAABAAAAEHByb3Bvc2FsX2NyZWF0ZWQAAAAIAAAAAAAAAAtwcm9wb3NhbF9pZAAAAAAGAAAAAQAAAAAAAAAIcHJvcG9zZXIAAAATAAAAAQAAAAAAAAAPc25hcHNob3RfbGVkZ2VyAAAAAAQAAAAAAAAAAAAAAAp2b3RlX3N0YXJ0AAAAAAAGAAAAAAAAAAAAAAAIdm90ZV9lbmQAAAAGAAAAAAAAAAAAAAAQZGVzY3JpcHRpb25faGFzaAAAA+4AAAAgAAAAAAAAAAAAAAALdG90YWxfcG93ZXIAAAAACwAAAAAAAAAAAAAABnF1b3J1bQAAAAAACwAAAAAAAAAC", "AAAABQAAAChBIHByb3Bvc2FsIHdhcyBjYW5jZWxlZCBieSBpdHMgcHJvcG9zZXIuAAAAAAAAABBQcm9wb3NhbENhbmNlbGVkAAAAAQAAABFwcm9wb3NhbF9jYW5jZWxlZAAAAAAAAAEAAAAAAAAAC3Byb3Bvc2FsX2lkAAAAAAYAAAABAAAAAg==", "AAAABQAAABhBIHByb3Bvc2FsIHdhcyBleGVjdXRlZC4AAAAAAAAAEFByb3Bvc2FsRXhlY3V0ZWQAAAABAAAAEXByb3Bvc2FsX2V4ZWN1dGVkAAAAAAAAAQAAAAAAAAALcHJvcG9zYWxfaWQAAAAABgAAAAEAAAAC"]),
      options
    );
  }

   static deploy<T = Client>(args: { token: string | Address; config: Config }, options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { salt?: Uint8Array; address?: string; } & ({ wasmHash: Uint8Array | string; format?: "hex" | "base64"; externalRef?: never; } | { externalRef: ExternalExecutableRef; wasmHash?: never; format?: never; })): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(args, options);
  }
  public readonly fromJson = {
    queue : this.txFromJson<Result<bigint, Error>>,  state : this.txFromJson<Result<ProposalState, Error>>,  token : this.txFromJson<string>,  cancel : this.txFromJson<Result<null, Error>>,  deposit : this.txFromJson<Result<bigint, Error>>,  execute : this.txFromJson<Result<null, Error>>,  propose : this.txFromJson<Result<bigint, Error>>,  get_vote : this.txFromJson<VoteRecord | null>,  power_at : this.txFromJson<Result<bigint, Error>>,  withdraw : this.txFromJson<Result<bigint, Error>>,  cast_vote : this.txFromJson<Result<bigint, Error>>,  deposit_of : this.txFromJson<bigint>,  get_config : this.txFromJson<Config>,  get_proposal : this.txFromJson<Result<Proposal, Error>>,  proposal_count : this.txFromJson<bigint>,  total_power_at : this.txFromJson<Result<bigint, Error>>
  };

  /** @deprecated Use fromJson instead. */
  public readonly fromJSON = this.fromJson;

  /**
   * Parse a raw contract event (topics + data) into a typed {@link ContractEvent}.
   */
  parseEvent(topics: xdr.ScVal[] | string[], data: xdr.ScVal | string): ContractEvent | undefined {
    return this.spec.parseEvent(topics, data) as ContractEvent | undefined;
  }
  /**
   * Build a topics filter row for the "VoteCast" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  voteCastEventFilter(topicValues?: { proposal_id?: bigint; voter?: string | Address }): string[] {
    return this.spec.eventTopicFilter("VoteCast", topicValues);
  }
  /**
   * Build a topics filter row for the "Deposited" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  depositedEventFilter(topicValues?: { account?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Deposited", topicValues);
  }
  /**
   * Build a topics filter row for the "Withdrawn" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  withdrawnEventFilter(topicValues?: { account?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Withdrawn", topicValues);
  }
  /**
   * Build a topics filter row for the "ConfigUpdated" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  configUpdatedEventFilter(topicValues?: { proposal_id?: bigint }): string[] {
    return this.spec.eventTopicFilter("ConfigUpdated", topicValues);
  }
  /**
   * Build a topics filter row for the "ProposalQueued" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  proposalQueuedEventFilter(topicValues?: { proposal_id?: bigint }): string[] {
    return this.spec.eventTopicFilter("ProposalQueued", topicValues);
  }
  /**
   * Build a topics filter row for the "ProposalCreated" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  proposalCreatedEventFilter(topicValues?: { proposal_id?: bigint; proposer?: string | Address }): string[] {
    return this.spec.eventTopicFilter("ProposalCreated", topicValues);
  }
  /**
   * Build a topics filter row for the "ProposalCanceled" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  proposalCanceledEventFilter(topicValues?: { proposal_id?: bigint }): string[] {
    return this.spec.eventTopicFilter("ProposalCanceled", topicValues);
  }
  /**
   * Build a topics filter row for the "ProposalExecuted" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  proposalExecutedEventFilter(topicValues?: { proposal_id?: bigint }): string[] {
    return this.spec.eventTopicFilter("ProposalExecuted", topicValues);
  }
}
