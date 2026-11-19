// Anchor a Clear to Pay receipt on Concordium testnet with RegisterData.
// The page recomputes the receipt hash itself from the pasted receipt, so
// what gets anchored is always the hash of exactly what you see.
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { DataBlob } from '@concordium/web-sdk/types';

const REGISTER_DATA = 21; // AccountTransactionType.RegisterData in @concordium/web-sdk 12
import { anchorDataHex, receiptHash, SCHEMA } from '../../receipt/receipt.js';

const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
const OWNER = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG'; // owner of Agent #1287

const $ = (id) => document.getElementById(id);
const say = (cls, html) => { $('out').innerHTML = `<div class="msg ${cls}">${html}</div>`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let provider = null;
let account = null;
let dataHex = null;

async function check() {
  dataHex = null;
  $('send').disabled = true;
  let receipt;
  try {
    receipt = JSON.parse($('receipt').value);
  } catch {
    say('bad', 'That is not valid JSON. Paste the whole receipt file.');
    return;
  }
  if (receipt?.schema !== SCHEMA) {
    say('bad', `Not a Clear to Pay receipt (schema must be <code>${SCHEMA}</code>).`);
    return;
  }
  try {
    const hash = await receiptHash(receipt);
    dataHex = await anchorDataHex(receipt);
    $('rhash').textContent = hash;
    $('rverdict').textContent = `${receipt.decision?.verdict} ${(receipt.decision?.codes ?? []).join(', ')}`;
    $('rinvoice').textContent = `${receipt.invoice?.id} · ${receipt.invoice?.amount} ${receipt.invoice?.currency} · ${receipt.invoice?.supplier}`;
    say('info', 'Receipt checked. Connect the wallet, then sign.');
    $('send').disabled = !account;
  } catch (e) {
    say('bad', `Receipt rejected: ${esc(e.message)}`);
  }
}

async function connect() {
  provider = await detectConcordiumProvider();
  const accounts = await provider.requestAccounts();
  account = accounts?.[0] ?? null;
  $('acct').textContent = account ?? 'none';
  const chain = (await provider.getSelectedChain()) ?? '';
  if (!chain.startsWith(TESTNET_GENESIS_PREFIX)) { account = null; say('bad', 'Your wallet is not on <b>testnet</b>.'); return; }
  if (account !== OWNER) { account = null; say('bad', 'Select the Agent #1287 owner account <code>44Fc…iWeG</code> in the wallet.'); return; }
  say('info', dataHex ? 'Ready. Press <b>Sign and anchor</b>.' : 'Wallet ready. Now paste and check a receipt.');
  $('send').disabled = !dataHex;
}

async function send() {
  $('send').disabled = true;
  try {
    const bytes = Uint8Array.from(dataHex.match(/../g).map((h) => parseInt(h, 16)));
    const txHash = await provider.sendTransaction(account, REGISTER_DATA, { data: new DataBlob(bytes.buffer) });
    say('ok', `Anchored. Transaction <code>${esc(txHash)}</code><br>On-chain data: <code>${dataHex}</code><br><a href="https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=${encodeURIComponent(txHash)}" target="_blank" rel="noopener">View on testnet CCDScan</a>`);
  } catch (e) {
    say('bad', `Not sent: ${esc(e?.message ?? e)}`);
    $('send').disabled = false;
  }
}

$('check').onclick = () => check();
$('connect').onclick = () => connect().catch((e) => say('bad', esc(e.message ?? e)));
$('send').onclick = send;
