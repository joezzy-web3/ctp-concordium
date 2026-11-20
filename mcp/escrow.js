// Node client for the escrow contract, used by the MCP server. Reads and dry runs need no
// key. Sending signs with the agent's own account key, read from a wallet export file
// whose path comes from the environment. The key never leaves this process and is never
// printed or returned.
import { readFileSync } from 'node:fs';
import {
  AccountAddress, AccountTransactionType, CcdAmount, ContractAddress, Energy, Parameter, ReceiveName,
  TransactionExpiry, TransactionHash, buildAccountSigner, parseWallet, signTransaction,
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

/** Loads the agent's signer from a wallet export file. Refuses a file for any other account. */
export function loadAgentSigner(path, expectedAddress) {
  if (!path) throw new Error('CTP_AGENT_KEY_FILE is not set, so this server can read and dry-run but not send.');
  let wallet;
  try { wallet = parseWallet(readFileSync(path, 'utf8')); } catch { throw new Error('Could not read the agent key file as a Concordium wallet export.'); }
  if (wallet.value.address !== expectedAddress) throw new Error(`The key file is for ${wallet.value.address.slice(0, 6)}…, not the agent account ${expectedAddress.slice(0, 6)}…. Nothing was sent.`);
  return { address: wallet.value.address, signer: buildAccountSigner(wallet) };
}

export function createEscrow({ escrow, agent, keyFile, client } = {}) {
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

  /** Signs as the agent and sends; waits for finalization. */
  async function send(m, bytes, energy) {
    const { address, signer } = loadAgentSigner(keyFile, agent.owner);
    const sender = AccountAddress.fromBase58(address);
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
  };
}
