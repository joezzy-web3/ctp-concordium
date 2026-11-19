// Sends the two link transactions prepared by link/prepare.mjs (read from ./bundle.json).
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { AccountTransactionType, CcdAmount, ContractAddress, ReceiveName, Energy } from '@concordium/web-sdk';

const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
const OWNER = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
const BUNDLE_SHA256 = 'ee584a29e24a8c6aede026f8e1f62f47f0fceb8b5e47363e44bc0f6baac6a583';
const ALLOWED = [
  { index: 12801, entry: 'registerExternalKey' },
  { index: 12802, entry: 'setExternalReference' },
];
import { say, code, bold, br, txLink } from '../../ui/say.js';

const $ = (id) => document.getElementById(id);

let bundle = null;
let provider = null;
let account = null;

async function load() {
  const res = await fetch('bundle.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('bundle.json not found: run link/prepare.mjs and push it first');
  // Pinned (audit F-10): the page accepts only the exact bundle that was signed and sent
  // on 19 Nov 2026. A changed bundle.json on the server cannot make it show or sign anything else.
  const raw = new Uint8Array(await res.arrayBuffer());
  const got = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (got !== BUNDLE_SHA256) throw new Error('bundle.json is not the pinned bundle; refusing to continue');
  bundle = JSON.parse(new TextDecoder().decode(raw));
  if (bundle.owner !== OWNER || bundle.network !== 'testnet') throw new Error('bundle is not for Agent #1287 on testnet');
  bundle.txs.forEach((t, i) => {
    const ok = ALLOWED[i] && t.contract.index === ALLOWED[i].index && t.contract.subindex === 0 && t.receive_name.endsWith('.' + ALLOWED[i].entry);
    if (!ok) throw new Error(`transaction ${i + 1} is not the expected one`);
  });
  $('near').textContent = `${bundle.near.account} · ${bundle.near.public_key}`;
  $('ns').textContent = `${bundle.near.namespace} · ${bundle.near.key_type} · scheme ${bundle.proof.scheme}`;
  $('sig').textContent = bundle.proof.signature_hex;
  bundle.txs.forEach((t, i) => { $(`t${i}`).textContent = `<${t.contract.index},${t.contract.subindex}> ${t.receive_name} · energy ${t.energy}`; });
}

async function connect() {
  provider = await detectConcordiumProvider();
  account = (await provider.requestAccounts())?.[0] ?? null;
  $('acct').textContent = account ?? 'none';
  const chain = (await provider.getSelectedChain()) ?? '';
  if (!chain.startsWith(TESTNET_GENESIS_PREFIX)) { account = null; say('bad', 'Your wallet is not on ', bold('testnet'), '.'); return; }
  if (account !== OWNER) { account = null; say('bad', 'Select the Agent #1287 owner account ', code('44Fc…iWeG'), '.'); return; }
  say('info', 'Ready. Send step 1, wait until it is finalized, then step 2.');
  $('s0').disabled = !bundle;
  $('s1').disabled = !bundle;
}

async function send(i) {
  if (!bundle || !account) return;
  const t = bundle.txs[i];
  $(`s${i}`).disabled = true;
  try {
    const txHash = await provider.sendTransaction(
      account,
      AccountTransactionType.Update,
      { amount: CcdAmount.zero(), address: ContractAddress.create(t.contract.index, t.contract.subindex), receiveName: ReceiveName.fromString(t.receive_name), maxContractExecutionEnergy: Energy.create(t.energy) },
      t.parameters,
      { type: 'parameter', value: t.schema_b64 },
    );
    say('ok', `Step ${i + 1} sent: `, code(txHash), br(), txLink(txHash));
  } catch (e) {
    say('bad', `Step ${i + 1} not sent: ${e?.message ?? e}`);
    $(`s${i}`).disabled = false;
  }
}

$('connect').onclick = () => connect().catch((e) => say('bad', String(e.message ?? e)));
$('s0').onclick = () => send(0);
$('s1').onclick = () => send(1);
load().catch((e) => say('bad', String(e.message)));
