import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../link/encode.js';

const OWNER = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
const KEY = { namespace: 'near:testnet', key_type: 'ed25519', public_key_hex: E.nearPublicKeyHex('ed25519:CbHyryfNkK8GuvMyG4Jd9TvxygNcCSzZ9Qzxgge6QvbK') };
const G = '4221332d34e1694168c2a0c0b3fd0f27' + '00'.repeat(16);

test('schema encoder reproduces the setAgentURI schema already proven on-chain', () => {
  const S = E.SCHEMA_TYPES;
  const s = Buffer.from(S.struct([
    ['token_id', S.bytesU8],
    ['agent_uri', S.enumOf([['None', S.none], ['Some', S.unnamed([S.string])]])],
    ['metadata_hash', S.enumOf([['None', S.none], ['Some', S.unnamed([[0x13, ...E.u32(32), 0x02]])]])],
  ])).toString('base64');
  assert.equal(s, 'FAADAAAACAAAAHRva2VuX2lkHQAJAAAAYWdlbnRfdXJpFQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAAFgINAAAAbWV0YWRhdGFfaGFzaBUCAAAABAAAAE5vbmUCBAAAAFNvbWUBAQAAABMgAAAAAg==');
});

test('Concordium address decodes to 32 bytes; a typo fails the checksum', () => {
  assert.equal(E.accountBytes(OWNER).length, 32);
  assert.throws(() => E.accountBytes(OWNER.slice(0, -1) + 'X'), /checksum/);
  assert.throws(() => E.accountBytes('buyer.cleartopay.testnet'), /base58|Concordium/);
});

test('NEAR public key decodes to 32 bytes', () => {
  assert.equal(KEY.public_key_hex.length, 64);
  assert.throws(() => E.nearPublicKeyHex('secp256k1:abc'));
});

test('canonical message follows the CIS-8 layout', () => {
  const m = E.canonicalMessage({ account: OWNER, contract: E.CIS8_TESTNET, genesisHex: G, externalNamespace: 'near:testnet', key: KEY, scheme: 'solana-ed25519' });
  assert.equal(m.subarray(0, 18).toString(), 'CIS-8/v1/canonical');
  assert.deepEqual(m.subarray(18, 50), E.accountBytes(OWNER));
  assert.equal(m.readBigUInt64LE(50), 12801n);
  assert.equal(m.readBigUInt64LE(58), 0n);
  assert.equal(m.subarray(66, 98).toString('hex'), G);
  assert.equal(m.readUInt32LE(98), 12);
  assert.equal(m.subarray(102, 114).toString(), 'near:testnet');
  assert.ok(m.toString('hex').endsWith(Buffer.from('solana-ed25519').toString('hex')));
  assert.equal(m.length, 18 + 32 + 16 + 32 + (4 + 12) + (4 + 12) + (4 + 7) + (4 + 32) + (4 + 14));
});

test('setExternalReference parameter: token 1287, Cis8 tag, CIS-8 contract 12801', () => {
  const p = E.setExternalReferenceParam({ tokenId: 1287, cis8: E.CIS8_TESTNET, key: KEY }).toString('hex');
  assert.ok(p.startsWith('08' + '0705000000000000' + '01' + '0132000000000000' + '0000000000000000' + '00'));
  assert.equal(E.tokenIdHex(1287), '0705000000000000');
});

test('registerExternalKey parameter: key, proof, then counted metadata', () => {
  const sig = 'ab'.repeat(64);
  const p = E.registerParam({ key: KEY, scheme: 'solana-ed25519', signatureHex: sig, metadata: [{ key: 'near_account', value: 'buyer.cleartopay.testnet' }] });
  const h = p.toString('hex');
  assert.ok(h.includes(Buffer.from('solana-ed25519').toString('hex') + '40000000' + sig + '01000000'));
  assert.ok(h.endsWith(Buffer.from('buyer.cleartopay.testnet').toString('hex')));
  const none = E.registerParam({ key: KEY, scheme: 'solana-ed25519', signatureHex: sig });
  assert.ok(none.toString('hex').endsWith(sig + '00000000'));
});
