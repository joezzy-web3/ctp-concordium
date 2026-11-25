// What each MCP tool does, apart from the MCP wiring, so tests can run it against a fake
// chain. Every answer is plain text an AI can relay. The contract is the judge: these tools
// only read, dry-run, and send what the agent account is allowed to send.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { orderStage, microToCcd, ccdToMicro, deliveryConfirmed, invoiceApproved } from '../app/src/codec.js';
import { CODE_TEXT } from '../app/src/errors.js';
import { buildEscrowReceipt, escrowReceiptHash } from '../receipt/escrowReceipt.js';
import { canonicalize } from '../receipt/canonical.js';
import { checkCounterparty } from '../gate/badgeGate.js';
import { executeParams, invoiceParams } from './escrow.js';

const NETWORK = 'concordium:testnet';
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;
const ZERO = '0'.repeat(64);
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'none');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
export const ccdscanTx = (tx) => `https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=${tx}`;

const NEXT = {
  accept: 'the supplier accepts the order',
  expired: 'the buyer can take the money back',
  dispute: 'the referee rules (both sides can agree to replace a silent referee)',
  counting: 'the receiver and the supplier’s rep seal their counts at the gate',
  revealing: 'the counters unseal their counts',
  mismatch: 'a recount, or the referee rules',
  invoice: 'the agent submits the invoice',
  approval: 'the supplier approves the invoice and its amount',
  amount: 'the buyer rejects the invoice so the right amount can be submitted',
  approverwindow: 'the approver counts, or their window after the gate counts ends',
  hold: 'the supplier’s payout hold ends',
  ready: 'the agent asks the contract to pay',
};

const verdictText = (d) => (d.verdict === 'Cleared'
  ? `Cleared: the contract pays ${short(d.paid_to)}.`
  : `${d.verdict}: ${d.codes.map((c) => CODE_TEXT[c] ?? c).join(' ') || 'no reason given.'}`);

async function stageOf(chain, o, cache = {}) {
  cache.cfg ??= await chain.viewConfig();
  if (!(o.supplier in cache)) cache[o.supplier] = await chain.viewSupplier(o.supplier);
  return orderStage(o, cache[o.supplier], cache.cfg.hold_ms);
}

/** A recently changed payout account, in words, or ''. A new supplier starts paid to its own
 *  account, so a different account still in its hold was changed recently (audit 24 Nov M5). */
function payoutWarning(o, sup, holdMs, now = Date.now()) {
  if (!sup || sup.payout === o.supplier || now - sup.payout_set_at >= holdMs) return '';
  const hours = Math.max(1, Math.round((now - sup.payout_set_at) / 3600000));
  return ` Warning: the supplier’s payout account was changed about ${hours} hour${hours === 1 ? '' : 's'} ago, to ${short(sup.payout)}. Confirm it with the supplier on a number already on file before anyone relies on it; the contract will not pay there until the hold ends.`;
}

export function makeTools(chain, { payer, preclearUrl, receiptsDir = process.env.CTP_RECEIPTS_DIR ?? join(homedir(), '.local/share/clear-to-pay/receipts'), invoiceDir = process.env.CTP_INVOICE_DIR ?? join(homedir(), 'Downloads'), fetch: fetchImpl } = {}) {
  const { escrow, agent } = chain;
  const where = `escrow <${escrow.index},${escrow.subindex}> on Concordium testnet`;

  async function listOrders() {
    const orders = await chain.listOrders();
    if (!orders.length) return `No orders yet on ${where}.`;
    const cache = {};
    const lines = [];
    for (const o of orders) {
      const st = await stageOf(chain, o, cache);
      const mine = o.agent === agent.owner ? '' : ' (another agent’s order)';
      lines.push(`#${o.id}: ${microToCcd(o.amount)} CCD, ${o.expected_qty} units. ${st.label}.${st.key in NEXT ? ` Next: ${NEXT[st.key]}.` : ''}${mine}`);
    }
    return `${orders.length} orders on ${where}:\n${lines.join('\n')}`;
  }

  async function getOrder({ order_id: id }) {
    const o = await chain.viewOrder(id);
    const st = await stageOf(chain, o);
    const counts = o.ruled_delivered ? 'the referee ruled the goods delivered'
      : o.reveals.length ? o.reveals.map((r) => `${r.role} ${r.qty}`).join(', ') : `${o.commits.length} sealed, none unsealed`;
    return [
      `Order #${id} on ${where}`,
      `Stage: ${st.label}.${st.key in NEXT ? ` Next: ${NEXT[st.key]}.` : ''}`,
      `Escrowed: ${microToCcd(o.amount)} CCD for ${o.expected_qty} units. Latest date for delivery and invoice: ${day(o.invoice_by)}.`,
      `Supplier ${short(o.supplier)}${o.accepted ? ', accepted' : ', not accepted yet'}. Receiver ${short(o.receiver)}, approver ${o.approver ? short(o.approver) : 'none (individual buyer)'}, supplier’s rep ${short(o.rep)}, referee ${short(o.referee)}.`,
      `Counts: ${counts}. Delivery confirmed: ${deliveryConfirmed(o) ? 'yes' : 'no'}.`,
      o.invoice ? `Invoice: ${microToCcd(o.invoice.amount)} CCD, fingerprint ${o.invoice.invoice_hash.slice(0, 12)}…, ${o.invoice.agent === o.supplier ? 'submitted by the supplier itself' : `by Agent #${o.invoice.agent_token_id}`}. Supplier approved: ${invoiceApproved(o) ? 'yes' : 'no'}.` : 'Invoice: none yet.',
      `Named agent: ${o.agent === agent.owner ? `this agent (#${agent.id})` : short(o.agent)}.`,
    ].join('\n') + payoutWarning(o, await chain.viewSupplier(o.supplier), (await chain.viewConfig()).hold_ms);
  }

  async function checkBadge() {
    const r = await checkCounterparty({ badge: agent.badge, claimedOwner: agent.owner }, { network: 'testnet', ...(fetchImpl ? { fetch: fetchImpl } : {}) });
    return `Concordium agent registry says ${r.verdict} for Agent #${agent.id} (badge ${agent.badge}, owner ${short(agent.owner)}).${r.codes.length ? ` Reasons: ${r.codes.join(', ')}.` : ''} The escrow contract also checks the registry on-chain itself when the agent is added, so this answer is a courtesy, not the guard.`;
  }

  async function dryRunPayment({ order_id: id }) {
    const r = await chain.simulate('execute_payment', executeParams(id, ZERO));
    if (!r.ok) return `Dry run of a payment request on order #${id}: the contract would refuse it (${r.error}). ${r.explain} Nothing was sent.`;
    const d = r.decisions[0];
    return `Dry run of a payment request on order #${id}, as Agent #${agent.id}: ${d ? verdictText(d) : 'no decision returned.'} Nothing was sent, signed or paid.`;
  }

  async function submitInvoice({ order_id: id, invoice_file: file, amount_ccd: amountCcd }) {
    const micro = ccdToMicro(String(amountCcd));
    if (micro == null) return 'The amount must be a CCD number, for example 25 or 0.5.';
    // Only files inside the invoices folder, after following links, and never hidden ones, so a
    // prompt-injected assistant cannot fingerprint a key or any other file (audit 24 Nov L2).
    let real, root;
    try { real = realpathSync(file); root = realpathSync(invoiceDir); } catch { return `Could not open the invoice file at ${file}.`; }
    const rel = relative(root, real);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(/[\\/]/).some((p) => p.startsWith('.'))) return `Invoices are read only from ${invoiceDir} (set CTP_INVOICE_DIR to change it). Move the invoice file there and try again.`;
    let st;
    try { st = statSync(real); } catch { return `Could not open the invoice file at ${file}.`; }
    // Only a regular file: never a device, pipe or folder (audit 21 Nov L1).
    if (!st.isFile()) return 'That path is not a regular file. Give the path of the invoice file itself.';
    const size = st.size;
    if (size > MAX_INVOICE_BYTES) return 'That file is larger than 10 MB; an invoice should be smaller.';
    const hash = createHash('sha256').update(readFileSync(real)).digest('hex');
    const bytes = invoiceParams(id, hash, micro);
    const dry = await chain.simulate('submit_invoice', bytes);
    if (!dry.ok) return `The contract would refuse this invoice (${dry.error}). ${dry.explain} Nothing was sent.`;
    if (!chain.canSend) return `Dry run passed: the contract would accept this invoice (fingerprint ${hash.slice(0, 12)}…, ${microToCcd(micro)} CCD). Sending needs CTP_AGENT_KEY_FILE; nothing was sent.`;
    let r;
    try { r = await chain.send('submit_invoice', bytes, dry.energy); } catch (e) {
      return afterTimeout(id, e, (o2) => (o2.invoice
        ? `It landed: order #${id} now has an invoice (fingerprint ${o2.invoice.invoice_hash.slice(0, 12)}…). Do not submit it again; the contract would refuse a second invoice anyway (InvoiceExists).`
        : `Order #${id} still has no invoice, so the request did not land. It is safe to submit again.`));
    }
    if (!r.ok) return `The contract refused the invoice on-chain (${r.error}). ${r.explain} ${ccdscanTx(r.tx)}`;
    return `Invoice submitted on order #${id}: ${microToCcd(micro)} CCD, fingerprint ${hash.slice(0, 12)}…. Only its SHA-256 went on-chain. Next, the supplier approves it from its own account. ${ccdscanTx(r.tx)}`;
  }

  async function requestPayment({ order_id: id }) {
    const o = await chain.viewOrder(id);
    const sup = await chain.viewSupplier(o.supplier);
    if (!sup) return `The supplier of order #${id} is not registered on this contract, so there is nothing to pay.`;
    const receipt = buildEscrowReceipt({ network: NETWORK, escrow, orderId: id, order: o, payout: sup.payout, askedBy: agent.owner });
    const hash = await escrowReceiptHash(receipt);
    const bytes = executeParams(id, hash);
    const dry = await chain.simulate('execute_payment', bytes);
    if (!dry.ok) return `The contract would refuse this request (${dry.error}). ${dry.explain} Nothing was sent.`;
    const preview = (dry.decisions[0] ? verdictText(dry.decisions[0]) : 'no decision') + payoutWarning(o, sup, (await chain.viewConfig()).hold_ms);
    if (!chain.canSend) return `Dry run: ${preview} Sending needs CTP_AGENT_KEY_FILE; nothing was sent.`;
    // Kept before sending, so no fingerprint lands on-chain without its receipt (audit M3).
    mkdirSync(receiptsDir, { recursive: true });
    const path = join(receiptsDir, `ctp-receipt-${escrow.index}-order${id}-${hash.slice(0, 12)}.json`);
    writeFileSync(path, `${canonicalize(receipt)}\n`);
    let r;
    try { r = await chain.send('execute_payment', bytes, dry.energy); } catch (e) {
      return afterTimeout(id, e, (o2) => (o2.paid
        ? `It went through: order #${id} is paid. Do not ask again; the contract refuses a second payment anyway (OrderClosed). Receipt saved at ${path}.`
        : `Order #${id} is not paid, so the request did not land or was held. It is safe to ask again: the dry run and the contract stop any second payment.`));
    }
    if (!r.ok) return `The contract refused the request on-chain (${r.error}). ${r.explain} ${ccdscanTx(r.tx)}`;
    const d = r.decisions[0];
    return `The contract recorded its decision on order #${id}: ${d ? verdictText(d) : 'no decision found.'} A held answer is final for this request and is on the record with its reasons; the AI cannot override it. Decision: ${ccdscanTx(r.tx)} Receipt saved at ${path}.`;
  }

  /** After a send with no answer: read the order back and say whether it landed, so a retry is
   *  never a guess. The contract refuses duplicates either way; this just tells the person. */
  async function afterTimeout(id, e, verdictOf) {
    const head = e?.sent ? `Sent, but the node did not confirm it in time${e.tx ? ` (${ccdscanTx(e.tx)})` : ''}.` : `Could not reach the node (${e?.message ?? e}); it may not have been sent.`;
    for (const wait of [0, 5000, 10000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try { return `${head} I checked the order: ${verdictOf(await chain.viewOrder(id))}`; } catch { /* try again */ }
    }
    return `${head} I could not read the order back either. Check order #${id} before asking again; the contract refuses duplicates in any case.`;
  }

  /** Pays Clear to Pay's x402 pre-clear service from the capped spending wallet. */
  async function preclearOrder({ order_id: id }) {
    if (!payer) return 'Pre-clear needs a spending wallet (CTP_SPEND_KEY_FILE and CTP_SPEND_ACCOUNT). Nothing was paid. A free dry run is available with dry_run_payment.';
    const url = `${preclearUrl}?escrow=${escrow.index}&order=${id}`;
    let r;
    try { r = await payer.pay(url); } catch (e) { return `Could not complete the paid check: ${e?.message ?? e}. If a payment was signed, it is counted in today's spending.`; }
    if (r.refused) return `Refused by the spending limits, before anything was signed: ${r.refused} Nothing was paid.`;
    if (!r.ok) return `The pre-clear service answered ${r.status}: ${r.body?.message ?? r.body?.error ?? 'no reason given'}. ${r.amount ? 'The fee was offered but the service did not confirm it.' : 'Nothing was paid.'}`;
    const b = r.body ?? {};
    const fee = `${microToCcd(BigInt(r.amount))} ${r.asset}`;
    const tx = r.receipt?.transaction ?? b.fee?.transaction;
    const verdict = b.verdict === 'Cleared' ? 'it would clear now' : b.verdict === 'Held' ? `it would be held: ${(b.reasons ?? []).join(' ')}` : `the contract would refuse the request (${b.reason ?? 'no reason'})`;
    return `Paid pre-clear for order #${id} on ${where}: ${verdict} This is the escrow contract's own dry run; nothing was sent to the escrow. Fee: ${fee} paid over x402 to ${short(b.fee?.payTo)}${tx ? ` (${ccdscanTx(tx)})` : ''}. Spent today: ${microToCcd(BigInt(r.spentToday))} ${r.asset}.`;
  }

  return { listOrders, getOrder, checkBadge, dryRunPayment, submitInvoice, requestPayment, preclearOrder };
}
