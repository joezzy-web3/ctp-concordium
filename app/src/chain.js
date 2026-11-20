// Chain access for the app: the browser wallet for signing, a testnet gRPC-web
// node for reading the escrow contract and waiting for finalization.
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { AccountAddress, AccountTransactionType, CcdAmount, ContractAddress, Energy, ReceiveName, TransactionHash } from '@concordium/web-sdk';
import { ConcordiumGRPCWebClient } from '@concordium/web-sdk/grpc';
import { MODULE_SCHEMA_B64 } from '../../console/src/schema.js';
import { decodeConfig, decodeOrder, decodeSupplier, decodeDecision } from './codec.js';

export const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
export const ESCROW = { index: Number(globalThis.CTP_ESCROW ?? 13102), subindex: 0 };
export const AGENT = { id: 1287, badge: 'JyP9U25oUQ6KdnBBHdTYP', owner: '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG' };
const CONTRACT = ContractAddress.create(ESCROW.index, ESCROW.subindex);

// The contract's error variants in order; concordium-std gives the first one code -1.
const ERRORS = ['Parse', 'LogFull', 'LogMalformed', 'NotAdmin', 'NotSigner', 'NotSupplier', 'NotAgent', 'UnknownOrder', 'OrderExists', 'UnknownSupplier', 'SupplierExists', 'OrderClosed', 'ZeroAmount', 'BadHold', 'BadOrderSigners', 'NotOrderSigner', 'SignerNoLongerValid', 'AlreadyCommitted', 'NoInvoice', 'NotCommitted', 'AlreadyRevealed', 'WaitingForSecondRole', 'RevealDoesNotMatchCommit', 'InvoiceExists', 'TransferFailed', 'AgentNotVerified', 'RegistryUnavailable', 'PastDeadline', 'BadDate', 'AlreadyAccepted', 'OrderNotAccepted', 'RefundLocked', 'InvoiceApprovedBySupplier', 'RecountNotNeeded', 'NoRecountsLeft', 'NotPendingAdmin', 'NotOrderParty', 'DateChanged', 'ZeroQuantity', 'BadReferee', 'BadRep', 'NotReferee', 'NoDispute', 'NotOrderAgent', 'SamePerson'];
export const EXPLAIN = {
  NotAdmin: 'Only the buyer account can do this.',
  NotSigner: 'This account is not a listed signer.',
  NotSupplier: 'Only the supplier of this order can do this.',
  NotAgent: 'Only the registered agent that submitted the invoice can do this.',
  UnknownOrder: 'There is no order with this number.',
  OrderExists: 'An order with this number already exists.',
  UnknownSupplier: 'This supplier is not registered yet.',
  SupplierExists: 'This supplier is already registered.',
  OrderClosed: 'This order is already paid or refunded.',
  BadOrderSigners: 'The receiver and approver must be two different listed signers in those roles.',
  NotOrderSigner: 'Only the receiver and approver named on this order, and the supplier’s delivery rep, can count it.',
  SignerNoLongerValid: 'This signer was removed or changed role.',
  AlreadyCommitted: 'You already sealed a count for this order.',
  NoInvoice: 'No invoice has been submitted yet.',
  NotCommitted: 'Commit your count first.',
  AlreadyRevealed: 'You already revealed your count.',
  WaitingForSecondRole: 'Wait until the receiver and the supplier’s delivery rep have both sealed their counts.',
  RevealDoesNotMatchCommit: 'That count or key does not match the count you sealed.',
  InvoiceExists: 'An invoice was already submitted for this order.',
  ZeroAmount: 'Attach an amount to fund the order.',
  TransferFailed: 'The payout transfer failed.',
  AgentNotVerified: 'The Concordium agent registry does not show this agent as active and owned by this account.',
  RegistryUnavailable: 'The contract could not read the agent registry, so it refused to be safe. Try again.',
  PastDeadline: 'The latest date for delivery and invoice has passed. Nothing new can be added unless both sides agree a new date.',
  BadDate: 'Pick a date in the future.',
  AlreadyAccepted: 'You already accepted this order.',
  OrderNotAccepted: 'Accept the order first. Then you can approve its invoice.',
  RefundLocked: 'The supplier accepted this order, so the money is locked for it. You can take it back after the latest date if the order is not ready to pay and its delivery is not in dispute; a disputed delivery goes to the referee, or the supplier can release it.',
  InvoiceApprovedBySupplier: 'The supplier approved this invoice and it matches the order. Only the supplier can reject it now.',
  RecountNotNeeded: 'A recount is only possible once the receiver and the supplier’s rep have both sealed, and the delivery is not confirmed.',
  NoRecountsLeft: 'Both recounts are used. If the delivery is still short, the money goes back after the latest date.',
  NotPendingAdmin: 'Only the account proposed as the new buyer admin can accept.',
  NotOrderParty: 'Only the buyer or the supplier of this order can do this.',
  DateChanged: 'The date on this order changed. Reload and accept the current date.',
  ZeroQuantity: 'An order must be for at least one unit.',
  BadReferee: 'The referee must be someone other than the buyer, the supplier, the two counters and the agent.',
  BadRep: 'Your delivery rep must be someone other than the buyer, its counters, the referee and the agent. You can name your own account.',
  NotReferee: 'Only the referee named on this order can rule on it.',
  NoDispute: 'There is nothing to rule on: the supplier’s rep has not counted, or the counts already confirm the delivery.',
  NotOrderAgent: 'Only the agent named on this order can submit its invoice.',
  SamePerson: 'The receiver and the approver are proven to be the same person. Name two different people.',
};
export const errorName = (code) => ERRORS[-Number(code) - 1] ?? null;

export const node = new ConcordiumGRPCWebClient('https://grpc.testnet.concordium.com', 20000);

// ---------- wallet ----------
let provider = null;
let account = null;
const listeners = new Set();
export const onAccount = (fn) => { listeners.add(fn); fn(account); return () => listeners.delete(fn); };
const setAccount = (a) => { account = a; listeners.forEach((fn) => fn(a)); };
export const currentAccount = () => account;

export async function connect() {
  provider ??= await detectConcordiumProvider();
  const a = (await provider.requestAccounts())?.[0] ?? null;
  const chain = (await provider.getSelectedChain()) ?? '';
  if (!chain.startsWith(TESTNET_GENESIS_PREFIX)) {
    setAccount(null);
    throw new Error('Your wallet is on another network. Switch it to Concordium testnet.');
  }
  setAccount(a);
  if (!listening) {
    listening = true;
    provider.on?.('accountChanged', (x) => setAccount(x));
    provider.on?.('accountDisconnected', () => setAccount(null));
  }
  return a;
}
let listening = false;

/** On page load: reuse the account this site was already allowed, without a wallet prompt. */
export async function restore() {
  try {
    provider ??= await detectConcordiumProvider(1500);
    const a = await provider.getMostRecentlySelectedAccount?.();
    const chain = (await provider.getSelectedChain?.()) ?? '';
    if (!a || !chain.startsWith(TESTNET_GENESIS_PREFIX)) return null;
    setAccount(a);
    if (!listening) {
      listening = true;
      provider.on?.('accountChanged', (x) => setAccount(x));
      provider.on?.('accountDisconnected', () => setAccount(null));
    }
    return a;
  } catch {
    return null; // no wallet installed, or the site is not allowed yet: the Connect button handles it
  }
}

/** Waits for finalization; resolves to { ok, tx, reason }. Gives up waiting after `ms`, never on the transaction. */
export async function waitFinal(tx, ms = globalThis.CTP_WAIT_MS ?? 120000) {
  const limit = new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms));
  let item;
  try {
    item = await Promise.race([node.waitForTransactionFinalization(TransactionHash.fromHexString(tx), ms), limit]);
  } catch {
    return { ok: null, tx, reason: 'Could not confirm it from here yet. Check it on CCDScan.' };
  }
  const sum = item.summary;
  if (sum.type === 'accountTransaction' && sum.transactionType === 'failed') {
    const r = sum.rejectReason;
    const name = r?.tag === 'RejectedReceive' ? errorName(r.rejectReason) : null;
    return { ok: false, tx, reason: name ? (EXPLAIN[name] ?? `Refused by the contract (${name}).`) : `Refused by the chain (${r?.tag ?? 'unknown reason'}).` };
  }
  return { ok: true, tx, events: escrowEvents(sum) };
}

/** Raw bytes of every event our escrow logged in a transaction (before and after any transfer). */
function escrowEvents(sum) {
  const out = [];
  for (const e of sum?.events ?? []) {
    if ((e.tag === 'Updated' || e.tag === 'Interrupted') && Number(e.address?.index) === ESCROW.index && Number(e.address?.subindex) === ESCROW.subindex) {
      for (const ev of e.events ?? []) out.push(new Uint8Array(ev.buffer));
    }
  }
  return out;
}

/** Decision events in a list of raw escrow events. */
export async function decisionsIn(events) {
  const out = [];
  for (const b of events) {
    const d = await decodeDecision(b).catch(() => null);
    if (d) out.push(d);
  }
  return out;
}

/** Reads a finalized transaction from the node and returns the escrow Decision events in it. */
export async function decisionsInTx(tx) {
  if (!/^[0-9a-f]{64}$/i.test(String(tx).trim())) throw new Error('A transaction hash is 64 hex characters.');
  const st = await node.getBlockItemStatus(TransactionHash.fromHexString(String(tx).trim().toLowerCase()));
  if (st?.status !== 'finalized') throw new Error('That transaction is not finalized (or not found) on testnet.');
  const sum = st.outcome?.summary;
  if (sum?.type !== 'accountTransaction' || sum.transactionType === 'failed') throw new Error('That transaction did not update the escrow.');
  return decisionsIn(escrowEvents(sum));
}

/** Sends one escrow call through the wallet. The wallet shows every field by name (module schema). */
export async function send(entrypoint, params, microCcd = 0n) {
  await connect();
  if (!account) throw new Error('Connect your wallet first.');
  return provider.sendTransaction(
    account,
    AccountTransactionType.Update,
    { amount: CcdAmount.fromMicroCcd(microCcd), address: CONTRACT, receiveName: ReceiveName.fromString(`ctp_escrow.${entrypoint}`), maxContractExecutionEnergy: Energy.create(30000) },
    params,
    { type: 'module', value: MODULE_SCHEMA_B64 },
  );
}

// ---------- reads ----------
async function view(method, paramBytes) {
  const res = await node.invokeContract({
    contract: CONTRACT,
    method: ReceiveName.fromString(`ctp_escrow.${method}`),
    // The gRPC client only reads `.buffer` (Parameter.toProto); importing Parameter itself
    // would pull in a 680 KB schema engine we do not need.
    parameter: { buffer: paramBytes ?? new Uint8Array(0) },
    energy: Energy.create(100000),
  });
  if (!res) throw new Error('The node could not run the query.');
  if (res.tag !== 'success') {
    const name = res.reason?.tag === 'RejectedReceive' ? errorName(res.reason.rejectReason) : null;
    const e = new Error(name ? EXPLAIN[name] ?? name : 'The contract refused the query.');
    e.code = name;
    throw e;
  }
  return res.returnValue.buffer;
}
/**
 * Dry-runs one escrow entrypoint as `invoker` on the live state: the node runs the real
 * contract code, but nothing is sent, signed or paid. Used by Judge mode.
 * Returns { ok:true, returnValue, events } or { ok:false, error, explain }.
 */
export async function simulate(entrypoint, paramBytes, invoker) {
  const res = await node.invokeContract({
    contract: CONTRACT,
    invoker: AccountAddress.fromBase58(invoker),
    method: ReceiveName.fromString(`ctp_escrow.${entrypoint}`),
    parameter: { buffer: paramBytes ?? new Uint8Array(0) },
    energy: Energy.create(100000),
  });
  if (!res) throw new Error('The node could not run the dry run.');
  if (res.tag === 'success') return { ok: true, returnValue: res.returnValue?.buffer ?? new Uint8Array(0), events: escrowEvents({ events: res.events }), energy: Number(res.usedEnergy?.value ?? 0) };
  const name = res.reason?.tag === 'RejectedReceive' ? errorName(res.reason.rejectReason) : null;
  return { ok: false, error: name ?? res.reason?.tag ?? 'Rejected', explain: name ? EXPLAIN[name] ?? name : 'The chain rejected it.', energy: Number(res.usedEnergy?.value ?? 0) };
}

const u64le = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const acctBytes = (a) => AccountAddress.fromBase58(a).decodedAddress;

export const viewConfig = async () => decodeConfig(await view('view_config'));
export const viewOrder = async (id) => decodeOrder(await view('view_order', u64le(id)));
export async function viewSupplier(addr) {
  try {
    return await decodeSupplier(await view('view_supplier', acctBytes(addr)));
  } catch (e) {
    if (e.code === 'UnknownSupplier') return null;
    throw e;
  }
}

/** Every order so far, by scanning ids from 1 until three in a row are missing. */
export async function listOrders(max = 200) {
  const out = [];
  let misses = 0;
  for (let id = 1; id <= max && misses < 3; id++) {
    try {
      out.push({ id, ...(await viewOrder(id)) });
      misses = 0;
    } catch (e) {
      if (e.code !== 'UnknownOrder') throw e;
      misses++;
    }
  }
  return out;
}

export const ccdscanTx = (tx) => `https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=${tx}`;
