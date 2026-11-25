// Referee space: the neutral party named on an order settles a disputed delivery.
// A dispute = the supplier's delivery rep counted, but the counts do not confirm it
// (a counter disagreed, or the buyer's receiver never unsealed). The contract enforces it.
import { currentAccount, listOrders } from './chain.js';
import { act } from './act.js';
import { disputed, deliveryConfirmed, microToCcd, pastDue, gateSealed } from './codec.js';
import { countsLine, fmtDay } from './ordertools.js';
import { h, fill, icon, chip, short } from './ui.js';
import { navSide, tile, row, ccd, sum, plural, attnPanel, dashHead } from './dash.js';

const rule = async (btn, o, ruling, done) => {
  btn.disabled = true;
  const r = await act('rule', { order_id: o.id, ruling: { [ruling]: [] } }, { pending: 'Recording your ruling. ', done });
  btn.disabled = false;
  if (r.ok) location.reload();
};

function card(o) {
  const open = disputed(o);
  return h('section.panel.count',
    h('div.count-h', h('span.order-id.num', `#${o.id}`), h('div', h('b', `${microToCcd(o.amount)} CCD in escrow`), h('span', `${o.expected_qty.toString()} units ordered`))),
    h('dl.facts',
      h('dt', 'Counts'), h('dd', countsLine(o)),
      h('dt', 'Latest date'), h('dd', fmtDay(o.invoice_by), pastDue(o) ? [' ', chip('hold', 'passed')] : null),
      h('dt', 'Buyer’s receiver'), h('dd.mono', short(o.receiver)),
      h('dt', 'Supplier’s rep'), h('dd.mono', o.rep ? short(o.rep) : 'not named yet')),
    o.paid ? h('p', chip('ok', 'Paid'))
      : o.refunded ? h('p', chip('mute', 'Closed, money returned to the buyer'))
        : open
          ? h('div',
            h('p', 'The supplier’s rep counted this delivery, but the counts do not confirm it. Look at the evidence (delivery note, photos, gate log), then rule. Your ruling is final and on the record.'),
            h('div.actions',
              h('button.btn.dark.small', { type: 'button', onclick: (e) => rule(e.currentTarget, o, 'Delivered', `You ruled order #${o.id} delivered. The supplier can now be paid once its invoice is approved.`) }, icon('check', 16), 'The goods were delivered'),
              h('button.btn.line.small', { type: 'button', onclick: (e) => { if (confirm(`Send ${microToCcd(o.amount)} CCD back to the buyer and close order #${o.id}?`)) rule(e.currentTarget, o, 'Refund', `Order #${o.id} closed. The money went back to the buyer.`); } }, 'Send the money back')))
          : h('p.fine', deliveryConfirmed(o) ? 'The counts confirm the delivery: nothing to rule on.' : 'No dispute: the supplier’s rep has not counted a delivery.'));
}

export async function refereeView(sub = '') {
  const me = currentAccount();
  const main = h('div.space-main');
  const root = h('div.space.with-side',
    navSide({ initial: 'R', title: 'Referee', role: 'referee', cur: sub, items: [['', 'Dashboard', 'grid'], ['disputes', 'Disputes', 'list']],
      note: 'You can rule only when the supplier’s rep counted a delivery that the counts do not confirm.' }),
    main);
  if (!me) {
    fill(main, h('section.panel.empty', h('h2', 'Connect your wallet'), h('p', 'Use the account named as referee on the order.')));
    return root;
  }
  let orders;
  try {
    orders = (await listOrders()).filter((o) => o.referee === me).reverse();
  } catch {
    fill(main, h('section.panel', h('p.err', icon('alert', 16), 'Could not read the escrow contract right now. Check your connection, then reload.')));
    return root;
  }
  if (!orders.length) {
    fill(main, h('section.panel.empty', h('h2', 'No orders name you'), h('p', `No order names ${short(me)} as its referee.`)));
    return root;
  }
  const disputes = orders.filter(disputed);
  if (sub !== 'disputes') { fill(main, refereeDash(orders)); return root; }
  fill(main,
    h('header.dash-h', h('div', h('h2', 'Disputes'), h('p', disputes.length ? `${disputes.length} ${disputes.length === 1 ? 'order needs' : 'orders need'} your ruling.` : 'Nothing to rule on right now.'))),
    disputes.map(card),
    orders.length > disputes.length ? h('details.closed', h('summary', `${orders.length - disputes.length} other ${orders.length - disputes.length === 1 ? 'order' : 'orders'} naming you`), orders.filter((o) => !disputed(o)).map(card)) : null);
  return root;
}

// ---------- dashboard ----------
function refStep(o) {
  if (disputed(o)) return { o, what: `Counted by the supplier’s rep, not confirmed (${countsLine(o)}). Look at the evidence, then rule.`, tone: 'gold', label: 'You', mine: true };
  if (deliveryConfirmed(o)) return { o, what: 'The counts confirm the delivery: nothing to rule on.', tone: 'ok', label: 'Confirmed' };
  if (gateSealed(o)) return { o, what: 'Counted at the gate; the counts are being unsealed.', tone: 'wait', label: 'Counting' };
  return { o, what: o.accepted ? 'Not delivered yet.' : 'Waiting for the supplier to accept.', tone: 'wait', label: o.accepted ? 'Open' : 'New' };
}

function refereeDash(orders) {
  const open = orders.filter((o) => !o.paid && !o.refunded);
  const steps = open.map(refStep).sort((a, b) => Number(Boolean(b.mine)) - Number(Boolean(a.mine)));
  const disputes = steps.filter((x) => x.mine);
  const settled = orders.length - open.length;
  return h('div.dash',
    dashHead('Dashboard', 'The orders that name you as referee, read live from the contract.'),
    h('div.tiles',
      tile('t-amber', 'Disputes to rule', String(disputes.length), disputes.length ? 'see below' : 'nothing to rule on now'),
      tile('t-sage', 'Under your watch', ccd(sum(open)), plural(open.length, 'open order')),
      tile('t-sky', 'Settled', String(settled), 'paid or returned to the buyer')),
    h('div.dash-cols',
      attnPanel('Orders naming you', '#/referee/disputes', 'Disputes', steps, 'No open orders name you.'),
      h('div.dash-side',
        h('section.panel.checks',
          h('h3', 'Your role'),
          h('ul.ready-list.compact',
            row('ok', 'Only on a real dispute', 'You can rule only when the supplier’s rep counted a delivery the counts do not confirm.'),
            row('ok', 'Two rulings', 'Delivered: the supplier can be paid once it approves its invoice. Money back: the order closes and the buyer is refunded.'),
            row('ok', 'Final and on the record', 'Your ruling is an on-chain event. You are replaced only if the buyer and supplier both agree.'))))));
}
