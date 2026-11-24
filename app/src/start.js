// Start your own escrow: any company creates its own escrow from the verified module,
// lists its own people, and orders through it. Each escrow is its own contract: its own
// money, orders, people and buyer admin. Nobody else can touch it.
import { AGENT, DEMO_ESCROW, ESCROW, isDemo, connect, currentAccount, createEscrow, checkEscrow, openEscrow, viewConfig, viewSupplier, ccdscanTx } from './chain.js';
import { CAST, saveCast } from './cast.js';
import { act } from './act.js';
import { h, fill, icon, chip, short, notice } from './ui.js';

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{50}$/;
const HOLDS = { test: 60 * 1000, prod: 72 * 3600 * 1000 };
const field = (label, input, hint) => h('label.field', h('span', label), input, hint ? h('small.hint', hint) : null);
const input = (props) => h('input', { autocomplete: 'off', spellcheck: 'false', ...props });

export async function startView() {
  return h('div.space.start',
    h('section.panel',
      h('header.panel-h', h('h2', 'Start your own escrow')),
      h('p.lead', 'Any company can run Clear to Pay on its own escrow: the same verified code as the demo, with its own money, orders and people. Nobody else can touch it.'),
      h('ol.start-steps',
        h('li', h('b', 'Create your escrow'), h('span', 'One wallet approval. Your account becomes its buyer admin.')),
        h('li', h('b', 'List your people'), h('span', 'Your receiver, an optional approver, your supplier and its payout account, and the AI agent.')),
        h('li', h('b', 'Order'), h('span', 'Create orders as usual. The contract decides every payment.'))),
      current()),
    isDemo ? createPanel() : await peoplePanel(),
    openPanel());
}

function current() {
  return h('p.start-now', icon('check', 16), ' You are on escrow ', h('b.mono', `<${ESCROW.index},${ESCROW.subindex}>`), isDemo ? ' (the demo, with its demo cast).' : ' (your own).',
    !isDemo ? [' ', h('button.link', { type: 'button', onclick: () => openEscrow(DEMO_ESCROW) }, 'Back to the demo')] : null);
}

// ---------- 1. create ----------
function createPanel() {
  const hold = h('select', { 'aria-label': 'Wait before paying a new or changed payout account' },
    h('option', { value: 'prod', selected: true }, '72 hours (recommended for a real company)'),
    h('option', { value: 'test' }, '1 minute (test only: no real protection)'));
  const holdNote = h('small.hint');
  const sayHold = () => fill(holdNote, hold.value === 'test'
    ? [chip('hold', 'Test only'), ' Use this just to try the whole flow in one sitting. A 1-minute wait does not stop payout-account scams.']
    : 'Stops “we changed our bank details, pay today” scams: a new or changed account waits 72 hours, time for the real supplier or you to notice.');
  hold.addEventListener('change', sayHold); sayHold();
  const out = h('div.live');
  const btn = h('button.btn.gold', { type: 'button', onclick: async () => {
    btn.disabled = true;
    try { await connect(); } catch (e) { notice('no', String(e?.message ?? e)); btn.disabled = false; return; }
    const me = currentAccount();
    if (!me) { notice('no', 'Connect your wallet first.'); btn.disabled = false; return; }
    fill(out, h('p', chip('wait', 'Creating'), ' Approve in your wallet, then wait for the chain to finalize it.'));
    const r = await createEscrow(HOLDS[hold.value]);
    if (r.ok) {
      saveCast(r.index, { buyer: me });
      notice('ok', h('b', `Escrow <${r.index},0> created. `), 'Now list your people.');
      openEscrow(r.index, '#/start');
      return;
    }
    btn.disabled = false;
    fill(out, h('p.err', icon('alert', 16), ' ', r.reason, r.tx ? [' ', h('a', { href: ccdscanTx(r.tx), target: '_blank', rel: 'noopener' }, 'See it on CCDScan', icon('external', 14))] : null));
  } }, 'Create my escrow');
  return h('section.panel',
    h('h3', '1. Create your escrow'),
    h('p', 'Made from the module ', h('span.mono', '196930b8…'), ', the build CCDExplorer shows as Verified. The account you approve with becomes the buyer admin.'),
    field('Wait before paying a new or changed payout account', hold),
    holdNote,
    h('p.hint', 'Set once, for this escrow’s whole life. Nobody can shorten it later: not you, not anyone who takes over your wallet.'),
    btn, out);
}

// ---------- 2. people ----------
async function peoplePanel() {
  const [cfg, sup] = await Promise.all([viewConfig().catch(() => null), CAST.supplier ? viewSupplier(CAST.supplier).catch(() => undefined) : null]);
  if (!cfg) return h('section.panel', h('p.err', icon('alert', 16), ' Could not read this escrow right now. Check your connection, then reload.'));
  const done = Boolean(sup);
  const me = currentAccount();
  const f = {
    receiver: input({ value: CAST.receiver, placeholder: 'Receiver’s Concordium account' }),
    approver: input({ value: CAST.approver, placeholder: 'Optional: approver’s account' }),
    supplierName: input({ value: CAST.supplierName === 'Supplier' ? '' : CAST.supplierName, placeholder: 'Supplier name, e.g. your rice supplier' }),
    supplier: input({ value: CAST.supplier, placeholder: 'Supplier’s Concordium account' }),
    payout: input({ value: CAST.supplier, placeholder: 'Payout account (usually the supplier’s own)' }),
    agentOwn: h('input', { type: 'checkbox' }),
    agent: input({ value: CAST.agent === AGENT.owner ? '' : CAST.agent, placeholder: 'Your agent’s account' }),
    agentId: input({ value: CAST.agentId === AGENT.id ? '' : String(CAST.agentId), placeholder: 'Agent ID in the registry', inputMode: 'numeric' }),
  };
  f.agentOwn.checked = CAST.agent !== AGENT.owner;
  const ownAgent = h('div.own-agent', field('Agent account', f.agent), field('Agent ID', f.agentId));
  const toggle = () => { ownAgent.hidden = !f.agentOwn.checked; };
  f.agentOwn.addEventListener('change', toggle); toggle();

  const save = h('button.btn.dark', { type: 'button', onclick: async () => {
    const v = (k) => f[k].value.trim();
    const errs = [];
    if (!ADDR_RE.test(v('receiver'))) errs.push('Enter the receiver’s account.');
    if (v('approver') && !ADDR_RE.test(v('approver'))) errs.push('The approver’s account is not a valid address.');
    if (!ADDR_RE.test(v('supplier'))) errs.push('Enter the supplier’s account.');
    const payout = v('payout') || v('supplier');
    if (!ADDR_RE.test(payout)) errs.push('The payout account is not a valid address.');
    const own = f.agentOwn.checked;
    if (own && (!ADDR_RE.test(v('agent')) || !/^\d+$/.test(v('agentId')))) errs.push('Enter your agent’s account and its ID in the registry.');
    const people = [v('receiver'), v('approver'), v('supplier')].filter(Boolean);
    if (new Set(people).size !== people.length) errs.push('The receiver, approver and supplier must be different accounts.');
    if (people.includes(cfg.admin)) errs.push('The buyer admin cannot also count or be the supplier.');
    if (errs.length) return notice('no', errs.join(' '));
    if (currentAccount() !== cfg.admin) return notice('no', `Only the buyer admin (${short(cfg.admin)}) can list people on this escrow. Switch to it in the account menu.`);
    const agent = own ? v('agent') : AGENT.owner, agentId = own ? Number(v('agentId')) : AGENT.id;
    saveCast(ESCROW.index, { buyer: cfg.admin, receiver: v('receiver'), approver: v('approver'), supplier: v('supplier'), supplierName: v('supplierName') || 'Supplier', agent, agentId });
    save.disabled = true;
    const signers = [{ account: v('receiver'), role: { Receiver: [] }, person_tag: { None: [] }, id_audit: { None: [] } }];
    if (v('approver')) signers.push({ account: v('approver'), role: { Approver: [] }, person_tag: { None: [] }, id_audit: { None: [] } });
    const r = await act('setup', { signers, agents: [{ account: agent, agent_token_id: agentId }], suppliers: [{ supplier: v('supplier'), payout }] },
      { pending: 'Listing your people. ', done: `Your people are listed. The contract checked Agent #${agentId} in the Concordium registry; the supplier’s payout hold started now.` });
    if (r.ok) location.hash = '#/buyer';
    else save.disabled = false;
  } }, 'List them on my escrow');

  return h('section.panel',
    h('h3', '2. List your people'),
    done ? h('p', chip('ok', 'Done'), ` Your supplier is registered on this escrow. You can add more people any time, or `, h('a', { href: '#/buyer/new' }, 'create an order'), '.') : null,
    me && me !== cfg.admin ? h('p.hint', icon('alert', 14), ` Connected as ${short(me)}. Only the buyer admin ${short(cfg.admin)} can list people.`) : null,
    h('div.form-grid',
      field('Receiver (counts at the gate)', f.receiver),
      field('Approver (optional, recommended for companies)', f.approver, 'A second person who checks inside.'),
      field('Supplier name', f.supplierName, 'Shown on screen and on your purchase orders.'),
      field('Supplier’s account', f.supplier),
      field('Supplier’s payout account', f.payout, 'Where payments go. Only the supplier can change it later, and every change waits out the hold.')),
    h('fieldset.agent-pick',
      h('legend', 'AI agent'),
      h('p', `By default your orders use Agent #${AGENT.id} (Clear to Pay’s Claude agent). The contract checks the agent in Concordium’s Agent Registry before accepting it, and the agent can only ever ask: the contract decides.`),
      h('label.check', f.agentOwn, ' Use my own registered agent instead'),
      ownAgent),
    save);
}

// ---------- open another escrow ----------
function openPanel() {
  const idx = input({ placeholder: 'Contract index, e.g. 13160', inputMode: 'numeric', 'aria-label': 'Escrow contract index' });
  const out = h('div.live');
  const go = h('button.btn.dark.small', { type: 'button', onclick: async () => {
    const n = idx.value.trim().replace(/^<|,0>$/g, '');
    if (!/^\d{1,12}$/.test(n)) return notice('no', 'Enter the escrow’s contract index, the first number in <index,0>.');
    go.disabled = true;
    fill(out, h('p', chip('wait', 'Checking'), ' Reading the contract from testnet.'));
    const c = await checkEscrow(Number(n));
    go.disabled = false;
    if (!c.ok) return fill(out, h('p.err', icon('alert', 16), ' ', c.reason));
    openEscrow(Number(n));
  } }, 'Open');
  return h('section.panel',
    h('h3', 'Open an escrow you already have'),
    h('p', 'The app opens only escrows running the verified Clear to Pay code.'),
    h('div.count-row', idx, go), out,
    !isDemo ? h('p', h('button.link', { type: 'button', onclick: () => openEscrow(DEMO_ESCROW) }, 'Back to the demo escrow')) : null);
}
