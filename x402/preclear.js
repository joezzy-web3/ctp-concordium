// Pre-clear: a paid x402 service. Before a supplier (or its agent) sends an invoice, it can ask
// Clear to Pay's Agent #1287 "would this order clear if payment were asked for now?" The answer
// costs a small fee, paid over x402 to the agent's own account: the agent gets paid for its work.
//
// The answer is the escrow contract's own dry run (execute_payment, simulated as the supplier),
// so it is never the agent's opinion. Nothing is sent to the escrow; only the fee moves.
//
// This module takes its facilitator and its chain access as arguments, so tests run it offline.
// api/preclear.js wires it to the real Concordium testnet.
import { x402ResourceServer } from '@x402/core/server';
import { ExactConcordiumScheme } from '@x402/concordium/exact/server';
import { encodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { CODE_TEXT } from '../app/src/errors.js';
import { executeParams } from '../mcp/escrow.js';

export const TESTNET = 'ccd:4221332d34e1694168c2a0c0b3fd0f27';
/** 0.01 CCD, in microCCD. */
export const DEFAULT_PRICE = '10000';
const ZERO = '0'.repeat(64);
import { orderChecks } from './checks.js';

const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }, body });

/**
 * @param {object} o
 * @param {{verify:Function, settle:Function, getSupported:Function}} o.facilitator  x402 facilitator (in-process or HTTP)
 * @param {(escrow:number) => {viewOrder:Function, simulate:Function, checkVerified:Function}} o.chainFor
 * @param {string} o.payTo  account that receives the fee (Agent #1287's owner)
 * @param {string} [o.price] fee in microCCD
 * @param {string} [o.asset] 'CCD', or a PLT symbol once one is issued
 * @param {string} [o.network]
 * @param {number} [o.defaultEscrow]
 */
export function makePreclear({ facilitator, chainFor, payTo, price = DEFAULT_PRICE, asset = 'CCD', network = TESTNET, defaultEscrow, ratePerMinute = 30, now = Date.now }) {
  const server = new x402ResourceServer(facilitator).register(network, new ExactConcordiumScheme());
  let ready = null;
  const init = () => (ready ??= server.initialize().catch((e) => { ready = null; throw e; }));

  // Unpaid requests cost us chain reads, not the caller (audit X4): a short cache for order reads,
  // and a per-caller rate limit (best effort, per server instance).
  const cache = new Map();
  const cached = async (key, ms, fn) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ms) return hit.value;
    const value = await fn();
    cache.set(key, { at: now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return value;
  };
  const hits = new Map();
  const limited = (who) => {
    if (!who) return false;
    const recent = (hits.get(who) ?? []).filter((at) => now() - at < 60_000);
    recent.push(now()); hits.set(who, recent);
    if (hits.size > 5000) hits.delete(hits.keys().next().value);
    return recent.length > ratePerMinute;
  };

  /** Handles one HTTP request. `url` is the full request URL; `headers` a lower-cased header map. */
  return async function handle({ url, headers = {}, caller }) {
    if (limited(caller)) return json(429, { error: 'rate_limited', message: 'Too many requests. Try again in a minute.' }, { 'retry-after': '60' });
    const u = new URL(url);
    const escrow = Number(u.searchParams.get('escrow') ?? defaultEscrow);
    const orderId = Number(u.searchParams.get('order'));
    if (!Number.isSafeInteger(escrow) || escrow <= 0 || !Number.isSafeInteger(orderId) || orderId <= 0) {
      return json(400, { error: 'bad_request', message: 'Give ?order=<number> (and optionally ?escrow=<index>).' });
    }
    // The resource is this exact question, so a payment for one order cannot be replayed for another.
    const resource = { url: `${u.origin}${u.pathname}?escrow=${escrow}&order=${orderId}`, description: `Pre-clear order #${orderId} on Clear to Pay escrow <${escrow},0>: would it clear now?`, mimeType: 'application/json' };

    const chain = chainFor(escrow);
    try { await cached(`v:${escrow}`, 10 * 60_000, () => chain.checkVerified()); } catch (e) { return json(400, { error: 'unverified_escrow', message: e.message }); }
    let order;
    try { order = await cached(`o:${escrow}:${orderId}`, 5_000, () => chain.viewOrder(orderId)); } catch (e) { return json(404, { error: 'unknown_order', message: e.message }); }

    await init();
    const [requirements] = await server.buildPaymentRequirements({ scheme: 'exact', network, payTo, price: { amount: price, asset }, maxTimeoutSeconds: 120 });

    const sig = headers['payment-signature'] ?? headers['x-payment'];
    if (!sig) {
      const pr = await server.createPaymentRequiredResponse([requirements], resource);
      return json(402, pr, { 'payment-required': encodePaymentRequiredHeader(pr) });
    }

    let payload;
    try { payload = decodePaymentSignatureHeader(sig); } catch { return json(400, { error: 'bad_payment', message: 'The payment header could not be read.' }); }
    const v = await server.verifyPayment(payload, requirements);
    if (!v.isValid) {
      const pr = await server.createPaymentRequiredResponse([requirements], resource, v.invalidReason ?? 'invalid_payment');
      return json(402, pr, { 'payment-required': encodePaymentRequiredHeader(pr) });
    }
    // Settle first: the answer is only given once the fee is final on-chain.
    const settled = await server.settlePayment(payload, requirements);
    if (!settled.success) {
      const pr = await server.createPaymentRequiredResponse([requirements], resource, settled.errorReason ?? 'settlement_failed');
      return json(402, pr, { 'payment-required': encodePaymentRequiredHeader(pr) });
    }

    // The contract's own answer, simulated as the supplier (the rules are the same whoever asks).
    const sim = await chain.simulate('execute_payment', executeParams(orderId, ZERO), order.supplier);
    const d = sim.ok ? sim.decisions[0] : null;
    const answer = !sim.ok
      ? { verdict: 'Refused', reason: sim.error, explain: sim.explain }
      : { verdict: d?.verdict ?? 'Unknown', codes: d?.codes ?? [], reasons: (d?.codes ?? []).map((c) => CODE_TEXT[c] ?? c) };
    // The checklist behind the verdict: delivery, invoice, payout account and its hold, deadline.
    let checks = null;
    try {
      const [supplier, config] = await Promise.all([chain.viewSupplier?.(order.supplier) ?? null, chain.viewConfig?.() ?? null]);
      checks = orderChecks(order, supplier, config, now());
    } catch { checks = null; }
    return json(200, {
      escrow: `<${escrow},0>`, order: orderId, ...answer, checks,
      note: 'The escrow contract’s own dry run. Nothing was sent to the escrow; only the fee moved.',
      fee: { amount: price, asset, payTo, payer: settled.payer, transaction: settled.transaction, network: settled.network },
    }, { 'payment-response': encodePaymentResponseHeader(settled) });
  };
}

/** Adapts an in-process x402Facilitator to the FacilitatorClient the resource server expects. */
export const localFacilitator = (f) => ({
  verify: (p, r) => f.verify(p, r),
  settle: (p, r) => f.settle(p, r),
  getSupported: async () => f.getSupported(),
});
