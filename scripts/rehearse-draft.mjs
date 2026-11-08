#!/usr/bin/env node
// Rehearsal helper: signs in to the toolkit with a Stellar CLI identity (SEP-53 via
// `stellar message sign`), creates and publishes a draft from a text file, and optionally posts
// comments on it as other identities. Session tokens stay in memory and are never printed.
//
//   node scripts/rehearse-draft.mjs --author gov-voter-a --title "Raise quorum" --file text.md
//        [--comment gov-voter-b="Looks good"] [--comment gov-voter-c="Agreed"]
//        [--url http://127.0.0.1:8787]
// Prints the draft id and its content hash (the description_hash for propose).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const all = (name) =>
  args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]] : []));
const url = opt('url', 'http://127.0.0.1:8787').replace(/\/+$/, '');
const author = opt('author', undefined);
const title = opt('title', undefined);
const file = opt('file', undefined);
if (author === undefined || title === undefined || file === undefined) {
  console.error(
    'usage: --author <identity> --title <title> --file <text file> [--comment id=text]',
  );
  process.exit(2);
}

async function call(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${url}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

/** Signs in as a CLI identity and returns the session token (kept in memory only). */
async function signIn(identity) {
  const address = execFileSync('stellar', ['keys', 'address', identity], {
    encoding: 'utf8',
  }).trim();
  const challenge = await call('POST', '/auth/challenge', { address });
  const signature = execFileSync(
    'stellar',
    ['message', 'sign', '--sign-with-key', identity, '--quiet'],
    {
      input: challenge.message,
      encoding: 'utf8',
    },
  ).trim();
  const session = await call('POST', '/auth/verify', {
    address,
    nonce: challenge.nonce,
    signature,
  });
  console.log(`signed in as ${identity} (${address}) with a SEP-53 signature from the Stellar CLI`);
  return session.token;
}

const body = readFileSync(file, 'utf8');
const token = await signIn(author);
const draft = await call('POST', '/drafts', { title, body, status: 'draft' }, token);
const published = await call('PATCH', `/drafts/${draft.id}`, { status: 'published' }, token);
console.log(
  `draft ${published.id} published; contentHash ${published.contentHash}; proposalId ${String(published.proposalId)}`,
);
for (const c of all('comment')) {
  const eq = c.indexOf('=');
  const who = c.slice(0, eq);
  const text = c.slice(eq + 1);
  const t = await signIn(who);
  const comment = await call('POST', `/drafts/${published.id}/comments`, { body: text }, t);
  console.log(`comment ${String(comment.id)} by ${who}: ${text}`);
}
console.log(`DRAFT_ID=${published.id}`);
console.log(`CONTENT_HASH=${published.contentHash}`);
