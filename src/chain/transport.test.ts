import { describe, expect, it } from 'vitest';
import {
  MalformedResponseError,
  RpcResponseError,
  RpcTimeoutError,
  RpcUnavailableError,
} from '../errors.js';
import { HttpRpcTransport } from './transport.js';

type Step = Response | Error | 'hang';

/** A fake `fetch` that answers each call with the next step; 'hang' waits for the abort. */
function fakeFetch(steps: Step[]) {
  const calls: { body: unknown }[] = [];
  const impl = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? init.body : 'null';
    calls.push({ body: JSON.parse(body) as unknown });
    const step = steps.shift();
    if (step === undefined) return Promise.reject(new Error('no more steps'));
    if (step === 'hang') {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted'));
        });
      });
    }
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  };
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function transport(steps: Step[], retries = 2, timeoutMs = 1_000) {
  const f = fakeFetch(steps);
  const sleeps: number[] = [];
  const t = new HttpRpcTransport({
    url: 'https://rpc.example',
    timeoutMs,
    retries,
    fetch: f.impl,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { t, calls: f.calls, sleeps };
}

describe('HttpRpcTransport', () => {
  it('returns the result of a JSON-RPC call', async () => {
    const { t, calls } = transport([json({ jsonrpc: '2.0', id: 1, result: { sequence: 5 } })]);
    await expect(t.request('getLatestLedger')).resolves.toEqual({ sequence: 5 });
    expect(calls[0]?.body).toMatchObject({ jsonrpc: '2.0', method: 'getLatestLedger' });
  });

  it('retries HTTP 503 and 429 with doubling delays', async () => {
    const { t, calls, sleeps } = transport([
      json({}, 503),
      json({}, 429),
      json({ jsonrpc: '2.0', id: 3, result: 'ok' }),
    ]);
    await expect(t.request('getHealth')).resolves.toBe('ok');
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1_000]);
  });

  it('gives up after the retries with RpcUnavailableError', async () => {
    const { t, calls } = transport([json({}, 502), json({}, 502), json({}, 502)]);
    await expect(t.request('getHealth')).rejects.toBeInstanceOf(RpcUnavailableError);
    expect(calls).toHaveLength(3);
  });

  it('times out a hanging request and reports RpcTimeoutError after retries', async () => {
    const { t, calls } = transport(['hang', 'hang'], 1, 20);
    const err = await t.request('getEvents').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcTimeoutError);
    expect((err as RpcTimeoutError).code).toBe('RPC_TIMEOUT');
    expect(calls).toHaveLength(2);
  });

  it('recovers when a retry succeeds after a timeout', async () => {
    const { t } = transport(['hang', json({ jsonrpc: '2.0', id: 2, result: 1 })], 1, 20);
    await expect(t.request('getHealth')).resolves.toBe(1);
  });

  it('retries network errors', async () => {
    const { t } = transport([new TypeError('fetch failed'), json({ jsonrpc: '2.0', result: 7 })]);
    await expect(t.request('getHealth')).resolves.toBe(7);
  });

  it('does not retry a JSON-RPC error object', async () => {
    const { t, calls } = transport([
      json({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'startLedger too old' } }),
    ]);
    const err = await t.request('getEvents').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcResponseError);
    expect((err as RpcResponseError).rpcCode).toBe(-32600);
    expect(calls).toHaveLength(1);
  });

  it('does not retry an HTTP 4xx answer', async () => {
    const { t, calls } = transport([json({}, 400)]);
    await expect(t.request('getHealth')).rejects.toBeInstanceOf(RpcUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it('rejects a body that is not JSON or not a JSON-RPC envelope', async () => {
    const notJson = transport([new Response('<html>', { status: 200 })]);
    await expect(notJson.t.request('getHealth')).rejects.toBeInstanceOf(MalformedResponseError);
    const notEnvelope = transport([json({ hello: 'world' })]);
    await expect(notEnvelope.t.request('getHealth')).rejects.toBeInstanceOf(MalformedResponseError);
  });
});
