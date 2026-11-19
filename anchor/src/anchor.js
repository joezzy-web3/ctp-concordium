// Anchor a Clear to Pay receipt on Concordium testnet with RegisterData.
// The page recomputes the receipt hash itself from the pasted receipt, so
// what gets anchored is always the hash of exactly what you see.
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { DataBlob } from '@concordium/web-sdk/types';

const REGISTER_DATA = 21; // AccountTransactionType.RegisterData in @concordium/web-sdk 12
import { anchorDataHex, receiptHash, validateReceipt, SCHEMA } from '../../receipt/receipt.js';

const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
const OWNER = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG'; // owner of Agent #1287

import { say, code, bold, br, txLink } from '../../ui/say.js';

const $ = (id) => document.getElementById(id);

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
    say('bad', 'Not a Clear to Pay receipt (schema must be ', code(SCHEMA), ').');
    return;
  }
  const problems = validateReceipt(receipt);
  if (problems.length) {
    say('bad', `Receipt refused: ${problems.join('; ')}`);
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
    say('bad', `Receipt rejected: ${e.message}`);
  }
}

async function connect() {
  provider = await detectConcordiumProvider();
  const accounts = await provider.requestAccounts();
  account = accounts?.[0] ?? null;
  $('acct').textContent = account ?? 'none';
  const chain = (await provider.getSelectedChain()) ?? '';
  if (!chain.startsWith(TESTNET_GENESIS_PREFIX)) { account = null; say('bad', 'Your wallet is not on ', bold('testnet'), '.'); return; }
  if (account !== OWNER) { account = null; say('bad', 'Select the Agent #1287 owner account ', code('44Fc…iWeG'), ' in the wallet.'); return; }
  if (dataHex) say('info', 'Ready. Press ', bold('Sign and anchor'), '.'); else say('info', 'Wallet ready. Now paste and check a receipt.');
  $('send').disabled = !dataHex;
}

async function send() {
  if (!dataHex || !account) return; // nothing checked or no wallet: never send
  $('send').disabled = true;
  try {
    const bytes = Uint8Array.from(dataHex.match(/../g).map((h) => parseInt(h, 16)));
    const txHash = await provider.sendTransaction(account, REGISTER_DATA, { data: new DataBlob(bytes.buffer) });
    say('ok', 'Anchored. Transaction ', code(txHash), br(), 'On-chain data: ', code(dataHex), br(), txLink(txHash));
  } catch (e) {
    say('bad', `Not sent: ${e?.message ?? e}`);
    $('send').disabled = false;
  }
}

$('check').onclick = () => check();
$('connect').onclick = () => connect().catch((e) => say('bad', String(e.message ?? e)));
$('send').onclick = send;
