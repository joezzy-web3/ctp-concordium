// Accountability receipt: one fixed-format record per payment decision.
//
// What it records: the invoice, the badge-gate result for the agent that sent
// it, the verdict and reason codes, which humans signed, and which registered
// agent (Agent #1287) made the decision.
// What goes on-chain: only a 36-byte tag + SHA-256, via Concordium's built-in
// RegisterData transaction. Invoice data stays off-chain; a random salt in
// every receipt means the hash reveals nothing about it.
// Receipts can link to the previous one (prev), forming a tamper-evident log.
//
// The receipt also enforces the accountability rules at build time:
// - it cannot say CLEARED unless the counterparty gate said CLEARED;
// - it cannot say CLEARED without two different human signers.

import { canonicalBytes, canonicalize, sha256Hex } from './canonical.js';

export const SCHEMA = 'ctp.receipt/v1';
export const ANCHOR_TAG_HEX = '43545031'; // ASCII "CTP1": marks our RegisterData payloads
const VERDICTS = new Set(['CLEARED', 'HELD', 'REFUSED', 'SEIZED']);
const AMOUNT_RE = /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,8})?$/;
const HEX64 = /^[0-9a-f]{64}$/;

function need(cond, msg) {
  if (!cond) throw new Error(`receipt: ${msg}`);
}

function randomSaltHex() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds a receipt. Throws if the decision breaks an accountability rule.
 * @param {object} d
 * @param {{id:string, supplier:string, amount:string, currency:string, po?:string}} d.invoice
 * @param {{verdict:string, codes:string[], evidence:object}} d.gate  result of checkCounterparty
 * @param {string} d.verdict    final decision: CLEARED | HELD | REFUSED | SEIZED
 * @param {string[]} d.codes     reason codes behind the decision
 * @param {{role:string, account:string, signed_at:string}[]} [d.signers]
 * @param {{agent_id:number, badge:string, network:string}} d.decided_by
 * @param {string} d.decided_at  ISO time
 * @param {string|null} [d.prev] hash of the previous receipt, or null
 * @param {string} [d.salt]      32 hex chars; random if omitted
 */
export function buildReceipt(d) {
  const inv = d?.invoice ?? {};
  need(typeof inv.id === 'string' && inv.id, 'invoice.id is required');
  need(typeof inv.supplier === 'string' && inv.supplier, 'invoice.supplier is required');
  need(typeof inv.amount === 'string' && AMOUNT_RE.test(inv.amount), 'invoice.amount must be a decimal string like "1250.00"');
  need(typeof inv.currency === 'string' && /^[A-Z]{3,5}$/.test(inv.currency), 'invoice.currency must be a code like "EUR"');
  need(VERDICTS.has(d.verdict), `verdict must be one of ${[...VERDICTS].join(', ')}`);
  need(Array.isArray(d.codes) && d.codes.every((c) => typeof c === 'string'), 'codes must be a list of strings');
  need(d.verdict === 'CLEARED' ? d.codes.length === 0 : d.codes.length > 0, 'CLEARED has no codes; any other verdict needs at least one');

  const gate = d.gate ?? {};
  need(['CLEARED', 'HELD', 'REFUSED'].includes(gate.verdict), 'gate result is required');

  const signers = (d.signers ?? []).map((s) => {
    need(typeof s?.role === 'string' && typeof s?.account === 'string' && typeof s?.signed_at === 'string', 'each signer needs role, account, signed_at');
    return { role: s.role, account: s.account, signed_at: s.signed_at };
  });

  if (d.verdict === 'CLEARED') {
    need(gate.verdict === 'CLEARED', 'cannot clear a payment when the sending agent did not pass the badge gate');
    need(new Set(signers.map((s) => s.account)).size >= 2, 'cannot clear a payment without two different human signers');
  }

  const by = d.decided_by ?? {};
  need(Number.isSafeInteger(by.agent_id) && typeof by.badge === 'string' && typeof by.network === 'string', 'decided_by needs agent_id, badge, network');
  need(typeof d.decided_at === 'string' && !Number.isNaN(Date.parse(d.decided_at)), 'decided_at must be an ISO time');
  need(d.prev == null || HEX64.test(d.prev), 'prev must be a 64-char lowercase hex hash or null');
  const salt = d.salt ?? randomSaltHex();
  need(/^[0-9a-f]{32}$/.test(salt), 'salt must be 32 lowercase hex chars');

  const ev = gate.evidence ?? {};
  return {
    schema: SCHEMA,
    invoice: { id: inv.id, supplier: inv.supplier, amount: inv.amount, currency: inv.currency, po: inv.po ?? null },
    counterparty: {
      verdict: gate.verdict,
      codes: [...(gate.codes ?? [])],
      badge: ev.badge ?? null,
      token_id: ev.token_id ?? null,
      owner: ev.owner ?? null,
      status: ev.status ?? null,
      on_chain_hash: ev.on_chain_hash ?? null,
      card_sha256: ev.card_sha256 ?? null,
      checked_at: ev.checked_at ?? null,
      network: ev.network ?? null,
    },
    decision: { verdict: d.verdict, codes: [...d.codes] },
    signers,
    decided_by: { agent_id: by.agent_id, badge: by.badge, network: by.network },
    decided_at: d.decided_at,
    prev: d.prev ?? null,
    salt,
  };
}

/** SHA-256 (hex) of the receipt's canonical bytes. */
export async function receiptHash(receipt) {
  return sha256Hex(canonicalBytes(receipt));
}

/** The RegisterData payload (hex): "CTP1" tag + 32-byte receipt hash = 36 bytes. */
export async function anchorDataHex(receipt) {
  return ANCHOR_TAG_HEX + (await receiptHash(receipt));
}

/**
 * Checks a receipt against the data registered on-chain.
 * @param {object} receipt
 * @param {string} onChainDataHex  data field of the RegisterData transaction
 * @param {string|null} [expectedPrev] hash the previous receipt in the log had
 */
export async function verifyReceipt(receipt, onChainDataHex, expectedPrev) {
  const problems = [];
  let hash = null;
  try {
    canonicalize(receipt);
    hash = await receiptHash(receipt);
  } catch (e) {
    problems.push(`not a valid receipt: ${e.message}`);
  }
  if (receipt?.schema !== SCHEMA) problems.push('unknown schema');
  const data = String(onChainDataHex ?? '').toLowerCase();
  if (!data.startsWith(ANCHOR_TAG_HEX) || data.length !== 72) problems.push('on-chain data is not a Clear to Pay anchor');
  else if (hash && data.slice(8) !== hash) problems.push('receipt was changed after it was anchored');
  if (expectedPrev !== undefined && (receipt?.prev ?? null) !== expectedPrev) problems.push('receipt is out of order in the log');
  return { valid: problems.length === 0, hash, problems };
}
