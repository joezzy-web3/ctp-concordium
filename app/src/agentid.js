// #/agent/identity: who stands behind Agent #1287.
// Anyone: read the published proof and check it against the chain (no wallet needed).
// The agent's owner: prove once with Concordium ID (verified adult + country of residence),
// anchor the proof, and download agent-identity.json to publish next to the app.
// The proof engine (WebAssembly) loads only when a check or a proof starts.
import { AGENT, currentAccount, registerData, requestProof, ccdscanTx } from './chain.js';
import { h, fill, icon, chip, short, notice } from './ui.js';
import { AGENT_ID_FILE, buildIdentityFile, checkIdentityShape, identityLine } from '../../idcheck/src/agentid.js';

let core;
const engine = async () => (core ??= await import('./idcheck-core.js'));

/** The published proof, served next to the app. null if there is none yet. */
let published;
export async function publishedIdentity() {
  if (published !== undefined) return published;
  try {
    const r = await fetch(`./${AGENT_ID_FILE}`, { cache: 'no-store' });
    published = r.ok ? await r.json() : null;
  } catch { published = null; }
  return published;
}

/** A short line for other pages (the supplier's invoice card): what the file claims, unchecked. */
export async function agentBehindLine() {
  const f = await publishedIdentity();
  const s = f ? checkIdentityShape(f, { agentId: AGENT.id, owner: AGENT.owner }) : null;
  if (!s?.ok) return null;
  return h('p.fine', icon('user', 14), ` Agent #${AGENT.id} acts for a verified adult${s.country ? ` in ${s.country}` : ''}. `, h('a.inline', { href: '#/agent/identity' }, 'Check it on-chain'));
}

function download(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function checkPanel(file) {
  const out = h('div.live');
  if (!file) {
    return h('section.panel', h('h3', 'Who stands behind this agent'),
      h('p', `The owner of Agent #${AGENT.id} has not published an ID proof yet.`));
  }
  const shape = checkIdentityShape(file, { agentId: AGENT.id, owner: AGENT.owner });
  const btn = h('button.btn.dark', { type: 'button', onclick: async (e) => {
    e.currentTarget.disabled = true;
    fill(out, h('p.fine', 'Checking the proof against Concordium testnet…'));
    try {
      const c = await engine();
      const r = await c.checkAgent(file, AGENT.id, AGENT.owner);
      fill(out, h(`div.result.${r.ok ? 'ok' : 'no'}`, h('p', chip(r.ok ? 'ok' : 'no', r.ok ? 'Checks out' : 'Does not check out'), ' ', identityLine(r, AGENT.id)),
        r.ok ? h('ul.plain.fine',
          h('li', 'The proof is exactly the one anchored on-chain.'),
          h('li', 'It still verifies today, and the identity credential behind it is still active.'),
          h('li', `It is about the owner’s own account, ${short(AGENT.owner)}, which owns Agent #${AGENT.id} in the Concordium Agent Registry.`)) : null));
    } catch (err) { fill(out, h('p.err', err.message ?? String(err))); }
    e.currentTarget.disabled = false;
  } }, icon('check', 18), 'Check it against the chain');
  return h('section.panel',
    h('h3', 'Who stands behind this agent'),
    shape.ok
      ? h('ul.ready-list.compact',
        h('li.ready', h('span.ready-ico.ok', icon('user', 16)), h('div', h('b', 'A verified adult'), h('span', `Proven with Concordium ID: over ${file.proves.minimumAge}, from an identity checked by a Concordium identity provider.`))),
        shape.country ? h('li.ready', h('span.ready-ico.ok', icon('check', 16)), h('div', h('b', `Lives in ${shape.country}`), h('span', 'Country of residence, so a supplier knows which jurisdiction stands behind the agent.'))) : null,
        h('li.ready', h('span.ready-ico.ok', icon('lock', 16)), h('div', h('b', 'Nothing else revealed'), h('span', 'No name, no birthday, no document number. The proof is zero knowledge.'))))
      : h('p.err', `The published file does not match this agent: ${shape.reasons.join('; ')}.`),
    h('div.actions', btn, h('a.btn.line', { href: ccdscanTx(file.auditAnchorTx), target: '_blank', rel: 'noopener' }, 'Anchor on CCDScan', icon('external', 14)), h('a.btn.text', { href: `./${AGENT_ID_FILE}`, target: '_blank', rel: 'noopener' }, 'The proof file')),
    out);
}

function ownerPanel() {
  const out = h('div.live');
  const withCountry = h('input', { type: 'checkbox', checked: true, style: { width: '20px', height: '20px', flex: 'none', margin: '0' } });
  const btn = h('button.btn.gold', { type: 'button', onclick: async (e) => {
    e.currentTarget.disabled = true;
    const me = currentAccount();
    try {
      fill(out, h('p.fine', 'Step 1 of 3: anchor the proof request. Your wallet asks you to approve a small RegisterData transaction.'));
      const c = await engine();
      const draft = await c.draftOwner(AGENT.id, me, { withCountry: withCountry.checked });
      const requestAnchorTx = await registerData(draft.anchor);
      const requestJSON = c.finishRequest(draft, requestAnchorTx);
      fill(out, h('p.fine', `Step 2 of 3: in the wallet window, choose ${short(me)} at the top, check what is shared (over 18${withCountry.checked ? ', country of residence' : ''}), then approve.`));
      const presentation = c.presentationJSON(await requestProof(c.requestFromJSON(requestJSON)));
      const record = await c.verifyOwnerAnswer(AGENT.id, me, requestJSON, presentation);
      fill(out, h('p.fine', 'Step 3 of 3: anchor the proof. Approve one more RegisterData transaction.'));
      const auditAnchorTx = await registerData(c.ownerAuditAnchor(record, AGENT.id));
      const file = buildIdentityFile({ agentId: AGENT.id, owner: me, record, auditAnchorTx, requestAnchorTx });
      download(AGENT_ID_FILE, file);
      fill(out, h('div.result.ok',
        h('p', h('b', 'Done. '), `Proven: a verified adult${file.proves.countryOfResidence ? ` living in ${file.proves.countryOfResidence}` : ''}. The file ${AGENT_ID_FILE} has downloaded.`),
        h('p.fine', 'Publish it next to the app (app/agent-identity.json) so everyone can check it.'),
        h('div.actions', h('a.btn.line.small', { href: ccdscanTx(auditAnchorTx), target: '_blank', rel: 'noopener' }, 'Proof anchor', icon('external', 14)), h('button.btn.line.small', { type: 'button', onclick: () => download(AGENT_ID_FILE, file) }, 'Download again'))));
      notice('ok', 'Owner proof anchored on-chain.');
    } catch (err) {
      fill(out, h('p.err', err.message ?? String(err)), withCountry.checked ? h('p.fine', 'If the wallet could not answer, your identity may have no country of residence on record. Untick “Also share my country of residence” and try again.') : null);
      e.currentTarget.disabled = false;
    }
  } }, icon('user', 18), `Prove who stands behind Agent #${AGENT.id}`);
  return h('section.panel',
    h('h3', 'You own this agent: prove who stands behind it'),
    h('p', 'Once, with Concordium ID. Your wallet proves, in zero knowledge, that you are a verified adult and shares your country of residence. Nothing else.'),
    h('p.fine', 'Two small RegisterData transactions anchor the request and the proof. Your name, birthday and document number never leave your wallet.'),
    h('label.check', { style: { justifyContent: 'flex-start', margin: '16px 0' } }, withCountry, h('span', 'Also share my country of residence (useful for cross-border sales)')),
    btn, out);
}

export async function agentIdentityView(side, frame) {
  const file = await publishedIdentity();
  const me = currentAccount();
  return frame(side,
    h('header.dash-h', h('div', h('h2', 'Who stands behind the agent'), h('p', `An AI agent should answer to a real person. Agent #${AGENT.id}’s owner proves it with Concordium ID, and anyone can check the proof against the chain.`))),
    h('div', { style: { display: 'grid', gap: '16px' } },
    checkPanel(file),
    me === AGENT.owner ? ownerPanel() : null,
    h('section.panel', h('h3', 'Why this matters'),
      h('p', 'The Agent Registry already shows that a verified person owns this agent. This proof adds two facts a supplier can rely on: the owner is an adult, and where they live. That is what Concordium’s Agent IDP will give agents natively; until it ships, Clear to Pay does it with today’s Concordium ID proofs.'))));
}
