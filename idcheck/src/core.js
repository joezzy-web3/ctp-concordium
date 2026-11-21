// Signer ID check (F-01): the parts that need Concordium's proof engine (WebAssembly, ~5 MB).
// Built on its own as app/idcheck-core.js and loaded only when someone opens ID checks, so the
// rest of the app stays light. No wallet here: the app signs and sends.
import {
  AccountAddress, IdentityProviderDID, TransactionHash,
  VerifiablePresentationV1, VerificationAuditRecordV1, VerificationRequestV1,
} from '@concordium/web-sdk';
import { ConcordiumGRPCWebClient } from '@concordium/web-sdk/grpc';
import { RESOURCE, boundToAccount, revealed, toHex } from './idlogic.js';

// This module is bundled on its own, with its own copy of the SDK, so it keeps its own node
// client: SDK values made here (account addresses, credential ids) are only recognised by
// a client from the same copy.
const grpcClient = new ConcordiumGRPCWebClient('https://grpc.testnet.concordium.com', 20000);

/** Every identity provider on testnet, so a counter can prove with whichever issued their ID. */
export async function testnetIssuers(grpc = grpcClient) {
  const out = [];
  for await (const ip of grpc.getIdentityProviders()) out.push(new IdentityProviderDID('Testnet', Number(ip.ipIdentity)));
  if (!out.length) throw new Error('Could not read the identity providers from the node.');
  return out;
}

/**
 * A proof request for one counter: a verified adult, revealing the ID document number only.
 * (Testnet identities may have no document issuer, and a request for a missing attribute
 * cannot be answered, so the issuer is not asked for.)
 */
export async function draftRequest(escrow, signer, role) {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const context = VerificationRequestV1.createSimpleContext(nonce, `ctp-${toHex(crypto.getRandomValues(new Uint8Array(8)))}`, RESOURCE(escrow, signer), `Clear to Pay: prove you are a verified adult before counting deliveries as ${role}`);
  const claims = VerificationRequestV1.claimsBuilder()
    .addAccountClaims(await testnetIssuers(), (b) => { b.revealAttribute('idDocNo'); b.addMinimumAge(18); })
    .getClaims();
  return { context, claims, anchor: VerificationRequestV1.createAnchor(context, claims, { ctp: 'signer-check' }) };
}

/** The request, once its anchor transaction is on-chain, as JSON for a link. */
export const finishRequest = (draft, anchorTx) => VerificationRequestV1.create(draft.context, draft.claims, TransactionHash.fromHexString(anchorTx)).toJSON();

export const requestFromJSON = (json) => VerificationRequestV1.fromJSON(json);
export const anchorTxOf = (json) => TransactionHash.toHexString(VerificationRequestV1.fromJSON(json).transactionRef);
export const presentationJSON = (p) => (typeof p?.toJSON === 'function' ? p.toJSON() : p);

/**
 * Checks an answer against the chain: the request is anchored, the presentation answers exactly
 * that request, every proof verifies and every credential is active. Then the proof must be about
 * one credential of the counter's own account. Returns the audit record and revealed attributes.
 */
export async function verifyAnswer(escrow, signer, requestJSON, presentation) {
  const grpc = grpcClient;
  const request = VerificationRequestV1.fromJSON(requestJSON);
  const vp = VerifiablePresentationV1.fromJSON(presentation);
  const res = await VerificationAuditRecordV1.createChecked(`ctp:${escrow.index}:${signer}:${Date.now()}`, request, vp, grpc, 'Testnet');
  if (res.type !== 'success') throw new Error(`The proof did not verify: ${res.error?.message ?? res.error}`);
  const info = await grpc.getAccountInfo(AccountAddress.fromBase58(signer));
  if (!boundToAccount(presentation, info)) throw new Error('The proof is not about the counter’s own account.');
  return { record: res.result, attrs: revealed(presentation) };
}

/** The audit record's on-chain anchor (RegisterData bytes) and its hash (the id_audit field). */
export function auditAnchor(record, role) {
  const info = { ctp: 'signer-audit', role: role[0] };
  return { bytes: VerificationAuditRecordV1.createAnchor(record, info), hash: toHex(VerificationAuditRecordV1.computeAnchorHash(record, info)), json: record.toJSON() };
}
