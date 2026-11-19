// Chain access for the app: the browser wallet for signing, a testnet gRPC-web
// node for reading the escrow contract and waiting for finalization.
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { AccountAddress, AccountTransactionType, CcdAmount, ContractAddress, Energy, Parameter, ReceiveName, TransactionHash } from '@concordium/web-sdk';
import { ConcordiumGRPCWebClient } from '@concordium/web-sdk/grpc';
import { MODULE_SCHEMA_B64 } from '../../console/src/schema.js';
import { decodeConfig, decodeOrder, decodeSupplier } from './codec.js';

export const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
export const ESCROW = { index: 13092, subindex: 0 };
export const AGENT = { id: 1287, badge: 'JyP9U25oUQ6KdnBBHdTYP', owner: '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG' };
const CONTRACT = ContractAddress.create(ESCROW.index, ESCROW.subindex);

// The contract's error variants in order; concordium-std gives the first one code -1.
const ERRORS = ['Parse', 'LogFull', 'LogMalformed', 'NotAdmin', 'NotSigner', 'NotSupplier', 'NotAgent', 'UnknownOrder', 'OrderExists', 'UnknownSupplier', 'SupplierExists', 'OrderClosed', 'ZeroAmount', 'BadHold', 'BadOrderSigners', 'NotOrderSigner', 'SignerNoLongerValid', 'AlreadyCommitted', 'NoInvoice', 'NotCommitted', 'AlreadyRevealed', 'WaitingForSecondRole', 'RevealDoesNotMatchCommit', 'InvoiceExists', 'TransferFailed'];
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
  NotOrderSigner: 'Only the receiver and approver named on this order can count it.',
  SignerNoLongerValid: 'This signer was removed or changed role.',
  AlreadyCommitted: 'You already committed a count for this order.',
  NoInvoice: 'No invoice has been submitted yet.',
  NotCommitted: 'Commit your count first.',
  AlreadyRevealed: 'You already revealed your count.',
  WaitingForSecondRole: 'Wait until both signers have committed.',
  RevealDoesNotMatchCommit: 'That count or salt is not what you committed.',
  InvoiceExists: 'An invoice was already submitted for this order.',
  ZeroAmount: 'Attach an amount to fund the order.',
  TransferFailed: 'The payout transfer failed.',
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
  return { ok: true, tx };
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
    parameter: Parameter.fromBuffer(paramBytes ?? new Uint8Array(0)),
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
