// Chain access for the app: the browser wallet for signing, a testnet gRPC-web
// node for reading the escrow contract and waiting for finalization.
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { AccountAddress, AccountTransactionType, CcdAmount, ContractAddress, ContractName, DataBlob, Energy, ModuleReference, ReceiveName, TransactionHash } from '@concordium/web-sdk';
import { ConcordiumGRPCWebClient } from '@concordium/web-sdk/grpc';
import { MODULE_SCHEMA_B64 } from '../../console/src/schema.js';
import { decodeConfig, decodeOrder, decodeSupplier, decodeDecision } from './codec.js';

export const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
const DEFAULT_ESCROW = Number(globalThis.CTP_ESCROW ?? 13155);
/** The demo escrow anyone can walk through with the demo cast. */
export const DEMO_ESCROW = 13155;
/** Modules built from this repo's verifiable build. An escrow on any other module is refused. */
export const VERIFIED_MODULES = [
  '67e4c0b60ea3945b594ca3ddd32f1287ae89d2eec399827bc3f8ee7eeff1db6e', // v8 with its source link (release escrow-v8-src1)
  '36764425bd13f1556df3d1ffb1f7d0c91edda6ba2066e390d524fb9a4992cc04', // the same v8 build before the link
  'd6d99ee4b4c8c7b71e00f06aa4b410bb0552871392439f528da6183a56f58d5b', // v7 with its source link (release escrow-v7-src1)
  'f36a55cc8d528d97decba0acfadba11f2e1d0b8c01be57c0f4b7a7b87513c735', // the same v7 build before the link
];
/** The module new escrows are created from. */
export const ESCROW_MODULE = VERIFIED_MODULES[0];
const ESCROW_KEY = 'ctp:escrow';
const validIndex = (v) => /^\d{1,12}$/.test(String(v ?? '').trim());
function pickEscrow() {
  let q = null;
  try { q = new URLSearchParams(globalThis.location?.search ?? '').get('escrow'); } catch { /* no URL */ }
  if (validIndex(q)) { try { localStorage.setItem(ESCROW_KEY, String(Number(q))); } catch { /* storage unavailable */ } return Number(q); }
  let saved = null;
  try { saved = localStorage.getItem(ESCROW_KEY); } catch { /* storage unavailable */ }
  return validIndex(saved) ? Number(saved) : DEFAULT_ESCROW;
}
export const ESCROW = { index: pickEscrow(), subindex: 0 };
export const isDemo = ESCROW.index === DEMO_ESCROW;

/** Switch the app to another escrow (a full reload, so nothing from the old one lingers). */
export function openEscrow(index, hash = '#/buyer') {
  try { localStorage.setItem(ESCROW_KEY, String(index)); } catch { /* storage unavailable */ }
  const u = new URL(location.href);
  u.searchParams.set('escrow', String(index));
  u.hash = hash;
  location.href = u.toString();
}

/** Is this contract a Clear to Pay escrow running verified code? */
export async function checkEscrow(index) {
  try {
    const limit = new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 10000));
    const info = await Promise.race([node.getInstanceInfo(ContractAddress.create(index, 0)), limit]);
    const ref = String(info?.sourceModule?.moduleRef ?? info?.sourceModule ?? '').toLowerCase();
    const name = String(info?.name?.value ?? info?.name ?? '');
    if (!VERIFIED_MODULES.includes(ref) || !name.endsWith('ctp_escrow')) return { ok: false, reason: 'This contract is not a Clear to Pay escrow running the verified code.' };
    return { ok: true, admin: null };
  } catch {
    return { ok: false, reason: 'Could not find a contract at that address on testnet (or could not reach testnet). Check the number and your connection.' };
  }
}
export const AGENT = { id: 1287, badge: 'JyP9U25oUQ6KdnBBHdTYP', owner: '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG' };
const CONTRACT = ContractAddress.create(ESCROW.index, ESCROW.subindex);

export { ERRORS, EXPLAIN, errorName } from './errors.js';
import { EXPLAIN, errorName } from './errors.js';

export const node = new ConcordiumGRPCWebClient('https://grpc.testnet.concordium.com', 20000);

// ---------- wallet ----------
let provider = null;
let account = null;
const listeners = new Set();
export const onAccount = (fn) => { listeners.add(fn); fn(account); return () => listeners.delete(fn); };
const setAccount = (a) => { account = a; listeners.forEach((fn) => fn(a)); };
export const currentAccount = () => account;

const LOGGED_OUT = 'ctp:loggedOut';
const remember = (out) => { try { if (out) localStorage.setItem(LOGGED_OUT, '1'); else localStorage.removeItem(LOGGED_OUT); } catch { /* storage unavailable */ } };
const loggedOut = () => { try { return localStorage.getItem(LOGGED_OUT) === '1'; } catch { return false; } };

const ACTIVE = 'ctp:activeAccount';
const chosen = () => { try { return localStorage.getItem(ACTIVE); } catch { return null; } };
const choose = (a) => { try { if (a) localStorage.setItem(ACTIVE, a); else localStorage.removeItem(ACTIVE); } catch { /* storage unavailable */ } };

function listen() {
  if (listening) return;
  listening = true;
  // Switching accounts in the wallet extension still works: the page follows it.
  provider.on?.('accountChanged', (x) => { if (!loggedOut()) { choose(x); setAccount(x); } });
  provider.on?.('accountDisconnected', (x) => { if (!x || x === account) setAccount(null); });
}

/**
 * Connects, or keeps the account already in use. Which account: the one in use if this site may
 * still use it, else the one picked in our account menu, else the one selected in the wallet,
 * else the first this site may use.
 */
export async function connect() {
  provider ??= await detectConcordiumProvider();
  const connected = (await provider.requestAccounts()) ?? [];
  const recent = await provider.getMostRecentlySelectedAccount?.();
  const pick = [account, chosen(), recent].find((x) => x && connected.includes(x)) ?? connected[0] ?? null;
  remember(false);
  const chain = (await provider.getSelectedChain()) ?? '';
  if (!chain.startsWith(TESTNET_GENESIS_PREFIX)) {
    setAccount(null);
    throw new Error('Your wallet is on another network. Switch it to Concordium testnet.');
  }
  setAccount(pick);
  listen();
  return pick;
}

/** Every account this site may use, without a wallet prompt once the site is approved. */
export async function connectedAccounts() {
  provider ??= await detectConcordiumProvider();
  return (await provider.requestAccounts()) ?? [];
}

/** Act as another account this site may use (from the account menu). */
export async function useAccount(a) {
  const connected = await connectedAccounts();
  if (!connected.includes(a)) throw new Error('That account is not connected to this site yet.');
  remember(false);
  choose(a);
  setAccount(a);
  listen();
  return a;
}
let listening = false;

/**
 * Log out of this page: it stops using the account until you connect again. A page cannot
 * revoke its own permission in the wallet; that stays in the wallet's connected-sites list.
 */
export function logout() {
  remember(true);
  choose(null);
  setAccount(null);
}

/** On page load: reuse the account this site was already allowed, without a wallet prompt. */
export async function restore() {
  try {
    provider ??= await detectConcordiumProvider(1500);
    if (loggedOut()) return null;
    const recent = await provider.getMostRecentlySelectedAccount?.();
    const chain = (await provider.getSelectedChain?.()) ?? '';
    if (!recent || !chain.startsWith(TESTNET_GENESIS_PREFIX)) return null;
    // The site is approved (the wallet named a connected account), so this does not prompt.
    const connected = (await provider.requestAccounts?.()) ?? [recent];
    const a = [chosen(), recent].find((x) => x && connected.includes(x)) ?? recent;
    setAccount(a);
    listen();
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
  try {
    return await provider.sendTransaction(
      account,
      AccountTransactionType.Update,
      { amount: CcdAmount.fromMicroCcd(microCcd), address: CONTRACT, receiveName: ReceiveName.fromString(`ctp_escrow.${entrypoint}`), maxContractExecutionEnergy: Energy.create(30000) },
      params,
      { type: 'module', value: MODULE_SCHEMA_B64 },
    );
  } catch (e) {
    throw await withSwitchHint(e);
  }
}

/** If the wallet refused while another account is selected in it, say how to fix it. */
async function withSwitchHint(e) {
  if (/already open/i.test(String(e?.message ?? e))) return new Error('The wallet already has a request open. Open the Concordium Wallet, finish or reject it, then try again.');
  const recent = await provider.getMostRecentlySelectedAccount?.().catch(() => null);
  if (!recent || recent === account || /reject|cancel|denied|closed|already open|prompt/i.test(String(e?.message ?? e))) return e;
  const err = new Error(`${String(e?.message ?? e).replace(/\.?$/, '.')} If the wallet only signs for the account selected in it, select ${account.slice(0, 4)}…${account.slice(-4)} in the Concordium Wallet and try again.`);
  err.cause = e;
  return err;
}

// ---------- wallet: ID checks (F-01) ----------
/** Records small data on-chain from the connected account (RegisterData) and waits for it. */
const INIT_SCHEMA_B64 = 'FAACAAAABwAAAGhvbGRfbXMFCAAAAHJlZ2lzdHJ5DA==';
const REGISTRY = { index: 12802, subindex: 0 }; // CIS-8004 Agent Registry on testnet
/** Create a new escrow from the verified module. The connected account becomes its buyer admin. */
export async function createEscrow(holdMs) {
  if (!provider || !account) await connect();
  let tx;
  try {
    tx = await provider.sendTransaction(account, AccountTransactionType.InitContract,
      { amount: CcdAmount.zero(), moduleRef: ModuleReference.fromHexString(ESCROW_MODULE), initName: ContractName.fromString('ctp_escrow'), maxContractExecutionEnergy: Energy.create(30000) },
      { hold_ms: holdMs, registry: REGISTRY }, { type: 'parameter', value: INIT_SCHEMA_B64 });
  } catch (e) {
    return { ok: false, reason: (await withSwitchHint(e))?.message ?? String(e) };
  }
  const limit = new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 180000));
  try {
    const item = await Promise.race([node.waitForTransactionFinalization(TransactionHash.fromHexString(tx), 180000), limit]);
    const sum = item.summary;
    const addr = sum?.contractInitialized?.address ?? (sum?.events ?? []).find((e) => e.address)?.address;
    if (sum?.transactionType === 'failed' || !addr) return { ok: false, tx, reason: 'The chain did not create the escrow. Check it on CCDScan.' };
    return { ok: true, tx, index: Number(addr.index) };
  } catch {
    return { ok: null, tx, reason: 'Sent, but not confirmed from here yet. Find the new contract on CCDScan, then open it below.' };
  }
}

export async function registerData(bytes) {
  await connect();
  if (!account) throw new Error('Connect your wallet first.');
  if (bytes.length > 256) throw new Error('That record is larger than the chain allows.');
  let tx;
  try {
    tx = await provider.sendTransaction(account, AccountTransactionType.RegisterData, { data: new DataBlob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)) });
  } catch (e) { throw await withSwitchHint(e); }
  const fin = await waitFinal(tx);
  if (!fin.ok) throw new Error(fin.reason ?? 'The record did not finalize.');
  return tx;
}
/** The connected account signs a fixed text message (moves nothing, costs nothing). */
export async function signText(message) {
  await connect();
  if (!account) throw new Error('Connect your wallet first.');
  try { return await provider.signMessage(account, message); } catch (e) { throw await withSwitchHint(e); }
}
/** The wallet answers a proof request with a zero-knowledge presentation. */
export async function requestProof(request) {
  await connect();
  if (!account) throw new Error('Connect your wallet first.');
  return provider.requestVerifiablePresentationV1(request);
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
