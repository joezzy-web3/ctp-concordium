// App shell: role tabs, role band with a short guide, wallet button, hash routes,
// and smooth section changes with the browser's view transitions.
import { DEMO_ESCROW, ESCROW, isDemo, checkEscrow, openEscrow, connect, connectedAccounts, currentAccount, logout, onAccount, restore, useAccount } from './chain.js';
import { startView } from './start.js';
import { CAST, roleOf } from './cast.js';
import { h, fill, $, short, icon, notice, store } from './ui.js';
import { buyerView } from './buyer.js';
import { judgeView } from './judge.js';
import { refereeView } from './referee.js';
import { signerView } from './signer.js';
import { proveView } from './ids.js';
import { supplierView, agentView } from './roles.js';

const ROLES = {
  buyer: { name: 'Buyer', line: 'Orders, escrow and payments. Only the buyer account can sign here.', guide: [
    ['Check readiness', 'The cast is set up, the agent is verified and the supplier’s payout hold has passed.'],
    ['Create an order', 'Supplier, order lines, the two people who count. Nothing opens your wallet while you fill it.'],
    ['Review, then sign once', 'The amount locks in escrow. Download the purchase order to send the supplier.'],
    ['Watch it clear', 'Orders shows each one live: counting, invoice, supplier approval, hold, paid.'],
  ] },
  signer: { name: 'Delivery signer', line: 'Count what arrived: the buyer’s receiver and the supplier’s rep at the gate, the approver inside.', guide: [
    ['Count the delivery', 'On your own, before you talk to anyone else who counts.'],
    ['Seal your count', 'Only a fingerprint of it goes on-chain. This browser keeps the key that unlocks it.'],
    ['No count, no unload', 'The supplier’s rep unloads only after the buyer’s receiver has sealed.'],
    ['Unseal when the gate counts are sealed', 'The contract checks your number against your seal.'],
  ] },
  supplier: { name: 'Supplier', line: 'Accept orders, name your delivery rep, approve your invoice, and get paid.', guide: [
    ['Accept the order', 'Check the date, the buyer’s counters and the referee, and name your delivery rep.'],
    ['Approve the invoice', 'Pick the same invoice file you sent and confirm the amount you agreed.'],
    ['Keep your payout account safe', 'Any change waits out a hold (72 hours in production) before money can go there.'],
  ] },
  agent: { name: 'Agent', line: 'Agent #1287 submits invoices and asks for payment. It can never pay on its own.', guide: [
    ['Submit the invoice', 'The agent’s badge is checked before it reaches the contract.'],
    ['Ask for payment', 'The contract runs every rule and answers cleared or held, with the reasons.'],
  ] },
  referee: { name: 'Referee', line: 'Settle a disputed delivery: the supplier’s rep counted, but the counts do not confirm it.', guide: [] },
  judge: { name: 'Judge mode', line: 'Try the attacks that empty company accounts today, against the real contract.', guide: [] },
  start: { name: 'Your own escrow', line: 'Create an escrow for your company from the verified code, list your people, and order.', guide: [] },
};

const routes = {
  '': () => pickView(),
  buyer: (sub) => buyerView(sub),
  signer: (sub) => (sub === 'prove' ? proveView() : signerView()),
  supplier: () => supplierView(),
  agent: () => agentView(),
  referee: () => refereeView(),
  judge: () => (isDemo ? judgeView() : demoOnly()),
  start: () => startView(),
};
const ORDER = ['', 'buyer', 'signer', 'supplier', 'agent', 'referee', 'judge', 'start'];

/** Judge mode runs its attacks with the demo cast, so it lives on the demo escrow. */
function demoOnly() {
  return h('section.panel.empty', h('h2', 'Judge mode runs on the demo escrow'), h('p', 'Its attacks use the demo cast. Your own escrow is untouched.'), h('button.btn.dark', { type: 'button', onclick: () => openEscrow(DEMO_ESCROW, '#/judge') }, 'Open the demo escrow'));
}

/** A non-demo escrow must run the verified Clear to Pay code, or the app will not open it. */
let escrowOk = isDemo ? Promise.resolve({ ok: true }) : checkEscrow(ESCROW.index);

// ---------- shell ----------
function band(role) {
  const r = ROLES[role];
  const el = $('#band');
  el.dataset.role = role || 'pick';
  if (!r) { fill(el, h('div.band-in', h('b', 'Choose who you are'), h('span', 'Each role sees only its own part. The contract refuses anyone else.'))); return; }
  const me = currentAccount();
  const actual = roleOf(me);
  // A supplier can be its own delivery rep, and anyone can be named referee on an order.
  const mismatch = me && !['judge', 'referee'].includes(role) && actual && actual !== role && !(role === 'signer' && actual === 'supplier');
  const open = store.get(`guide:${role}`, false);
  const guideBtn = r.guide.length ? h('button.band-g', { type: 'button', 'aria-expanded': String(open), onclick: () => { store.set(`guide:${role}`, !open); band(role); } }, open ? 'Hide the guide' : 'Show the guide') : null;
  fill(el, 
    h('div.band-in',
      h('b', r.name),
      h('span', mismatch ? `You are connected as the ${ROLES[actual].name.toLowerCase()} (${short(me)}). Switch account in the wallet to act here.` : r.line),
      mismatch ? h('a.band-go', { href: `#/${actual}` }, `Go to the ${ROLES[actual].name.toLowerCase()} page`) : guideBtn),
    open && r.guide.length && !mismatch ? h('ol.guide', r.guide.map(([t, d]) => h('li', h('b', t), h('span', d)))) : null,
  );
}

function tabs(role) {
  for (const a of document.querySelectorAll('#tabs a')) {
    const on = a.dataset.role === role;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function pickView() {
  const tile = (role, title, text) => h('a.pick', { href: `#/${role}` }, h('b', title), h('span', text), icon('arrow', 20));
  return h('section.pick-grid',
    tile('buyer', 'Buyer', 'Create and fund orders, watch them clear.'),
    tile('signer', 'Delivery signer', 'Count what arrived, blind.'),
    tile('supplier', 'Supplier', 'Approve your invoice and amount.'),
    tile('agent', 'Agent', 'Submit invoices, ask for payment.'),
    tile('referee', 'Referee', 'Settle a disputed delivery.'),
    tile('judge', 'Judge mode', 'Try to fool it on the real contract.'),
    tile('start', 'Your own escrow', isDemo ? 'Start one for your company in three steps.' : `You are on escrow <${ESCROW.index},0>. Switch or set it up.`),
  );
}

let lastIndex = 0;
async function render() {
  const [role = '', sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const view = routes[role] ?? routes[''];
  const index = ORDER.indexOf(role);
  const dir = index >= lastIndex ? 'forward' : 'back';
  lastIndex = index;
  const chk = await escrowOk;
  const swap = async () => {
    tabs(role);
    band(role);
    const node = chk.ok || role === 'start' ? await view(sub) : h('section.panel.empty', h('h2', `Escrow <${ESCROW.index},0> can’t be opened`), h('p', chk.reason), h('button.btn.dark', { type: 'button', onclick: () => openEscrow(DEMO_ESCROW) }, 'Back to the demo escrow'), ' ', h('a.btn', { href: '#/start' }, 'Open another'));
    fill($('#view'), node);
    document.title = `${ROLES[role]?.name ?? 'Choose your role'} · Clear to Pay`;
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.dataset.dir = dir;
    await document.startViewTransition(swap).finished.catch(() => {});
  } else {
    await swap();
  }
  $('#view').focus({ preventScroll: true });
}

function walletButton(acct) {
  const b = $('#wallet');
  fill(b, acct ? h('span.dot-ok', icon('check', 14)) : null, acct ? `${CAST.nameOf(acct)} ${short(acct)}` : 'Connect wallet');
  b.classList.toggle('connected', Boolean(acct));
}

// ---------- account menu: tap the address button to switch accounts or log out ----------
let menu = null;
function closeMenu() {
  if (!menu) return;
  menu.remove();
  menu = null;
  $('#wallet').setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', onKey, true);
}
function outside(e) { if (menu && !menu.contains(e.target) && e.target !== $('#wallet') && !$('#wallet').contains(e.target)) closeMenu(); }
function onKey(e) { if (e.key === 'Escape') { closeMenu(); $('#wallet').focus(); } }
const label = (a) => `${CAST.nameOf(a)} · ${short(a)}`;

async function openMenu() {
  const me = currentAccount();
  let list = [me];
  try { list = await connectedAccounts(); } catch { /* keep the current one */ }
  if (!list.includes(me)) list = [me, ...list];
  const pick = (a) => h('button.acct-item', { type: 'button', role: 'menuitemradio', 'aria-checked': String(a === me), onclick: async () => {
    closeMenu();
    if (a === me) return;
    try { await useAccount(a); notice('ok', h('b', 'Now acting as '), label(a), '.'); } catch (err) { notice('no', String(err?.message ?? err)); }
  } }, h('b', CAST.nameOf(a)), h('span.mono', short(a)), a === me ? icon('check', 16) : null);
  menu = h('div.acct-menu', { role: 'menu', 'aria-label': 'Accounts' },
    h('p.acct-h', 'Act as'),
    list.map(pick),
    h('details.acct-more', h('summary', 'Use another account'),
      h('ol.acct-steps',
        h('li', 'Open the Concordium Wallet, tap the six dots, then Accounts.'),
        h('li', 'On any account: Connected sites, See list.'),
        h('li', `On ${location.host}, tap Edit.`),
        h('li', 'Tick every account you want here, then close.')),
      h('p', 'They appear in this menu straight away.')),
    h('a.acct-item', { role: 'menuitem', href: '#/start', onclick: () => closeMenu() }, h('b', isDemo ? 'Start your own escrow' : 'Switch escrow'), h('span.mono', `<${ESCROW.index},0>${isDemo ? ' demo' : ''}`)),
    h('button.acct-item.out', { type: 'button', role: 'menuitem', onclick: () => {
      closeMenu();
      logout();
      notice('ok', h('b', 'Logged out. '), 'Click Connect wallet to connect again.');
    } }, 'Log out'));
  $('#wallet').after(menu);
  $('#wallet').setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
  menu.querySelector('.acct-item')?.focus();
}

$('#wallet').setAttribute('aria-haspopup', 'menu');
$('#wallet').addEventListener('click', () => {
  if (menu) return closeMenu();
  if (currentAccount()) return openMenu();
  // Not connected: ask the wallet, which opens its window when this site needs approval.
  connect()
    .then((a) => { if (a) notice('ok', h('b', 'Connected '), `as ${label(a)}. Tap the address button to switch accounts or log out.`); })
    .catch((e) => notice('no', h('b', 'Wallet not connected. '), String(e?.message ?? e)));
});
// Redraw the page when the connected account changes, so each role sees its own view at once.
let shownFor;
onAccount((a) => {
  walletButton(a);
  if (shownFor !== undefined && a !== shownFor) render();
  shownFor = a;
});
addEventListener('hashchange', render);
render();
restore();
