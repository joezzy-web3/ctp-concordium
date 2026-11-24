// Judge mode: the attacks that empty company accounts, tried against the live escrow.
// Each one is a dry run: the node runs the real contract code on the real state, as the
// account that would attempt the attack. Nothing is sent, signed or paid, so anyone can
// press the buttons without a wallet.
import { AGENT, ESCROW, listOrders, simulate, decisionsIn, viewConfig, viewSupplier } from './chain.js';
import { CAST } from './cast.js';
import { accountBytes, invoiceApproved, pastDue, readyToPay, microToCcd, deliveryOnRecord, deliveryConfirmed, invoiceDeadline } from './codec.js';
import { CODE_TEXT, verifyReceiptCard } from './payreceipt.js';
import { h, fill, icon, chip, short } from './ui.js';

const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const ZERO32 = new Uint8Array(32);
const FAKE_INVOICE = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255); // an invoice nobody approved

const isOpen = (o) => !o.paid && !o.refunded;
const newest = (os, f) => [...os].reverse().find(f) ?? null;
const VERDICT = ['Cleared', 'Held', 'Seized'];

/**
 * Each attack: who tries it, what they try, which live order it needs, and what the
 * contract should do. `expect` is an error name, or 'Held' for a decision that pays nothing.
 */
const ATTACKS = [
  {
    title: 'A hijacked agent asks to be paid for an invoice the supplier never approved',
    threat: 'The classic: an AI agent is tricked (or taken over) and pushes a payment through.',
    who: 'Agent #1287', invoker: AGENT.owner,
    need: 'an open order with an invoice the supplier has not approved',
    pick: (os) => newest(os, (o) => isOpen(o) && o.invoice && !invoiceApproved(o) && o.invoice.agent === AGENT.owner),
    run: (o) => ['execute_payment', cat(u64(o.id), ZERO32)],
    expect: 'Held',
    code: 'HeldNoSupplierApproval',
  },
  {
    title: 'The buyer keeps the goods and stalls the count to get its money back',
    threat: 'The supplier’s rep counted the delivery, the buyer’s receiver never unseals, and the buyer tries to refund.',
    who: 'Buyer admin', invoker: CAST.buyer,
    need: 'an open order the supplier’s rep counted that the counts do not confirm',
    pick: (os) => newest(os, (o) => isOpen(o) && o.accepted && deliveryOnRecord(o) && !deliveryConfirmed(o)),
    run: (o) => ['refund', u64(o.id)],
    expect: 'RefundLocked',
  },
  {
    title: 'A hijacked supplier account redirects the payout and asks to be paid',
    threat: 'The attacker sets a new payout account; the hold delays any payment there and makes the change visible.',
    who: 'Supplier', invoker: CAST.supplier,
    need: 'an order ready to pay whose supplier changed its payout account less than the hold ago',
    pick: (os, ctx) => newest(os, (o) => isOpen(o) && readyToPay(o) && ctx.inHold(o.supplier)),
    run: (o) => ['execute_payment', cat(u64(o.id), ZERO32)],
    expect: 'Held',
    code: 'HeldPayoutCoolOff',
  },
  {
    title: '“Our bank details changed”: a clerk registers a supplier with the scammer’s payout account',
    threat: 'The oldest accounts-payable scam. On Clear to Pay the buyer never types in where a supplier is paid: a new supplier is paid to its own account, and only the supplier can change it.',
    who: 'Buyer admin', invoker: CAST.buyer,
    need: null,
    pick: () => ({ id: null }),
    // A new supplier (the referee's account stands in) with someone else's account as its payout.
    run: async () => ['register_supplier', cat(await accountBytes(CAST.referee), await accountBytes(CAST.receiver))],
    expect: 'PayoutNotSupplier',
  },
  {
    title: 'The buyer pulls its agent after delivery and waits out the date to claw the money back',
    threat: 'Both sides counted the goods, but the buyer’s agent never sends the invoice. The supplier can invoice itself, and keeps a grace week past the date in which the buyer cannot refund.',
    who: 'Buyer admin', invoker: CAST.buyer,
    need: 'a confirmed delivery with no approved invoice, past its date but inside the grace week',
    pick: (os) => newest(os, (o) => isOpen(o) && o.accepted && deliveryConfirmed(o) && !readyToPay(o) && pastDue(o) && Date.now() <= invoiceDeadline(o)),
    run: (o) => ['refund', u64(o.id)],
    expect: 'RefundLocked',
  },
  {
    title: 'The agent approves its own fake invoice',
    threat: 'If the agent could approve on the supplier’s behalf, it could pay any invoice it invented.',
    who: 'Agent #1287', invoker: AGENT.owner,
    need: 'an open order',
    pick: (os) => newest(os, isOpen),
    run: (o) => ['approve_invoice', cat(u64(o.id), FAKE_INVOICE, u64(o.amount))],
    expect: 'NotSupplier',
  },
  {
    title: 'Someone registers Agent #1287 on an account that does not own it',
    threat: 'A stolen or copied agent identity. The contract asks the Concordium agent registry who really owns #1287.',
    who: 'Buyer admin', invoker: CAST.buyer,
    need: null,
    pick: () => ({ id: null }),
    run: async () => ['add_agent', cat(await accountBytes(CAST.receiver), u64(AGENT.id))],
    expect: 'AgentNotVerified',
  },
  {
    title: 'Someone registers an agent that does not exist',
    threat: 'A made-up agent number. The registry has no such agent, so the contract refuses it.',
    who: 'Buyer admin', invoker: CAST.buyer,
    need: null,
    pick: () => ({ id: null }),
    run: async () => ['add_agent', cat(await accountBytes(AGENT.owner), u64(987654321))],
    expect: 'AgentNotVerified',
  },
  {
    title: 'The buyer pulls the money back after the supplier accepted',
    threat: 'A buyer who receives the goods and then empties the escrow before paying.',
    who: 'Buyer admin', invoker: CAST.buyer,
    need: 'an open order the supplier has accepted, before its latest date (or one that was ready in time)',
    pick: (os) => newest(os, (o) => isOpen(o) && o.accepted && (!pastDue(o) || readyToPay(o))),
    run: (o) => ['refund', u64(o.id)],
    expect: 'RefundLocked',
  },
  {
    title: 'The buyer throws out the invoice the supplier approved',
    threat: 'Stalling an honest supplier by rejecting its invoice again and again.',
    who: 'Buyer admin', invoker: CAST.buyer,
    need: 'an open order whose invoice the supplier approved',
    pick: (os) => newest(os, (o) => isOpen(o) && invoiceApproved(o)),
    run: (o) => ['reject_invoice', u64(o.id)],
    expect: 'InvoiceApprovedBySupplier',
  },
  {
    title: 'A signer keeps restarting the count',
    threat: 'A bribed signer who dislikes the result tries to stall the order with recounts.',
    who: 'Receiver', invoker: CAST.receiver,
    need: 'an open order',
    pick: (os) => newest(os, isOpen),
    run: (o) => ['recount', u64(o.id)],
    expect: 'NotOrderParty',
  },
  {
    title: 'A paid order is paid a second time',
    threat: 'Replaying a payment request after the money already went out.',
    who: 'Supplier', invoker: CAST.supplier,
    need: 'a paid order',
    pick: (os) => newest(os, (o) => o.paid),
    run: (o) => ['execute_payment', cat(u64(o.id), ZERO32)],
    expect: 'OrderClosed',
  },
  {
    title: 'An outsider takes over the buyer admin',
    threat: 'Taking control of the contract to create orders and move escrow.',
    who: 'Receiver (not the admin)', invoker: CAST.receiver,
    need: null,
    pick: () => ({ id: null }),
    run: () => ['accept_admin', new Uint8Array(0)],
    expect: 'NotPendingAdmin',
  },
];

async function tryAttack(a, order, out) {
  fill(out, h('p.fine', 'Running the real contract on the live state…'));
  try {
    const [entry, bytes] = await a.run(order);
    const r = await simulate(entry, bytes, a.invoker);
    let blocked;
    let what;
    if (!r.ok) {
      blocked = r.error === a.expect;
      what = [h('b', 'Refused: '), r.explain, ' ', h('code', r.error)];
    } else {
      const verdict = VERDICT[r.returnValue?.[0]] ?? 'Unknown';
      const [d] = await decisionsIn(r.events ?? []);
      blocked = verdict !== 'Cleared' && a.expect === 'Held' && (!a.code || (d?.codes ?? []).includes(a.code));
      what = [h('b', `${verdict}: `), verdict === 'Cleared' ? 'the contract would pay.' : (d?.codes ?? []).map((c) => CODE_TEXT[c] ?? c).join(' ') || 'nothing is paid.'];
    }
    fill(out,
      h('div', { class: blocked ? 'verify-ok' : 'verify-no' },
        h('p', blocked ? chip('ok', 'Protected') : chip('hold', 'Unexpected'), ' ', ...what),
        h('p.fine', `Dry run of ${entry} as ${a.who} (${short(a.invoker)})${order?.id ? ` on order #${order.id}` : ''}, against escrow <${ESCROW.index},${ESCROW.subindex}>. Nothing was sent or paid.`)));
  } catch (e) {
    fill(out, h('p.err', 'Could not run it: ', String(e?.message ?? e)));
  }
}

export async function judgeView() {
  let orders = [];
  let loadError = null;
  const holdUntil = {};
  try {
    const [os, cfg] = await Promise.all([listOrders(), viewConfig()]);
    orders = os;
    for (const s of new Set(orders.map((o) => o.supplier))) {
      const sup = await viewSupplier(s).catch(() => null);
      if (sup) holdUntil[s] = sup.payout_set_at + cfg.hold_ms;
    }
  } catch (e) { loadError = String(e?.message ?? e); }
  const ctx = { inHold: (s) => Date.now() < (holdUntil[s] ?? 0) };
  const cards = ATTACKS.map((a) => {
    const order = loadError ? null : a.pick(orders, ctx);
    const out = h('div.verify-out');
    return h('section.panel.attack',
      h('h3', a.title),
      h('p', a.threat),
      h('p.fine', `Tried by: ${a.who}`, order?.id ? ` · on order #${order.id} (${microToCcd(order.amount)} CCD)` : ''),
      order
        ? h('button.btn.dark.small', { type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; await tryAttack(a, order, out); e.currentTarget.disabled = false; } }, icon('alert', 16), 'Try it on the live contract')
        : h('p.fine', icon('clock', 14), ` Needs ${a.need} on the live contract. Create one in the Buyer space, then come back.`),
      out);
  });
  return [
    h('section.panel.judge-intro',
      h('h2', 'Try to fool it'),
      h('p', 'Each button runs the real escrow contract on its live testnet state, as the account that would try the attack. It is a dry run: nothing is sent, signed or paid, and you need no wallet. Every answer comes from the contract itself.'),
      loadError ? h('p.err', `Could not read the live orders: ${loadError}`) : null),
    cards,
    verifyReceiptCard(),
  ];
}
