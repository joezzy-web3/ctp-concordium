// Controls the buyer and the supplier share on one order: the agreed date, recounts,
// asking for payment, and getting the money back. The contract enforces every rule;
// these only offer what it would accept right now, and explain the rest.
import { act } from './act.js';
import { askForPayment } from './payreceipt.js';
import { MAX_RECOUNTS, deliveryConfirmed, invoiceApproved, pastDue, readyToPay, recountAllowed, refundAllowed, deliveryOnRecord, disputed, microToCcd } from './codec.js';
import { h, chip, icon, fmtDate, notice, short } from './ui.js';

const DAY = 24 * 3600 * 1000;
/** A date input value (yyyy-mm-dd) -> the end of that day, local time, in ms. */
export const dayEnd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59`).getTime() : NaN);
/** ms -> a date input value, local time. */
export const toDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** The contract's Timestamp, as the wallet's schema expects it (RFC 3339). */
export const iso = (ms) => new Date(ms).toISOString();
export const defaultDue = () => toDay(Date.now() + 14 * DAY);
export const fmtDay = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const run = async (btn, entry, params, done) => {
  btn.disabled = true;
  const r = await act(entry, params, { done });
  btn.disabled = false;
  if (r.ok) location.reload();
};

/** The agreed date: shows it, any pending proposal, and lets this side propose or agree. */
export function dateBlock(o, me, side, { showDate = true } = {}) {
  const other = side === 'buyer' ? 'supplier' : 'buyer';
  const p = o.date_proposal;
  const mine = p && p.by.toLowerCase() === side;
  const buyerAlone = side === 'buyer' && !o.accepted;
  const input = h('input', { type: 'date', value: toDay(p?.invoice_by ?? o.invoice_by), min: toDay(Date.now() + DAY), 'aria-label': 'New date' });
  const propose = h('button.btn.line.small', { type: 'button', onclick: (e) => {
    const ms = dayEnd(input.value);
    if (!(ms > Date.now())) return notice('no', 'Pick a date in the future.');
    run(e.currentTarget, 'change_date', { order_id: o.id, invoice_by: iso(ms) },
      buyerAlone ? `Date on order #${o.id} set to ${fmtDay(ms)}.` : `New date proposed for order #${o.id}. It applies when the ${other} agrees.`);
  } }, buyerAlone ? 'Set date' : 'Propose this date');
  return h('div.date-block',
    !showDate ? null : h('p', icon('calendar', 16), ' Latest date for delivery and invoice: ', h('b', fmtDay(o.invoice_by)),
      pastDue(o) ? [' ', chip('hold', 'passed')] : null,
      o.accepted ? null : [' ', chip('wait', 'not accepted yet')]),
    p && !mine ? h('p', chip('wait', `${other[0].toUpperCase()}${other.slice(1)} proposes ${fmtDay(p.invoice_by)}`), ' ',
      h('button.btn.dark.small', { type: 'button', onclick: (e) => run(e.currentTarget, 'change_date', { order_id: o.id, invoice_by: iso(p.invoice_by) }, `Date on order #${o.id} moved to ${fmtDay(p.invoice_by)}.`) }, 'Agree to this date')) : null,
    mine ? h('p.fine', `You proposed ${fmtDay(p.invoice_by)}. Waiting for the ${other} to agree.`) : null,
    h('details.change', h('summary', buyerAlone ? 'Change the date' : 'Ask for a different date'),
      h('p.fine', buyerAlone ? 'The supplier has not accepted yet, so you can change it alone.' : `Both sides must agree. The ${other} sees your proposal and can agree to it.`),
      h('div.count-row', input, propose)));
}

/**
 * Replace a silent referee. Shown while a delivery is disputed or a change is pending: one side
 * proposes a neutral account, and it changes when the other side proposes the same one.
 */
export function refereeBlock(o, side) {
  const p = o.referee_proposal;
  if (o.paid || o.refunded || (!disputed(o) && !p)) return null;
  const other = side === 'buyer' ? 'supplier' : 'buyer';
  const mine = p && p.by.toLowerCase() === side;
  const input = h('input', { type: 'text', spellcheck: 'false', placeholder: 'New referee’s account', 'aria-label': 'New referee account' });
  const propose = h('button.btn.line.small', { type: 'button', onclick: (e) => {
    const a = input.value.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{50}$/.test(a)) return notice('no', 'Enter the new referee’s full Concordium account.');
    run(e.currentTarget, 'change_referee', { order_id: o.id, referee: a }, `New referee proposed for order #${o.id}. It applies when the ${other} agrees.`);
  } }, 'Propose referee');
  return h('div.date-block',
    h('p', icon('user', 16), ' Referee: ', h('b', short(o.referee))),
    p && !mine ? h('p', chip('wait', `${other[0].toUpperCase()}${other.slice(1)} proposes ${short(p.referee)} as referee`), ' ',
      h('button.btn.dark.small', { type: 'button', onclick: (e) => run(e.currentTarget, 'change_referee', { order_id: o.id, referee: p.referee }, `Referee on order #${o.id} changed to ${short(p.referee)}.`) }, 'Agree')) : null,
    mine ? h('p.fine', `You proposed ${short(p.referee)}. Waiting for the ${other} to agree.`) : null,
    h('details.change', h('summary', 'Referee not answering? Propose another'),
      h('p.fine', `Both sides must agree on a new referee. The ${other} sees your proposal and can agree to it.`),
      h('div.count-row', input, propose)));
}

/** Recount: both signers count again, blind. Only for unsealed counts that disagree. */
export function recountButton(o) {
  if (!recountAllowed(o)) return null;
  const left = MAX_RECOUNTS - o.recounts;
  return h('button.btn.line.small', { type: 'button', onclick: (e) => {
    if (!confirm(`Ask both signers to count order #${o.id} again? ${left} recount${left === 1 ? '' : 's'} left. The current counts stay on the record.`)) return;
    run(e.currentTarget, 'recount', o.id, `Recount started for order #${o.id}. Both signers count again.`);
  } }, icon('refresh', 16), `Recount (${left} left)`);
}

/** Anyone on the order can ask; the contract applies the same rules whoever asks. */
export function askPaymentButton(o, label = 'Ask for payment') {
  if (!readyToPay(o) || o.paid || o.refunded) return null;
  return h('button.btn.gold.small', { type: 'button', onclick: async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const r = await askForPayment(o.id);
    b.disabled = false;
    if (r.ok) setTimeout(() => location.reload(), 2500);
  } }, label);
}

/** Buyer: refund when the contract allows it, otherwise say why the money is locked. */
export function refundControl(o) {
  if (o.paid || o.refunded) return null;
  if (refundAllowed(o)) {
    return h('button.btn.text.small.danger', { type: 'button', onclick: (e) => {
      if (!confirm(`Take back ${microToCcd(o.amount)} CCD from order #${o.id}? The order closes.`)) return;
      run(e.currentTarget, 'refund', o.id, `Order #${o.id} refunded to the buyer.`);
    } }, 'Take the money back');
  }
  const why = readyToPay(o)
    ? 'Delivery confirmed and invoice approved: this money is the supplier’s.'
    : deliveryOnRecord(o) && !deliveryConfirmed(o)
      ? 'The supplier’s delivery rep counted this delivery and the counts do not confirm it: only the referee can send the money back.'
      : `Locked for the supplier until ${fmtDay(o.invoice_by)}. If the order is not ready to pay by then, and its delivery is not in dispute, you can take it back.`;
  return h('p.fine', icon('lock', 14), ' ', why);
}

/** Supplier: give the money back, for example when cancelling. */
export function releaseButton(o) {
  if (o.paid || o.refunded) return null;
  return h('button.btn.text.small.danger', { type: 'button', onclick: (e) => {
    if (!confirm(`Give ${microToCcd(o.amount)} CCD on order #${o.id} back to the buyer? The order closes and cannot be paid to you.`)) return;
    run(e.currentTarget, 'release_to_buyer', o.id, `Order #${o.id} closed. The money went back to the buyer.`);
  } }, 'Cancel and give the money back');
}

/** The buyer may reject an invoice only while the supplier has not approved it for the full amount. */
export const buyerCanReject = (o) => Boolean(o.invoice) && !o.paid && !o.refunded && !invoiceApproved(o);

const ROLE_NAME = { Receiver: 'receiver', Approver: 'approver', SupplierRep: 'supplier’s rep' };
export const countsLine = (o) => (o.ruled_delivered ? 'referee ruled the goods delivered' : o.reveals.length
  ? `${o.reveals.map((x) => `${ROLE_NAME[x.role]} ${x.qty}`).join(', ')}${deliveryConfirmed(o) ? ' (confirmed)' : ''}`
  : `${o.commits.length} sealed`) + (o.recounts ? `, recount ${o.recounts} of ${MAX_RECOUNTS}` : '');
