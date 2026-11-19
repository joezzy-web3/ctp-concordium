// Buyer space: Readiness, New order (wizard with review and one signature), Orders.
import { AGENT, ESCROW, currentAccount, listOrders, viewConfig, viewSupplier, ccdscanTx } from './chain.js';
import { ccdToMicro, microToCcd, orderStage } from './codec.js';
import { CAST } from './cast.js';
import { act } from './act.js';
import { h, fill, icon, chip, countdown, fmtDate, short, store, notice } from './ui.js';
import { printPO } from './po.js';

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{50}$/;
const SETUP_TX = '5ceebe7c6dc59eed13eaa21cb6518429bbfda509748b6c8962c4530d51827ae3';

// ---------- sidebar ----------
const CONTRACT_URL = `https://testnet.ccdscan.io/?dcount=1&dentity=contract&dcontractAddressIndex=${ESCROW.index}&dcontractAddressSubIndex=${ESCROW.subindex}`;
function sidebar(sub) {
  const me = currentAccount();
  const item = (key, label, ico) => h('a', { href: `#/buyer${key ? `/${key}` : ''}`, class: sub === key ? 'on' : null, 'aria-current': sub === key ? 'page' : null }, icon(ico, 18), label);
  return h('aside.side',
    h('div.who', h('span.avatar', 'B'), h('div', h('b', 'Buyer'), h('span.mono', me ? short(me) : 'Not connected'))),
    h('nav', { 'aria-label': 'Buyer sections' }, item('', 'Dashboard', 'grid'), item('new', 'New order', 'plus'), item('orders', 'Orders', 'list')),
    h('a.side-foot', { href: CONTRACT_URL, target: '_blank', rel: 'noopener' }, `Escrow <${ESCROW.index},${ESCROW.subindex}>`, icon('external', 14)));
}

export async function buyerView(sub = '') {
  const body = sub === 'new' ? wizard() : sub === 'orders' ? await ordersView() : await dashboard();
  return h('div.space.with-side', sidebar(sub), h('div.space-main', body));
}

// ---------- readiness ----------
async function badge() {
  try {
    const r = await fetch(`https://agent-registry-mcp.concordium.com/v1/check-badge/${AGENT.badge}?network=testnet`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return { known: true, ok: j.badge_valid === true, issues: j.issues ?? [] };
  } catch {
    return { known: false };
  }
}

const NEXT_STEP = {
  counting: 'The receiver and approver count the delivery.',
  revealing: 'The signers reveal their sealed counts.',
  mismatch: 'The counts do not match the order: check with the signers.',
  invoice: `Agent #${AGENT.id} submits the invoice.`,
  approval: 'The supplier approves the invoice and its amount.',
  amount: 'The invoice amount differs from the escrow: refund and reorder.',
  hold: 'The supplier’s new payout account is still in its 72-hour hold.',
  ready: `Agent #${AGENT.id} asks the contract to pay.`,
};

async function dashboard() {
  const [cfg, sup, orders, b] = await Promise.all([
    viewConfig().catch(() => null), viewSupplier(CAST.supplier).catch(() => undefined), listOrders().catch(() => null), badge(),
  ]);
  if (!cfg || !orders) {
    return h('section.panel', h('header.panel-h', h('h2', 'Dashboard')), h('p.err', icon('alert', 16), 'Could not read the escrow contract right now. Check your connection, then reload.'));
  }
  const me = currentAccount();
  const supByAddr = { [CAST.supplier]: sup ?? null };
  const open = orders.filter((o) => !o.paid && !o.refunded);
  const paid = orders.filter((o) => o.paid);
  const held = open.reduce((x, o) => x + o.amount, 0n);
  const paidOut = paid.reduce((x, o) => x + o.amount, 0n);
  const staged = open.map((o) => ({ o, st: orderStage(o, supByAddr[o.supplier], cfg.hold_ms) }));
  const waiting = staged.filter(({ st }) => st.key !== 'ready');

  // payout hold ring: how much of the 72 hours has passed
  const start = sup ? sup.payout_set_at : null;
  const end = start ? start + cfg.hold_ms : null;
  const done = end ? Math.min(1, Math.max(0, (Date.now() - start) / cfg.hold_ms)) : 0;
  const ring = h('div.ring', { style: { '--p': `${Math.round(done * 100)}%` }, role: 'img', 'aria-label': `${Math.round(done * 100)}% of the payout hold has passed` },
    h('div.ring-in', h('b.num', end && end > Date.now() ? countdown(end - Date.now()) : 'Done'), h('span', end && end > Date.now() ? 'left' : 'hold passed')));

  const tile = (cls, label, value, foot) => h(`div.tile.${cls}`, h('span', label), h('b.num', value), h('small', foot));
  const row = (tone, title, text, extra) => h('li.ready', h(`span.ready-ico.${tone}`, icon(tone === 'ok' ? 'check' : tone === 'hold' ? 'clock' : 'alert', 16)), h('div', h('b', title), h('span', text), extra));

  return h('div.dash',
    h('header.dash-h', h('div', h('h2', 'Dashboard'), h('p', 'Everything here is read live from the escrow contract.')), h('a.btn.dark', { href: '#/buyer/new' }, 'New order', h('i', { 'aria-hidden': 'true' }))),
    h('div.tiles',
      tile('t-sage', 'Held in escrow', `${microToCcd(held)} CCD`, `${open.length} open ${open.length === 1 ? 'order' : 'orders'}`),
      tile('t-amber', 'Waiting on someone', String(waiting.length), waiting.length ? 'see below who acts next' : 'nothing is stuck'),
      tile('t-sky', 'Paid to suppliers', `${microToCcd(paidOut)} CCD`, `${paid.length} paid ${paid.length === 1 ? 'order' : 'orders'}`)),
    h('div.dash-cols',
      h('section.panel.attn',
        h('div.panel-row', h('h3', 'Open orders'), h('a.inline', { href: '#/buyer/orders' }, 'All orders', icon('arrow', 14))),
        staged.length ? h('ul.attn-list', staged.map(({ o, st }) => h('li',
          h('a', { href: '#/buyer/orders' },
            h('span.order-id.num', `#${o.id}`),
            h('span.attn-what', h('b.num', `${microToCcd(o.amount)} CCD`), h('span', NEXT_STEP[st.key] ?? st.label)),
            chip(st.tone, st.label)))))
          : h('div.empty-s', h('p', 'No open orders. Create one and the amount locks in escrow until it clears.'))),
      h('div.dash-side',
        h('section.panel.hold',
          h('h3', 'Supplier payout hold'),
          sup ? [ring, h('p', end > Date.now() ? `${CAST.supplierName} can be paid from ${fmtDate(end)}.` : `${CAST.supplierName} can be paid now.`)]
            : h('p', sup === null ? 'The supplier is not registered on this escrow.' : 'Could not read the supplier right now.')),
        h('section.panel.checks',
          h('h3', 'Readiness'),
          h('ul.ready-list.compact',
            row(me === cfg.admin ? 'ok' : 'hold', 'Buyer account', me === cfg.admin ? 'Connected as the buyer admin.' : `Connect ${short(cfg.admin)} to create orders.`),
            b.known ? row(b.ok ? 'ok' : 'no', `Agent #${AGENT.id}`, b.ok ? 'Verified by Concordium.' : 'Badge does not check out.')
              : row('hold', `Agent #${AGENT.id}`, 'Registry not reachable from here.', h('a.inline', { href: `https://agent-registry-mcp.concordium.com/v1/check-badge/${AGENT.badge}?network=testnet`, target: '_blank', rel: 'noopener' }, 'Check', icon('external', 14))),
            row('ok', 'Receiver and approver', 'Listed on the contract.', h('a.inline', { href: ccdscanTx(SETUP_TX), target: '_blank', rel: 'noopener' }, 'Setup', icon('external', 14))))))),
  );
}

// ---------- new order wizard ----------
const STEPS = ['Supplier', 'Order lines', 'Who counts', 'Review'];
const blank = () => ({ step: 0, supplier: CAST.supplier, supplierName: CAST.supplierName, place: '', notes: '', lines: [{ item: '', qty: '', price: '' }], receiver: CAST.receiver, approver: CAST.approver });
const load = () => ({ ...blank(), ...store.get('ctp:draft', {}) });
const save = (d) => store.set('ctp:draft', d);

function totals(d) {
  let units = 0n, micro = 0n, ok = d.lines.length > 0;
  for (const l of d.lines) {
    const q = /^\d{1,9}$/.test(String(l.qty).trim()) ? BigInt(l.qty) : null;
    const p = ccdToMicro(l.price);
    if (!l.item.trim() || q == null || q === 0n || p == null) { ok = false; continue; }
    units += q;
    micro += q * p;
  }
  return { units, micro, ok: ok && micro > 0n };
}

function problems(d, step) {
  const p = [];
  if (step === 0) {
    if (!ADDR_RE.test(d.supplier.trim())) p.push('Enter the supplier’s Concordium account.');
    if (!d.supplierName.trim()) p.push('Enter the supplier’s name for the purchase order.');
  }
  if (step === 1 && !totals(d).ok) p.push('Each line needs an item, a whole quantity and a unit price in CCD.');
  if (step === 2) {
    if (!ADDR_RE.test(d.receiver.trim()) || !ADDR_RE.test(d.approver.trim())) p.push('Enter both accounts.');
    else if (d.receiver.trim() === d.approver.trim()) p.push('The receiver and the approver must be two different people.');
  }
  return p;
}

function field(label, input, hint) {
  return h('label.field', h('span', label), input, hint ? h('small', hint) : null);
}

function wizard() {
  const d = load();
  const root = h('section.panel.wizard');
  let dir = 'fwd';

  const go = (step) => {
    const errs = step > d.step ? problems(d, d.step) : [];
    if (errs.length) { paint(errs); return; }
    dir = step >= d.step ? 'fwd' : 'back';
    d.step = step;
    save(d);
    paint();
  };

  const input = (key, attrs = {}) => h('input', { value: d[key], ...attrs, oninput: (e) => { d[key] = e.target.value; save(d); } });

  function stepSupplier() {
    const status = h('p.live', 'Checking the supplier on the contract…');
    viewSupplier(d.supplier.trim()).then((s) => {
      fill(status, s ? chip('ok', 'Registered') : chip('no', 'Not registered'), ' ', s ? `Paid to its own account ${short(s.payout)}.` : 'Register it before ordering, or the contract will refuse the order.');
    }).catch(() => fill(status, chip('wait', 'Unknown'), ' Could not reach the contract to check.'));
    return h('div',
      field('Supplier name (for the purchase order)', input('supplierName', { autocomplete: 'organization' })),
      field('Supplier’s Concordium account', input('supplier', { spellcheck: false, class: 'mono' }), 'Payment goes only to the payout account the supplier registered itself.'),
      status);
  }

  function stepLines() {
    const t = totals(d);
    const tbody = h('tbody', d.lines.map((l, i) => h('tr',
      h('td', h('input', { value: l.item, 'aria-label': `Item ${i + 1}`, placeholder: 'Rice, 50 kg bag', oninput: (e) => { l.item = e.target.value; save(d); refreshTotals(); } })),
      h('td', h('input.num', { value: l.qty, inputMode: 'numeric', 'aria-label': `Quantity ${i + 1}`, placeholder: '100', oninput: (e) => { l.qty = e.target.value; save(d); refreshTotals(); } })),
      h('td', h('input.num', { value: l.price, inputMode: 'decimal', 'aria-label': `Unit price ${i + 1} in CCD`, placeholder: '0.25', oninput: (e) => { l.price = e.target.value; save(d); refreshTotals(); } })),
      h('td', d.lines.length > 1 ? h('button.icon-btn', { type: 'button', 'aria-label': `Remove line ${i + 1}`, onclick: () => { d.lines.splice(i, 1); save(d); paint(); } }, icon('x', 16)) : null),
    )));
    const tot = h('p.totals');
    function refreshTotals() {
      const x = totals(d);
      fill(tot, h('span', 'Units the signers will count: ', h('b.num', x.units.toString())), h('span', 'Total to lock in escrow: ', h('b.num', `${microToCcd(x.micro)} CCD`)));
    }
    refreshTotals();
    return h('div',
      h('table.lines', h('thead', h('tr', h('th', 'Item'), h('th', 'Quantity'), h('th', 'Unit price (CCD)'), h('th', h('span.sr', 'Remove')))), tbody),
      h('button.btn.line.small', { type: 'button', onclick: () => { d.lines.push({ item: '', qty: '', price: '' }); save(d); paint(); } }, icon('plus', 16), 'Add a line'),
      tot,
      field('Deliver to', input('place', { placeholder: 'Apapa warehouse, Lagos' })),
      field('Notes for the supplier (optional)', input('notes')));
    void t;
  }

  function stepCounters() {
    return h('div',
      h('p.lead', 'Two different people count the delivery without seeing each other’s number. The contract pays only when both counts match the order.'),
      field('Receiver (counts on arrival)', input('receiver', { spellcheck: false, class: 'mono' })),
      field('Approver (a second person, in another role)', input('approver', { spellcheck: false, class: 'mono' })));
  }

  function stepReview() {
    const t = totals(d);
    const idBox = h('span', 'This order locks in escrow');
    listOrders().then((os) => { d.orderId = (os.at(-1)?.id ?? 0) + 1; fill(idBox, 'Order ', h('b.num', `#${d.orderId}`), ' locks in escrow'); }).catch(() => fill(idBox, 'Could not read the next order number; reload before signing.'));
    const sec = (i, title, ...content) => h('section.rv', h('div.rv-h', h('h3', title), h('button.btn.text.small', { type: 'button', onclick: () => go(i) }, icon('edit', 16), 'Edit')), ...content);
    const params = () => ({ order_id: d.orderId, supplier: d.supplier.trim(), expected_qty: Number(t.units), receiver: d.receiver.trim(), approver: d.approver.trim() });
    const sign = h('button.btn.gold.wide', { type: 'button', onclick: async () => {
      if (!d.orderId) return notice('no', 'Could not work out the next order number. Reload and try again.');
      if (currentAccount() !== CAST.buyer) notice('wait', 'This must be signed by the buyer account; the contract refuses anyone else.');
      sign.disabled = true;
      const r = await act('create_order', params(), { micro: t.micro, pending: `Order #${d.orderId} sent. `, done: `Order #${d.orderId} created. ${microToCcd(t.micro)} CCD is locked in escrow.` });
      sign.disabled = false;
      if (r.ok) { store.set(`ctp:po:${d.orderId}`, d); store.del('ctp:draft'); location.hash = '#/buyer/orders'; }
    } }, 'Sign with wallet');
    return h('div.review',
      h('div.rv-col',
        sec(0, 'Supplier', h('p', h('b', d.supplierName), h('br'), h('span.mono', short(d.supplier)))),
        sec(1, 'Order lines', h('ul.rv-lines', d.lines.map((l) => h('li', h('span', `${l.item} × ${l.qty}`), h('b.num', `${microToCcd(BigInt(l.qty) * ccdToMicro(l.price))} CCD`)))), d.place ? h('p.mute', `Deliver to ${d.place}`) : null),
        sec(2, 'Who counts', h('p', `Receiver ${short(d.receiver)}`, h('br'), `Approver ${short(d.approver)}`))),
      h('aside.pay',
        idBox,
        h('div.big.num', `${microToCcd(t.micro)} CCD`),
        h('p', 'Paid to the supplier only when both counts match, the supplier approves this amount, and its payout account has waited 72 hours.'),
        sign,
        h('button.btn.out.wide', { type: 'button', onclick: () => printPO({ ...d, orderId: d.orderId, micro: t.micro, units: t.units }) }, icon('download', 16), 'Download purchase order (PDF)'),
        h('details.wallet', h('summary', 'What your wallet will sign'),
          h('p', `Contract <${ESCROW.index},${ESCROW.subindex}>, ctp_escrow.create_order, attaching ${microToCcd(t.micro)} CCD.`),
          h('pre', JSON.stringify({ order_id: d.orderId ?? 'next', supplier: d.supplier.trim(), expected_qty: Number(t.units), receiver: d.receiver.trim(), approver: d.approver.trim() }, null, 2)))));
  }

  function paint(errs = []) {
    const views = [stepSupplier, stepLines, stepCounters, stepReview];
    fill(root, 
      h('header.panel-h', h('h2', 'New order'), h('p', 'Nothing opens your wallet until the last step. The draft saves itself.')),
      h('ol.progress', STEPS.map((s, i) => h('li', { class: i < d.step ? 'done' : i === d.step ? 'on' : null }, h('button', { type: 'button', disabled: i > d.step, onclick: () => go(i) }, s)))),
      h(`div.step.${dir}`, views[d.step]()),
      errs.length ? h('p.err', { role: 'alert' }, icon('alert', 16), errs.join(' ')) : null,
      d.step < 3 ? h('div.actions',
        d.step > 0 ? h('button.btn.text', { type: 'button', onclick: () => go(d.step - 1) }, 'Back') : null,
        h('button.btn.dark', { type: 'button', onclick: () => go(d.step + 1) }, d.step === 2 ? 'Review' : 'Next', h('i', { 'aria-hidden': 'true' }))) : h('div.actions', h('button.btn.text', { type: 'button', onclick: () => go(2) }, 'Back')),
    );
  }
  paint();
  return root;
}

// ---------- orders ----------
const TIMELINE = [
  ['funded', 'Funded'],
  ['counted', 'Both counted'],
  ['revealed', 'Counts revealed'],
  ['invoice', 'Invoice in'],
  ['approved', 'Supplier approved'],
  ['paid', 'Paid'],
];

function reached(o) {
  const approved = o.invoice && o.supplier_approval && o.supplier_approval.invoice_hash === o.invoice.invoice_hash && o.supplier_approval.amount === o.invoice.amount;
  return { funded: true, counted: o.commits.length >= 2, revealed: o.reveals.length >= 2, invoice: Boolean(o.invoice), approved: Boolean(approved), paid: o.paid };
}

async function ordersView() {
  let orders, cfg, sups = {};
  try {
    [orders, cfg] = await Promise.all([listOrders(), viewConfig()]);
    for (const s of new Set(orders.map((o) => o.supplier))) sups[s] = await viewSupplier(s);
  } catch {
    return h('section.panel', h('header.panel-h', h('h2', 'Orders')), h('p.err', icon('alert', 16), 'Could not read the contract right now. Check your connection and reload.'));
  }
  if (!orders.length) return h('section.panel.empty', h('h2', 'No orders yet'), h('p', 'Create the first one. The amount locks in escrow until the order clears.'), h('a.btn.dark', { href: '#/buyer/new' }, 'New order', h('i', { 'aria-hidden': 'true' })));
  const list = h('ul.orders', [...orders].reverse().map((o) => {
    const st = orderStage(o, sups[o.supplier], cfg.hold_ms);
    const r = reached(o);
    const po = store.get(`ctp:po:${o.id}`);
    const detail = h('div.order-d',
      h('ol.timeline', TIMELINE.map(([k, label]) => h('li', { class: r[k] ? 'done' : null }, h('span.tl-dot', r[k] ? icon('check', 12) : null), label))),
      h('dl.facts',
        h('dt', 'Units ordered'), h('dd.num', o.expected_qty.toString()),
        h('dt', 'Counts'), h('dd', o.reveals.length ? o.reveals.map((x) => `${x.role} ${x.qty}`).join(', ') : `${o.commits.length} of 2 committed`),
        h('dt', 'Receiver, approver'), h('dd.mono', `${short(o.receiver)}, ${short(o.approver)}`),
        h('dt', 'Supplier'), h('dd.mono', short(o.supplier)),
        st.until ? [h('dt', 'Payout hold ends'), h('dd', fmtDate(st.until))] : null),
      h('div.actions',
        po ? h('button.btn.line.small', { type: 'button', onclick: () => printPO({ ...po, orderId: o.id, micro: o.amount, units: o.expected_qty }) }, icon('download', 16), 'Purchase order') : null,
        o.invoice && !o.paid && !o.refunded ? h('button.btn.text.small', { type: 'button', onclick: async (e) => {
          if (!confirm(`Reject the invoice on order #${o.id}? It is cleared, with any supplier approval, so the right invoice can be submitted.`)) return;
          e.currentTarget.disabled = true;
          const res = await act('reject_invoice', o.id, { done: `Invoice on order #${o.id} rejected. The agent can submit the right one.` });
          if (res.ok) location.reload();
        } }, 'Reject invoice') : null,
        !o.paid && !o.refunded ? h('button.btn.text.small.danger', { type: 'button', onclick: async (e) => {
          if (!confirm(`Refund order #${o.id}? ${microToCcd(o.amount)} CCD goes back to the buyer and the order closes.`)) return;
          e.currentTarget.disabled = true;
          const res = await act('refund', o.id, { done: `Order #${o.id} refunded to the buyer.` });
          if (res.ok) location.reload();
        } }, 'Refund') : null));
    return h('li.order',
      h('details', h('summary',
        h('span.order-id.num', `#${o.id}`),
        h('span.order-what', po ? `${po.supplierName}, ${po.lines.map((l) => l.item).join(', ')}` : `${o.expected_qty} units`),
        h('b.num', `${microToCcd(o.amount)} CCD`),
        chip(st.tone, st.label)), detail));
  }));
  return h('section.panel', h('header.panel-h', h('h2', 'Orders'), h('p', 'Read live from the escrow contract. Open one to see where it stands.')), list);
}
