#!/usr/bin/env node
// Prepare the NEAR <-> Concordium link for Agent #1287 (testnet).
//
//   node link/prepare.mjs --key <NEAR key file> --expect ed25519:<public key> --near-account <account>
//
// 1. Loads the NEAR key from the file and refuses unless its public key equals --expect.
//    The secret key is used only in memory to sign; it is never printed or written.
// 2. Asks the registry for the CIS-8 canonical bytes and rebuilds them from the spec;
//    any difference stops the script.
// 3. Signs them with the NEAR key (plain ed25519 over the raw bytes) and checks the signature.
// 4. Asks the registry to build registerExternalKey and setExternalReference, rebuilds
//    both parameters from the spec, and stops on any difference.
// 5. Writes link/bundle.json (public data only) for the wallet page at link/.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import * as E from './encode.js';

const MCP = 'https://agent-registry-mcp.concordium.com/mcp';
const OWNER = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
const AGENT_ID = 1287;
const NAMESPACE = 'near:testnet'; // CAIP-2 id for NEAR testnet
const KEY_TYPE = 'ed25519';
// CIS-8 has no NEAR-named scheme. NEAR keys are ed25519, and this scheme verifies a plain
// ed25519 signature over the raw canonical bytes, which is exactly what we produce.
const SCHEME = 'solana-ed25519';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const die = (msg) => { console.error(`STOP: ${msg}`); process.exit(1); };
const keyFile = arg('--key');
const expect = arg('--expect');
const nearAccount = arg('--near-account');
if (!keyFile || !expect || !nearAccount) die('usage: node link/prepare.mjs --key <file> --expect ed25519:<pk> --near-account <account>');

// ---- 1. Load the key; never print the secret ----
let seed;
let pkHex;
{
  const kf = JSON.parse(readFileSync(keyFile, 'utf8'));
  const sk = kf.private_key ?? kf.secret_key;
  if (typeof sk !== 'string' || !sk.startsWith('ed25519:')) die('key file has no ed25519 secret key');
  const raw = E.base58Decode(sk.slice(8));
  if (raw.length !== 64 && raw.length !== 32) die('unexpected secret key length');
  seed = raw.subarray(0, 32);
  const priv = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  pkHex = createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  if (pkHex !== E.nearPublicKeyHex(expect)) die('the key in this file is not the expected key');
  if (kf.public_key && E.nearPublicKeyHex(kf.public_key) !== pkHex) die('file public_key does not match its secret key');
  if (kf.account_id && kf.account_id !== nearAccount) die(`key file belongs to ${kf.account_id}, not ${nearAccount}`);
  console.log(`NEAR key OK: ${expect} (${nearAccount})`);
}
const privateKey = () => createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
const publicKey = createPublicKey(privateKey());
const key = { namespace: NAMESPACE, key_type: KEY_TYPE, public_key_hex: pkHex };

// ---- MCP helper ----
async function call(name, args) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await res.text();
  const msg = JSON.parse(text.slice(text.indexOf('{')).split('\n')[0]);
  if (msg.error) die(`${name}: ${JSON.stringify(msg.error)}`);
  const body = msg.result?.structuredContent ?? JSON.parse(msg.result?.content?.[0]?.text ?? '{}');
  if (msg.result?.isError) die(`${name}: ${JSON.stringify(body)}`);
  return body;
}
/** All hex strings found anywhere in an object, with their key paths. */
function hexStrings(o, path = '$', out = []) {
  if (typeof o === 'string' && /^(0x)?[0-9a-fA-F]{16,}$/.test(o)) out.push([path, o.replace(/^0x/, '').toLowerCase()]);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) hexStrings(v, `${path}.${k}`, out);
  return out;
}

// ---- 2. Canonical bytes: registry vs our own ----
const canon = await call('build_cis8_canonical_bytes', {
  network: 'testnet', concordium_account: OWNER, external_namespace: NAMESPACE,
  external_key_namespace: NAMESPACE, external_key_type: KEY_TYPE, external_public_key_hex: pkHex, proof_scheme: SCHEME,
});
const tagHex = Buffer.from(E.DOMAIN_TAG).toString('hex');
const theirs = hexStrings(canon).find(([, h]) => h.startsWith(tagHex))?.[1];
if (!theirs) die(`registry returned no canonical bytes: ${JSON.stringify(canon).slice(0, 400)}`);
const genesisHex = theirs.slice((18 + 32 + 16) * 2, (18 + 32 + 16 + 32) * 2);
if (!genesisHex.startsWith(E.TESTNET_GENESIS_PREFIX)) die('canonical bytes are not for testnet');
const ours = E.canonicalMessage({ account: OWNER, contract: E.CIS8_TESTNET, genesisHex, externalNamespace: NAMESPACE, key, scheme: SCHEME }).toString('hex');
if (ours !== theirs) die('registry canonical bytes differ from the CIS-8 spec; not signing');
console.log(`Canonical bytes match the spec (${theirs.length / 2} bytes, CIS-8 contract ${E.CIS8_TESTNET.index}, testnet).`);

// ---- 3. Sign and self-check ----
const msgBytes = Buffer.from(theirs, 'hex');
const signatureHex = sign(null, msgBytes, privateKey()).toString('hex');
seed.fill(0); // done with the secret
if (!verify(null, msgBytes, publicKey, Buffer.from(signatureHex, 'hex'))) die('signature did not verify');
console.log('Signed with the NEAR key; signature verifies.');

// ---- 4. Transactions: registry vs our own ----
const metadata = [
  { key: 'near_account', value: nearAccount },
  { key: 'agent', value: `Clear to Pay, Concordium Agent #${AGENT_ID}` },
];
const reg = await call('build_cis8_register', {
  network: 'testnet', sender: OWNER, external_key: key, proof: { scheme: SCHEME, signature_hex: signatureHex }, metadata,
});
const setRef = await call('build_set_external_reference', {
  network: 'testnet', sender: OWNER, token_id: AGENT_ID,
  external_reference: { contract_address: E.CIS8_TESTNET, kind: 'Cis8', key },
});

/** First string under a key whose path matches `re`, searching nested objects. */
function findString(o, re, path = '$') {
  if (!o || typeof o !== 'object') return undefined;
  for (const [k, v] of Object.entries(o)) {
    const p = `${path}.${k}`;
    if (typeof v === 'string' && re.test(k)) return v;
    if (typeof v === 'number' && re.test(k)) return String(v);
  }
  for (const [k, v] of Object.entries(o)) {
    const hit = findString(v, re, `${path}.${k}`);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function tx(label, built, expectedHex, contract, receiveName, parameters, schemaB64) {
  // The parameter hex can sit at any depth; take the hex string whose path mentions "param",
  // else any hex string equal to ours.
  const hexes = hexStrings(built);
  // The live registry returns `parameter_hex` next to `parameter_json`; prefer the hex field by name.
  const paramHex = (hexes.find(([path]) => /parameter_hex$/i.test(path))
    ?? hexes.find(([path]) => /param[^.]*hex$/i.test(path))
    ?? hexes.find(([path]) => /param[^.]*$/i.test(path) && !/json/i.test(path))
    ?? [])[1] ?? '';
  if (paramHex !== expectedHex) {
    die(`${label}: registry parameter differs from the spec.\n  registry: ${paramHex || '(none found)'}\n  ours:     ${expectedHex}\n  registry response: ${JSON.stringify(built).slice(0, 1500)}`);
  }
  const rn = findString(built, /receive/i);
  if (rn && rn !== receiveName) die(`${label}: registry says ${rn}, expected ${receiveName}`);
  const energy = Math.max(Number(findString(built, /energy/i)) || 0, 60000);
  return { label, contract, receive_name: receiveName, energy, parameters, schema_b64: schemaB64, parameter_hex: paramHex };
}
const regParams = { key, scheme: SCHEME, signatureHex, metadata };
const refParams = { tokenId: AGENT_ID, cis8: E.CIS8_TESTNET, key };
const txs = [
  tx('Register the NEAR key in CIS-8', reg, E.registerParam(regParams).toString('hex'), E.CIS8_TESTNET,
    findString(reg, /receive/i) ?? 'cis8.registerExternalKey', E.registerJson(regParams), E.REGISTER_SCHEMA_B64),
  tx('Attach it to Agent #1287', setRef, E.setExternalReferenceParam(refParams).toString('hex'), E.CIS8004_TESTNET,
    findString(setRef, /receive/i) ?? 'CIS-8004.setExternalReference', E.setExternalReferenceJson(refParams), E.SET_REF_SCHEMA_B64),
];
for (const t of txs) {
  if (!/\.(registerExternalKey|setExternalReference)$/.test(t.receive_name)) die(`unexpected entrypoint ${t.receive_name}`);
}
writeFileSync('link/registry-responses.json', JSON.stringify({ canonical: canon, register: reg, set_external_reference: setRef }, null, 2) + '\n');
console.log('Both transaction parameters match the specs.');

// ---- 5. Bundle (public data only) ----
const bundle = {
  network: 'testnet',
  owner: OWNER,
  agent_id: AGENT_ID,
  near: { account: nearAccount, public_key: expect, public_key_hex: pkHex, namespace: NAMESPACE, key_type: KEY_TYPE },
  proof: { scheme: SCHEME, canonical_hex: theirs, signature_hex: signatureHex },
  txs,
};
writeFileSync('link/bundle.json', JSON.stringify(bundle, null, 2) + '\n');
console.log('\nWrote link/bundle.json (public key and signature only).');
for (const t of txs) console.log(`  ${t.label}: <${t.contract.index},${t.contract.subindex}> ${t.receive_name}, energy ${t.energy}`);
