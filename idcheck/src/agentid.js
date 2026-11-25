// Who stands behind the agent: the owner of Agent #1287 proves with Concordium ID, in zero
// knowledge, that they are a verified adult and which country they live in, and nothing else.
// The proof is anchored on-chain and published as agent-identity.json, so anyone (a supplier,
// another agent, a judge) can check it against the chain at any time.
//
// This is the job Concordium's Agent IDP will do natively ("give your agent a selected
// attribute of your ID"). Until it ships, we build it from today's Concordium ID proofs:
// a verifiable presentation request, the owner's wallet answer, and an audit record whose
// hash is registered on-chain. When Agent IDP is live, the agent carries the attribute itself.
//
// Pure checks are split from chain checks so Node tests can run the first half without a node.
// This file has no SDK import, so the main app bundle can use it; the chain half is in
// agentid-chain.js (loaded with the proof engine, and by the MCP server).
import { revealed } from './idlogic.js';

export const AGENT_ID_FILE = 'agent-identity.json';
export const OWNER_RESOURCE = (agentId, owner) => `ctp-agent:${agentId}:owner:${owner}`;
/** Public info written next to the audit record's hash on-chain. */
export const OWNER_AUDIT_INFO = (agentId) => ({ ctp: 'agent-owner', agent: agentId });
export const MIN_AGE = 18;
export const COUNTRY = 'countryOfResidence';

/** The file anyone can check: the audit record (request + answer) and where it is anchored. */
export function buildIdentityFile({ agentId, owner, record, auditAnchorTx, requestAnchorTx, now = Date.now() }) {
  const json = typeof record?.toJSON === 'function' ? record.toJSON() : record;
  return {
    type: 'ClearToPayAgentIdentity',
    version: 1,
    agent: agentId,
    owner,
    proves: { verifiedAdult: true, minimumAge: MIN_AGE, countryOfResidence: revealed(json.presentation)[COUNTRY] ?? null },
    requestAnchorTx,
    auditAnchorTx,
    createdAt: new Date(now).toISOString(),
    record: json,
  };
}

/** Everything that can be checked without a node. Returns { ok, country, reasons[] }. */
export function checkIdentityShape(file, { agentId, owner }) {
  const reasons = [];
  if (file?.type !== 'ClearToPayAgentIdentity' || file?.version !== 1) reasons.push('not a Clear to Pay agent identity file');
  if (file?.agent !== agentId) reasons.push(`it is about agent #${file?.agent}, not #${agentId}`);
  if (file?.owner !== owner) reasons.push('it names a different owner account');
  const req = JSON.stringify(file?.record?.request ?? {});
  if (!req.includes(OWNER_RESOURCE(agentId, owner))) reasons.push('the proof request was made for a different agent or owner');
  if (!/"dob"/.test(req)) reasons.push('the request does not ask for a minimum age');
  const country = revealed(file?.record?.presentation)[COUNTRY] ?? null;
  if ((file?.proves?.countryOfResidence ?? null) !== country) reasons.push('the summary does not match the proof');
  if (!/^[0-9a-f]{64}$/i.test(file?.auditAnchorTx ?? '')) reasons.push('no on-chain anchor for the proof');
  return { ok: reasons.length === 0, country, reasons };
}

/** One line for people: what the check means. */
export function identityLine(r, agentId) {
  return r.ok
    ? `Agent #${agentId} acts for a verified adult${r.country ? ` who lives in ${r.country}` : ''}, proven with Concordium ID and anchored on-chain. Nothing else about them is revealed.`
    : `Agent #${agentId}'s owner proof does not check out: ${r.reasons.join('; ')}.`;
}
