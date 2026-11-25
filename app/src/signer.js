// Delivery signer space: count, seal, unseal. Only orders that name this account.
import { ESCROW, currentAccount, listOrders } from './chain.js';
import { CAST } from './cast.js';
import { act } from './act.js';
import { h, fill, icon, chip, short, store, notice } from './ui.js';
import { navSide, tile, row, plural, attnPanel, dashHead } from './dash.js';
import { sealOf, toHex as hex, pastDue, deliveryConfirmed, gateSealed, MAX_RECOUNTS } from './codec.js';

/** One key per order and count round, so a recount always gets a fresh seal. */
const keyName = (acct, o) => `ctp:seal:${ESCROW.index}:${acct}:${o.id}:${o.recounts}`;
/** Backup code = "count-key" so it can be pasted back on another device. */
const backupCode = (s) => `${s.qty}-${s.key}`;
function parseBackup(code) {
  const m = String(code).trim().toLowerCase().match(/^(\d{1,19})-([0-9a-f]{64})$/);
  return m ? { qty: m[1], key: m[2] } : null;
}

function sidebar(me, sub) {
  const name = me ? CAST.nameOf(me) : 'Not connected';
  return navSide({ initial: name[0] ?? '?', title: name === 'Account' || name === 'Not connected' ? 'Delivery signer' : name, role: 'signer', cur: sub,
    items: [['', 'Dashboard', 'grid'], ['count', 'Count deliveries', 'list']],
    note: 'You see only the orders that name you. Nobody sees a count until the gate counts are both sealed.' });
}

export async function signerView(sub = '') {
  const me = currentAccount();
  const main = h('div.space-main');
  const root = h('div.space.with-side', sidebar(me, sub), main);
  if (!me) {
    fill(main, h('section.panel.empty', h('h2', 'Connect your wallet'), h('p', 'Use the receiver, approver or delivery rep account named on the order.')));
    return root;
  }
  let orders;
  try {
    orders = (await listOrders()).filter((o) => o.receiver === me || o.approver === me || o.rep === me);
  } catch {
    fill(main, h('section.panel', h('p.err', icon('alert', 16), 'Could not read the escrow contract right now. Check your connection, then reload.')));
    return root;
  }
  if (!orders.length) {
    fill(main, h('section.panel.empty', h('h2', 'Nothing to count'), h('p', `No order names ${short(me)} as its receiver, approver or delivery rep.`)));
    return root;
  }
  const open = orders.filter((o) => !o.paid && !o.refunded).reverse();
  const closed = orders.filter((o) => o.paid || o.refunded).reverse();
  if (sub !== 'count') { fill(main, signerDash(orders, me)); return root; }
  fill(main,
    h('header.dash-h', h('div', h('h2', 'Count deliveries'), h('p', 'Count on your own, then seal it. When the receiver and the supplier’s rep have both sealed, unseal yours.'))),
    open.length ? open.map((o) => card(o, me)) : h('section.panel.empty-s', h('p', 'All your orders are counted.')),
    closed.length ? h('details.closed', h('summary', `${closed.length} finished ${closed.length === 1 ? 'order' : 'orders'}`), closed.map((o) => card(o, me))) : null);
  return root;
}

const ROLE_TEXT = { Receiver: 'the receiver (buyer, at the gate)', Approver: 'the approver (buyer, inside)', SupplierRep: 'the supplier’s delivery rep' };
const countOf = (o, role) => o.reveals.find((x) => x.role === role);

function card(o, me) {
  const role = o.receiver === me ? 'Receiver' : o.approver === me ? 'Approver' : 'SupplierRep';
  const mine = o.commits.find((c) => c.signer === me);
  const myReveal = o.reveals.find((r) => r.signer === me);
  const gate = gateSealed(o);
  const receiverSealed = o.commits.some((c) => c.role === 'Receiver');
  const saved = store.get(keyName(me, o));
  const body = h('div.count-body');
  const confirmed = deliveryConfirmed(o);

  const steps = [
    ['Seal', Boolean(mine)],
    ['Gate counts sealed', gate],
    ['Unseal', Boolean(myReveal)],
    ['Delivery confirmed', confirmed],
  ];

  const recountNote = o.recounts && !mine
    ? h('p', chip('wait', `Recount ${o.recounts} of ${MAX_RECOUNTS}`), ' The buyer or supplier asked for a fresh count. Count again on your own; your earlier count stays on the record.')
    : null;
  // "No count, no unload": the driver sees whether the buyer's receiver has sealed.
  const unloadNote = role === 'SupplierRep' && !o.paid && !o.refunded
    ? (receiverSealed
      ? h('p', chip('ok', 'Receiver has sealed'), ' The buyer’s receiver has counted. You can unload.')
      : h('p.err', icon('alert', 18), h('b', 'Receiver has NOT sealed: do not unload.'), ' Wait until the buyer’s receiver has sealed their count. No count, no unload.'))
    : null;
  const approverNote = role === 'Approver' && !mine
    ? h('p.fine', 'You check the delivery inside. After the gate counts, the payment waits for you for the hold period: unseal the same number and it can go at once; a different number holds it. Staying silent never blocks it for longer than that.')
    : null;
  const sealButton = (label) => {
    const input = h('input.count-in.num', { inputMode: 'numeric', 'aria-label': 'Units you counted', placeholder: '0', autocomplete: 'off' });
    const btn = h('button.btn.dark', { type: 'button', onclick: async () => {
      const v = input.value.trim();
      if (!/^\d{1,9}$/.test(v)) { notice('no', 'Enter the number of units you counted, as a whole number.'); return; }
      const key = crypto.getRandomValues(new Uint8Array(32));
      const s = { qty: v, key: hex(key) };
      store.set(keyName(me, o), s);
      btn.disabled = true;
      const r = await act('commit_count', { order_id: o.id, hash: await sealOf(o.id, o.recounts, me, v, key) }, { pending: 'Sealing your count. ', done: `Your count is sealed for order #${o.id}.` });
      btn.disabled = false;
      if (r.ok) location.reload();
    } }, icon('lock', 18), label);
    return h('div.count-row', input, btn);
  };

  if (o.paid || o.refunded) {
    fill(body, h('p', o.paid ? 'Paid. Your count was part of it.' : 'This order was closed and the money went back to the buyer.'));
  } else if (pastDue(o) && !confirmed) {
    fill(body, h('p', chip('hold', 'Counting closed'), ' The latest date for this order has passed. Nothing more can be counted unless the buyer and supplier agree a new date; a disputed delivery goes to the referee.'));
  } else if (!mine) {
    fill(body,
      recountNote, unloadNote, approverNote,
      whatNote(o),
      h('p', `Count the units that arrived for order #${o.id}, on your own. You are not shown the ordered amount, so your count stays independent.`),
      sealButton('Seal my count'),
      h('p.fine', 'Only a fingerprint of your count goes on-chain. This browser keeps the key to unseal it.'));
  } else if (!gate) {
    const waitingFor = role === 'Receiver' ? 'the supplier’s delivery rep' : role === 'SupplierRep' ? 'the buyer’s receiver' : 'the receiver and the supplier’s rep';
    fill(body,
      unloadNote,
      h('p.sealed', icon('lock', 18), `Sealed. Waiting for ${waitingFor} to seal.`),
      backupBlock(saved),
      o.reveals.length === 0 ? h('details.backup', h('summary', 'Lost the key? Seal again'), h('p.fine', 'Until anyone unseals, you can replace your seal with a new count and key.'), sealButton('Seal again')) : null);
  } else if (!myReveal) {
    const codeIn = h('input.mono', { placeholder: 'Backup code, if you sealed on another device', 'aria-label': 'Backup code' });
    const btn = h('button.btn.gold', { type: 'button', onclick: async () => {
      const s = saved ?? parseBackup(codeIn.value);
      if (!s) { notice('no', 'This browser does not have the key for this count. Paste the backup code you saved when you sealed it.'); return; }
      btn.disabled = true;
      const r = await act('reveal_count', { order_id: o.id, qty: Number(s.qty), salt: Array.from(s.key.match(/../g), (x) => parseInt(x, 16)) }, { pending: 'Unsealing. ', done: `Your count (${s.qty}) is unsealed for order #${o.id}.` });
      btn.disabled = false;
      // The count is public now: drop its key, so a shared gate tablet keeps nothing (audit 24 Nov L5).
      if (r.ok) { store.del(keyName(me, o)); location.reload(); }
    } }, 'Unseal my count');
    fill(body,
      unloadNote,
      h('p', 'The gate counts are sealed. Unseal yours now; the contract checks it against your seal.'),
      saved ? h('div.count-row', btn) : h('div.count-row', codeIn, btn),
      o.reveals.length === 0 ? h('details.backup', h('summary', 'Lost the key? Seal again'), h('p.fine', 'Until anyone unseals, you can replace your seal with a new count and key.'), sealButton('Seal again')) : null);
  } else {
    const line = ['Receiver', 'SupplierRep', 'Approver'].map((r) => countOf(o, r)).filter(Boolean).map((x) => `${ROLE_TEXT[x.role].replace(/ \(.*\)/, '')} ${x.qty}`).join(', ');
    fill(body,
      h('p', `Counts so far: ${line}.`),
      confirmed ? h('p', chip('ok', 'Delivery confirmed'))
        : (countOf(o, 'Receiver') && countOf(o, 'SupplierRep'))
          ? h('p', chip('hold', 'Counts do not match'), o.recounts < MAX_RECOUNTS ? ' The buyer or supplier can ask everyone to count again; otherwise the referee decides.' : ' No recounts left; the referee decides.')
          : h('p', 'Waiting for the other gate count to be unsealed.'));
  }

  return h('section.panel.count',
    h('div.count-h', h('span.order-id.num', `#${o.id}`), h('div', h('b', `You are ${ROLE_TEXT[role]}`), h('span', role === 'SupplierRep' ? `Receiver ${short(o.receiver)}` : `Supplier’s rep ${o.rep ? short(o.rep) : 'not named yet'}`))),
    h('ol.count-steps', steps.map(([label, ok]) => h('li', { class: ok ? 'done' : null }, h('span.tl-dot', ok ? icon('check', 12) : null), label))),
    body);
}

function backupBlock(saved) {
  if (!saved) return null;
  const code = backupCode(saved);
  return h('details.backup',
    h('summary', 'Save a backup code'),
    h('p.fine', 'Only needed if you unseal on another device or clear this browser. Anyone with this code can see your count, so keep it private until both counts are unsealed.'),
    h('div.count-row', h('input.mono', { value: code, readOnly: true, 'aria-label': 'Backup code' }),
      h('button.btn.line.small', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(code); notice('ok', 'Backup code copied.'); } catch { notice('no', 'Could not copy. Select the code and copy it by hand.'); } } }, 'Copy')));
}

/** What the counter is counting (items, never quantities), from the purchase order if this
 *  browser has it; otherwise the counter checks the paper purchase order at the gate. */
function whatNote(o) {
  const po = store.get(`ctp:po:${ESCROW.index}:${o.id}`);
  const items = (po?.lines ?? []).map((l) => (l.item ?? '').trim()).filter(Boolean);
  if (po?.supplier === o.supplier && items.length) {
    return h('p.what', h('strong', `Order #${o.id} from ${po.supplierName || CAST.nameOf(o.supplier)}: `), items.join(', '), '.');
  }
  return h('p.what', h('strong', `Order #${o.id} from ${CAST.nameOf(o.supplier)}. `), 'Check the items against the purchase order the driver hands you.');
}

// ---------- dashboard ----------
const roleOn = (o, me) => (o.receiver === me ? 'Receiver' : o.approver === me ? 'Approver' : 'SupplierRep');
const SHORT_ROLE = { Receiver: 'receiver', Approver: 'approver', SupplierRep: 'delivery rep' };

/** Where this signer stands on one open order: what to do, or whom they wait for. */
function signerStep(o, me) {
  const role = roleOn(o, me);
  const mine = o.commits.find((c) => c.signer === me);
  const myReveal = o.reveals.find((r) => r.signer === me);
  const confirmed = deliveryConfirmed(o);
  const as = `As ${SHORT_ROLE[role]}: `;
  if (pastDue(o) && !confirmed) return { o, what: `${as}the date passed, counting is closed.`, tone: 'mute', label: 'Closed', step: 'closed' };
  if (!o.accepted) return { o, what: `${as}the supplier has not accepted yet. Nothing to count.`, tone: 'wait', label: 'New', step: 'waiting' };
  if (!mine) {
    if (role === 'SupplierRep' && !o.commits.some((c) => c.role === 'Receiver')) return { o, what: `${as}count and seal. The receiver has not sealed yet: do not unload.`, tone: 'gold', label: 'You', mine: true, step: 'count' };
    return { o, what: `${as}count what arrived on your own, then seal it.`, tone: 'gold', label: 'You', mine: true, step: 'count' };
  }
  if (!gateSealed(o)) return { o, what: `${as}sealed. Waiting for ${role === 'Receiver' ? 'the supplier’s rep' : role === 'SupplierRep' ? 'the receiver' : 'the gate counts'} to seal.`, tone: 'wait', label: 'Sealed', step: 'sealed' };
  if (!myReveal) {
    const key = store.get(keyName(me, o));
    return { o, what: key ? `${as}the gate counts are sealed. Unseal yours now.` : `${as}unseal now. This browser has no key for it: have your backup code ready.`, tone: key ? 'gold' : 'hold', label: key ? 'You' : 'Backup code', mine: true, step: 'unseal' };
  }
  if (confirmed) return { o, what: `${as}counts match. Delivery confirmed.`, tone: 'ok', label: 'Confirmed', step: 'done' };
  if (countOf(o, 'Receiver') && countOf(o, 'SupplierRep')) return { o, what: `${as}counts do not match. A recount, or the referee decides.`, tone: 'hold', label: 'Mismatch', step: 'done' };
  return { o, what: `${as}unsealed. Waiting for the other gate count.`, tone: 'wait', label: 'Unsealed', step: 'done' };
}

function signerDash(orders, me) {
  const open = orders.filter((o) => !o.paid && !o.refunded).reverse();
  const steps = open.map((o) => signerStep(o, me)).sort((a, b) => Number(Boolean(b.mine)) - Number(Boolean(a.mine)));
  const toCount = steps.filter((x) => x.step === 'count').length;
  const toUnseal = steps.filter((x) => x.step === 'unseal').length;
  const confirmed = orders.filter(deliveryConfirmed).length;
  const byRole = (r) => orders.filter((o) => roleOn(o, me) === r).length;
  const sealedOpen = open.filter((o) => o.commits.some((c) => c.signer === me) && !o.reveals.some((r) => r.signer === me));
  const keys = sealedOpen.filter((o) => store.get(keyName(me, o))).length;
  const roleRows = [['Receiver', 'Buyer’s receiver', 'You count at the gate for the buyer.'], ['SupplierRep', 'Supplier’s delivery rep', 'You count at the gate for the supplier, and unload only after the receiver has sealed.'], ['Approver', 'Buyer’s approver', 'You check the delivery inside, after the gate.']]
    .filter(([r]) => byRole(r)).map(([r, t, x]) => row('ok', `${t} on ${plural(byRole(r), 'order')}`, x));
  return h('div.dash',
    dashHead('Dashboard', 'The orders that name you, read live from the contract.'),
    h('div.tiles',
      tile('t-amber', 'To count', String(toCount), toCount ? 'count on your own, then seal' : 'nothing to count now'),
      tile('t-sage', 'To unseal', String(toUnseal), toUnseal ? 'the gate counts are sealed' : 'nothing to unseal now'),
      tile('t-sky', 'Deliveries confirmed', String(confirmed), `of ${plural(orders.length, 'order')} naming you`)),
    h('div.dash-cols',
      attnPanel('Open orders', '#/signer/count', 'Count deliveries', steps, 'All your orders are counted.'),
      h('div.dash-side',
        h('section.panel.checks', h('h3', 'Your roles'), h('ul.ready-list.compact', roleRows)),
        h('section.panel.checks',
          h('h3', 'This browser'),
          h('ul.ready-list.compact',
            sealedOpen.length
              ? row(keys === sealedOpen.length ? 'ok' : 'hold', `Keys for ${plural(keys, 'sealed count')} of ${sealedOpen.length}`, keys === sealedOpen.length ? 'Keep this browser until you unseal. Save a backup code if you may switch devices.' : 'Some keys are not here. Unseal with the backup code you saved when you sealed.')
              : row('ok', 'No keys to keep', 'Each key is deleted from this browser once its count is unsealed.'),
            row('ok', 'Counts stay blind', 'Only a fingerprint of each count goes on-chain until both gate counts are sealed.'))))));
}
