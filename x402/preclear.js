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
export function makePreclear({ facilitator, chainFor, payTo, price = DEFAULT_PRICE, asset = 'CCD', network = TESTNET, defaultEscrow }) {
  const server = new x402ResourceServer(facilitator).register(network, new ExactConcordiumScheme());
  let ready = null;
  const init = () => (ready ??= server.initialize().catch((e) => { ready = null; throw e; }));

  /** Handles one HTTP request. `url` is the full request URL; `headers` a lower-cased header map. */
  return async function handle({ url, headers = {} }) {
    const u = new URL(url);
    const escrow = Number(u.searchParams.get('escrow') ?? defaultEscrow);
    const orderId = Number(u.searchParams.get('order'));
    if (!Number.isSafeInteger(escrow) || escrow <= 0 || !Number.isSafeInteger(orderId) || orderId <= 0) {
      return json(400, { error: 'bad_request', message: 'Give ?order=<number> (and optionally ?escrow=<index>).' });
    }
    // The resource is this exact question, so a payment for one order cannot be replayed for another.
    const resource = { url: `${u.origin}${u.pathname}?escrow=${escrow}&order=${orderId}`, description: `Pre-clear order #${orderId} on Clear to Pay escrow <${escrow},0>: would it clear now?`, mimeType: 'application/json' };

    const chain = chainFor(escrow);
    try { await chain.checkVerified(); } catch (e) { return json(400, { error: 'unverified_escrow', message: e.message }); }
    let order;
    try { order = await chain.viewOrder(orderId); } catch (e) { return json(404, { error: 'unknown_order', message: e.message }); }

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
    return json(200, {
      escrow: `<${escrow},0>`, order: orderId, ...answer,
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
