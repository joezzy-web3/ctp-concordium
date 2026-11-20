// Decoders for the escrow contract's view results, written against the contract's
// own Rust serialization (see test/fixtures/escrow-bytes.json and test/codec.test.js).
// Pure JavaScript, no WebAssembly, so the app stays small.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let s = '';
  while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}

/** Concordium account address -> its 32 raw bytes. Checks the version and checksum. */
export async function accountBytes(addr) {
  let n = 0n;
  for (const c of String(addr)) {
    const d = ALPHABET.indexOf(c);
    if (d < 0) throw new Error('Not a Concordium account address.');
    n = n * 58n + BigInt(d);
  }
  const all = new Uint8Array(37);
  for (let i = 36; i >= 0; i--) { all[i] = Number(n & 255n); n >>= 8n; }
  if (n !== 0n || all[0] !== 1) throw new Error('Not a Concordium account address.');
  const h1 = new Uint8Array(await crypto.subtle.digest('SHA-256', all.subarray(0, 33)));
  const h2 = new Uint8Array(await crypto.subtle.digest('SHA-256', h1));
  if (h2.subarray(0, 4).some((b, i) => b !== all[33 + i])) throw new Error('Not a Concordium account address.');
  return all.slice(1, 33);
}

/** 32 raw bytes -> Concordium account address (base58check, version 1). */
export async function accountAddress(raw) {
  const body = new Uint8Array(33);
  body[0] = 1;
  body.set(raw, 1);
  const h1 = new Uint8Array(await crypto.subtle.digest('SHA-256', body));
  const h2 = new Uint8Array(await crypto.subtle.digest('SHA-256', h1));
  const all = new Uint8Array(37);
  all.set(body);
  all.set(h2.subarray(0, 4), 33);
  return base58(all);
}

class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  need(n) { if (this.i + n > this.b.length) throw new Error('truncated contract data'); }
  u8() { this.need(1); return this.b[this.i++]; }
  u32() { this.need(4); const x = this.v.getUint32(this.i, true); this.i += 4; return x; }
  u64() { this.need(8); const x = this.v.getBigUint64(this.i, true); this.i += 8; return x; }
  raw(n) { this.need(n); const x = this.b.slice(this.i, this.i + n); this.i += n; return x; }
  bool() { const x = this.u8(); if (x > 1) throw new Error('bad bool'); return x === 1; }
  opt() { const x = this.u8(); if (x > 1) throw new Error('bad option tag'); return x === 1; }
  hex32() { return [...this.raw(32)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  role() { const t = this.u8(); if (t > 1) throw new Error('bad role'); return t === 0 ? 'Receiver' : 'Approver'; }
  done() { if (this.i !== this.b.length) throw new Error('unexpected extra contract data'); }
}

const accounts = new Map();
async function acct(r) {
  const raw = r.raw(32);
  const key = raw.join(',');
  if (!accounts.has(key)) accounts.set(key, await accountAddress(raw));
  return accounts.get(key);
}

/** Order, as returned by view_order. Amounts are micro-CCD as BigInt. */
export async function decodeOrder(bytes) {
  const r = new Reader(bytes);
  const o = {};
  o.supplier = await acct(r);
  o.receiver = await acct(r);
  o.approver = await acct(r);
  o.expected_qty = r.u64();
  o.amount = r.u64();
  o.commits = [];
  for (let n = r.u32(); n > 0; n--) o.commits.push({ signer: await acct(r), role: r.role(), hash: r.hex32() });
  o.reveals = [];
  for (let n = r.u32(); n > 0; n--) o.reveals.push({ signer: await acct(r), role: r.role(), qty: r.u64() });
  o.invoice = r.opt() ? { agent: await acct(r), agent_token_id: r.u64(), invoice_hash: r.hex32(), amount: r.u64() } : null;
  o.supplier_approval = r.opt() ? { invoice_hash: r.hex32(), amount: r.u64() } : null;
  o.paid = r.bool();
  o.refunded = r.bool();
  o.invoice_by = Number(r.u64());
  o.accepted = r.bool();
  o.date_proposal = r.opt() ? { by: await acct(r), invoice_by: Number(r.u64()) } : null;
  o.recounts = r.u8();
  r.done();
  return o;
}

export const MAX_RECOUNTS = 2;

/** Both named people unsealed, and both counts equal the ordered quantity. Same rule as the contract. */
export const deliveryConfirmed = (o) => o.reveals.length === 2 && o.reveals[0].role !== o.reveals[1].role && o.reveals.every((x) => x.qty === o.expected_qty);
/** The supplier approved the submitted invoice, for the full escrowed amount. */
export const invoiceApproved = (o) => Boolean(o.invoice && o.supplier_approval && o.supplier_approval.invoice_hash === o.invoice.invoice_hash && o.supplier_approval.amount === o.invoice.amount && o.invoice.amount === o.amount);
export const readyToPay = (o) => deliveryConfirmed(o) && invoiceApproved(o);
export const pastDue = (o, now = Date.now()) => now > o.invoice_by;
/** The buyer can take the money back: before the supplier accepts, or after the date if not ready. */
export const refundAllowed = (o, now = Date.now()) => !o.paid && !o.refunded && (!o.accepted || (pastDue(o, now) && !readyToPay(o)));
export const recountAllowed = (o, now = Date.now()) => !o.paid && !o.refunded && !pastDue(o, now) && o.reveals.length === 2 && !deliveryConfirmed(o) && o.recounts < MAX_RECOUNTS;

/** Supplier, as returned by view_supplier. payout_set_at is milliseconds since 1970. */
export async function decodeSupplier(bytes) {
  const r = new Reader(bytes);
  const s = { payout: await acct(r), payout_set_at: Number(r.u64()) };
  r.done();
  return s;
}

/** ConfigView, as returned by view_config. */
export async function decodeConfig(bytes) {
  const r = new Reader(bytes);
  const c = { admin: await acct(r) };
  c.pending_admin = r.opt() ? await acct(r) : null;
  c.hold_ms = Number(r.u64());
  c.registry = { index: Number(r.u64()), subindex: Number(r.u64()) };
  r.done();
  return c;
}

/** Where an order stands, in words a person understands, from its decoded state. */
export function orderStage(o, supplier, holdMs, now = Date.now()) {
  if (o.refunded) return { key: 'refunded', label: 'Refunded', tone: 'mute' };
  if (o.paid) return { key: 'paid', label: 'Paid', tone: 'ok' };
  if (pastDue(o, now) && !readyToPay(o)) return { key: 'expired', label: 'Date passed, not ready: buyer can take the money back', tone: 'hold' };
  if (!o.accepted) return { key: 'accept', label: 'Waiting for the supplier to accept', tone: 'wait' };
  if (o.commits.length < 2) return { key: 'counting', label: `Counting: ${o.commits.length} of 2 sealed`, tone: 'wait' };
  if (o.reveals.length < 2) return { key: 'revealing', label: `Revealing: ${o.reveals.length} of 2`, tone: 'wait' };
  if (o.reveals.some((x) => x.qty !== o.expected_qty)) return { key: 'mismatch', label: o.recounts < MAX_RECOUNTS ? 'Counts do not match: recount possible' : 'Counts do not match, no recounts left', tone: 'hold' };
  if (!o.invoice) return { key: 'invoice', label: 'Waiting for the invoice', tone: 'wait' };
  const approved = o.supplier_approval && o.supplier_approval.invoice_hash === o.invoice.invoice_hash && o.supplier_approval.amount === o.invoice.amount;
  if (!approved) return { key: 'approval', label: 'Waiting for the supplier to approve', tone: 'wait' };
  if (o.invoice.amount !== o.amount) return { key: 'amount', label: 'Invoice amount differs from the escrow', tone: 'hold' };
  const free = supplier ? supplier.payout_set_at + holdMs : 0;
  if (now < free) return { key: 'hold', label: 'Ready, payout hold running', tone: 'hold', until: free };
  return { key: 'ready', label: 'Ready to pay', tone: 'ok' };
}

export const microToCcd = (m) => {
  const s = BigInt(m).toString().padStart(7, '0');
  const whole = s.slice(0, -6).replace(/^0+(?=\d)/, '');
  const frac = s.slice(-6).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
};

/** "12.5" -> 12500000n micro-CCD, or null if not a valid amount. */
export function ccdToMicro(s) {
  const t = String(s ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return BigInt(w) * 1000000n + BigInt((f + '000000').slice(0, 6));
}


export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Bytes a signer hashes to seal a count. Same layout as contract/src/rules.rs commit_preimage:
 *  "CTP-count/v2" ‖ order id (u64 LE) ‖ signer account (32 bytes) ‖ qty (u64 LE) ‖ key (32 bytes). */
export function sealPreimage(orderId, signer, qty, key) {
  const pre = new Uint8Array(92);
  pre.set(new TextEncoder().encode('CTP-count/v2'), 0);
  const dv = new DataView(pre.buffer);
  dv.setBigUint64(12, BigInt(orderId), true);
  pre.set(signer, 20);
  dv.setBigUint64(52, BigInt(qty), true);
  pre.set(key, 60);
  return pre;
}
/** Seal for `signerAddress` (base58). The signer's own account is inside the seal. */
export async function sealOf(orderId, signerAddress, qty, key) {
  const signer = await accountBytes(signerAddress);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', sealPreimage(orderId, signer, qty, key))));
}
