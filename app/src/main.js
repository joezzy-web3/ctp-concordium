// App shell: role tabs, role band with a short guide, wallet button, hash routes,
// and smooth section changes with the browser's view transitions.
import { connect, currentAccount, onAccount } from './chain.js';
import { CAST, roleOf } from './cast.js';
import { h, fill, $, short, icon, notice, store } from './ui.js';
import { buyerView } from './buyer.js';
import { placeholderView } from './placeholder.js';
import { signerView } from './signer.js';
import { supplierView, agentView } from './roles.js';

const ROLES = {
  buyer: { name: 'Buyer', line: 'Orders, escrow and payments. Only the buyer account can sign here.', guide: [
    ['Check readiness', 'The cast is set up, the agent is verified and the supplier’s payout hold has passed.'],
    ['Create an order', 'Supplier, order lines, the two people who count. Nothing opens your wallet while you fill it.'],
    ['Review, then sign once', 'The amount locks in escrow. Download the purchase order to send the supplier.'],
    ['Watch it clear', 'Orders shows each one live: counting, invoice, supplier approval, hold, paid.'],
  ] },
  signer: { name: 'Delivery signer', line: 'Count what arrived. Nobody sees your number until both of you have counted.', guide: [
    ['Count the delivery', 'On your own, before you talk to the other signer.'],
    ['Commit your count', 'Only a fingerprint of it goes on-chain. This browser keeps the secret that unlocks it.'],
    ['Reveal when both have committed', 'The contract checks your number against your fingerprint.'],
  ] },
  supplier: { name: 'Supplier', line: 'Approve your invoice and amount, watch your payout account and payments.', guide: [
    ['Approve the invoice', 'Pick the same invoice file you sent and confirm the amount you agreed.'],
    ['Keep your payout account safe', 'Any change waits 72 hours before money can go there.'],
  ] },
  agent: { name: 'Agent', line: 'Agent #1287 submits invoices and asks for payment. It can never pay on its own.', guide: [
    ['Submit the invoice', 'The agent’s badge is checked before it reaches the contract.'],
    ['Ask for payment', 'The contract runs every rule and answers cleared or held, with the reasons.'],
  ] },
  judge: { name: 'Judge mode', line: 'Try the attacks that empty company accounts today, against the real contract.', guide: [] },
};

const routes = {
  '': () => pickView(),
  buyer: (sub) => buyerView(sub),
  signer: () => signerView(),
  supplier: () => supplierView(),
  agent: () => agentView(),
  judge: () => placeholderView('judge'),
};
const ORDER = ['', 'buyer', 'signer', 'supplier', 'agent', 'judge'];

// ---------- shell ----------
function band(role) {
  const r = ROLES[role];
  const el = $('#band');
  el.dataset.role = role || 'pick';
  if (!r) { fill(el, h('div.band-in', h('b', 'Choose who you are'), h('span', 'Each role sees only its own part. The contract refuses anyone else.'))); return; }
  const me = currentAccount();
  const actual = roleOf(me);
  const mismatch = me && role !== 'judge' && actual && actual !== role;
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
    tile('judge', 'Judge mode', 'Try to fool it on the real contract.'),
  );
}

let lastIndex = 0;
async function render() {
  const [role = '', sub = ''] = location.hash.replace(/^#\/?/, '').split('/');
  const view = routes[role] ?? routes[''];
  const index = ORDER.indexOf(role);
  const dir = index >= lastIndex ? 'forward' : 'back';
  lastIndex = index;
  const swap = async () => {
    tabs(role);
    band(role);
    const node = await view(sub);
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

$('#wallet').addEventListener('click', () => connect().catch((e) => notice('no', h('b', 'Wallet not connected. '), String(e?.message ?? e))));
onAccount((a) => { walletButton(a); const [role] = location.hash.replace(/^#\/?/, '').split('/'); band(role ?? ''); });
addEventListener('hashchange', render);
render();
