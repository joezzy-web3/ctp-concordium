// Who stands behind the agent: the owner proof file, checked without a node (shape), and the
// MCP tool's answer for each outcome. The chain half runs live in the app and the MCP server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityFile, checkIdentityShape, identityLine, OWNER_RESOURCE } from '../idcheck/src/agentid.js';
import { makeTools } from '../mcp/tools.js';

const AGENT = 1287;
const OWNER = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
const TX = 'ab'.repeat(32);
const record = (resource = OWNER_RESOURCE(AGENT, OWNER), country = 'NG') => ({
  type: 'ConcordiumVerificationAuditRecord', version: 1, id: 'x',
  request: { context: { requested: [{ label: 'ResourceID', context: resource }] }, subjectClaims: [{ statements: [{ type: 'AttributeInRange', attributeTag: 'dob' }, { type: 'RevealAttribute', attributeTag: 'countryOfResidence' }] }] },
  presentation: { verifiableCredential: [{ credentialSubject: { id: 'ccd:testnet:cred:aa', statement: [{ type: 'AttributeInRange', attributeTag: 'dob' }, { type: 'AttributeValue', attributeTag: 'countryOfResidence', attributeValue: country }] } }] },
});
const file = (r = record()) => buildIdentityFile({ agentId: AGENT, owner: OWNER, record: r, auditAnchorTx: TX, requestAnchorTx: TX, now: 0 });

test('a proof for this agent and owner reads as a verified adult in a country', () => {
  const f = file();
  assert.deepEqual(f.proves, { verifiedAdult: true, minimumAge: 18, countryOfResidence: 'NG' });
  const s = checkIdentityShape(f, { agentId: AGENT, owner: OWNER });
  assert.equal(s.ok, true, s.reasons.join('; '));
  assert.equal(s.country, 'NG');
  assert.match(identityLine({ ok: true, country: 'NG', reasons: [] }, AGENT), /verified adult who lives in NG/);
});

test('an adult-only proof (no country on record) is accepted and says so', () => {
  const r = record(); r.presentation.verifiableCredential[0].credentialSubject.statement.pop();
  const s = checkIdentityShape(file(r), { agentId: AGENT, owner: OWNER });
  assert.equal(s.ok, true, s.reasons.join('; '));
  assert.equal(s.country, null);
  assert.match(identityLine({ ok: true, country: null, reasons: [] }, AGENT), /acts for a verified adult, proven/);
});

test('a proof made for another agent or owner is refused', () => {
  assert.equal(checkIdentityShape(file(), { agentId: 9999, owner: OWNER }).ok, false);
  assert.equal(checkIdentityShape(file(), { agentId: AGENT, owner: '3NrB4khEwjL32cM8qVsay6iHTRznthBFPNCG6GvmLNQygyVE2S' }).ok, false);
  const other = file(record(OWNER_RESOURCE(42, OWNER)));
  assert.match(checkIdentityShape(other, { agentId: AGENT, owner: OWNER }).reasons.join(), /different agent or owner/);
});

test('an edited summary, a missing age check or a missing anchor is refused', () => {
  const edited = { ...file(), proves: { verifiedAdult: true, minimumAge: 18, countryOfResidence: 'GB' } };
  assert.match(checkIdentityShape(edited, { agentId: AGENT, owner: OWNER }).reasons.join(), /summary does not match/);
  const r = record(); r.request.subjectClaims[0].statements = [{ type: 'RevealAttribute', attributeTag: 'countryOfResidence' }];
  assert.match(checkIdentityShape(file(r), { agentId: AGENT, owner: OWNER }).reasons.join(), /minimum age/);
  assert.match(checkIdentityShape({ ...file(), auditAnchorTx: '' }, { agentId: AGENT, owner: OWNER }).reasons.join(), /anchor/);
});

test('the MCP tool reports the owner proof plainly, whatever the outcome', async () => {
  const chain = { escrow: { index: 13161, subindex: 0 }, agent: { id: AGENT, owner: OWNER } };
  assert.match(await makeTools(chain, {}).agentIdentity(), /has not published/);
  assert.match(await makeTools(chain, { ownerProof: async () => ({ ok: true, country: 'NG', reasons: [] }) }).agentIdentity(), /verified adult who lives in NG.*Checked now/);
  assert.match(await makeTools(chain, { ownerProof: async () => ({ ok: false, country: 'NG', reasons: ['the proof no longer verifies'] }) }).agentIdentity(), /does not check out: the proof no longer verifies/);
  assert.match(await makeTools(chain, { ownerProof: async () => { throw new Error('node down'); } }).agentIdentity(), /could not be checked: node down/);
});
