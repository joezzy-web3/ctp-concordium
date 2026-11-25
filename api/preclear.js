// Vercel function: GET /api/preclear?order=<n>[&escrow=<index>]
// A paid x402 endpoint on Concordium testnet. Answers 402 with the payment requirements; after a
// valid payment (settled by our own facilitator, which sponsors the gas) it returns the escrow
// contract's own dry-run verdict for that order.
//
// Environment (set in Vercel, never in the repo):
//   CCD_FACILITATOR_ADDRESS      sponsor account (pays the network fee for each payment)
//   CCD_FACILITATOR_PRIVATE_KEY  its private key
//   CTP_PRECLEAR_PRICE           optional, fee in microCCD (default 10000 = 0.01 CCD)
//   CTP_PRECLEAR_ASSET           optional, 'CCD' (default) or a PLT symbol
import { readFileSync } from 'node:fs';
import { x402Facilitator } from '@x402/core/facilitator';
import { ExactConcordiumScheme } from '@x402/concordium/exact/facilitator';
import { getConcordiumGrpcUrl, parseGrpcUrl, toConcordiumFacilitatorSigner } from '@x402/concordium';
import { createEscrow } from '../mcp/escrow.js';
import { makePreclear, localFacilitator, TESTNET, DEFAULT_PRICE } from '../x402/preclear.js';

const chainSrc = readFileSync(new URL('../app/src/chain.js', import.meta.url), 'utf8');
const defaultEscrow = Number(chainSrc.match(/CTP_ESCROW \?\? (\d+)/)[1]);
const [, agentId, badge, owner] = chainSrc.match(/AGENT = \{ id: (\d+), badge: '([^']+)', owner: '([^']+)' \}/);
const verifiedModules = [...chainSrc.match(/VERIFIED_MODULES = \[([^\]]*)\]/)[1].matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]);
const agent = { id: Number(agentId), badge, owner };

let handle = null;
function setup() {
  const address = process.env.CCD_FACILITATOR_ADDRESS, key = process.env.CCD_FACILITATOR_PRIVATE_KEY;
  if (!address || !key) throw new Error('The pre-clear service is not configured yet.');
  const [host, port] = parseGrpcUrl(getConcordiumGrpcUrl(TESTNET));
  const signer = toConcordiumFacilitatorSigner(address, key, { host, port, useTls: true });
  const facilitator = new x402Facilitator().register(TESTNET, new ExactConcordiumScheme({ signer, requireFinalization: true, finalizationTimeoutMs: 45_000 }));
  const chains = new Map();
  const chainFor = (index) => {
    if (!chains.has(index)) chains.set(index, createEscrow({ escrow: { index, subindex: 0 }, agent, verifiedModules }));
    return chains.get(index);
  };
  return makePreclear({
    facilitator: localFacilitator(facilitator), chainFor, payTo: agent.owner, defaultEscrow,
    price: process.env.CTP_PRECLEAR_PRICE ?? DEFAULT_PRICE, asset: process.env.CTP_PRECLEAR_ASSET ?? 'CCD',
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).setHeader('allow', 'GET').json({ error: 'method_not_allowed' }); return; }
  try {
    handle ??= setup();
    const proto = req.headers['x-forwarded-proto'] ?? 'https';
    const caller = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || undefined;
    const out = await handle({ url: `${proto}://${req.headers.host}${req.url}`, headers: req.headers, caller });
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    // Let browsers and agents read the x402 headers cross-origin.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'payment-required, payment-response');
    res.status(out.status).json(out.body);
  } catch (e) {
    // Never echo library errors: they could carry configuration. Only our own message is shown.
    const ours = e?.message === 'The pre-clear service is not configured yet.';
    res.status(503).json({ error: 'unavailable', message: ours ? e.message : 'The pre-clear service could not answer right now. Try again shortly.' });
  }
}

