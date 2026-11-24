// Node client for the escrow contract, used by the MCP server. Reads and dry runs need no
// key. Sending signs with the agent's own account key, read from a wallet export file
// whose path comes from the environment. The key never leaves this process and is never
// printed or returned.
import { readFileSync, statSync } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import {
  AccountAddress, AccountTransactionType, CcdAmount, ContractAddress, Energy, Parameter, ReceiveName,
  TransactionExpiry, TransactionHash, buildAccountSigner, buildBasicAccountSigner, parseWallet, signTransaction,
} from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';
import { decodeConfig, decodeOrder, decodeSupplier, decodeDecision } from '../app/src/codec.js';
import { EXPLAIN, errorName } from '../app/src/errors.js';

export const NODE = { host: 'grpc.testnet.concordium.com', port: 20000 };

export const u64le = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
export const hex32 = (h) => {
  if (!/^[0-9a-f]{64}$/i.test(h)) throw new Error('Expected a SHA-256 fingerprint (64 hex characters).');
  return Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
};
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

/** Parameter bytes, written against the contract's InvoiceParams and ExecuteParams. */
export const invoiceParams = (orderId, invoiceHash, micro) => cat(u64le(orderId), hex32(invoiceHash), u64le(micro));
export const executeParams = (orderId, receiptHash) => cat(u64le(orderId), hex32(receiptHash));

const rejection = (reason) => {
  const name = reason?.tag === 'RejectedReceive' ? errorName(reason.rejectReason) : null;
  return { error: name ?? reason?.tag ?? 'Rejected', explain: name ? EXPLAIN[name] ?? name : 'The chain rejected it.' };
};

/** Raw bytes of every event the escrow logged, from a dry run or a transaction summary. */
export function escrowEvents(events, escrow) {
  const out = [];
  for (const e of events ?? []) {
    if ((e.tag === 'Updated' || e.tag === 'Interrupted') && Number(e.address?.index) === escrow.index && Number(e.address?.subindex) === escrow.subindex) {
      for (const ev of e.events ?? []) out.push(new Uint8Array(ev.buffer));
    }
  }
  return out;
}

export async function decisionsIn(raw) {
  const out = [];
  for (const b of raw) { const d = await decodeDecision(b).catch(() => null); if (d) out.push(d); }
  return out;
}

/** Public key (hex) of a raw Ed25519 private key given as 64 hex characters. */
export function publicKeyOf(hex) {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(hex, 'hex')]);
  return createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
}

/**
 * Loads the agent's signer. Accepts a Concordium wallet export file, or a file holding only
 * the private key the wallet lets you copy (64 hex characters). A wallet export must be for
 * the agent account; a bare key is checked against the account's on-chain keys before any
 * send (see send below).
 */
export function loadAgentSigner(path, expectedAddress) {
  if (!path) throw new Error('CTP_AGENT_KEY_FILE is not set, so this server can read and dry-run but not send.');
  let raw;
  // The key file must not be readable by other users (audit 24 Nov L3). Windows files, and
  // Windows drives seen from WSL (/mnt/c/...), have no Unix permissions to check.
  if (process.platform !== 'win32' && !/^\/mnt\/[a-z]\//i.test(path)) {
    let mode;
    try { mode = statSync(path).mode; } catch { throw new Error('Could not read the agent key file.'); }
    if (mode & 0o077) throw new Error(`The agent key file can be read by other users on this computer. Run: chmod 600 "${path}" (and keep it out of synced folders such as Google Drive or OneDrive). Nothing was sent.`);
  }
  try { raw = readFileSync(path, 'utf8').trim(); } catch { throw new Error('Could not read the agent key file.'); }
  if (/^[0-9a-f]{64}$/i.test(raw)) return { address: expectedAddress, signer: buildBasicAccountSigner(raw), publicKey: publicKeyOf(raw) };
  let wallet;
  try { wallet = parseWallet(raw); } catch { throw new Error('The agent key file is neither a Concordium wallet export nor a 64-character private key.'); }
  if (wallet.value.address !== expectedAddress) throw new Error(`The key file is for ${wallet.value.address.slice(0, 6)}…, not the agent account ${expectedAddress.slice(0, 6)}…. Nothing was sent.`);
  return { address: wallet.value.address, signer: buildAccountSigner(wallet), publicKey: null };
}

/** Every verify key in an account's credentials, as lowercase hex. */
export function accountVerifyKeys(info) {
  const out = new Set();
  const walk = (v) => { if (!v || typeof v !== 'object') return; if (typeof v.verifyKey === 'string') out.add(v.verifyKey.toLowerCase()); for (const x of Object.values(v)) walk(x); };
  walk(info?.accountCredentials);
  return out;
}

export function createEscrow({ escrow, agent, keyFile, client, verifiedModules } = {}) {
  const node = client ?? new ConcordiumGRPCNodeClient(NODE.host, NODE.port, credentials.createSsl(), { timeout: 15000 });
  const contract = ContractAddress.create(escrow.index, escrow.subindex);
  const method = (m) => ReceiveName.fromString(`ctp_escrow.${m}`);

  async function view(m, bytes) {
    const res = await node.invokeContract({ contract, method: method(m), parameter: Parameter.fromBuffer(bytes ?? new Uint8Array(0)), energy: Energy.create(100000) });
    if (res?.tag !== 'success') { const r = rejection(res?.reason); const e = new Error(r.explain); e.code = r.error; throw e; }
    return res.returnValue.buffer;
  }

  /** Runs the real contract code on live state as `invoker`. Nothing is signed, sent or paid. */
  async function simulate(m, bytes, invoker = agent.owner) {
    const res = await node.invokeContract({ contract, invoker: AccountAddress.fromBase58(invoker), method: method(m), parameter: Parameter.fromBuffer(bytes), energy: Energy.create(100000) });
    if (res?.tag === 'success') return { ok: true, decisions: await decisionsIn(escrowEvents(res.events, escrow)), energy: Number(res.usedEnergy?.value ?? 0) };
    return { ok: false, ...rejection(res?.reason), energy: Number(res?.usedEnergy?.value ?? 0) };
  }

  /** Refuses to sign for a contract that is not a Clear to Pay escrow running the verified
   *  code (audit 24 Nov L1). Checked once, before the first transaction. */
  let verified = null;
  async function ensureVerified() {
    if (!verifiedModules) return;
    verified ??= (async () => {
      const info = await node.getInstanceInfo(contract);
      const ref = String(info?.sourceModule?.moduleRef ?? info?.sourceModule ?? '').toLowerCase();
      const name = String(info?.name?.value ?? info?.name ?? '');
      if (!verifiedModules.includes(ref) || !name.endsWith('ctp_escrow')) throw new Error(`Escrow <${escrow.index},${escrow.subindex}> is not running the verified Clear to Pay code, so this agent will not sign for it. Nothing was sent.`);
    })();
    try { await verified; } catch (e) { verified = null; throw e; }
  }

  /** Signs as the agent and sends; waits for finalization. */
  async function send(m, bytes, energy) {
    await ensureVerified();
    const { address, signer, publicKey } = loadAgentSigner(keyFile, agent.owner);
    const sender = AccountAddress.fromBase58(address);
    if (publicKey && !accountVerifyKeys(await node.getAccountInfo(sender)).has(publicKey)) {
      throw new Error(`That private key does not belong to the agent account ${address.slice(0, 6)}…. Nothing was sent.`);
    }
    const { nonce } = await node.getNextAccountNonce(sender);
    const tx = {
      type: AccountTransactionType.Update,
      header: { sender, nonce, expiry: TransactionExpiry.futureMinutes(5) },
      payload: { amount: CcdAmount.zero(), address: contract, receiveName: method(m), message: Parameter.fromBuffer(bytes), maxContractExecutionEnergy: Energy.create(Math.max(5000, Math.ceil(energy * 1.5) + 1000)) },
    };
    const hash = await node.sendAccountTransaction(tx, await signTransaction(tx, signer));
    const tx64 = TransactionHash.toHexString(hash);
    const item = await node.waitForTransactionFinalization(hash, 120000);
    const sum = item.summary;
    if (sum.type === 'accountTransaction' && sum.transactionType === 'failed') return { ok: false, tx: tx64, ...rejection(sum.rejectReason) };
    return { ok: true, tx: tx64, decisions: await decisionsIn(escrowEvents(sum.events, escrow)) };
  }

  async function listOrders(max = 200) {
    const out = [];
    let misses = 0;
    for (let id = 1; id <= max && misses < 3; id++) {
      try { out.push({ id, ...(await decodeOrder(await view('view_order', u64le(id)))) }); misses = 0; } catch (e) { if (e.code !== 'UnknownOrder') throw e; misses++; }
    }
    return out;
  }

  return {
    escrow, agent,
    canSend: Boolean(keyFile),
    viewConfig: async () => decodeConfig(await view('view_config')),
    viewOrder: async (id) => ({ id, ...(await decodeOrder(await view('view_order', u64le(id)))) }),
    viewSupplier: async (addr) => { try { return await decodeSupplier(await view('view_supplier', AccountAddress.fromBase58(addr).decodedAddress)); } catch (e) { if (e.code === 'UnknownSupplier') return null; throw e; } },
    listOrders, simulate, send,
    /** Throws unless the escrow runs a verified Clear to Pay module (needs verifiedModules). */
    checkVerified: ensureVerified,
  };
}
