// ID checks (F-01): counters prove with Concordium ID, in zero knowledge, that they are
// verified adults; the escrow keeps a salted fingerprint and refuses an order whose receiver
// and approver are one person.
// - Buyer:   #/buyer/ids             ask a counter, see answers, record them.
//            #/buyer/ids/<answer>    an answer link: check it and record it.
// - Counter: #/signer/prove/<request> prove with the wallet, send the answer back.
// The proof engine (WebAssembly) loads only here, from idcheck-core.js.
import { ESCROW, node, currentAccount, connect, send, waitFinal, registerData, signText, requestProof, ccdscanTx } from './chain.js';
import { CAST } from './cast.js';
import { h, fill, icon, chip, short, store, notice, fmtDate } from './ui.js';
import { SALT_MESSAGE, fromHex, pack, personTag, saltFromSignature, toHex, unpack } from '../../idcheck/src/idlogic.js';

const K = `ctp:idcheck:${ESCROW.index}`;
const ASKED = `${K}:asked`; // anchor tx -> { signer, role, at, request }
const ANSWERS = `${K}:answers`; // anchor tx -> { presentation, at } (answers made in this browser)
const SALT = `${K}:salt`;
const ADDR = /^[1-9A-HJ-NP-Za-km-z]{50}$/;
const base = () => `${location.origin}${location.pathname}`;
const linkTo = (route, payload) => `${base()}#/${route}/${payload}`;

let core;
const engine = async () => (core ??= await import('./idcheck-core.js'));

const verified = () => store.get(K, []);
const asked = () => store.get(ASKED, {});
const answers = () => store.get(ANSWERS, {});

/** Copy, or share on a phone (WhatsApp and the like), plus a same-browser shortcut. */
function handoff(url, what, openLabel) {
  const copy = h('button.btn.dark.small', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); notice('ok', `${what} copied.`); } catch { prompt('Copy this link:', url); } } }, 'Copy link');
  const share = navigator.share ? h('button.btn.line.small', { type: 'button', onclick: () => navigator.share({ title: 'Clear to Pay', text: what, url }).catch(() => {}) }, 'Share') : null;
  return h('div.actions', copy, share, h('a.btn.line.small', { href: url }, openLabel));
}

// ======================= buyer =======================

export async function idsView() {
  const answerLink = location.hash.split('/')[3];
  const result = h('div');
  if (answerLink) setTimeout(() => checkAnswer(result, answerLink).catch((e) => say(result, 'no', e)), 0);
  return h('div.ids',
    h('header.dash-h', h('div', h('h2', 'ID checks'), h('p', 'Each counter proves with Concordium ID, in zero knowledge, that they are a real verified adult. The escrow keeps only a private fingerprint, and refuses an order that names the same person twice.'))),
    result,
    h('div.dash-cols', askPanel(), h('div.dash-side', pendingPanel(result), verifiedPanel())),
    howPanel());
}

function say(el, tone, ...parts) {
  const text = parts.map((p) => (p instanceof Error ? p.message : p));
  fill(el, h(`section.panel.result.${tone}`, h('p', ...text)));
}

function askPanel() {
  const out = h('div');
  const castPick = [
    CAST.receiver ? { account: CAST.receiver, role: 'Receiver', name: 'Use the receiver' } : null,
    CAST.approver ? { account: CAST.approver, role: 'Approver', name: 'Use the approver' } : null,
  ].filter(Boolean);
  const acct = h('input.mono', { spellcheck: false, placeholder: 'The counter’s Concordium account' });
  const role = h('select', h('option', { value: 'Receiver' }, 'Receiver (counts at the gate)'), h('option', { value: 'Approver' }, 'Approver (checks inside)'));
  const quick = castPick.length ? h('div.actions.quick', castPick.map((c) => h('button.btn.line.small', { type: 'button', onclick: () => { acct.value = c.account; role.value = c.role; } }, c.name))) : null;
  const go = h('button.btn.dark', { type: 'button', onclick: async (e) => {
    const b = e.currentTarget;
    const signer = acct.value.trim();
    if (!ADDR.test(signer)) return notice('no', 'Enter the counter’s full Concordium account.');
    b.disabled = true;
    try {
      await connect();
      fill(out, h('p.fine', 'Preparing the request… then approve one small record in your wallet.'));
      const c = await engine();
      const draft = await c.draftRequest(node, ESCROW, signer, role.value);
      const tx = await registerData(draft.anchor);
      const request = c.finishRequest(draft, tx);
      store.set(ASKED, { ...asked(), [tx]: { signer, role: role.value, at: Date.now(), request } });
      const url = linkTo('signer/prove', await pack({ request, signer, role: role.value }));
      fill(out, h('div.result.ok',
        h('p', h('b', 'Request ready. '), `Send this link to ${CAST.nameOf(signer)} (${short(signer)}). They open it with their own wallet.`),
        handoff(url, 'ID check request', 'Open it here (same browser)'),
        h('p.fine', 'Request recorded on-chain: ', h('a', { href: ccdscanTx(tx), target: '_blank', rel: 'noopener' }, 'transaction'), '.')));
    } catch (err) { fill(out, h('p.err', err.message ?? String(err))); } finally { b.disabled = false; }
  } }, 'Create proof request', h('i', { 'aria-hidden': 'true' }));
  return h('section.panel',
    h('h3', 'Ask a counter for proof'),
    quick,
    h('label.field', h('span', 'Counter’s account'), acct),
    h('label.field', h('span', 'Role on your orders'), role),
    go, out);
}

function pendingPanel(result) {
  const list = Object.entries(asked()).sort((a, b) => b[1].at - a[1].at);
  const done = new Set(verified().map((v) => v.request));
  const open = list.filter(([tx]) => !done.has(tx));
  const got = answers();
  return h('section.panel',
    h('h3', 'Waiting for answers'),
    open.length ? h('ul.ready-list.compact', open.map(([tx, a]) => h('li.ready',
      h(`span.ready-ico.${got[tx] ? 'ok' : 'hold'}`, icon(got[tx] ? 'check' : 'clock', 16)),
      h('div', h('b', `${CAST.nameOf(a.signer)} · ${a.role}`), h('span', got[tx] ? 'Answer received in this browser.' : `Asked ${fmtDate(a.at)}. Waiting for their answer link.`)),
      got[tx] ? h('button.btn.gold.small', { type: 'button', onclick: () => checkLocal(result, tx).catch((e) => say(result, 'no', e)) }, 'Check and record') : null)))
      : h('p.fine', 'No open requests. Ask a counter on the left.'),
    h('details.change', h('summary', 'Got an answer link? Paste it'),
      (() => {
        const box = h('textarea', { rows: 3, spellcheck: false, placeholder: 'The link the counter sent back' });
        return [box, h('button.btn.line.small', { type: 'button', onclick: () => {
          const v = box.value.trim();
          const i = v.indexOf('#/buyer/ids/');
          checkAnswer(result, i >= 0 ? v.slice(i + 12) : v).catch((e) => say(result, 'no', e));
        } }, 'Check it')];
      })()));
}

function verifiedPanel() {
  const list = verified();
  const tags = new Map();
  for (const v of list) tags.set(v.tag, (tags.get(v.tag) ?? 0) + 1);
  return h('section.panel',
    h('h3', 'Verified counters'),
    list.length ? h('ul.ready-list.compact', list.map((v) => h('li.ready',
      h(`span.ready-ico.${tags.get(v.tag) > 1 ? 'no' : 'ok'}`, icon(tags.get(v.tag) > 1 ? 'alert' : 'check', 16)),
      h('div', h('b', `${CAST.nameOf(v.account)} · ${v.role}`), h('span', tags.get(v.tag) > 1 ? 'Same person as another verified counter: the contract refuses an order naming both.' : `Verified ${fmtDate(v.at)}. Fingerprint ${v.tag.slice(0, 8)}…`)),
      h('a.inline', { href: ccdscanTx(v.auditTx), target: '_blank', rel: 'noopener' }, 'Audit', icon('external', 14)))))
      : h('p.fine', 'Nobody verified yet.'),
    h('details.change', h('summary', 'Salt backup'),
      h('p.fine', 'Your fingerprints use a private salt made by your wallet. Keep a backup so they stay the same on another browser or if your wallet keys change.'),
      h('div.actions',
        h('button.btn.line.small', { type: 'button', onclick: () => {
          const s = store.get(SALT, null);
          if (!s) return notice('wait', 'The salt is made the first time you record a counter.');
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ escrow: `<${ESCROW.index},0>`, salt: s, note: 'Private. Load it on the ID checks page to keep fingerprints the same.' }, null, 2)], { type: 'application/json' })), download: `ctp-salt-backup-${ESCROW.index}.json` });
          a.click();
        } }, icon('download', 16), 'Download'),
        h('label.btn.line.small', 'Load a backup', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async (e) => {
          try {
            const j = JSON.parse(await e.target.files[0].text());
            if (j.escrow !== `<${ESCROW.index},0>` || !/^[0-9a-f]{64}$/.test(j.salt)) throw new Error('That is not a salt backup for this escrow.');
            store.set(SALT, j.salt);
            notice('ok', 'Salt backup loaded.');
          } catch (err) { notice('no', err.message ?? String(err)); }
        } })))));
}

function howPanel() {
  const step = (n, t, d) => h('li', h('b', t), h('span', d));
  return h('section.panel.how',
    h('h3', 'How it works'),
    h('ol.guide',
      step(1, 'You ask', 'Create a request for one counter and send them the link.'),
      step(2, 'They prove', 'Their own Concordium wallet makes a zero-knowledge proof: a verified adult, sharing only their ID document issuer and number with this page.'),
      step(3, 'You record', 'The app checks the proof against the chain, makes a salted fingerprint, records an audit anchor, and saves the fingerprint on the escrow. The document number is never stored.')));
}

async function checkLocal(result, tx) {
  const a = asked()[tx];
  const ans = answers()[tx];
  if (!a || !ans) throw new Error('That answer is no longer here. Ask the counter again.');
  await checkAndOffer(result, tx, a, ans.presentation);
}

async function checkAnswer(result, packed) {
  const payload = await unpack(packed);
  const c = await engine();
  const tx = c.anchorTxOf(payload.request);
  const a = asked()[tx];
  // Who and in which role come from the request made here, never from the answer link.
  if (!a) throw new Error('This answer is not for a request made from this browser. Create the request here, send that link, and open the answer here.');
  await checkAndOffer(result, tx, a, payload.presentation);
}

async function checkAndOffer(result, tx, a, presentation) {
  say(result, 'wait', 'Checking the proof against the chain…');
  const c = await engine();
  const { record, attrs } = await c.verifyAnswer(node, ESCROW, a.signer, a.request, presentation);
  const issuer = attrs.idDocIssuer ?? '?';
  const doc = attrs.idDocNo ?? '';
  const masked = doc.length <= 4 ? '••••' : `${doc.slice(0, 2)}${'•'.repeat(doc.length - 4)}${doc.slice(-2)}`;
  const rec = h('button.btn.gold', { type: 'button', onclick: async (e) => {
    e.currentTarget.disabled = true;
    try { await recordIt(result, tx, a, record, attrs); } catch (err) { say(result, 'no', err); }
  } }, 'Record on the escrow');
  fill(result, h('section.panel.result.ok',
    h('h3', icon('check', 18), ` ${CAST.nameOf(a.signer)} is a verified adult`),
    h('p', `Proven with Concordium ID for ${short(a.signer)} as ${a.role}. ID document ${issuer} ${masked}. The number is used once to make a private fingerprint and is not stored.`),
    h('p.fine', 'Recording asks your buyer wallet for three approvals: a fixed message (makes your private salt, first time only), the audit record, and the escrow update.'),
    rec));
}

async function recordIt(result, tx, a, record, attrs) {
  await connect();
  const c = await engine();
  say(result, 'wait', 'Approve in your wallet…');
  let salt = store.get(SALT, null);
  if (!salt) { salt = toHex(await saltFromSignature(await signText(SALT_MESSAGE(ESCROW)))); store.set(SALT, salt); }
  const tag = await personTag(ESCROW, fromHex(salt), attrs.idDocIssuer, attrs.idDocNo);
  const audit = c.auditAnchor(record, a.role);
  const auditTx = await registerData(audit.bytes);
  const upd = await send('add_signer', { account: a.signer, role: { [a.role]: [] }, person_tag: { Some: [tag] }, id_audit: { Some: [audit.hash] } });
  const fin = await waitFinal(upd);
  if (!fin.ok) throw new Error(fin.reason ?? 'The escrow update did not finalize.');
  const others = verified().filter((v) => v.account !== a.signer);
  const twin = others.find((v) => v.tag === tag);
  store.set(K, [...others, { account: a.signer, role: a.role, tag, audit: audit.hash, auditTx, at: Date.now(), request: tx }]);
  const got = answers(); delete got[tx]; store.set(ANSWERS, got);
  const file = h('a.btn.line.small', { href: URL.createObjectURL(new Blob([JSON.stringify({ escrow: `<${ESCROW.index},0>`, account: a.signer, role: a.role, person_tag: tag, id_audit: audit.hash, audit_anchor_tx: auditTx, audit_record: audit.json }, null, 2)], { type: 'application/json' })), download: `ctp-id-audit-${a.signer.slice(0, 8)}.json` }, icon('download', 16), 'Audit record');
  fill(result, h(`section.panel.result.${twin ? 'no' : 'ok'}`,
    h('h3', icon(twin ? 'alert' : 'check', 18), twin ? ' Recorded: same person as another counter' : ` ${CAST.nameOf(a.signer)} is verified on the escrow`),
    h('p', twin
      ? `${CAST.nameOf(a.signer)} has the same fingerprint as ${CAST.nameOf(twin.account)} (${twin.role}). The contract will refuse an order that names both. Name two different people.`
      : `From now on, the contract refuses any order whose receiver and approver are this same person.`),
    h('div.actions', h('a.btn.dark.small', { href: '#/buyer' }, 'Back to dashboard'), h('a.btn.line.small', { href: ccdscanTx(upd), target: '_blank', rel: 'noopener' }, 'Escrow update', icon('external', 14)), file)));
  if (location.hash.split('/')[3]) history.replaceState(null, '', '#/buyer/ids');
}

// ======================= counter =======================

export async function proveView() {
  const packed = location.hash.split('/')[3];
  let p;
  try { p = await unpack(packed ?? ''); } catch { return h('section.panel.empty', h('h2', 'This link is incomplete'), h('p', 'Ask the buyer to send the ID check link again.')); }
  const me = currentAccount();
  const out = h('div');
  const right = me === p.signer;
  const prove = h('button.btn.gold', { type: 'button', disabled: !right, onclick: async (e) => {
    e.currentTarget.disabled = true;
    try {
      fill(out, h('p.fine', 'Your wallet will show exactly what is shared. Approve it there.'));
      const c = await engine();
      const presentation = c.presentationJSON(await requestProof(c.requestFromJSON(p.request)));
      const tx = c.anchorTxOf(p.request);
      store.set(ANSWERS, { ...answers(), [tx]: { presentation, at: Date.now() } });
      const url = linkTo('buyer/ids', await pack({ request: p.request, presentation }));
      fill(out, h('div.result.ok',
        h('p', h('b', 'Done. '), 'Your proof is ready. Send this link back to the buyer.'),
        handoff(url, 'ID check answer', 'Open as the buyer (same browser)'),
        h('p.fine', 'Same browser as the buyer? You can skip the link: their ID checks page already shows “Answer received”.')));
    } catch (err) { fill(out, h('p.err', err.message ?? String(err))); e.currentTarget.disabled = false; }
  } }, 'Prove with Concordium ID');
  return h('div.space', h('section.panel.prove',
    h('header.panel-h', h('h2', 'Prove you are a verified person'), h('p', `The buyer asks ${short(p.signer)} to prove, before counting deliveries as ${p.role.toLowerCase()}, that it belongs to a real verified adult.`)),
    h('ul.ready-list.compact',
      h('li.ready', h('span.ready-ico.ok', icon('check', 16)), h('div', h('b', 'Shared with the buyer’s page'), h('span', 'Your ID document issuer and number, and proof that you are over 18.'))),
      h('li.ready', h('span.ready-ico.ok', icon('lock', 16)), h('div', h('b', 'Stays private'), h('span', 'Your name, birthday and everything else. Only a salted fingerprint goes on-chain.')))),
    right ? null : h('p.err', me ? `Your wallet is connected as ${short(me)}. Pick ${short(p.signer)} in the Concordium Wallet, click the address button to log out, then Connect wallet.` : `Connect the wallet account ${short(p.signer)}.`),
    prove, out));
}
