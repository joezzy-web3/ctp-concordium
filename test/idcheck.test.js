// Signer ID check (F-01): the fingerprint, the binding to the signer's own account, and the
// links that carry the request and the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerificationRequestV1, IdentityProviderDID, TransactionHash } from '@concordium/web-sdk';
import { personTag, normDoc, saltFromSignature, revealed, presentedCredIds, accountCredIds, boundToAccount, pack, unpack, RESOURCE } from '../idcheck/src/idlogic.js';

const ESCROW = { index: 13102, subindex: 0 };
const SALT = new Uint8Array(32).fill(9);
const CRED = 'a'.repeat(96);

const presentation = (cred = CRED, docNo = 'A1234567') => ({
  verifiableCredential: [{
    credentialSubject: {
      id: `did:ccd:testnet:cred:${cred}`,
      statement: [
        { type: 'AttributeValue', attributeTag: 'idDocIssuer', attributeValue: 'NG' },
        { type: 'AttributeValue', attributeTag: 'idDocNo', attributeValue: docNo },
        { type: 'AttributeInRange', attributeTag: 'dob', lower: '18000101', upper: '20081121' },
      ],
    },
  }],
});
const accountInfo = (cred) => ({ accountCredentials: { 0: { v: 0, value: { type: 'normal', contents: { credId: cred } } } } });

test('one person gives one fingerprint, however the number is typed', async () => {
  const a = await personTag(ESCROW, SALT, 'NG', 'a12 34567');
  const b = await personTag(ESCROW, SALT, 'ng', 'A1234567');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(normDoc(' x 1 '), 'X1');
});

test('different people, salts or escrows give different fingerprints', async () => {
  const base = await personTag(ESCROW, SALT, 'NG', 'A1234567');
  assert.notEqual(base, await personTag(ESCROW, SALT, 'NG', 'A1234568'));
  assert.notEqual(base, await personTag(ESCROW, new Uint8Array(32).fill(8), 'NG', 'A1234567'));
  assert.notEqual(base, await personTag({ index: 1, subindex: 0 }, SALT, 'NG', 'A1234567'));
  await assert.rejects(personTag(ESCROW, SALT, 'NG', ''), /did not reveal/);
});

test('the salt comes from the buyer’s signature and is the same every time', async () => {
  const sig = { 0: { 0: 'ab'.repeat(64) } };
  const s1 = await saltFromSignature(sig);
  assert.equal(s1.length, 32);
  assert.deepEqual(s1, await saltFromSignature(JSON.parse(JSON.stringify(sig))));
  assert.notDeepEqual(s1, await saltFromSignature({ 0: { 0: 'cd'.repeat(64) } }));
  await assert.rejects(saltFromSignature({}), /no signature/);
});

test('revealed attributes and the credential are read from the presentation', () => {
  const p = presentation();
  assert.deepEqual(revealed(p), { idDocIssuer: 'NG', idDocNo: 'A1234567' });
  assert.deepEqual(presentedCredIds(p), [CRED]);
});

test('a proof only counts for the signer’s own account', () => {
  assert.ok(boundToAccount(presentation(), accountInfo(CRED)));
  assert.ok(!boundToAccount(presentation('b'.repeat(96)), accountInfo(CRED)), 'someone else’s credential');
  const two = presentation();
  two.verifiableCredential.push(presentation('b'.repeat(96)).verifiableCredential[0]);
  assert.ok(!boundToAccount(two, accountInfo(CRED)), 'extra credentials');
  assert.ok(accountCredIds({ accountCredentials: { 0: { value: { contents: { regId: CRED.toUpperCase() } } } } }).has(CRED));
});

test('a real request survives the link round trip', async () => {
  const ctx = VerificationRequestV1.createSimpleContext(new Uint8Array(32).fill(7), 'ctp-1', RESOURCE(ESCROW, '3'.repeat(50)), 'test');
  const claims = VerificationRequestV1.claimsBuilder().addAccountClaims([new IdentityProviderDID('Testnet', 0)], (b) => { b.revealAttribute('idDocIssuer'); b.revealAttribute('idDocNo'); b.addMinimumAge(18); }).getClaims();
  assert.ok(VerificationRequestV1.createAnchor(ctx, claims, { ctp: 'signer-check' }).length <= 256, 'fits RegisterData');
  const req = VerificationRequestV1.create(ctx, claims, TransactionHash.fromHexString('ab'.repeat(32)));
  const link = await pack({ request: req.toJSON(), signer: '3'.repeat(50), role: 'Receiver' });
  assert.match(link, /^[A-Za-z0-9_-]+$/);
  const back = await unpack(link);
  assert.equal(back.role, 'Receiver');
  assert.deepEqual(VerificationRequestV1.fromJSON(back.request).toJSON(), JSON.parse(JSON.stringify(req.toJSON())));
});
