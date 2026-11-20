// Supplier and Agent spaces.
import { AGENT, currentAccount, listOrders, viewConfig, viewSupplier } from './chain.js';
import { ccdToMicro, microToCcd, orderStage, toHex, invoiceApproved, pastDue, invoiceOpen } from './codec.js';
import { dateBlock, recountButton, askPaymentButton, releaseButton, countsLine, iso, fmtDay } from './ordertools.js';
import { askForPayment, receiptPanel } from './payreceipt.js';
import { CAST } from './cast.js';
import { act } from './act.js';
import { h, fill, icon, chip, short, countdown, fmtDate, notice, holdText } from './ui.js';

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{50}$/;
const fileHash = async (file) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())));

function sidebar(initial, title, sub, note) {
  return h('aside.side', h('div.who', h('span.avatar', initial), h('div', h('b', title), h('span.mono', sub))), note ? h('p.side-note', note) : null);
}

function frame(side, ...body) {
  return h('div.space.with-side', side, h('div.space-main', ...body));
}

const unreachable = () => h('section.panel', h('p.err', icon('alert', 16), 'Could not read the escrow contract right now. Check your connection, then reload.'));

// ---------------- supplier ----------------
export async function supplierView() {
  const me = currentAccount();
  const side = sidebar('S', me ? CAST.nameOf(me) : 'Supplier', me ? short(me) : 'Connect your wallet', 'Money goes only to the payout account you set yourself. Every change waits out a hold before money can go there.');
  if (!me) return frame(side, h('section.panel.empty', h('h2', 'Connect your wallet'), h('p', 'Use the supplier account registered on the escrow.')));
  let sup, cfg, orders;
  try {
    [sup, cfg, orders] = await Promise.all([viewSupplier(me), viewConfig(), listOrders()]);
  } catch {
    return frame(side, unreachable());
  }
  if (!sup) return frame(side, h('section.panel.empty', h('h2', 'Not registered'), h('p', `${short(me)} is not a supplier on this escrow. Ask the buyer to register you.`)));
  orders = orders.filter((o) => o.supplier === me);
  const end = sup.payout_set_at + cfg.hold_ms;
  const left = end - Date.now();

  // payout card
  const newPayout = h('input.mono', { placeholder: 'New payout account', 'aria-label': 'New payout account', spellcheck: false });
  const payout = h('section.panel',
    h('h3', 'Your payout account'),
    h('p.big-addr.mono', sup.payout),
    left > 0 ? h('p', chip('hold', `Hold: ${countdown(left)} left`), ` Payments can go here from ${fmtDate(end)}.`) : h('p', chip('ok', 'Ready'), ' Payments can go here now.'),
    h('details.change',
      h('summary', 'Change payout account'),
      h('p.fine', `Only you can change it, and the ${holdText(cfg.hold_ms)} hold starts again. Nobody, including the buyer, can redirect a payment that is due now.`),
      h('div.count-row', newPayout, h('button.btn.line', { type: 'button', onclick: async () => {
        const v = newPayout.value.trim();
        if (!ADDR_RE.test(v)) return notice('no', 'Enter a Concordium account address.');
        if (!confirm(`Change your payout account? Payments wait ${holdText(cfg.hold_ms)} from now.`)) return;
        const r = await act('set_payout', v, { done: `Payout account changed to ${short(v)}. The ${holdText(cfg.hold_ms)} hold restarted.` });
        if (r.ok) location.reload();
      } }, 'Change'))));

  // invoices
  const staged = orders.map((o) => ({ o, st: orderStage(o, sup, cfg.hold_ms) }));
  const isOpen = ({ o }) => !o.paid && !o.refunded;
  const toAccept = staged.filter((x) => isOpen(x) && !x.o.accepted);
  const toApprove = staged.filter((x) => isOpen(x) && x.o.accepted && x.o.invoice);
  const waiting = staged.filter((x) => isOpen(x) && x.o.accepted && !x.o.invoice);
  const tools = (o) => h('div.order-tools', dateBlock(o, me, 'supplier'), h('div.actions', askPaymentButton(o, 'Ask for my payment'), recountButton(o), releaseButton(o)));

  const acceptCard = ({ o }) => {
    const repIn = h('input.mono', { value: me, spellcheck: false, 'aria-label': 'Delivery rep account' });
    return h('section.panel.count',
      h('div.count-h', h('span.order-id.num', `#${o.id}`), h('div', h('b', 'New order: accept it to lock the money for you'), h('span', `${o.expected_qty} units`))),
      h('div.big-amount.num', `${microToCcd(o.amount)} CCD`),
      h('p', 'Latest date for delivery and invoice: ', h('b', fmtDay(o.invoice_by)), '. You can deliver and be paid any day before it. Once you accept, the buyer cannot take this money back unless the date passes with nothing delivered, or you give it back.'),
      h('dl.facts',
        h('dt', 'Buyer’s receiver (gate)'), h('dd.mono', short(o.receiver)),
        h('dt', 'Buyer’s approver (inside)'), h('dd.mono', short(o.approver)),
        h('dt', 'Referee for disputes'), h('dd.mono', short(o.referee))),
      pastDue(o) ? h('p.err', icon('alert', 16), 'This date has passed. Ask the buyer for a new date before accepting.') : [
        h('div.field', h('label', 'Your delivery rep (the driver, who counts at the gate)'), repIn,
          h('p.fine', 'Your own account works if you deliver yourself. At the gate the rep sees whether the buyer’s receiver has sealed a count: no count, no unload.')),
        h('div.count-row',
          h('button.btn.gold', { type: 'button', onclick: async (e) => {
            const rep = repIn.value.trim();
            if (!/^[1-9A-HJ-NP-Za-km-z]{50}$/.test(rep)) return notice('no', 'Enter your delivery rep’s Concordium account.');
            e.currentTarget.disabled = true;
            const r = await act('accept_order', { order_id: o.id, invoice_by: iso(o.invoice_by), rep }, { done: `You accepted order #${o.id}. The money is locked for you until ${fmtDay(o.invoice_by)}.` });
            if (r.ok) location.reload(); else e.currentTarget.disabled = false;
          } }, icon('check', 18), 'Accept order and date'))],
      h('div.order-tools', dateBlock(o, me, 'supplier', { showDate: false }), h('div.actions', releaseButton(o))));
  };
  const paid = staged.filter(({ o }) => o.paid);

  const approveCard = ({ o, st }) => {
    const approved = invoiceApproved(o) || (o.supplier_approval && o.supplier_approval.invoice_hash === o.invoice.invoice_hash && o.supplier_approval.amount === o.invoice.amount);
    const closed = !invoiceOpen(o) && !approved;
    const amountIn = h('input.num', { value: microToCcd(o.invoice.amount), inputMode: 'decimal', 'aria-label': 'Amount you agree to be paid, in CCD' });
    const fileState = h('p.live', 'Pick the invoice file you sent, to confirm it is the same one.');
    let fileOk = false;
    const fileIn = h('input', { type: 'file', 'aria-label': 'Your invoice file', onchange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      fileOk = (await fileHash(f)) === o.invoice.invoice_hash;
      fill(fileState, fileOk ? chip('ok', 'Same invoice') : chip('no', 'Different file'), ' ', fileOk ? 'This is the invoice the agent submitted.' : 'This is not the invoice the agent submitted. Do not approve it; reject it below.');
    } });
    return h('section.panel.count',
      h('div.count-h', h('span.order-id.num', `#${o.id}`), h('div', h('b', approved ? 'Approved' : 'Invoice waiting for your approval'), h('span', chip(st.tone, st.label)))),
      h('div.big-amount.num', `${microToCcd(o.invoice.amount)} CCD`),
      h('p.fine', `Escrowed for this order: ${microToCcd(o.amount)} CCD. Invoice ${o.invoice.invoice_hash.slice(0, 8)}…, submitted by Agent #${o.invoice.agent_token_id ?? AGENT.id}.`),
      h('p.fine', `Counts: ${countsLine(o)}.`),
      closed ? h('p.err', icon('alert', 16), `The latest date (${fmtDay(o.invoice_by)}) has passed, so approvals are closed. Ask the buyer to agree a new date.`) : null,
      approved || closed ? null : [
        h('label.field', h('span', 'Your invoice file'), fileIn), fileState,
        h('label.field', h('span', 'Amount you agree to be paid (CCD)'), amountIn),
        h('div.count-row', h('button.btn.gold', { type: 'button', onclick: async (e) => {
          if (!fileOk) return notice('no', 'Pick your invoice file first, so you approve exactly the invoice you sent.');
          const micro = ccdToMicro(amountIn.value);
          if (micro == null) return notice('no', 'Enter the amount in CCD, for example 25 or 12.5.');
          if (micro !== o.invoice.amount) notice('wait', 'The amount differs from the invoice. The contract will hold the payment until they match.');
          e.currentTarget.disabled = true;
          const r = await act('approve_invoice', { order_id: o.id, invoice_hash: o.invoice.invoice_hash, amount: micro.toString() }, { done: `You approved order #${o.id} for ${microToCcd(micro)} CCD.` });
          if (r.ok) location.reload();
        } }, icon('check', 18), 'Approve invoice and amount'),
        h('button.btn.text', { type: 'button', onclick: async (e) => {
          if (!confirm(`Reject this invoice on order #${o.id}? Use this if it is not the invoice you sent. The agent can then submit the right one.`)) return;
          e.currentTarget.disabled = true;
          const r = await act('reject_invoice', o.id, { done: `Invoice on order #${o.id} rejected.` });
          if (r.ok) location.reload();
        } }, 'Not my invoice: reject it'))],
      tools(o), receiptPanel(o));
  };
  const waitingCard = ({ o, st }) => h('section.panel.count',
    h('div.count-h', h('span.order-id.num', `#${o.id}`), h('div', h('b', `${microToCcd(o.amount)} CCD escrowed for you`), h('span', chip(st.tone, st.label)))),
    h('p.fine', `Counts: ${countsLine(o)}. Send your invoice to the buyer's agent; it submits the fingerprint and you approve it here.`),
    tools(o));

  return frame(side,
    h('header.dash-h', h('div', h('h2', 'Your invoices'), h('p', 'Approve your own invoice and amount. Nobody can pay you less than you approve.'))),
    toAccept.map(acceptCard),
    toApprove.length ? toApprove.map(approveCard) : h('section.panel.empty-s', h('p', 'No invoices waiting for your approval.')),
    waiting.length ? [h('h3.sub-h', 'Waiting for the invoice'), waiting.map(waitingCard)] : null,
    payout,
    paid.length ? h('section.panel', h('h3', 'Payments received'), h('ul.plain', paid.map(({ o }) => h('li', h('b.num', `#${o.id}`), ` ${microToCcd(o.amount)} CCD`, receiptPanel(o))))) : null);
}

// ---------------- agent ----------------
async function checkBadge(id) {
  const r = await fetch(`https://agent-registry-mcp.concordium.com/v1/check-badge/${encodeURIComponent(id)}?network=testnet`, { signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return { ok: false, text: 'No agent with this ID.' };
  const j = await r.json();
  return { ok: j.badge_valid === true, text: j.badge_valid ? `Verified: agent #${j.token_id}, owner ${short(j.on_chain?.owner_account)}, ${j.on_chain?.status}.` : `Does not check out: ${(j.issues ?? []).join(', ') || 'see the registry'}.` };
}

export async function agentView() {
  const me = currentAccount();
  const side = sidebar('A', `Agent #${AGENT.id}`, short(AGENT.owner), 'The agent reads invoices and asks for payment. The contract decides; the agent can never pay on its own.');
  const badgeIn = h('input.mono', { value: AGENT.badge, 'aria-label': 'Agent ID to check', spellcheck: false });
  const badgeOut = h('p.live');
  const checker = h('section.panel',
    h('h3', 'Check another agent before dealing with it'),
    h('div.count-row', badgeIn, h('button.btn.line', { type: 'button', onclick: async () => {
      if (!/^[1-9A-HJ-NP-Za-km-z]{8,64}$/.test(badgeIn.value.trim())) return fill(badgeOut, chip('no', 'Not an agent ID'));
      fill(badgeOut, 'Checking with the Concordium Agent Registry…');
      try { const r = await checkBadge(badgeIn.value.trim()); fill(badgeOut, chip(r.ok ? 'ok' : 'no', r.ok ? 'Verified' : 'Refused'), ' ', r.text); } catch { fill(badgeOut, chip('wait', 'Unknown'), ' Could not reach the registry from this browser.'); }
    } }, 'Check badge')), badgeOut);

  if (me !== AGENT.owner) {
    return frame(side, h('header.dash-h', h('div', h('h2', 'Agent desk'), h('p', `Connect the account that owns Agent #${AGENT.id} (${short(AGENT.owner)}) to submit invoices.`))), checker);
  }
  let orders, cfg, sups = {};
  try {
    [orders, cfg] = await Promise.all([listOrders(), viewConfig()]);
    for (const s of new Set(orders.map((o) => o.supplier))) sups[s] = await viewSupplier(s);
  } catch {
    return frame(side, unreachable());
  }
  const open = orders.filter((o) => !o.paid && !o.refunded && o.agent === AGENT.owner).reverse();

  const orderCard = (o) => {
    const st = orderStage(o, sups[o.supplier], cfg.hold_ms);
    let action;
    if (!o.invoice && !invoiceOpen(o)) {
      action = h('p', 'The latest date has passed, so no invoice can be submitted unless the buyer and supplier agree a new date.');
    } else if (!o.invoice) {
      let hash = null;
      const out = h('p.live', 'Pick the supplier’s invoice file. Only its SHA-256 goes on-chain.');
      const amt = h('input.num', { value: microToCcd(o.amount), inputMode: 'decimal', 'aria-label': 'Invoice amount in CCD' });
      action = [
        h('label.field', h('span', 'Invoice file'), h('input', { type: 'file', onchange: async (e) => { const f = e.target.files?.[0]; if (f) { hash = await fileHash(f); fill(out, chip('ok', 'Read'), ` ${f.name}, fingerprint ${hash.slice(0, 8)}…`); } } })), out,
        h('label.field', h('span', 'Amount on the invoice (CCD)'), amt),
        h('button.btn.dark', { type: 'button', onclick: async (e) => {
          if (!hash) return notice('no', 'Pick the invoice file first.');
          const micro = ccdToMicro(amt.value);
          if (micro == null) return notice('no', 'Enter the invoice amount in CCD.');
          e.currentTarget.disabled = true;
          const r = await act('submit_invoice', { order_id: o.id, invoice_hash: hash, amount: micro.toString() }, { done: `Invoice submitted for order #${o.id}. The supplier approves it next.` });
          if (r.ok) location.reload();
        } }, 'Submit invoice')];
    } else {
      action = [
        h('p', st.key === 'ready' ? 'Every check passes. Ask the contract to pay.' : `Not ready yet: ${st.label.toLowerCase()}. You can still ask; the contract will answer held, with the reasons.`),
        h('button.btn.gold', { type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          const r = await askForPayment(o.id);
          if (r.ok) setTimeout(() => location.reload(), 2500);
          else e.currentTarget.disabled = false;
        } }, 'Ask for payment')];
    }
    return h('section.panel.count',
      h('div.count-h', h('span.order-id.num', `#${o.id}`), h('div', h('b', `${microToCcd(o.amount)} CCD escrowed`), h('span', chip(st.tone, st.label)))),
      action, receiptPanel(o));
  };

  return frame(side,
    h('header.dash-h', h('div', h('h2', 'Agent desk'), h('p', 'Submit invoices and ask for payment. The contract runs every rule itself.'))),
    open.length ? open.map(orderCard) : h('section.panel.empty-s', h('p', 'No open orders.')),
    checker);
}
