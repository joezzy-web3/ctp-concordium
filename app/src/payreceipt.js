// Payment receipts in the app. Asking for payment builds a receipt from the order as the
// contract holds it right now, and sends its fingerprint as receipt_hash. The contract
// writes that fingerprint into its Decision event, next to its verdict. The receipt is
// kept in this browser and can be downloaded; anyone can check it against the chain.
import { act } from './act.js';
import { ESCROW, currentAccount, viewOrder, viewSupplier, decisionsIn, decisionsInTx, ccdscanTx } from './chain.js';
import { buildEscrowReceipt, escrowReceiptHash, checkReceiptAgainstDecision, compareReceiptWithOrder } from '../../receipt/escrowReceipt.js';
import { canonicalize } from '../../receipt/canonical.js';
import { h, fill, icon, chip, notice, store, short } from './ui.js';

const NETWORK = 'concordium:testnet';
const key = (id) => `ctp:receipts:${ESCROW.index}:${id}`;
export const savedReceipts = (id) => store.get(key(id), []);

/** Asks the contract for its decision on an order, with a receipt. Returns the act() result. */
export async function askForPayment(orderId, { done } = {}) {
  const me = currentAccount();
  let receipt;
  let hash;
  try {
    const order = await viewOrder(orderId);
    const sup = await viewSupplier(order.supplier);
    if (!sup) throw new Error('The supplier is not registered on this contract.');
    receipt = buildEscrowReceipt({ network: NETWORK, escrow: ESCROW, orderId, order, payout: sup.payout, askedBy: me ?? '' });
    hash = await escrowReceiptHash(receipt);
  } catch (e) {
    notice('no', h('b', 'Could not prepare the receipt. '), String(e?.message ?? e));
    return { ok: false };
  }
  // Kept before sending, so a timeout or a closed tab never leaves a fingerprint on-chain
  // whose receipt nobody has (audit 20 Nov M3).
  const save = (patch) => store.set(key(orderId), [...savedReceipts(orderId).filter((x) => x.hash !== hash), { receipt, hash, tx: null, verdict: null, codes: [], ...patch }]);
  save({ pending: true });
  const r = await act('execute_payment', { order_id: orderId, receipt_hash: hash }, { pending: 'Asking the contract. ', done: done ?? `The contract recorded its decision on order #${orderId}, with your receipt.` });
  if (r.ok === false) {
    // Not sent, or refused: a refused transaction records nothing, so there is no decision to keep.
    store.set(key(orderId), savedReceipts(orderId).filter((x) => x.hash !== hash));
  } else if (!r.ok) {
    save({ pending: true, tx: r.tx ?? null }); // sent, not yet confirmed from here
  }
  if (r.ok) {
    const [decision] = await decisionsIn(r.events ?? []);
    save({ tx: r.tx, verdict: decision?.verdict ?? null, codes: decision?.codes ?? [] });
    if (decision?.verdict === 'Cleared') notice('ok', h('b', 'Cleared. '), `The contract paid the supplier at ${short(decision.paid_to)}.`);
    else if (decision) notice('wait', h('b', 'Held. '), decision.codes.map((c) => CODE_TEXT[c] ?? c).join(' '));
  }
  return r;
}

/** The contract's reason codes, in words. */
export const CODE_TEXT = {
  SeizedAlreadyPaid: 'This order was already paid.',
  HeldNoInvoice: 'No invoice yet.',
  HeldOneSignature: 'Both signers have not unsealed their counts yet.',
  HeldCountMismatch: 'The counts do not match the order.',
  HeldAmountMismatch: 'The invoice amount is not the escrowed amount.',
  HeldNoSupplierApproval: 'The supplier has not approved this invoice and amount.',
  HeldPayoutCoolOff: 'The supplier’s payout account is still in its hold.',
};

const download = (rec) => {
  const blob = new Blob([`${canonicalize(rec.receipt)}\n`], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `ctp-receipt-order${rec.receipt.order_id}-${rec.hash.slice(0, 12)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

/** Checks a receipt against the Decision in a transaction. Returns { ok, decision, problems }. */
export async function verifyReceipt(receipt, tx) {
  const decisions = await decisionsInTx(tx);
  if (!decisions.length) return { ok: false, decision: null, problems: ['That transaction has no payment decision from this escrow.'] };
  const results = await Promise.all(decisions.map(async (d) => ({ d, p: await checkReceiptAgainstDecision(receipt, d, ESCROW) })));
  const hit = results.find((x) => x.p.length === 0) ?? results[0];
  // The facts inside the receipt, against the order the contract holds (audit 20 Nov N14).
  let notes = [];
  if (hit.p.length === 0) {
    const diffs = compareReceiptWithOrder(receipt, await viewOrder(receipt.order_id));
    if (hit.d.verdict === 'Cleared') hit.p.push(...diffs);
    else notes = diffs.map((x) => `${x} (the order may have changed since this held decision)`);
  }
  return { ok: hit.p.length === 0, decision: hit.d, problems: hit.p, notes };
}

const verdictChip = (v) => chip(v === 'Cleared' ? 'ok' : 'hold', v === 'Cleared' ? 'Cleared' : v === 'Held' ? 'Held' : v ?? 'Unknown');

function resultView(res) {
  const d = res.decision;
  return res.ok
    ? h('div.verify-ok', h('p', icon('check', 16), h('b', ' This receipt is the one the contract recorded with its decision, and its facts match the order on-chain.')),
      res.notes?.length ? h('ul.plain', res.notes.map((x) => h('li.fine', x))) : null,
      h('p.fine', 'Verdict: ', verdictChip(d.verdict), d.codes.length ? ` ${d.codes.map((c) => CODE_TEXT[c] ?? c).join(' ')}` : '', d.paid_to ? ` · paid to ${short(d.paid_to)}` : '', ` · asked by ${short(d.asked_by)}`))
    : h('div.verify-no', h('p.err', icon('alert', 16), h('b', ' This receipt does not match the decision on-chain.')), h('ul.plain', res.problems.map((x) => h('li', x))));
}

/** Receipts kept in this browser for an order, with download and an on-chain check. */
export function receiptPanel(o) {
  const recs = savedReceipts(o.id);
  if (!recs.length) return null;
  const out = h('div.verify-out');
  return h('div.receipts',
    h('h4', 'Payment receipts'),
    h('ul.plain', recs.map((rec) => h('li',
      rec.pending && !rec.verdict ? chip('wait', 'Sent, not confirmed here') : verdictChip(rec.verdict), ' ', h('code', `${rec.hash.slice(0, 12)}…`), ' ',
      rec.tx ? [h('a.inline', { href: ccdscanTx(rec.tx), target: '_blank', rel: 'noopener' }, 'Decision', icon('external', 14)), ' '] : null,
      h('button.btn.text.small', { type: 'button', onclick: () => download(rec) }, icon('download', 14), 'Download'), ' ',
      !rec.tx ? null : h('button.btn.text.small', { type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { fill(out, resultView(await verifyReceipt(rec.receipt, rec.tx))); } catch (err) { fill(out, h('p.err', String(err?.message ?? err))); }
        e.currentTarget.disabled = false;
      } }, 'Check on-chain')))),
    out);
}

/** For anyone holding a receipt file: check it against the decision transaction. */
export function verifyReceiptCard() {
  const file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Receipt file' });
  const tx = h('input', { type: 'text', placeholder: 'Decision transaction hash (64 hex characters)', spellcheck: 'false', 'aria-label': 'Transaction hash' });
  const out = h('div.verify-out');
  return h('section.panel',
    h('h3', 'Check a payment receipt'),
    h('p.fine', 'Every payment decision carries the fingerprint of a receipt. Pick the receipt file and paste the decision’s transaction hash: the page reads the decision from the chain and checks that this exact receipt is the one it recorded.'),
    h('div.field', h('label', 'Receipt file'), file),
    h('div.field', h('label', 'Decision transaction'), tx),
    h('button.btn.dark', { type: 'button', onclick: async (e) => {
      const f = file.files?.[0];
      if (!f) return notice('no', 'Pick a receipt file first.');
      e.currentTarget.disabled = true;
      try {
        if (f.size > 64 * 1024) throw new Error('That file is too large to be a receipt.');
        const receipt = JSON.parse(await f.text());
        fill(out, resultView(await verifyReceipt(receipt, tx.value)));
      } catch (err) {
        fill(out, h('p.err', String(err?.message ?? err)));
      }
      e.currentTarget.disabled = false;
    } }, 'Check receipt'),
    out);
}
