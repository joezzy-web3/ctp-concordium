// Delivery signer space: count, seal, unseal. Only orders that name this account.
import { currentAccount, listOrders } from './chain.js';
import { CAST } from './cast.js';
import { act } from './act.js';
import { h, fill, icon, chip, short, store, notice } from './ui.js';
import { sealOf, toHex as hex, pastDue, deliveryConfirmed, MAX_RECOUNTS } from './codec.js';

/** One key per order and count round, so a recount always gets a fresh seal. */
const keyName = (acct, o) => `ctp:seal:${acct}:${o.id}:${o.recounts}`;
/** Backup code = "count-key" so it can be pasted back on another device. */
const backupCode = (s) => `${s.qty}-${s.key}`;
function parseBackup(code) {
  const m = String(code).trim().toLowerCase().match(/^(\d{1,19})-([0-9a-f]{64})$/);
  return m ? { qty: m[1], key: m[2] } : null;
}

function sidebar(me) {
  const name = me ? CAST.nameOf(me) : 'Not connected';
  return h('aside.side',
    h('div.who', h('span.avatar', name[0] ?? '?'), h('div', h('b', name === 'Account' ? 'Delivery signer' : name), h('span.mono', me ? short(me) : 'Connect your wallet'))),
    h('p.side-note', 'You see only the orders that name you. Nobody sees your count until both of you have sealed yours.'));
}

export async function signerView() {
  const me = currentAccount();
  const main = h('div.space-main');
  const root = h('div.space.with-side', sidebar(me), main);
  if (!me) {
    fill(main, h('section.panel.empty', h('h2', 'Connect your wallet'), h('p', 'Use the receiver or approver account named on the order.')));
    return root;
  }
  let orders;
  try {
    orders = (await listOrders()).filter((o) => o.receiver === me || o.approver === me);
  } catch {
    fill(main, h('section.panel', h('p.err', icon('alert', 16), 'Could not read the escrow contract right now. Check your connection, then reload.')));
    return root;
  }
  if (!orders.length) {
    fill(main, h('section.panel.empty', h('h2', 'Nothing to count'), h('p', `No order names ${short(me)} as its receiver or approver.`)));
    return root;
  }
  const open = orders.filter((o) => !o.paid && !o.refunded).reverse();
  const closed = orders.filter((o) => o.paid || o.refunded).reverse();
  fill(main,
    h('header.dash-h', h('div', h('h2', 'Count deliveries'), h('p', 'Count on your own, then seal it. When both counts are sealed, unseal yours.'))),
    open.length ? open.map((o) => card(o, me)) : h('section.panel.empty-s', h('p', 'All your orders are counted.')),
    closed.length ? h('details.closed', h('summary', `${closed.length} finished ${closed.length === 1 ? 'order' : 'orders'}`), closed.map((o) => card(o, me))) : null);
  return root;
}

function card(o, me) {
  const role = o.receiver === me ? 'Receiver' : 'Approver';
  const other = role === 'Receiver' ? o.approver : o.receiver;
  const mine = o.commits.find((c) => c.signer === me);
  const theirs = o.commits.find((c) => c.signer === other);
  const myReveal = o.reveals.find((r) => r.signer === me);
  const theirReveal = o.reveals.find((r) => r.signer === other);
  const saved = store.get(keyName(me, o));
  const body = h('div.count-body');

  const steps = [
    ['Seal', Boolean(mine)],
    ['Other seals', Boolean(theirs)],
    ['Unseal', Boolean(myReveal)],
    ['Both unsealed', Boolean(myReveal && theirReveal)],
  ];

  const recountNote = o.recounts && !mine
    ? h('p', chip('wait', `Recount ${o.recounts} of ${MAX_RECOUNTS}`), ' The buyer or supplier asked for a fresh count. Count again on your own; your earlier count stays on the record.')
    : null;
  if (o.paid || o.refunded) {
    fill(body, h('p', o.paid ? 'Paid. Your count was part of it.' : 'This order was closed and the money went back to the buyer.'));
  } else if (pastDue(o) && !(myReveal && theirReveal)) {
    fill(body, h('p', chip('hold', 'Counting closed'), ' The agreed date for this order has passed. Nothing more can be counted unless the buyer and supplier agree a new date.'));
  } else if (!mine) {
    const input = h('input.count-in.num', { inputMode: 'numeric', 'aria-label': 'Units you counted', placeholder: '0', autocomplete: 'off' });
    const btn = h('button.btn.dark', { type: 'button', onclick: async () => {
      const v = input.value.trim();
      if (!/^\d{1,9}$/.test(v)) { notice('no', 'Enter the number of units you counted, as a whole number.'); return; }
      const key = crypto.getRandomValues(new Uint8Array(32));
      const s = { qty: v, key: hex(key) };
      store.set(keyName(me, o), s);
      btn.disabled = true;
      const r = await act('commit_count', { order_id: o.id, hash: await sealOf(o.id, me, v, key) }, { pending: 'Sealing your count. ', done: `Your count is sealed for order #${o.id}.` });
      btn.disabled = false;
      if (r.ok) location.reload();
    } }, icon('lock', 18), 'Seal my count');
    fill(body,
      recountNote,
      h('p', `Count the units that arrived for order #${o.id}, on your own. You are not shown the ordered amount, so your count stays independent.`),
      h('div.count-row', input, btn),
      h('p.fine', 'Only a fingerprint of your count goes on-chain. This browser keeps the key to unseal it.'));
  } else if (!theirs) {
    fill(body,
      h('p.sealed', icon('lock', 18), 'Sealed. Waiting for the other signer to count.'),
      backupBlock(saved));
  } else if (!myReveal) {
    const codeIn = h('input.mono', { placeholder: 'Backup code, if you sealed on another device', 'aria-label': 'Backup code' });
    const btn = h('button.btn.gold', { type: 'button', onclick: async () => {
      const s = saved ?? parseBackup(codeIn.value);
      if (!s) { notice('no', 'This browser does not have the key for this count. Paste the backup code you saved when you sealed it.'); return; }
      btn.disabled = true;
      const r = await act('reveal_count', { order_id: o.id, qty: Number(s.qty), salt: Array.from(s.key.match(/../g), (x) => parseInt(x, 16)) }, { pending: 'Unsealing. ', done: `Your count (${s.qty}) is unsealed for order #${o.id}.` });
      btn.disabled = false;
      if (r.ok) location.reload();
    } }, 'Unseal my count');
    fill(body,
      h('p', 'Both counts are sealed. Unseal yours now; the contract checks it against your seal.'),
      saved ? h('div.count-row', btn) : h('div.count-row', codeIn, btn));
  } else {
    const match = deliveryConfirmed(o);
    fill(body,
      h('p', `You counted ${myReveal.qty}.`, theirReveal ? ` The other signer counted ${theirReveal.qty}.` : ' Waiting for the other signer to unseal.'),
      theirReveal ? (match ? h('p', chip('ok', 'Counts match the order')) : h('p', chip('hold', 'Counts do not match'), o.recounts < MAX_RECOUNTS ? ' The buyer or supplier can ask you both to count again.' : ' No recounts left; the order stays held.')) : null);
  }

  return h('section.panel.count',
    h('div.count-h', h('span.order-id.num', `#${o.id}`), h('div', h('b', `You are the ${role.toLowerCase()}`), h('span', `With ${short(other)}`))),
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
