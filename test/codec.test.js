import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeOrder, decodeSupplier, decodeConfig, refundAllowed, recountAllowed, readyToPay, orderStage, microToCcd, accountAddress, ccdToMicro, sealPreimage, sealOf, accountBytes as addrBytes } from '../app/src/codec.js';
import { createHash } from 'node:crypto';
import { accountBytes } from '../link/encode.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/escrow-bytes.json', import.meta.url)));
const hex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const R = '3NrB4khEwjL32cM8qVsay6iHTRznthBFPNCG6GvmLNQygyVE2S', AP = '3byivDufzZzRRFasdEcL6pYM9zyyER73kaYvraPWb1rVixy9pA', S = '45H81t8SBw5z84LjPcX3VFZRWPrcEKv3bTbao8yC5hbP2BixMY', AG = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';

test('account addresses round-trip through base58check', async () => {
  for (const a of [R, AP, S, AG]) assert.equal(await accountAddress(accountBytes(a)), a);
});

test('decodes a full order exactly as the contract serialized it', async () => {
  const o = await decodeOrder(hex(F.order_full));
  assert.equal(o.supplier, S); assert.equal(o.receiver, R); assert.equal(o.approver, AP);
  assert.equal(o.expected_qty, 100n); assert.equal(o.amount, 25000000n);
  assert.deepEqual(o.commits.map((c) => [c.signer, c.role, c.hash.slice(0, 2)]), [[R, 'Receiver', '11'], [AP, 'Approver', '22']]);
  assert.deepEqual(o.reveals, [{ signer: R, role: 'Receiver', qty: 100n }]);
  assert.deepEqual(o.invoice, { agent: AG, agent_token_id: 1287n, invoice_hash: 'cd'.repeat(32), amount: 25000000n });
  assert.deepEqual(o.supplier_approval, { invoice_hash: 'cd'.repeat(32), amount: 25000000n });
  assert.equal(o.paid, false); assert.equal(o.refunded, false);
  assert.equal(o.invoice_by, 1795117380000); assert.equal(o.accepted, true);
  assert.deepEqual(o.date_proposal, { by: S, invoice_by: 1795203780000 });
  assert.equal(o.recounts, 1);
});

test('decodes the contract config, including the registry it asks', async () => {
  const BUYER = '4QzE6ZTUg2j5FCH4fxyvNLEvcmuY3w8PrTZ66qjqocycEmTthG';
  assert.deepEqual(await decodeConfig(hex(F.config)), { admin: BUYER, pending_admin: AG, hold_ms: 60000, registry: { index: 12802, subindex: 0 } });
});

test('refund, recount and payment rules mirror the contract', async () => {
  const o = await decodeOrder(hex(F.order_full));
  const due = o.invoice_by;
  const fresh = { ...o, accepted: false };
  assert.equal(refundAllowed(fresh, due - 1), true, 'before the supplier accepts');
  assert.equal(refundAllowed(o, due - 1), false, 'accepted, before the date');
  assert.equal(refundAllowed(o, due + 1), true, 'after the date, not ready (one reveal)');
  const R2 = { signer: AP, role: 'Approver', qty: 100n };
  const ready = { ...o, reveals: [...o.reveals, R2], invoice: { ...o.invoice }, supplier_approval: { ...o.supplier_approval } };
  assert.equal(readyToPay(ready), true);
  assert.equal(refundAllowed(ready, due + 1), false, 'ready by the date: locked for the supplier');
  const short = { ...ready, reveals: [o.reveals[0], { ...R2, qty: 90n }] };
  assert.equal(recountAllowed(short, due - 1), true);
  assert.equal(recountAllowed({ ...short, recounts: 2 }, due - 1), false, 'no recounts left');
  assert.equal(recountAllowed(short, due + 1), false, 'past the date');
  assert.equal(recountAllowed(ready, due - 1), false, 'counts agree');
  assert.equal(orderStage({ ...o, accepted: false }, null, 0, due - 1).key, 'accept');
  assert.equal(orderStage(o, null, 0, due + 1).key, 'expired');
});

test('decodes an empty, paid order', async () => {
  const o = await decodeOrder(hex(F.order_empty));
  assert.equal(o.expected_qty, 7n); assert.equal(o.amount, 1n);
  assert.deepEqual([o.commits, o.reveals, o.invoice, o.supplier_approval, o.paid], [[], [], null, null, true]);
  assert.deepEqual([o.accepted, o.date_proposal, o.recounts], [false, null, 0]);
});

test('decodes a supplier record', async () => {
  assert.deepEqual(await decodeSupplier(hex(F.supplier)), { payout: S, payout_set_at: 1795117380000 });
});

test('refuses truncated or padded data', async () => {
  await assert.rejects(decodeOrder(hex(F.order_full).slice(0, -1)), /truncated/);
  await assert.rejects(decodeSupplier(hex(F.supplier + '00')), /extra/);
  const badTag = F.order_empty.slice(0, -4) + '02' + F.order_empty.slice(-2);
  await assert.rejects(decodeOrder(hex(badTag)), /option/);
});

test('order stage reads like a person would say it', async () => {
  const o = await decodeOrder(hex(F.order_full));
  assert.equal(orderStage(o, null, 0, 1000).key, 'revealing');
  o.reveals.push({ signer: AP, role: 'Approver', qty: 100n });
  const sup = { payout_set_at: 1000 };
  assert.equal(orderStage(o, sup, 500, 1200).key, 'hold');
  assert.equal(orderStage(o, sup, 500, 1500).key, 'ready');
  o.supplier_approval.amount = 1n;
  assert.equal(orderStage(o, sup, 500, 1500).key, 'approval');
  assert.equal(orderStage({ ...o, paid: true }, sup, 0).label, 'Paid');
});

test('micro-CCD formats without float errors', () => {
  assert.equal(microToCcd(25000000n), '25');
  assert.equal(microToCcd(1n), '0.000001');
  assert.equal(microToCcd(1234567n), '1.234567');
});

test('seal layout matches contract/src/rules.rs commit_preimage', async () => {
  const key = new Uint8Array(32).fill(9);
  const signer = new Uint8Array(32).fill(3);
  const p = sealPreimage(7, signer, 100, key);
  assert.equal(p.length, 92);
  assert.equal(Buffer.from(p.subarray(0, 12)).toString(), 'CTP-count/v2');
  assert.deepEqual([...p.subarray(12, 20)], [7, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...p.subarray(20, 52)], [...signer]);
  assert.deepEqual([...p.subarray(52, 60)], [100, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...p.subarray(60)], [...key]);
  const addr = await accountAddress(signer);
  assert.deepEqual([...await addrBytes(addr)], [...signer]);
  assert.equal(await sealOf(7, addr, 100, key), createHash('sha256').update(p).digest('hex'));
});

test('a seal is bound to its signer', async () => {
  const key = new Uint8Array(32).fill(9);
  const a = await accountAddress(new Uint8Array(32).fill(2));
  const b = await accountAddress(new Uint8Array(32).fill(3));
  assert.notEqual(await sealOf(7, a, 100, key), await sealOf(7, b, 100, key));
  await assert.rejects(addrBytes(a.slice(0, -1) + (a.endsWith('1') ? '2' : '1')));
  await assert.rejects(addrBytes('0OIl'));
});

test('CCD amounts parse exactly', () => {
  assert.equal(ccdToMicro('25'), 25000000n);
  assert.equal(ccdToMicro('0.25'), 250000n);
  assert.equal(ccdToMicro('1.000001'), 1000001n);
  for (const bad of ['', '-1', '1.0000001', '1e3', 'abc', '1,5']) assert.equal(ccdToMicro(bad), null, bad);
});
