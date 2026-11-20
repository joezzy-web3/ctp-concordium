// Payment receipt for the escrow contract: the facts the caller saw when asking
// for a payment decision, in one fixed format.
//
// How it is anchored: its SHA-256 (of the canonical JSON) is sent as
// `receipt_hash` in `execute_payment`, and the contract writes it into its own
// Decision event, next to the verdict it reached and who asked. So the
// fingerprint lives inside the very decision that moved (or held) the money:
// no separate transaction, and nobody can attach it to a different decision.
//
// What it proves: this exact receipt was presented with that decision. The
// verdict itself is the contract's (the Decision event), never the receipt's,
// so the receipt does not claim one. Every fact in it can be checked against
// the chain: the order, both counts, the invoice fingerprint, the supplier's
// approval and the payout account.
// No Node-only APIs: the app bundles this file unchanged.

import { canonicalBytes, sha256Hex } from './canonical.js';

export const ESCROW_SCHEMA = 'ctp.escrow-receipt/v1';

const HEX64 = /^[0-9a-f]{64}$/;
const MICRO = /^(0|[1-9][0-9]{0,19})$/;
const ACCT = /^[1-9A-HJ-NP-Za-km-z]{50}$/;
const ROLES = ['Approver', 'Receiver'];
const KEYS = ['schema', 'network', 'escrow', 'order_id', 'supplier', 'amount_micro', 'expected_qty', 'invoice_by', 'counts', 'recounts', 'invoice', 'supplier_approval', 'payout_account', 'asked_by', 'asked_at'];

const iso = (ms) => new Date(Number(ms)).toISOString();

/**
 * Builds the receipt from the order as read from the contract just before asking.
 * @param {object} p
 * @param {string} p.network   e.g. 'concordium:testnet'
 * @param {{index:number, subindex:number}} p.escrow
 * @param {number} p.orderId
 * @param {object} p.order     decoded view_order result (app/src/codec.js decodeOrder)
 * @param {string} p.payout    the supplier's payout account
 * @param {string} p.askedBy   the account asking for the decision
 * @param {number} [p.now]     ms; defaults to the clock
 */
export function buildEscrowReceipt({ network, escrow, orderId, order: o, payout, askedBy, now = Date.now() }) {
  const r = {
    schema: ESCROW_SCHEMA,
    network,
    escrow: `<${escrow.index},${escrow.subindex}>`,
    order_id: Number(orderId),
    supplier: o.supplier,
    amount_micro: String(o.amount),
    expected_qty: String(o.expected_qty),
    invoice_by: iso(o.invoice_by),
    counts: [...o.reveals].map((x) => ({ role: x.role, account: x.signer, qty: String(x.qty) })).sort((a, b) => a.role.localeCompare(b.role)),
    recounts: Number(o.recounts ?? 0),
    invoice: o.invoice ? { sha256: o.invoice.invoice_hash, amount_micro: String(o.invoice.amount), agent: o.invoice.agent, agent_token_id: Number(o.invoice.agent_token_id) } : null,
    supplier_approval: o.supplier_approval ? { sha256: o.supplier_approval.invoice_hash, amount_micro: String(o.supplier_approval.amount) } : null,
    payout_account: payout,
    asked_by: askedBy,
    asked_at: iso(now),
  };
  const problems = validateEscrowReceipt(r);
  if (problems.length) throw new Error(`receipt: ${problems.join('; ')}`);
  return r;
}

/** Strict check of a receipt's shape. Returns the problems (empty when valid). */
export function validateEscrowReceipt(r) {
  const p = [];
  const req = (c, m) => { if (!c) p.push(m); };
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['not an object'];
  for (const k of Object.keys(r)) req(KEYS.includes(k), `unexpected field ${k}`);
  for (const k of KEYS) req(k in r, `missing field ${k}`);
  req(r.schema === ESCROW_SCHEMA, 'unknown schema');
  req(/^concordium:(testnet|mainnet)$/.test(r.network ?? ''), 'network must be concordium:testnet or concordium:mainnet');
  req(/^<\d+,\d+>$/.test(r.escrow ?? ''), 'escrow must look like <index,subindex>');
  req(Number.isSafeInteger(r.order_id) && r.order_id >= 0, 'order_id must be a whole number');
  req(ACCT.test(r.supplier ?? ''), 'supplier must be an account address');
  req(MICRO.test(r.amount_micro ?? ''), 'amount_micro must be a whole number string');
  req(MICRO.test(r.expected_qty ?? ''), 'expected_qty must be a whole number string');
  req(!Number.isNaN(Date.parse(r.invoice_by)), 'invoice_by must be an ISO time');
  req(Array.isArray(r.counts) && r.counts.length <= 2, 'counts must be a list of at most two');
  for (const c of r.counts ?? []) req(ROLES.includes(c?.role) && ACCT.test(c?.account ?? '') && MICRO.test(c?.qty ?? ''), 'each count needs role, account and qty');
  req(Number.isSafeInteger(r.recounts) && r.recounts >= 0, 'recounts must be a whole number');
  if (r.invoice !== null) req(HEX64.test(r.invoice?.sha256 ?? '') && MICRO.test(r.invoice?.amount_micro ?? '') && ACCT.test(r.invoice?.agent ?? '') && Number.isSafeInteger(r.invoice?.agent_token_id), 'invoice needs sha256, amount_micro, agent and agent_token_id');
  if (r.supplier_approval !== null) req(HEX64.test(r.supplier_approval?.sha256 ?? '') && MICRO.test(r.supplier_approval?.amount_micro ?? ''), 'supplier_approval needs sha256 and amount_micro');
  req(ACCT.test(r.payout_account ?? ''), 'payout_account must be an account address');
  req(ACCT.test(r.asked_by ?? ''), 'asked_by must be an account address');
  req(!Number.isNaN(Date.parse(r.asked_at)), 'asked_at must be an ISO time');
  return p;
}

/** The fingerprint sent to the contract as receipt_hash. */
export const escrowReceiptHash = (r) => sha256Hex(canonicalBytes(r));

/**
 * Checks a receipt against a Decision event read from the chain (decodeDecision).
 * Returns the problems (empty when the receipt is the one this decision carries).
 */
export async function checkReceiptAgainstDecision(r, d, escrow) {
  const p = validateEscrowReceipt(r);
  if (p.length) return p;
  const hash = await escrowReceiptHash(r);
  const req = (c, m) => { if (!c) p.push(m); };
  req(d.receipt_hash === hash, 'the receipt’s fingerprint is not the one in this decision (edited, or a different receipt)');
  req(escrow == null || r.escrow === `<${escrow.index},${escrow.subindex}>`, 'the decision was made by a different contract');
  req(r.order_id === Number(d.order_id), 'different order');
  req(r.asked_by === d.asked_by, 'a different account asked for this decision');
  req(!r.invoice || (r.invoice.agent === d.agent && r.invoice.agent_token_id === Number(d.agent_token_id)), 'a different agent submitted the invoice');
  if (d.verdict === 'Cleared') req(d.paid_to === r.payout_account, 'the money went to a different account than the receipt shows');
  return p;
}
