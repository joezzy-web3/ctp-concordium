// Escrow console for ctp_escrow <13091,0> on testnet.
// Each person connects their own wallet account and does only their part:
//   buyer: set up the cast and fund orders · signers: count blind
//   supplier: approve its invoice · agent: submit the invoice and ask for payment.
// Parameters are serialized by the wallet using the schema embedded in the
// deployed module (schema.js), so the wallet shows every field by name.
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { AccountTransactionType, CcdAmount, ContractAddress, ReceiveName, Energy } from '@concordium/web-sdk';
import { say, code, br, txLink } from '../../ui/say.js';
import { MODULE_SCHEMA_B64 } from './schema.js';

const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
const CONTRACT = ContractAddress.create(13091, 0);
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

async function send(entrypoint, params, amount = CcdAmount.zero()) {
  if (!account) throw new Error('connect the wallet first');
  const tx = await provider.sendTransaction(
    account,
    AccountTransactionType.Update,
    { amount, address: CONTRACT, receiveName: ReceiveName.fromString(`ctp_escrow.${entrypoint}`), maxContractExecutionEnergy: Energy.create(30000) },
    params,
    { type: 'module', value: MODULE_SCHEMA_B64 },
  );
  say('ok', `${entrypoint} sent: `, code(tx), br(), txLink(tx));
  return tx;
}

const actions = {
  // ---- buyer (admin) ----
  add_signer: () => send('add_signer', { account: addr('signer_account'), role: { [val('signer_role')]: [] } }),
  add_agent: () => send('add_agent', { account: addr('agent_account'), agent_token_id: u64('agent_token') }),
  register_supplier: () => send('register_supplier', { supplier: addr('supplier_account'), payout: addr('supplier_payout') }),
  create_order: () => send('create_order', {
    order_id: u64('order_id'), supplier: addr('order_supplier'), expected_qty: u64('order_qty'),
    receiver: addr('order_receiver'), approver: addr('order_approver'),
  }, ccd('order_amount')),
  refund: () => send('refund', u64('refund_order')),
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
    await send('commit_count', { order_id: orderId, hash });
    say('ok', 'Count committed. Keep this salt until you reveal (it is also saved in this browser): ', code(hexOf(salt)));
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
    await send('reveal_count', { order_id: orderId, qty: Number(qty), salt });
  },
  // ---- supplier ----
  approve_invoice: () => send('approve_invoice', { order_id: u64('inv_order'), invoice_hash: hex64('inv_hash') }),
  set_payout: () => send('set_payout', addr('new_payout')),
  // ---- agent ----
  submit_invoice: () => send('submit_invoice', { order_id: u64('inv_order'), invoice_hash: hex64('inv_hash'), amount: ccd('inv_amount').microCcdAmount.toString() }),
  execute_payment: () => send('execute_payment', { order_id: u64('inv_order'), receipt_hash: val('receipt_hash') ? hex64('receipt_hash') : '0'.repeat(64) }),
};

async function connect() {
  provider = await detectConcordiumProvider();
  account = (await provider.requestAccounts())?.[0] ?? null;
  const chain = (await provider.getSelectedChain()) ?? '';
  if (!chain.startsWith(TESTNET_GENESIS_PREFIX)) {
    account = null;
    say('bad', 'Your wallet is not on testnet.');
  }
  $('acct').textContent = account ?? 'not connected';
}

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
