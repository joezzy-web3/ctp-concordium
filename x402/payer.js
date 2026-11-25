// The paying side of x402, for an AI agent. The agent can pay for a service on its own, but only
// inside limits written here in code, never in a prompt: one allowed payee, one allowed service
// origin, one asset, a cap per payment and a cap per day. A request outside them is refused before
// anything is signed, however the agent was asked.
//
// It pays from a separate spending wallet, never from the agent's escrow key.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { TESTNET } from './preclear.js';

const DAY_MS = 24 * 3600 * 1000;

/** Spend ledger: the payments this wallet made, kept on this computer. Damaged means refuse. */
function readLedger(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error('The spending record is damaged, so no payment is made. Check it, or remove it to start a new one.');
  }
}

/**
 * @param {object} o
 * @param {object} o.scheme          an x402 client scheme for Concordium (signs as the spending wallet)
 * @param {string} o.payTo           the only account this wallet may pay
 * @param {string} o.origin          the only service origin it may pay, e.g. https://cleartopay-concordium.vercel.app
 * @param {string} [o.asset]         the only asset it may pay in
 * @param {bigint} o.maxPerPayment   in atomic units
 * @param {bigint} o.maxPerDay       in atomic units
 * @param {string} o.ledgerPath
 * @param {Function} [o.fetch]
 * @param {() => number} [o.now]
 */
export function makePayer({ scheme, payTo, origin, asset = 'CCD', maxPerPayment, maxPerDay, ledgerPath, fetch: fetchImpl = fetch, now = Date.now }) {
  // The library's own spend controls too, so the per-payment cap is checked twice: here and in x402.
  const client = new x402Client().register(TESTNET, scheme)
    .setSpendControls({ allowedAssets: [{ network: TESTNET, asset, maxAmountPerPayment: maxPerPayment.toString() }] });

  /** Spent in the last 24 hours. */
  const spentToday = () => readLedger(ledgerPath).filter((e) => now() - e.at < DAY_MS).reduce((s, e) => s + BigInt(e.amount), 0n);

  // One payment at a time, so two calls at once can never both pass the daily cap (audit X2).
  let queue = Promise.resolve();
  const pay = (url) => { const run = queue.then(() => payOnce(url)); queue = run.catch(() => {}); return run; };
  const isRedirect = (r) => r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400);

  /** Pays for one request to `url` if it fits the limits; returns { ok, status, body, receipt } or { ok:false, refused }. */
  async function payOnce(url) {
    let u;
    try { u = new URL(url); } catch { return { ok: false, refused: 'That is not a valid address.' }; }
    if (u.origin !== origin) return { ok: false, refused: `This wallet only pays ${origin}.` };
    // Never follow redirects: the signed payment must only ever go to the allowed origin (audit X1).
    const first = await fetchImpl(url, { redirect: 'manual' });
    if (isRedirect(first)) return { ok: false, refused: 'The service tried to redirect the request elsewhere. Nothing was paid.' };
    if (first.status !== 402) return { ok: first.ok, status: first.status, body: await first.json().catch(() => null) };
    const header = first.headers.get('payment-required');
    let pr;
    try { pr = header ? decodePaymentRequiredHeader(header) : await first.json(); } catch { return { ok: false, refused: 'The service sent a payment request this wallet could not read.' }; }
    const req = (pr.accepts ?? []).find((a) => a.scheme === 'exact' && a.network === TESTNET);
    if (!req) return { ok: false, refused: 'The service did not offer a Concordium testnet payment.' };
    // The limits. Each is checked before anything is signed.
    if (req.payTo !== payTo) return { ok: false, refused: `The service asked to be paid to ${req.payTo}, not the one account this wallet may pay.` };
    if (req.asset !== asset) return { ok: false, refused: `The service asked for ${req.asset}; this wallet pays only ${asset}.` };
    let amount;
    try { amount = BigInt(req.amount); } catch { return { ok: false, refused: 'The service asked for an amount this wallet could not read.' }; }
    if (amount <= 0n) return { ok: false, refused: 'The service asked for a zero or negative amount.' };
    if (amount > maxPerPayment) return { ok: false, refused: `The service asked for ${req.amount}; the most this wallet pays at once is ${maxPerPayment}.` };
    const spent = spentToday();
    if (spent + amount > maxPerDay) return { ok: false, refused: `That would take today's spending to ${spent + amount}; the daily limit is ${maxPerDay}.` };

    const payload = await client.createPaymentPayload({ ...pr, accepts: [req] });
    // Counted before sending, so a lost answer can never let the wallet spend past its limit.
    const ledger = readLedger(ledgerPath);
    ledger.push({ at: now(), url: u.href, payTo: req.payTo, asset: req.asset, amount: req.amount });
    mkdirSync(dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });

    const second = await fetchImpl(url, { redirect: 'manual', headers: { 'payment-signature': encodePaymentSignatureHeader(payload) } });
    if (isRedirect(second)) return { ok: false, status: second.status, body: null, amount: req.amount, asset: req.asset, refused: 'The service redirected the paid request; the signed payment was not sent on. It is counted in today\u2019s spending.' };
    const body = await second.json().catch(() => null);
    const rh = second.headers.get('payment-response');
    let receipt = null;
    try { receipt = rh ? decodePaymentResponseHeader(rh) : null; } catch { /* the body still says what happened */ }
    return { ok: second.ok, status: second.status, body, receipt, amount: req.amount, asset: req.asset, spentToday: (spent + amount).toString() };
  }

  return { pay, spentToday };
}
