// The checklist sold with each paid pre-clear: what the escrow knows about one order, in plain
// words, next to the contract's own verdict. Read from the chain; nothing here can change state.
import { deliveryConfirmed, invoiceApproved, invoiceWrongAmount, gateSealed } from '../app/src/codec.js';

const iso = (ms) => (Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null);

export function orderChecks(order, supplier, config, now = Date.now()) {
  const o = { commits: [], reveals: [], ...order };
  const delivery = deliveryConfirmed(o) ? 'confirmed: the counts match' : gateSealed(o) ? 'counting: the gate counts are sealed, not all open yet' : 'not counted yet';
  const invoice = !o.invoice ? 'none submitted yet'
    : invoiceWrongAmount(o) ? 'wrong amount: it does not match the escrowed amount'
      : invoiceApproved(o) ? 'approved by the supplier from its own account'
        : 'waiting for the supplier to approve it';
  const holdEnds = supplier && config ? Number(supplier.payout_set_at) + Number(config.hold_ms) : null;
  const payout = supplier ? {
    toSuppliersOwnAccount: supplier.payout === o.supplier,
    holdPassed: holdEnds !== null && now >= holdEnds,
    holdEndsAt: iso(holdEnds),
  } : null;
  const deadline = o.invoice_by !== undefined ? { date: iso(o.invoice_by), passed: now > Number(o.invoice_by) } : null;
  return { delivery, invoice, payout, deadline, settled: o.paid ? 'paid' : o.refunded ? 'refunded to the buyer' : 'open' };
}
