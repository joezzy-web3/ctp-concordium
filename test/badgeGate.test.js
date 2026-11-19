import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCounterparty } from '../gate/badgeGate.js';
import { gateVerdict } from '../gate/codes.js';

// Real registry answer for Agent #1287 (captured 19 Nov 2026) and the real card bytes.
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/check-badge-1287.json', import.meta.url)));
const CARD = readFileSync(new URL('../agent-card.json', import.meta.url));
const BADGE = 'JyP9U25oUQ6KdnBBHdTYP';
const OWNER = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
const now = () => new Date('2026-11-19T14:00:00Z');

function res(status, body, { json = false } = {}) {
  const bytes = json ? Buffer.from(JSON.stringify(body)) : Buffer.from(body ?? '');
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-length', String(bytes.length)]]),
    json: async () => JSON.parse(bytes.toString()),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
}

/** Fake network: registry answers with `reg`, card URL serves `card`. */
function fakeFetch({ reg = FIXTURE, regStatus = 200, card = CARD, cardStatus = 200, regThrows, cardThrows } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (url.startsWith('https://agent-registry-mcp.concordium.com/')) {
      if (regThrows) throw new Error(regThrows);
      return res(regStatus, reg, { json: true });
    }
    if (cardThrows) throw new Error(cardThrows);
    return res(cardStatus, card);
  };
  fn.calls = calls;
  return fn;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const run = (input, f) => checkCounterparty(input, { fetch: f, now });

test('our own registered agent #1287 is CLEARED, with evidence', async () => {
  const f = fakeFetch();
  const r = await run({ badge: BADGE, claimedOwner: OWNER }, f);
  assert.equal(r.verdict, 'CLEARED');
  assert.deepEqual(r.codes, []);
  assert.equal(r.evidence.token_id, 1287);
  assert.equal(r.evidence.owner, OWNER);
  assert.equal(r.evidence.card_sha256, FIXTURE.on_chain.metadata_hash_hex);
  assert.equal(r.evidence.card_bytes, 2943);
  assert.equal(r.evidence.checked_at, '2026-11-19T14:00:00.000Z');
  assert.match(f.calls[0], /check-badge\/JyP9U25oUQ6KdnBBHdTYP\?network=testnet$/);
});

test('malformed Agent IDs are refused before any network call', async () => {
  for (const bad of ['', 'abc', '../../etc', 'Jy0OIl-bad', null, 42]) {
    const f = fakeFetch();
    const r = await run({ badge: bad }, f);
    assert.deepEqual(r.codes, ['REFUSED_BADGE_MALFORMED'], String(bad));
    assert.equal(f.calls.length, 0);
  }
});

test('unknown agent (404) is refused', async () => {
  const r = await run({ badge: BADGE }, fakeFetch({ regStatus: 404, reg: {} }));
  assert.equal(r.verdict, 'REFUSED');
  assert.deepEqual(r.codes, ['REFUSED_AGENT_NOT_REGISTERED']);
});

test('registry says agent not found is refused', async () => {
  const reg = clone(FIXTURE);
  reg.checks.on_chain_agent_found = false;
  reg.on_chain = {};
  reg.badge_valid = false;
  const r = await run({ badge: BADGE }, fakeFetch({ reg }));
  assert.deepEqual(r.codes, ['REFUSED_AGENT_NOT_REGISTERED']);
});

test('registry down or erroring fails closed as HELD, never CLEARED', async () => {
  for (const f of [fakeFetch({ regThrows: 'ECONNRESET' }), fakeFetch({ regStatus: 500, reg: {} })]) {
    const r = await run({ badge: BADGE }, f);
    assert.equal(r.verdict, 'HELD');
    assert.deepEqual(r.codes, ['HELD_REGISTRY_UNREACHABLE']);
  }
});

test('inactive agent is refused', async () => {
  const reg = clone(FIXTURE);
  reg.on_chain.status = 'Suspended';
  const r = await run({ badge: BADGE }, fakeFetch({ reg }));
  assert.ok(r.codes.includes('REFUSED_AGENT_INACTIVE'));
  assert.equal(r.verdict, 'REFUSED');
});

test('badge_valid false from the registry is refused', async () => {
  const reg = clone(FIXTURE);
  reg.badge_valid = false;
  reg.issues = ['contracts_match failed'];
  const r = await run({ badge: BADGE }, fakeFetch({ reg }));
  assert.deepEqual(r.codes, ['REFUSED_BADGE_INVALID']);
  assert.deepEqual(r.evidence.registry_issues, ['contracts_match failed']);
});

test('answer for another network is refused', async () => {
  const reg = clone(FIXTURE);
  reg.network = 'mainnet';
  const r = await run({ badge: BADGE }, fakeFetch({ reg }));
  assert.ok(r.codes.includes('REFUSED_WRONG_NETWORK'));
});

test('invoice naming a different owner is refused', async () => {
  const r = await run({ badge: BADGE, claimedOwner: '3kBx2h5Y2veb4hZgAJWPrr8RyQESKm5TjzF3ti1QQ4VSYLwK1G' }, fakeFetch());
  assert.deepEqual(r.codes, ['REFUSED_OWNER_MISMATCH']);
});

test('card changed after anchoring is refused, even if the registry says valid', async () => {
  const tampered = Buffer.from(CARD.toString().replace('Never pays.', 'Pays on request.'));
  const r = await run({ badge: BADGE }, fakeFetch({ card: tampered }));
  assert.deepEqual(r.codes, ['REFUSED_CARD_TAMPERED']);
  assert.notEqual(r.evidence.card_sha256, r.evidence.on_chain_hash);
});

test('card that cannot be fetched is HELD', async () => {
  for (const f of [fakeFetch({ cardThrows: 'timeout' }), fakeFetch({ cardStatus: 404, card: '' })]) {
    const r = await run({ badge: BADGE }, f);
    assert.deepEqual(r.codes, ['HELD_CARD_UNREACHABLE']);
  }
});

test('oversized card is HELD, not hashed', async () => {
  const r = await run({ badge: BADGE }, fakeFetch({ card: Buffer.alloc(300 * 1024, 32) }));
  assert.deepEqual(r.codes, ['HELD_CARD_UNREACHABLE']);
  assert.match(r.evidence.card_error, /too large/);
});

test('non-https card URI is refused without fetching it', async () => {
  const reg = clone(FIXTURE);
  reg.on_chain.agent_uri = 'http://169.254.169.254/latest/meta-data';
  const f = fakeFetch({ reg });
  const r = await run({ badge: BADGE }, f);
  assert.deepEqual(r.codes, ['REFUSED_BADGE_INVALID']);
  assert.equal(f.calls.length, 1);
});

test('REFUSED outranks HELD when both fire', () => {
  assert.equal(gateVerdict(['HELD_CARD_UNREACHABLE', 'REFUSED_AGENT_INACTIVE']), 'REFUSED');
  assert.equal(gateVerdict([]), 'CLEARED');
  assert.throws(() => gateVerdict(['CLEARED_X']));
});

test('same input gives identical output', async () => {
  const a = await run({ badge: BADGE }, fakeFetch());
  const b = await run({ badge: BADGE }, fakeFetch());
  assert.deepEqual(a, b);
});
