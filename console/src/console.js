// Escrow console for ctp_escrow <13091,0> on testnet.
// Each person connects their own wallet account and does only their part:
//   buyer: set up the cast and fund orders · signers: count blind
//   supplier: approve its invoice · agent: submit the invoice and ask for payment.
// Parameters are serialized by the wallet using the schema embedded in the
// deployed module (schema.js), so the wallet shows every field by name.
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { AccountTransactionType, CcdAmount, ContractAddress, ReceiveName, Energy, TransactionHash } from '@concordium/web-sdk';
import { ConcordiumGRPCWebClient } from '@concordium/web-sdk/grpc';
import { say, code, br, txLink } from '../../ui/say.js';
import { MODULE_SCHEMA_B64 } from './schema.js';

const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
// Escrow v2 (supplier approves the amount; one-transaction setup).
const CONTRACT_INDEX = 13106;
const CONTRACT = ContractAddress.create(CONTRACT_INDEX, 0);
// The contract's error variants, in order: concordium-std gives the first one code -1.
const ERRORS = ['Parse', 'LogFull', 'LogMalformed', 'NotAdmin', 'NotSigner', 'NotSupplier', 'NotAgent', 'UnknownOrder', 'OrderExists', 'UnknownSupplier', 'SupplierExists', 'OrderClosed', 'ZeroAmount', 'BadHold', 'BadOrderSigners', 'NotOrderSigner', 'SignerNoLongerValid', 'AlreadyCommitted', 'NoInvoice', 'NotCommitted', 'AlreadyRevealed', 'WaitingForSecondRole', 'RevealDoesNotMatchCommit', 'InvoiceExists', 'TransferFailed'];
const EXPLAIN = {
  NotAdmin: 'only the buyer account can do this', NotSigner: 'this account is not a listed signer', NotSupplier: 'only the supplier of this order can do this',
  NotAgent: 'only the registered agent that submitted the invoice can do this', UnknownOrder: 'no order with this id', OrderExists: 'an order with this id already exists',
  UnknownSupplier: 'this supplier is not registered', SupplierExists: 'this supplier is already registered', OrderClosed: 'this order is already paid or refunded',
  BadOrderSigners: 'the receiver and approver must be two different listed signers in those roles', NotOrderSigner: 'only the receiver and approver named on this order can count it',
  SignerNoLongerValid: 'this signer was removed or changed role', AlreadyCommitted: 'you already committed a count for this order', NoInvoice: 'no invoice submitted yet',
  NotCommitted: 'commit your count first', AlreadyRevealed: 'you already revealed', WaitingForSecondRole: 'wait until both signers have committed',
  RevealDoesNotMatchCommit: 'the count or salt is not what you committed', InvoiceExists: 'an invoice was already submitted for this order', ZeroAmount: 'attach CCD to fund the order',
};
const node = new ConcordiumGRPCWebClient('https://grpc.testnet.concordium.com', 20000);
const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{50}$/;
const HEX64 = /^[0-9a-f]{64}$/;

const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value.trim();
let provider = null;
let account = null;

const hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (bytes) => hexOf(await crypto.subtle.digest('SHA-256', bytes));

function u64(id) {
  const s = val(id);
  if (!/^\d{1,19}$/.test(s) || BigInt(s) > 18446744073709551615n) throw new Error(`${id}: whole number expected`);
  return Number(s) <= Number.MAX_SAFE_INTEGER ? Number(s) : s;
}
function addr(id) {
  const s = val(id);
  if (!ADDR_RE.test(s)) throw new Error(`${id}: Concordium account address expected`);
  return s;
}
function hex64(id) {
  const s = val(id).toLowerCase();
  if (!HEX64.test(s)) throw new Error(`${id}: 64 hex characters expected`);
  return s;
}
function ccd(id) {
  const s = val(id);
  if (!/^\d+(\.\d{1,6})?$/.test(s) || Number(s) <= 0) throw new Error(`${id}: amount in CCD expected, e.g. 25`);
  const [w, f = ''] = s.split('.');
  return CcdAmount.fromMicroCcd(BigInt(w) * 1000000n + BigInt((f + '000000').slice(0, 6)));
}

/** Blind count commitment: SHA-256("CTP-count/v1" || order_id LE || qty LE || salt). Same as contract/src/rules.rs. */
async function commitHash(orderId, qty, salt) {
  const pre = new Uint8Array(60);
  pre.set(new TextEncoder().encode('CTP-count/v1'), 0);
  const dv = new DataView(pre.buffer);
  dv.setBigUint64(12, BigInt(orderId), true);
  dv.setBigUint64(20, BigInt(qty), true);
  pre.set(salt, 28);
  return sha256Hex(pre);
}

const saltKey = (orderId) => `ctp-count:${account}:${orderId}`;

/** Reconnects first, so a reload or an account switch in the wallet does not block the send. */
async function ensureConnected() {
  provider ??= await detectConcordiumProvider();
  account = (await provider.requestAccounts())?.[0] ?? null;
  $('acct').textContent = account ?? 'not connected';
  if (!account) throw new Error('connect the wallet first');
}

/** Waits for finalization and explains the outcome in words. */
async function outcome(tx, doneText) {
  say('info', 'Sent ', code(tx), '. Waiting for the chain to finalize it…', br(), txLink(tx));
  let item;
  try {
    const limit = new Promise((_, no) => setTimeout(() => no(new Error('timeout')), globalThis.CTP_WAIT_MS ?? 120000));
    item = await Promise.race([node.waitForTransactionFinalization(TransactionHash.fromHexString(tx), 120000), limit]);
  } catch {
    say('info', 'Sent ', code(tx), '. Could not reach a node to confirm; check it on CCDScan.', br(), txLink(tx));
    return;
  }
  const sum = item.summary;
  if (sum.type === 'accountTransaction' && sum.transactionType === 'failed') {
    const r = sum.rejectReason;
    const name = r?.tag === 'RejectedReceive' ? ERRORS[-Number(r.rejectReason) - 1] : null;
    const why = name ? `${name}: ${EXPLAIN[name] ?? 'refused by the contract'}` : (r?.tag ?? 'rejected');
    say('bad', 'Refused by the chain. ', why, br(), txLink(tx));
    return;
  }
  say('ok', `✓ ${doneText}`, br(), 'Finalized: ', code(tx), br(), txLink(tx));
}

async function send(entrypoint, params, amount = CcdAmount.zero(), doneText = `${entrypoint} done`) {
  await ensureConnected();
  const tx = await provider.sendTransaction(
    account,
    AccountTransactionType.Update,
    { amount, address: CONTRACT, receiveName: ReceiveName.fromString(`ctp_escrow.${entrypoint}`), maxContractExecutionEnergy: Energy.create(30000) },
    params,
    { type: 'module', value: MODULE_SCHEMA_B64 },
  );
  await outcome(tx, doneText);
  return tx;
}
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

const actions = {
  // ---- buyer (admin) ----
  setup: () => {
    const receiver = addr('setup_receiver');
    const approver = addr('setup_approver');
    const agent = addr('agent_account');
    const supplier = addr('supplier_account');
    const payout = addr('supplier_payout');
    if (receiver === approver) throw new Error('the receiver and approver must be two different accounts');
    return send('setup', {
      signers: [{ account: receiver, role: { Receiver: [] } }, { account: approver, role: { Approver: [] } }],
      agents: [{ account: agent, agent_token_id: u64('agent_token') }],
      suppliers: [{ supplier, payout }],
    }, CcdAmount.zero(), `Cast set up: receiver ${short(receiver)}, approver ${short(approver)}, agent ${short(agent)}, supplier ${short(supplier)}. The 72-hour payout hold started now.`);
  },
  add_signer: () => send('add_signer', { account: addr('signer_account'), role: { [val('signer_role')]: [] } }, CcdAmount.zero(), `Added ${short(val('signer_account'))} as ${val('signer_role')}.`),
  add_agent: () => send('add_agent', { account: addr('agent_account'), agent_token_id: u64('agent_token') }, CcdAmount.zero(), `Added agent ${short(val('agent_account'))} (token ${val('agent_token')}).`),
  register_supplier: () => send('register_supplier', { supplier: addr('supplier_account'), payout: addr('supplier_payout') }, CcdAmount.zero(), `Registered supplier ${short(val('supplier_account'))}. The 72-hour payout hold started now.`),
  create_order: () => send('create_order', {
    order_id: u64('order_id'), supplier: addr('order_supplier'), expected_qty: u64('order_qty'),
    receiver: addr('order_receiver'), approver: addr('order_approver'),
  }, ccd('order_amount'), `Order ${val('order_id')} created and funded with ${val('order_amount')} CCD.`),
  refund: () => send('refund', u64('refund_order'), CcdAmount.zero(), `Order ${val('refund_order')} refunded to the buyer.`),
  // ---- signers ----
  commit_count: async () => {
    const orderId = u64('count_order');
    const qty = u64('count_qty');
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const hash = await commitHash(orderId, qty, salt);
    try {
      localStorage.setItem(saltKey(orderId), JSON.stringify({ qty: String(qty), salt: hexOf(salt) }));
    } catch { /* storage may be unavailable; the salt is shown below */ }
    $('count_salt').value = hexOf(salt);
    await send('commit_count', { order_id: orderId, hash }, CcdAmount.zero(), `Count committed for order ${orderId}. Only its fingerprint is on-chain. Your salt (also saved in this browser): ${hexOf(salt)}`);
  },
  reveal_count: async () => {
    const orderId = u64('count_order');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(saltKey(orderId)) ?? 'null'); } catch { /* ignore */ }
    const saltHex = (val('count_salt') || saved?.salt || '').toLowerCase();
    const qty = val('count_qty') || saved?.qty;
    if (!HEX64.test(saltHex)) throw new Error('salt missing: paste the salt you saved when committing');
    if (!/^\d+$/.test(qty ?? '')) throw new Error('enter the same count you committed');
    const salt = Array.from(saltHex.match(/../g), (h) => parseInt(h, 16));
    await send('reveal_count', { order_id: orderId, qty: Number(qty), salt }, CcdAmount.zero(), `Count ${qty} revealed for order ${orderId}.`);
  },
  // ---- supplier ----
  approve_invoice: () => send('approve_invoice', { order_id: u64('inv_order'), invoice_hash: hex64('inv_hash'), amount: ccd('inv_amount').microCcdAmount.toString() }, CcdAmount.zero(), `Supplier approved invoice ${val('inv_hash').slice(0, 8)}… for ${val('inv_amount')} CCD on order ${val('inv_order')}.`),
  set_payout: () => send('set_payout', addr('new_payout'), CcdAmount.zero(), `Payout account changed to ${short(val('new_payout'))}. The 72-hour hold restarted.`),
  // ---- agent ----
  submit_invoice: () => send('submit_invoice', { order_id: u64('inv_order'), invoice_hash: hex64('inv_hash'), amount: ccd('inv_amount').microCcdAmount.toString() }, CcdAmount.zero(), `Invoice ${val('inv_hash').slice(0, 8)}… submitted for order ${val('inv_order')}.`),
  execute_payment: () => send('execute_payment', { order_id: u64('inv_order'), receipt_hash: val('receipt_hash') ? hex64('receipt_hash') : '0'.repeat(64) }, CcdAmount.zero(), `Decision recorded for order ${val('inv_order')}. Open the transaction to see the verdict: CLEARED pays the supplier; HELD lists the reasons.`),
};

async function connect() {
  provider = await detectConcordiumProvider();
  account = (await provider.requestAccounts())?.[0] ?? null;
  $('acct').textContent = account ?? 'not connected';
  const chain = (await provider.getSelectedChain()) ?? '';
  if (!chain.startsWith(TESTNET_GENESIS_PREFIX)) {
    account = null;
    say('bad', 'Your wallet is not on testnet.');
  }
  $('acct').textContent = account ?? 'not connected';
}

if (!CONTRACT_INDEX) say('bad', 'The escrow v2 contract is not deployed yet. Deploy it first (deploy/), then this page is updated with its address.');
$('connect').onclick = () => connect().catch((e) => say('bad', String(e?.message ?? e)));
for (const [name, fn] of Object.entries(actions)) {
  const b = document.querySelector(`[data-action="${name}"]`);
  if (b) b.onclick = () => Promise.resolve().then(fn).catch((e) => say('bad', `${name}: ${e?.message ?? e}`));
}
// Invoice file -> SHA-256, so the agent and the supplier hash the very same bytes.
$('inv_file').onchange = async (e) => {
  const f = e.target.files?.[0];
  if (f) $('inv_hash').value = await sha256Hex(await f.arrayBuffer());
};
