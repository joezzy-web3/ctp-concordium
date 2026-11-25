// The chain half of the agent owner proof (see agentid.js). Needs the Concordium SDK.
import { TransactionHash, VerificationAuditRecordV1, VerificationRequestV1, AccountAddress } from '@concordium/web-sdk';
import { boundToAccount, toHex } from './idlogic.js';
import { OWNER_RESOURCE, MIN_AGE, COUNTRY, checkIdentityShape } from './agentid.js';

/** The request the owner answers: a verified adult, revealing only the country of residence
 *  (or nothing at all, if the owner's identity has no country of residence on record). */
export function draftOwnerRequest(agentId, owner, issuers, { withCountry = true } = {}) {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const context = VerificationRequestV1.createSimpleContext(nonce, `ctp-${toHex(globalThis.crypto.getRandomValues(new Uint8Array(8)))}`, OWNER_RESOURCE(agentId, owner),
    `Clear to Pay: prove who stands behind Agent #${agentId} (a verified adult${withCountry ? ', and your country of residence' : ''})`);
  const claims = VerificationRequestV1.claimsBuilder()
    .addAccountClaims(issuers, (b) => { if (withCountry) b.revealAttribute(COUNTRY); b.addMinimumAge(MIN_AGE); })
    .getClaims();
  return { context, claims, anchor: VerificationRequestV1.createAnchor(context, claims, { ctp: 'agent-owner-request', agent: agentId }) };
}

/**
 * The full check against the chain:
 * 1. the file is about this agent and owner (shape),
 * 2. the audit record is exactly the one whose hash was registered on-chain (verifyAnchor),
 * 3. the proof still verifies today and its credential is still active (createChecked),
 * 4. the proof is about the owner's own account.
 */
export async function checkAgentIdentity(file, { agentId, owner, grpc, network = 'Testnet' }) {
  const shape = checkIdentityShape(file, { agentId, owner });
  if (!shape.ok) return { ok: false, country: shape.country, reasons: shape.reasons };
  const reasons = [];
  const record = VerificationAuditRecordV1.fromJSON(file.record);
  try {
    await VerificationAuditRecordV1.verifyAnchor(record, TransactionHash.fromHexString(file.auditAnchorTx), grpc);
  } catch (e) { reasons.push(`the on-chain anchor does not match: ${e.message ?? e}`); }
  const res = await VerificationAuditRecordV1.createChecked(`ctp-agent-check:${Date.now()}`, record.request, record.presentation, grpc, network);
  if (res.type !== 'success') reasons.push(`the proof no longer verifies: ${res.error?.message ?? res.error}`);
  const info = await grpc.getAccountInfo(AccountAddress.fromBase58(owner));
  if (!boundToAccount(file.record.presentation, info)) reasons.push('the proof is not about the owner’s account');
  return { ok: reasons.length === 0, country: shape.country, reasons };
}

