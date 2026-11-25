// x402 pre-clear: the paid service (Agent #1287 gets paid) and the capped payer (an agent pays).
// Offline: the facilitator and the chain are fakes; the x402 messages are the real ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { makePreclear, TESTNET, DEFAULT_PRICE } from '../x402/preclear.js';
import { makePayer } from '../x402/payer.js';

const AGENT = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
const SPONSOR = '3Mqk4VdfeXFFZXQ57FjR6AmML2Dgpz8a8j9AQ4NeUWSf2q2nGH';
const SUPPLIER = '45H81t8SBw5z84LjPcX3VFZRWPrcEKv3bTbao8yC5hbP2BixMY';
const PAYER = '3NrB4khEwjL32cM8qVsay6iHTRznthBFPNCG6GvmLNQygyVE2S';
const ORIGIN = 'https://cleartopay-concordium.vercel.app';
const URL1 = `${ORIGIN}/api/preclear?escrow=13155&order=1`;

/** A facilitator that checks the payload names the right payee and amount, like rules 4 and 5. */
function fakeFacilitator() {
  const calls = { verify: 0, settle: 0 };
  const ok = (p, r) => p.payload?.to === r.payTo && p.payload?.amount === r.amount && p.payload?.sponsor === SPONSOR;
  return {
    calls,
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: TESTNET, extra: { feePayer: SPONSOR } }], extensions: [], signers: {} }),
    verify: async (p, r) => { calls.verify++; return ok(p, r) ? { isValid: true, payer: p.payload.sender } : { isValid: false, invalidReason: 'recipient_mismatch' }; },
    settle: async (p, r) => { calls.settle++; return ok(p, r) ? { success: true, payer: p.payload.sender, transaction: 'ab'.repeat(32), network: TESTNET } : { success: false, errorReason: 'recipient_mismatch', transaction: '', network: TESTNET }; },
  };
}

function fakeChain({ verified = true, verdict = { verdict: 'Held', codes: ['HeldNoSupplierApproval'] } } = {}) {
  const sims = [];
  return {
    sims,
    checkVerified: async () => { if (!verified) throw new Error('Escrow <9,0> is not running the verified Clear to Pay code.'); },
    viewOrder: async (id) => { if (id !== 1) { throw new Error('There is no order with this number.'); } return { id, supplier: SUPPLIER }; },
    simulate: async (m, bytes, invoker) => { sims.push({ m, invoker }); return { ok: true, decisions: [{ ...verdict, paid_to: null }] }; },
  };
}

/** A client scheme that "signs" by naming payee, amount and sponsor, as a real V1 sponsored transfer would. */
function fakeClientScheme(counter = { n: 0 }) {
  return {
    scheme: 'exact',
    counter,
    createPaymentPayload: async (v, req) => { counter.n++; return { x402Version: v, payload: { sender: PAYER, to: req.payTo, amount: req.amount, sponsor: req.extra?.feePayer } }; },
  };
}

const service = (opts = {}) => {
  const facilitator = opts.facilitator ?? fakeFacilitator();
  const chain = opts.chain ?? fakeChain();
  return { facilitator, chain, handle: makePreclear({ facilitator, chainFor: () => chain, payTo: AGENT, defaultEscrow: 13155 }) };
};

/** fetch that routes to the handler, as a real HTTP client would. */
const fetchTo = (handle) => async (url, init = {}) => {
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const out = await handle({ url, headers });
  return new Response(JSON.stringify(out.body), { status: out.status, headers: out.headers });
};

test('without payment the service answers 402 with Concordium requirements: Agent #1287 is paid, the sponsor pays gas', async () => {
  const { handle, facilitator, chain } = service();
  const out = await handle({ url: URL1 });
  assert.equal(out.status, 402);
  const pr = decodePaymentRequiredHeader(out.headers['payment-required']);
  assert.equal(pr.accepts.length, 1);
  const [r] = pr.accepts;
  assert.equal(r.scheme, 'exact');
  assert.equal(r.network, TESTNET);
  assert.equal(r.payTo, AGENT);
  assert.equal(r.asset, 'CCD');
  assert.equal(r.amount, DEFAULT_PRICE);
  assert.equal(r.extra.feePayer, SPONSOR);
  assert.match(pr.resource.url, /escrow=13155&order=1$/);
  assert.equal(facilitator.calls.verify + facilitator.calls.settle, 0);
  assert.equal(chain.sims.length, 0, 'no answer without payment');
});

test('a valid payment is verified and settled before the contract’s own dry run is returned', async () => {
  const { handle, facilitator, chain } = service();
  const pr = decodePaymentRequiredHeader((await handle({ url: URL1 })).headers['payment-required']);
  const [req] = pr.accepts;
  const payload = { x402Version: 2, resource: pr.resource, accepted: req, payload: { sender: PAYER, to: req.payTo, amount: req.amount, sponsor: SPONSOR } };
  const out = await handle({ url: URL1, headers: { 'payment-signature': encodePaymentSignatureHeader(payload) } });
  assert.equal(out.status, 200);
  assert.equal(out.body.verdict, 'Held');
  assert.deepEqual(out.body.reasons, ['The supplier has not approved this invoice and amount.']);
  assert.equal(out.body.fee.transaction, 'ab'.repeat(32));
  assert.equal(decodePaymentResponseHeader(out.headers['payment-response']).success, true);
  assert.deepEqual(facilitator.calls, { verify: 1, settle: 1 });
  assert.deepEqual(chain.sims, [{ m: 'execute_payment', invoker: SUPPLIER }], 'simulated as the supplier, nothing sent');
});

test('a payment to the wrong account is refused and nothing is settled or answered', async () => {
  const { handle, facilitator, chain } = service();
  const pr = decodePaymentRequiredHeader((await handle({ url: URL1 })).headers['payment-required']);
  const [req] = pr.accepts;
  const payload = { x402Version: 2, resource: pr.resource, accepted: req, payload: { sender: PAYER, to: SUPPLIER, amount: req.amount, sponsor: SPONSOR } };
  const out = await handle({ url: URL1, headers: { 'payment-signature': encodePaymentSignatureHeader(payload) } });
  assert.equal(out.status, 402);
  assert.equal(decodePaymentRequiredHeader(out.headers['payment-required']).error, 'recipient_mismatch');
  assert.equal(facilitator.calls.settle, 0);
  assert.equal(chain.sims.length, 0);
});

test('bad questions are refused before any payment is asked for', async () => {
  const { handle } = service();
  assert.equal((await handle({ url: `${ORIGIN}/api/preclear` })).status, 400);
  assert.equal((await handle({ url: `${ORIGIN}/api/preclear?order=7` })).status, 404);
  const unverified = service({ chain: fakeChain({ verified: false }) });
  const out = await unverified.handle({ url: URL1 });
  assert.equal(out.status, 400);
  assert.equal(out.body.error, 'unverified_escrow');
});

test('end to end: the capped wallet pays, the service settles, the agent gets the contract’s answer', async () => {
  const { handle } = service({ chain: fakeChain({ verdict: { verdict: 'Cleared', codes: [] } }) });
  const ledgerPath = join(mkdtempSync(join(tmpdir(), 'ctp-')), 'spend.json');
  const payer = makePayer({ scheme: fakeClientScheme(), payTo: AGENT, origin: ORIGIN, maxPerPayment: 50_000n, maxPerDay: 500_000n, ledgerPath, fetch: fetchTo(handle) });
  const r = await payer.pay(URL1);
  assert.equal(r.ok, true);
  assert.equal(r.body.verdict, 'Cleared');
  assert.equal(r.receipt.transaction, 'ab'.repeat(32));
  assert.equal(r.spentToday, DEFAULT_PRICE);
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].amount, DEFAULT_PRICE);
});

test('the wallet’s limits are code: wrong payee, wrong asset, too much, wrong service and the daily cap are refused before signing', async () => {
  const signed = { n: 0 };
  const ledgerPath = join(mkdtempSync(join(tmpdir(), 'ctp-')), 'spend.json');
  const asking = (req) => async () => new Response('{}', { status: 402, headers: { 'payment-required': Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: URL1 }, accepts: [{ scheme: 'exact', network: TESTNET, asset: 'CCD', amount: '10000', payTo: AGENT, maxTimeoutSeconds: 120, extra: { feePayer: SPONSOR }, ...req }] })).toString('base64') } });
  const payer = (fetch, extra = {}) => makePayer({ scheme: fakeClientScheme(signed), payTo: AGENT, origin: ORIGIN, maxPerPayment: 50_000n, maxPerDay: 500_000n, ledgerPath, fetch, ...extra });
  assert.match((await payer(asking({ payTo: SUPPLIER })).pay(URL1)).refused, /not the one account/);
  assert.match((await payer(asking({ asset: 'USDR' })).pay(URL1)).refused, /pays only CCD/);
  assert.match((await payer(asking({ amount: '10000000' })).pay(URL1)).refused, /most this wallet pays at once/);
  assert.match((await payer(asking({ amount: '0' })).pay(URL1)).refused, /zero or negative/);
  assert.match((await payer(asking({})).pay('https://evil.example/api/preclear?order=1')).refused, /only pays https:\/\/cleartopay/);
  // Daily cap: 0.49 CCD already spent today, a 0.02 CCD request would pass the 0.5 CCD limit.
  writeFileSync(ledgerPath, JSON.stringify([{ at: Date.now() - 1000, amount: '490000' }, { at: Date.now() - 2 * 86400000, amount: '400000' }]));
  assert.match((await payer(asking({ amount: '20000' })).pay(URL1)).refused, /daily limit/);
  assert.equal(signed.n, 0, 'nothing was signed');
  // A damaged record refuses rather than guessing.
  writeFileSync(ledgerPath, 'not json');
  await assert.rejects(payer(asking({})).pay(URL1), /spending record is damaged/);
  assert.equal(signed.n, 0);
});

// Audit 25 Nov re-check: X1 redirects, X2 parallel calls, X4 rate limit.
test('the payer never follows a redirect, before or after signing', async () => {
  const signed = { n: 0 };
  const ledgerPath = join(mkdtempSync(join(tmpdir(), 'ctp-')), 'spend.json');
  const redirect = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
  const p = makePayer({ scheme: fakeClientScheme(signed), payTo: AGENT, origin: ORIGIN, maxPerPayment: 50_000n, maxPerDay: 500_000n, ledgerPath, fetch: redirect });
  assert.match((await p.pay(URL1)).refused, /redirect/);
  assert.equal(signed.n, 0);
  // A redirect on the paid request: the payment is not sent on, and it stays counted.
  const { handle } = service();
  let n = 0;
  const thenRedirect = async (url, init) => (n++ === 0 ? fetchTo(handle)(url, init) : new Response(null, { status: 307, headers: { location: 'https://evil.example/' } }));
  const p2 = makePayer({ scheme: fakeClientScheme(signed), payTo: AGENT, origin: ORIGIN, maxPerPayment: 50_000n, maxPerDay: 500_000n, ledgerPath, fetch: thenRedirect });
  const r = await p2.pay(URL1);
  assert.equal(r.ok, false);
  assert.match(r.refused, /redirected the paid request/);
  assert.equal(JSON.parse(readFileSync(ledgerPath, 'utf8')).length, 1);
});

test('two payments at the same moment cannot both pass the daily cap', async () => {
  const { handle } = service({ chain: fakeChain({ verdict: { verdict: 'Cleared', codes: [] } }) });
  const ledgerPath = join(mkdtempSync(join(tmpdir(), 'ctp-')), 'spend.json');
  writeFileSync(ledgerPath, JSON.stringify([{ at: Date.now() - 1000, amount: '485000' }])); // 0.485 of 0.5 spent
  const p = makePayer({ scheme: fakeClientScheme(), payTo: AGENT, origin: ORIGIN, maxPerPayment: 50_000n, maxPerDay: 500_000n, ledgerPath, fetch: fetchTo(handle) });
  const [a, b] = await Promise.all([p.pay(URL1), p.pay(URL1)]);
  assert.equal([a, b].filter((r) => r.ok).length, 1, 'only one 0.01 CCD payment fits');
  assert.match([a, b].find((r) => !r.ok).refused, /daily limit/);
});

test('unpaid requests are rate-limited per caller', async () => {
  const facilitator = fakeFacilitator(); const chain = fakeChain();
  const handle = makePreclear({ facilitator, chainFor: () => chain, payTo: AGENT, defaultEscrow: 13155, ratePerMinute: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await handle({ url: URL1, caller: '1.2.3.4' })).status, 402);
  assert.equal((await handle({ url: URL1, caller: '1.2.3.4' })).status, 429);
  assert.equal((await handle({ url: URL1, caller: '5.6.7.8' })).status, 402, 'another caller is unaffected');
});
