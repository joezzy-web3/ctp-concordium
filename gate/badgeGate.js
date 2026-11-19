// Counterparty badge gate: "verify before you pay".
//
// Before Clear to Pay accepts an invoice from another AI agent, it checks that
// agent's Verified by Concordium badge from two independent sources:
//   1. the Concordium Agent Registry service reads the chain (owner, status,
//      metadata_hash) and runs the badge checks;
//   2. Clear to Pay fetches the Agent Card itself and hashes the raw bytes,
//      so a wrong answer from one source alone cannot clear an agent.
// The gate fails closed: any doubt gives HELD or REFUSED, never CLEARED.
// It returns evidence that later goes into the accountability receipt.

import { createHash } from 'node:crypto';
import { GATE_CODES as C, GATE_ORDER, gateVerdict } from './codes.js';
import { safeFetchBytes } from './safeFetch.js';

export const REGISTRY_URL = 'https://agent-registry-mcp.concordium.com';
export const TESTNET_CHAIN = 'ccd:4221332d34e1694168c2a0c0b3fd0f27';
const MAX_CARD_BYTES = 256 * 1024;
const TIMEOUT_MS = 8000;

// Agent IDs are base58 strings (no 0, O, I, l). Checked before use in a URL.
const BADGE_RE = /^[1-9A-HJ-NP-Za-km-z]{8,64}$/;

/** fetch with a timeout; returns the Response or throws. */
async function fetchWithTimeout(fetchImpl, url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { signal: ctrl.signal, redirect: 'error', headers: { accept: 'application/json' } });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Checks a counterparty agent.
 * @param {object} input
 * @param {string} input.badge          Agent ID claimed by the counterparty (e.g. from its invoice)
 * @param {string} [input.claimedOwner] owner account the invoice names, if any
 * @param {object} [opts]
 * @param {'testnet'|'mainnet'} [opts.network='testnet']
 * @param {string} [opts.expectedChain]  CAIP-2 chain id the registry must answer for
 * @param {Function} [opts.fetch]        registry fetch, injected for tests
 * @param {Function} [opts.fetchCard]    card download (url) => Uint8Array; default refuses non-public
 *                                       addresses, streams with a byte cap and one overall timeout
 * @param {() => Date} [opts.now]
 * @returns {Promise<{verdict:string, codes:string[], evidence:object}>}
 */
export async function checkCounterparty(input, opts = {}) {
  const network = opts.network ?? 'testnet';
  const expectedChain = opts.expectedChain ?? (network === 'testnet' ? TESTNET_CHAIN : null);
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const fetchCard = opts.fetchCard ?? ((url) => safeFetchBytes(url, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_CARD_BYTES }));
  const now = opts.now ?? (() => new Date());
  const fired = new Set();
  const evidence = { badge: input?.badge ?? null, network, checked_at: now().toISOString(), registry: REGISTRY_URL };

  const finish = () => {
    const codes = GATE_ORDER.filter((c) => fired.has(c));
    return { verdict: gateVerdict(codes), codes, evidence };
  };

  // 0. Shape of the claimed Agent ID.
  if (typeof input?.badge !== 'string' || !BADGE_RE.test(input.badge)) {
    fired.add(C.REFUSED_BADGE_MALFORMED);
    return finish();
  }

  // 1. Ask the registry (it reads the chain and runs the badge checks).
  let reg;
  try {
    const url = `${REGISTRY_URL}/v1/check-badge/${encodeURIComponent(input.badge)}?network=${encodeURIComponent(network)}`;
    const res = await fetchWithTimeout(fetchImpl, url, TIMEOUT_MS);
    if (res.status === 404) {
      fired.add(C.REFUSED_AGENT_NOT_REGISTERED);
      return finish();
    }
    if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
    reg = await res.json();
  } catch (err) {
    evidence.registry_error = String(err?.message ?? err);
    fired.add(C.HELD_REGISTRY_UNREACHABLE);
    return finish();
  }

  const checks = reg?.checks ?? {};
  const onChain = reg?.on_chain ?? {};
  Object.assign(evidence, {
    token_id: reg?.token_id ?? null,
    owner: onChain.owner_account ?? null,
    status: onChain.status ?? null,
    agent_uri: onChain.agent_uri ?? null,
    on_chain_hash: onChain.metadata_hash_hex ?? null,
    registry_badge_valid: reg?.badge_valid === true,
    registry_issues: Array.isArray(reg?.issues) ? reg.issues : [],
  });

  if (reg?.network !== network || (expectedChain && reg?.expected?.chain !== expectedChain)) {
    fired.add(C.REFUSED_WRONG_NETWORK);
  }
  if (checks.on_chain_agent_found === false || !onChain.owner_account) {
    fired.add(C.REFUSED_AGENT_NOT_REGISTERED);
    return finish();
  }
  if (onChain.status !== 'Active') fired.add(C.REFUSED_AGENT_INACTIVE);
  if (reg?.badge_valid !== true) fired.add(C.REFUSED_BADGE_INVALID);
  if (input.claimedOwner && input.claimedOwner !== onChain.owner_account) fired.add(C.REFUSED_OWNER_MISMATCH);

  // 2. Fetch and hash the card ourselves (second, independent source).
  const uri = onChain.agent_uri;
  const onChainHash = String(onChain.metadata_hash_hex ?? '').toLowerCase();
  if (typeof uri !== 'string' || !uri.startsWith('https://') || !/^[0-9a-f]{64}$/.test(onChainHash)) {
    fired.add(C.REFUSED_BADGE_INVALID); // no https card or no anchored hash: nothing to verify against
    return finish();
  }
  try {
    const bytes = await fetchCard(uri);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_CARD_BYTES) throw new Error('card too large');
    const ours = createHash('sha256').update(bytes).digest('hex');
    evidence.card_sha256 = ours;
    evidence.card_bytes = bytes.byteLength;
    if (ours !== onChainHash) fired.add(C.REFUSED_CARD_TAMPERED);
  } catch (err) {
    evidence.card_error = String(err?.message ?? err);
    fired.add(C.HELD_CARD_UNREACHABLE);
  }

  return finish();
}
