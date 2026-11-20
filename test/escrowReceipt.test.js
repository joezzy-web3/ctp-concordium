// Payment receipts: built from the order, fingerprinted into the contract's Decision event,
// and checked against that event. Decision bytes come from the contract's own serializer
// (test/fixtures/escrow-bytes.json, checked by contract/tests/escrow.rs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeOrder, decodeDecision } from '../app/src/codec.js';
import { buildEscrowReceipt, escrowReceiptHash, validateEscrowReceipt, checkReceiptAgainstDecision, compareReceiptWithOrder, ESCROW_SCHEMA } from '../receipt/escrowReceipt.js';
import { canonicalize } from '../receipt/canonical.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/escrow-bytes.json', import.meta.url)));
const hex = (s) => Uint8Array.from(s.match(/../g).map((x) => parseInt(x, 16)));
const S = '45H81t8SBw5z84LjPcX3VFZRWPrcEKv3bTbao8yC5hbP2BixMY';
const AG = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
const AP = '3byivDufzZzRRFasdEcL6pYM9zyyER73kaYvraPWb1rVixy9pA';
const ESCROW = { index: 13098, subindex: 0 };

const readyOrder = async () => {
  const o = await decodeOrder(hex(F.order_full));
  return { ...o, reveals: [...o.reveals, { signer: AP, role: 'Approver', qty: 100n }] };
};
const build = async (over = {}) => buildEscrowReceipt({ network: 'concordium:testnet', escrow: ESCROW, orderId: 1, order: await readyOrder(), payout: S, askedBy: S, now: Date.UTC(2026, 10, 20, 13, 32), ...over });

test('decodes the contract Decision event, cleared and held', async () => {
  const c = await decodeDecision(hex(F.decision_cleared));
  assert.deepEqual(c, { order_id: 1, verdict: 'Cleared', codes: [], agent: AG, agent_token_id: 1287, receipt_hash: 'ab'.repeat(32), paid_to: S, at: 1795181528000, asked_by: S });
  const h = await decodeDecision(hex(F.decision_held));
  assert.equal(h.verdict, 'Held');
  assert.deepEqual(h.codes, ['HeldNoSupplierApproval', 'HeldPayoutCoolOff']);
  assert.equal(h.paid_to, null);
  assert.equal(h.asked_by, AG);
  // Any other event is not a Decision; truncated or extra bytes are refused.
  assert.equal(await decodeDecision(hex('0b' + F.decision_cleared.slice(2))), null);
  await assert.rejects(decodeDecision(hex(F.decision_cleared.slice(0, -2))), /truncated/);
  await assert.rejects(decodeDecision(hex(F.decision_cleared + '00')), /extra/);
});

test('a receipt records the order as the contract holds it', async () => {
  const r = await build();
  assert.equal(r.schema, ESCROW_SCHEMA);
  assert.deepEqual(validateEscrowReceipt(r), []);
  assert.equal(r.escrow, '<13098,0>');
  assert.equal(r.amount_micro, '25000000');
  assert.deepEqual(r.counts.map((c) => [c.role, c.qty]), [['Approver', '100'], ['Receiver', '100']]);
  assert.equal(r.invoice.sha256, 'cd'.repeat(32));
  assert.equal(r.invoice.agent_token_id, 1287);
  assert.equal(r.supplier_approval.amount_micro, '25000000');
  assert.equal(r.invoice_by, '2026-11-19T19:43:00.000Z');
  // Same facts, same fingerprint, in any key order.
  const h = await escrowReceiptHash(r);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await escrowReceiptHash(JSON.parse(JSON.stringify(r))), h);
  assert.equal(canonicalize(r).includes(' '), false);
});

test('a receipt matches the decision that carries its fingerprint', async () => {
  const r = await build();
  const d = { ...(await decodeDecision(hex(F.decision_cleared))), receipt_hash: await escrowReceiptHash(r) };
  assert.deepEqual(await checkReceiptAgainstDecision(r, d, ESCROW), []);
});

test('an edited receipt, or one shown with another decision, is caught', async () => {
  const r = await build();
  const d = { ...(await decodeDecision(hex(F.decision_cleared))), receipt_hash: await escrowReceiptHash(r) };
  const edited = { ...r, payout_account: AG };
  assert.match((await checkReceiptAgainstDecision(edited, d, ESCROW)).join(), /fingerprint/);
  assert.match((await checkReceiptAgainstDecision(edited, d, ESCROW)).join(), /different account/);
  assert.match((await checkReceiptAgainstDecision(r, { ...d, order_id: 2 }, ESCROW)).join(), /different order/);
  assert.match((await checkReceiptAgainstDecision(r, { ...d, asked_by: AG }, ESCROW)).join(), /asked/);
  assert.match((await checkReceiptAgainstDecision(r, d, { index: 13092, subindex: 0 })).join(), /different contract/);
  assert.match((await checkReceiptAgainstDecision({ ...r, extra: 1 }, d, ESCROW)).join(), /unexpected field/);
});

test('a receipt cannot be built from a malformed order', async () => {
  await assert.rejects(build({ payout: 'nope' }), /payout_account/);
  await assert.rejects(build({ askedBy: '' }), /asked_by/);
});

test('a receipt’s facts are compared with the order the contract holds', async () => {
  const order = await readyOrder();
  const r = await build();
  assert.deepEqual(compareReceiptWithOrder(r, order), []);
  const otherCount = { ...order, reveals: order.reveals.map((x, i) => (i ? { ...x, qty: 99n } : x)) };
  assert.match(compareReceiptWithOrder(r, otherCount).join(), /counts differ/);
  assert.match(compareReceiptWithOrder(r, { ...order, supplier_approval: null }).join(), /supplier approval differs/);
  assert.match(compareReceiptWithOrder({ ...r, amount_micro: '1' }, order).join(), /escrowed amount differs/);
  assert.match(compareReceiptWithOrder(r, { ...order, ruled_delivered: !order.ruled_delivered }).join(), /referee ruling/);
});
