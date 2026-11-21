// Signer ID check page (F-01). Two people use it:
// - the buyer, to ask a counter for proof and then record the result on the escrow;
// - the counter (receiver or approver), to answer with their Concordium wallet.
// Nothing goes through a server: the request and the answer travel as links (after #).
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import {
  AccountAddress, DataBlob, IdentityProviderDID, TransactionHash,
  VerifiablePresentationV1, VerificationAuditRecordV1, VerificationRequestV1,
} from '@concordium/web-sdk';
import { ConcordiumGRPCWebClient } from '@concordium/web-sdk/grpc';
import { ESCROW, connect as connectApp, send as sendEscrow, waitFinal } from '../../app/src/chain.js';
import { RESOURCE, SALT_MESSAGE, boundToAccount, fromHex, pack, personTag, revealed, saltFromSignature, toHex, unpack } from './idlogic.js';

const REGISTER_DATA = 21; // AccountTransactionType.RegisterData
const TESTNET = '4221332d34e1694168c2a0c0b3fd0f27';
const grpc = new ConcordiumGRPCWebClient('https://grpc.testnet.concordium.com', 20000);
const ADDR = /^[1-9A-HJ-NP-Za-km-z]{50}$/;
const $ = (id) => document.getElementById(id);
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const mask = (s) => (s.length <= 4 ? '••••' : `${s.slice(0, 2)}${'•'.repeat(Math.max(2, s.length - 4))}${s.slice(-2)}`);
const tx = (h) => `https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=${h}`;
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
const VERIFIED = `ctp:idcheck:${ESCROW.index}`;
// Requests this browser created, by anchor transaction: an answer must match one of them, and
// the account and role come from here, never from the answer link (audit 21 Nov M3).
const ASKED = `ctp:idcheck:${ESCROW.index}:asked`;
const SALT_BACKUP = `ctp:idcheck:${ESCROW.index}:salt`;

function say(el, kind, ...parts) {
  const box = document.createElement('div');
  box.className = `msg ${kind}`;
  for (const p of parts) box.append(p instanceof Node ? p : document.createTextNode(String(p)));
  $(el).replaceChildren(box);
}
const link = (href, text) => Object.assign(document.createElement('a'), { href, target: '_blank', rel: 'noopener', textContent: text });
const code = (t) => Object.assign(document.createElement('code'), { textContent: t });

let provider;
async function wallet() {
  provider ??= await detectConcordiumProvider();
  const connected = (await provider.requestAccounts()) ?? [];
  const recent = await provider.getMostRecentlySelectedAccount?.();
  const account = connected.includes(recent) ? recent : connected[0];
  if (!account) throw new Error('Unlock your Concordium wallet and allow this site.');
  if (!String((await provider.getSelectedChain()) ?? '').startsWith(TESTNET)) throw new Error('Switch your wallet to testnet.');
  return account;
}
async function registerData(account, bytes) {
  if (bytes.length > 256) throw new Error('Anchor is larger than RegisterData allows.');
  const hash = await provider.sendTransaction(account, REGISTER_DATA, { data: new DataBlob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)) });
  const fin = await waitFinal(hash);
  if (!fin.ok) throw new Error(fin.reason ?? 'The anchor transaction did not finalize.');
  return hash;
}
async function testnetIssuers() {
  const out = [];
  for await (const ip of grpc.getIdentityProviders()) out.push(new IdentityProviderDID('Testnet', Number(ip.ipIdentity)));
  if (!out.length) throw new Error('Could not read the identity providers from the node.');
  return out;
}

// ---------- buyer: ask ----------
async function ask() {
  say('askOut', 'info', 'Connect the buyer wallet and approve one small anchor transaction…');
  const buyer = await wallet();
  const signer = $('signer').value.trim();
  const role = $('role').value;
  if (!ADDR.test(signer)) throw new Error('Enter the counter’s full Concordium account.');
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const context = VerificationRequestV1.createSimpleContext(nonce, `ctp-${toHex(crypto.getRandomValues(new Uint8Array(8)))}`, RESOURCE(ESCROW, signer), `Clear to Pay: prove you are a verified adult before counting deliveries as ${role}`);
  const claims = VerificationRequestV1.claimsBuilder()
    .addAccountClaims(await testnetIssuers(), (b) => { b.revealAttribute('idDocIssuer'); b.revealAttribute('idDocNo'); b.addMinimumAge(18); })
    .getClaims();
  const anchorTx = await registerData(buyer, VerificationRequestV1.createAnchor(context, claims, { ctp: 'signer-check' }));
  const request = VerificationRequestV1.create(context, claims, TransactionHash.fromHexString(anchorTx));
  store.set(ASKED, { ...store.get(ASKED, {}), [anchorTx]: { signer, role, at: Date.now() } });
  const url = `${location.origin}${location.pathname}#req=${await pack({ request: request.toJSON(), signer, role })}`;
  const open = Object.assign(document.createElement('button'), { textContent: 'Copy link for the counter', onclick: () => navigator.clipboard?.writeText(url) });
  say('askOut', 'ok', 'Request anchored on-chain (', link(tx(anchorTx), 'transaction'), '). Send this link to ', code(short(signer)), '. They open it with their own wallet.', document.createElement('br'), open, ' ', link(url, 'Open it here (same browser demo)'));
}

// ---------- counter: answer ----------
async function answer(payload) {
  const request = VerificationRequestV1.fromJSON(payload.request);
  const me = await wallet();
  if (me !== payload.signer) throw new Error(`Select the account ${short(payload.signer)} in your wallet; this request is for that account only.`);
  say('ansOut', 'info', 'Your wallet will show exactly what is shared, and ask you to approve…');
  const p = await provider.requestVerifiablePresentationV1(request);
  const presentation = typeof p?.toJSON === 'function' ? p.toJSON() : p;
  const url = `${location.origin}${location.pathname}#res=${await pack({ request: payload.request, presentation, signer: payload.signer, role: payload.role })}`;
  store.set(`${VERIFIED}:last`, url);
  const copy = Object.assign(document.createElement('button'), { textContent: 'Copy answer link for the buyer', onclick: () => navigator.clipboard?.writeText(url) });
  say('ansOut', 'ok', 'Proof made. Send this link back to the buyer. It carries a zero-knowledge proof: your ID document issuer and number for the buyer’s page only, and that you are over 18. Nothing else about you.', document.createElement('br'), copy, ' ', link(url, 'Open it here (same browser demo)'));
}

// ---------- buyer: check and record ----------
let checked = null;
async function check(payload) {
  say('chkOut', 'info', 'Checking the proof against the chain…');
  const request = VerificationRequestV1.fromJSON(payload.request);
  const presentation = VerifiablePresentationV1.fromJSON(payload.presentation);
  const anchorTx = TransactionHash.toHexString(request.transactionRef);
  const asked = store.get(ASKED, {})[anchorTx];
  if (!asked) throw new Error('This answer is not for a request made from this browser. Create the request here, send that link, and check the answer here.');
  // Who and in which role come from the request you made, not from the answer.
  payload = { ...payload, signer: asked.signer, role: asked.role };
  if (!ADDR.test(payload.signer) || !['Receiver', 'Approver'].includes(payload.role)) throw new Error('That answer is malformed.');
  const res = await VerificationAuditRecordV1.createChecked(`ctp:${ESCROW.index}:${payload.signer}:${Date.now()}`, request, presentation, grpc, 'Testnet');
  if (res.type !== 'success') throw new Error(`The proof did not verify: ${res.error?.message ?? res.error}`);
  const info = await grpc.getAccountInfo(AccountAddress.fromBase58(payload.signer));
  if (!boundToAccount(payload.presentation, info)) throw new Error('The proof is not about the signer’s own account.');
  const attrs = revealed(payload.presentation);
  checked = { ...payload, record: res.result, attrs };
  const rec = Object.assign(document.createElement('button'), { textContent: 'Record on the escrow', onclick: () => record().catch((e) => say('chkOut', 'bad', e.message ?? e)) });
  say('chkOut', 'ok', 'Verified with Concordium ID: ', code(short(payload.signer)), ` (${payload.role}) is a verified adult. ID document ${attrs.idDocIssuer ?? '?'} ${mask(attrs.idDocNo ?? '')}. `, 'The number is used once to make a salted fingerprint and is not stored.', document.createElement('br'), rec);
}

async function record() {
  const c = checked;
  if (!c) return;
  say('chkOut', 'info', 'Sign three things with the buyer wallet: a fixed message (makes your private salt), the audit anchor, and the escrow update…');
  const buyer = await wallet();
  // The salt comes from the buyer wallet's signature on a fixed message. A backup loaded on this
  // page wins, so fingerprints stay the same if the wallet's keys ever change (audit 21 Nov M4).
  const backup = store.get(SALT_BACKUP, null);
  const salt = backup ? fromHex(backup) : await saltFromSignature(await provider.signMessage(buyer, SALT_MESSAGE(ESCROW)));
  if (!backup) store.set(SALT_BACKUP, toHex(salt));
  const tag = await personTag(ESCROW, salt, c.attrs.idDocIssuer, c.attrs.idDocNo);
  const info = { ctp: 'signer-audit', role: c.role[0] };
  const auditTx = await registerData(buyer, VerificationAuditRecordV1.createAnchor(c.record, info));
  const audit = toHex(VerificationAuditRecordV1.computeAnchorHash(c.record, info));
  await connectApp();
  const txHash = await sendEscrow('add_signer', { account: c.signer, role: { [c.role]: [] }, person_tag: { Some: [tag] }, id_audit: { Some: [audit] } });
  const fin = await waitFinal(txHash);
  if (!fin.ok) throw new Error(fin.reason ?? 'The escrow update did not finalize.');
  const list = store.get(VERIFIED, []).filter((x) => x.account !== c.signer);
  const twin = list.find((x) => x.tag === tag);
  list.push({ account: c.signer, role: c.role, tag, audit, auditTx, at: Date.now() });
  store.set(VERIFIED, list);
  const blob = new Blob([JSON.stringify({ escrow: `<${ESCROW.index},0>`, account: c.signer, role: c.role, person_tag: tag, id_audit: audit, audit_anchor_tx: auditTx, audit_record: c.record.toJSON() }, null, 2)], { type: 'application/json' });
  const dl = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `ctp-id-audit-${c.signer.slice(0, 8)}.json`, textContent: 'Download the audit record' });
  const saltFile = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify({ escrow: `<${ESCROW.index},0>`, salt: toHex(salt), note: 'Private. Keeps person fingerprints the same if your wallet keys change. Load it on the Signer ID check page.' }, null, 2)], { type: 'application/json' })), download: `ctp-salt-backup-${ESCROW.index}.json`, textContent: 'Download your salt backup (keep it private)' });
  say('chkOut', twin ? 'bad' : 'ok',
    `${short(c.signer)} is now a verified ${c.role} on escrow <${ESCROW.index},0> (`, link(tx(txHash), 'escrow update'), ', ', link(tx(auditTx), 'audit anchor'), '). ',
    twin ? `Same person as ${short(twin.account)} (${twin.role}): the contract will refuse an order that names both.` : 'Fingerprint recorded; an order naming this person twice will be refused.',
    document.createElement('br'), dl, ' · ', saltFile);
  renderList();
}

function renderList() {
  const list = store.get(VERIFIED, []);
  $('list').replaceChildren(...(list.length ? list.map((x) => Object.assign(document.createElement('li'), { textContent: `${x.role} ${short(x.account)} · fingerprint ${x.tag.slice(0, 10)}… · ${new Date(x.at).toLocaleString()}` })) : [Object.assign(document.createElement('li'), { textContent: 'None verified from this browser yet.' })]));
}

async function route() {
  const h = location.hash;
  const show = (id) => { for (const s of ['buyerView', 'signerView']) $(s).hidden = s !== id; };
  try {
    if (h.startsWith('#req=')) {
      show('signerView');
      const payload = await unpack(h.slice(5));
      $('forAcct').textContent = payload.signer;
      $('forRole').textContent = payload.role;
      $('prove').onclick = () => answer(payload).catch((e) => say('ansOut', 'bad', e.message ?? e));
    } else {
      show('buyerView');
      renderList();
      if (h.startsWith('#res=')) { $('answer').value = location.href; await check(await unpack(h.slice(5))); }
    }
  } catch (e) { say(h.startsWith('#req=') ? 'ansOut' : 'chkOut', 'bad', e.message ?? e); }
}

$('ask').onclick = () => ask().catch((e) => say('askOut', 'bad', e.message ?? e));
$('checkBtn').onclick = async () => {
  try {
    const v = $('answer').value.trim();
    const i = v.indexOf('#res=');
    await check(await unpack(i >= 0 ? v.slice(i + 5) : v));
  } catch (e) { say('chkOut', 'bad', e.message ?? e); }
};
$('saltFile').onchange = async (e) => {
  try {
    const j = JSON.parse(await e.target.files[0].text());
    if (j.escrow !== `<${ESCROW.index},0>` || !/^[0-9a-f]{64}$/.test(j.salt)) throw new Error('That is not a salt backup for this escrow.');
    store.set(SALT_BACKUP, j.salt);
    say('chkOut', 'ok', 'Salt backup loaded. New fingerprints will match the ones you recorded before.');
  } catch (err) { say('chkOut', 'bad', err.message ?? err); }
};
$('esc').textContent = `<${ESCROW.index},0>`;
window.addEventListener('hashchange', route);
route();
