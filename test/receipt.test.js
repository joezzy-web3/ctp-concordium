import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, receiptHash, anchorDataHex, verifyReceipt, ANCHOR_TAG_HEX } from '../receipt/receipt.js';
import { canonicalize } from '../receipt/canonical.js';

const OWNER = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
const GATE_OK = {
  verdict: 'CLEARED',
  codes: [],
  evidence: {
    badge: 'JyP9U25oUQ6KdnBBHdTYP', network: 'testnet', checked_at: '2026-11-19T14:01:31.015Z',
    token_id: 1287, owner: OWNER, status: 'Active',
    on_chain_hash: 'b6567d9bdb984846f7f72a2769a42485888be98928b11398c6a58be1828e9588',
    card_sha256: 'b6567d9bdb984846f7f72a2769a42485888be98928b11398c6a58be1828e9588',
  },
};
const GATE_REFUSED = { verdict: 'REFUSED', codes: ['REFUSED_OWNER_MISMATCH'], evidence: { ...GATE_OK.evidence } };
const SIGNERS = [
  { role: 'receiver', account: 'accA', signed_at: '2026-11-19T13:00:00Z' },
  { role: 'approver', account: 'accB', signed_at: '2026-11-19T13:30:00Z' },
];
const base = (over = {}) => ({
  invoice: { id: 'INV-1042', supplier: 'Acme Foods Ltd', amount: '1250.00', currency: 'EUR', po: 'PO-77' },
  gate: GATE_OK,
  verdict: 'CLEARED',
  codes: [],
  signers: SIGNERS,
  decided_by: { agent_id: 1287, badge: 'JyP9U25oUQ6KdnBBHdTYP', network: 'testnet' },
  decided_at: '2026-11-19T14:05:00Z',
  prev: null,
  salt: '00112233445566778899aabbccddeeff',
  ...over,
});

test('canonical form is stable regardless of key order', () => {
  assert.equal(canonicalize({ b: 1, a: { d: [true, null], c: 'x' } }), '{"a":{"c":"x","d":[true,null]},"b":1}');
  assert.equal(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }));
});

test('canonical form rejects floats, undefined and non-plain objects', () => {
  assert.throws(() => canonicalize({ amount: 12.5 }), /safe integers/);
  assert.throws(() => canonicalize({ a: undefined }), /undefined/);
  assert.throws(() => canonicalize({ d: new Date() }), /plain objects/);
});

test('a cleared decision builds a receipt with a stable hash and a 36-byte anchor', async () => {
  const r = buildReceipt(base());
  assert.equal(r.schema, 'ctp.receipt/v1');
  assert.equal(r.counterparty.token_id, 1287);
  const h1 = await receiptHash(r);
  const h2 = await receiptHash(buildReceipt(base()));
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  const data = await anchorDataHex(r);
  assert.equal(data, ANCHOR_TAG_HEX + h1);
  assert.equal(data.length / 2, 36);
});

test('the salt makes the hash unguessable from the invoice alone', async () => {
  const a = await receiptHash(buildReceipt(base({ salt: undefined })));
  const b = await receiptHash(buildReceipt(base({ salt: undefined })));
  assert.notEqual(a, b);
});

test('cannot CLEAR when the sending agent failed the badge gate', () => {
  assert.throws(() => buildReceipt(base({ gate: GATE_REFUSED })), /badge gate/);
});

test('a REFUSED decision for a failed gate is recorded fine', () => {
  const r = buildReceipt(base({ gate: GATE_REFUSED, verdict: 'REFUSED', codes: ['REFUSED_OWNER_MISMATCH'], signers: [] }));
  assert.equal(r.decision.verdict, 'REFUSED');
  assert.deepEqual(r.counterparty.codes, ['REFUSED_OWNER_MISMATCH']);
});

test('cannot CLEAR without two different human signers', () => {
  assert.throws(() => buildReceipt(base({ signers: [SIGNERS[0]] })), /two different/);
  assert.throws(() => buildReceipt(base({ signers: [SIGNERS[0], { ...SIGNERS[1], account: 'accA' }] })), /two different/);
});

test('verdict and codes must agree', () => {
  assert.throws(() => buildReceipt(base({ codes: ['HELD_ONE_SIGNATURE'] })), /CLEARED has no codes/);
  assert.throws(() => buildReceipt(base({ verdict: 'HELD', codes: [] })), /at least one/);
  assert.throws(() => buildReceipt(base({ verdict: 'PAID' })), /verdict must be/);
});

test('amounts must be decimal strings', () => {
  for (const amount of [1250, '1,250.00', '-5', '01.5', '1e3', '']) {
    assert.throws(() => buildReceipt(base({ invoice: { ...base().invoice, amount } })), /amount/, String(amount));
  }
});

test('verify: untouched receipt matches its anchor', async () => {
  const r = buildReceipt(base());
  const v = await verifyReceipt(r, await anchorDataHex(r));
  assert.equal(v.valid, true);
  assert.deepEqual(v.problems, []);
});

test('verify: any change after anchoring is caught', async () => {
  const r = buildReceipt(base());
  const data = await anchorDataHex(r);
  const edited = structuredClone(r);
  edited.invoice.amount = '12500.00';
  const v = await verifyReceipt(edited, data);
  assert.equal(v.valid, false);
  assert.ok(v.problems.includes('receipt was changed after it was anchored'));
});

test('verify: data that is not our anchor is rejected', async () => {
  const r = buildReceipt(base());
  const h = await receiptHash(r);
  for (const data of ['', h, 'deadbeef' + h, ANCHOR_TAG_HEX + h + '00']) {
    const v = await verifyReceipt(r, data);
    assert.equal(v.valid, false, data);
  }
});

test('receipts chain: each one points at the previous hash', async () => {
  const first = buildReceipt(base());
  const firstHash = await receiptHash(first);
  const second = buildReceipt(base({ invoice: { ...base().invoice, id: 'INV-1043' }, prev: firstHash }));
  const ok = await verifyReceipt(second, await anchorDataHex(second), firstHash);
  assert.equal(ok.valid, true);
  const out = await verifyReceipt(second, await anchorDataHex(second), null);
  assert.ok(out.problems.includes('receipt is out of order in the log'));
});

test('verify refuses a hand-made CLEARED receipt that breaks the rules, even with a matching anchor (audit F-07)', async () => {
  const { validateReceipt } = await import('../receipt/receipt.js');
  const good = buildReceipt(base());
  const forged = [
    (r) => { r.counterparty.verdict = 'REFUSED'; r.counterparty.codes = ['REFUSED_OWNER_MISMATCH']; },
    (r) => { r.signers = [r.signers[0]]; },
    (r) => { r.signers[1].role = 'receiver'; },
    (r) => { r.signers[1].account = r.signers[0].account; },
    (r) => { r.counterparty.card_sha256 = 'ff'.repeat(32); },
    (r) => { r.decision.codes = ['HELD_ONE_SIGNATURE']; },
    (r) => { r.extra = 'x'; },
  ];
  for (const mutate of forged) {
    const r = structuredClone(good);
    mutate(r);
    assert.ok(validateReceipt(r).length > 0, mutate.toString());
    const v = await verifyReceipt(r, await anchorDataHex(r)); // anchored "honestly" for its own hash
    assert.equal(v.valid, false, mutate.toString());
  }
  assert.deepEqual(validateReceipt(good), []);
});
