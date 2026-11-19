// Byte encoders for the NEAR <-> Concordium link, written from the CIS-8 and
// CIS-8004 specifications. We build every message ourselves and compare it
// with what the hosted registry tools return; any difference stops the flow.
import { createHash } from 'node:crypto';

export const DOMAIN_TAG = 'CIS-8/v1/canonical'; // 18 ASCII bytes
export const CIS8_TESTNET = Object.freeze({ index: 12801, subindex: 0 });
export const CIS8004_TESTNET = Object.freeze({ index: 12802, subindex: 0 });
export const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';

const enc = new TextEncoder();
const cat = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
export const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
export const str = (s) => { const b = enc.encode(s); return cat(u32(b.length), b); };
export const bytes = (hex) => { const b = Buffer.from(hex, 'hex'); return cat(u32(b.length), b); };
export const contractAddress = (c) => cat(u64(c.index), u64(c.subindex));
export const tokenIdHex = (id) => u64(id).toString('hex'); // CIS-8004 AgentTokenId body, little-endian

// ---- base58 (Bitcoin alphabet) ----
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Decode(s) {
  let n = 0n;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('not base58');
    n = n * 58n + BigInt(v);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const lead = s.match(/^1*/)[0].length;
  return Buffer.concat([Buffer.alloc(lead), n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex')]);
}

/** Concordium account address -> its 32 raw bytes (checks version byte and checksum). */
export function accountBytes(address) {
  const raw = base58Decode(address);
  if (raw.length !== 37 || raw[0] !== 1) throw new Error('not a Concordium account address');
  const body = raw.subarray(0, 33);
  const sum = createHash('sha256').update(createHash('sha256').update(body).digest()).digest().subarray(0, 4);
  if (!sum.equals(raw.subarray(33))) throw new Error('account address checksum is wrong');
  return Buffer.from(raw.subarray(1, 33));
}

/** NEAR "ed25519:<base58>" public key -> 32-byte hex. */
export function nearPublicKeyHex(pk) {
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(pk)) throw new Error('not a NEAR ed25519 public key');
  const b = base58Decode(pk.slice(8));
  if (b.length !== 32) throw new Error('NEAR public key must be 32 bytes');
  return b.toString('hex');
}

const keyId = (k) => cat(str(k.namespace), str(k.key_type), bytes(k.public_key_hex));

/** CIS-8 CanonicalSignedMessage: the exact bytes the external key signs. */
export function canonicalMessage({ account, contract, genesisHex, externalNamespace, key, scheme }) {
  const genesis = Buffer.from(genesisHex, 'hex');
  if (genesis.length !== 32) throw new Error('genesis hash must be 32 bytes');
  return cat(enc.encode(DOMAIN_TAG), accountBytes(account), contractAddress(contract), genesis, str(externalNamespace), keyId(key), str(scheme));
}

/** CIS-8 registerExternalKey parameter. */
export function registerParam({ key, scheme, signatureHex, metadata = [] }) {
  return cat(keyId(key), str(scheme), bytes(signatureHex), u32(metadata.length), ...metadata.map((m) => cat(str(m.key), str(m.value))));
}

/** CIS-8004 setExternalReference parameter with a present Cis8 reference. */
export function setExternalReferenceParam({ tokenId, cis8, key }) {
  return cat([8], u64(tokenId), [1], contractAddress(cis8), [0], keyId(key));
}

// ---- Concordium schema (v2 type encoding) so the browser wallet can show and serialize the parameter ----
const S = {
  string: [0x16, 0x02], // String, u32 length
  bytes: [0x1d, 0x02], // ByteList, u32 length (JSON: hex string)
  bytesU8: [0x1d, 0x00], // ByteList, u8 length
  contractAddress: [0x0c],
  list: (t) => [0x10, 0x02, ...t],
  struct: (fields) => [0x14, 0x00, ...u32(fields.length), ...fields.flatMap(([n, t]) => [...str(n), ...t])],
  enumOf: (variants) => [0x15, ...u32(variants.length), ...variants.flatMap(([n, f]) => [...str(n), ...f])],
  unnamed: (types) => [0x01, ...u32(types.length), ...types.flat()],
  none: [0x02],
};
export const SCHEMA_TYPES = S;
const KEY_T = S.struct([['namespace', S.string], ['key_type', S.string], ['public_key', S.bytes]]);

export const REGISTER_SCHEMA_B64 = Buffer.from(S.struct([
  ['external_key', KEY_T],
  ['proof', S.struct([['scheme', S.string], ['signature', S.bytes]])],
  ['metadata', S.list(S.struct([['key', S.string], ['value', S.string]]))],
])).toString('base64');

export const SET_REF_SCHEMA_B64 = Buffer.from(S.struct([
  ['token_id', S.bytesU8],
  ['external_reference', S.enumOf([
    ['None', S.none],
    ['Some', S.unnamed([S.struct([['contract_address', S.contractAddress], ['kind', S.enumOf([['Cis8', S.unnamed([KEY_T])]])]])])],
  ])],
])).toString('base64');

const keyJson = (k) => ({ namespace: k.namespace, key_type: k.key_type, public_key: k.public_key_hex });
export const registerJson = ({ key, scheme, signatureHex, metadata = [] }) => ({
  external_key: keyJson(key),
  proof: { scheme, signature: signatureHex },
  metadata: metadata.map((m) => ({ key: m.key, value: m.value })),
});
export const setExternalReferenceJson = ({ tokenId, cis8, key }) => ({
  token_id: tokenIdHex(tokenId),
  external_reference: { Some: [{ contract_address: { index: cis8.index, subindex: cis8.subindex }, kind: { Cis8: [keyJson(key)] } }] },
});
