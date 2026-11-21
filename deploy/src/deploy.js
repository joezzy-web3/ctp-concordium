// Deploy the escrow module (step 1) and create the contract instance (step 2) on testnet.
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { CcdAmount, ContractName, Energy, ModuleReference } from '@concordium/web-sdk';
import { say, code, bold, br, txLink } from '../../ui/say.js';

const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
// SHA-256 of the verifiable build from CI that we deploy (contract/ at the pinned commit).
const EXPECTED_MODULE_SHA256 = 'ec8aa1da1bf370b3241a723862ff089cd6549b41e8f38e19bd7fcfad33a94b73';
const DEPLOY_MODULE = 0; // AccountTransactionType.DeployModule
const INIT_CONTRACT = 1; // AccountTransactionType.InitContract
const HOLDS = { prod: 72 * 3600 * 1000, test: 60 * 1000 }; // 72 hours, or 1 minute for a test run
const holdMs = () => HOLDS[$('holdpick').value] ?? HOLDS.prod;
// Schema of InitParams { hold_ms: u64, registry: ContractAddress }
const INIT_SCHEMA_B64 = 'FAACAAAABwAAAGhvbGRfbXMFCAAAAHJlZ2lzdHJ5DA==';
const REGISTRY = { index: 12802, subindex: 0 }; // CIS-8004 Agent Registry on testnet

const $ = (id) => document.getElementById(id);
let provider = null;
let account = null;
let moduleBytes = null;
let moduleRef = null;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pick(file) {
  moduleBytes = null;
  moduleRef = null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const h = hex(await crypto.subtle.digest('SHA-256', bytes));
  $('sha').textContent = h;
  // A .wasm.v1 file starts with version 1 (4 bytes, big-endian) and the module length.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0) !== 1 || view.getUint32(4) !== bytes.length - 8) {
    say('bad', 'This is not a Concordium v1 module file (.wasm.v1).');
    return;
  }
  if (h !== EXPECTED_MODULE_SHA256) {
    say('bad', 'This module is not the pinned CI build. Download the ctp_escrow-verifiable artifact from the pinned commit.');
    return;
  }
  moduleBytes = bytes;
  moduleRef = h; // the module reference is the SHA-256 of the versioned module
  $('ref').value = h;
  say('info', 'Module checked: it is the pinned verifiable build. Connect the wallet to deploy it.');
  refresh();
}

async function connect() {
  provider = await detectConcordiumProvider();
  account = (await provider.requestAccounts())?.[0] ?? null;
  $('acct').textContent = account ?? 'none';
  const chain = (await provider.getSelectedChain()) ?? '';
  if (!chain.startsWith(TESTNET_GENESIS_PREFIX)) {
    account = null;
    say('bad', 'Your wallet is not on ', bold('testnet'), '.');
  }
  refresh();
}

function refresh() {
  $('deploy').disabled = !(account && moduleBytes);
  $('init').disabled = !(account && /^[0-9a-f]{64}$/.test($('ref').value.trim()));
}

async function deploy() {
  if (!account || !moduleBytes) return;
  $('deploy').disabled = true;
  try {
    const tx = await provider.sendTransaction(account, DEPLOY_MODULE, { source: moduleBytes });
    say('ok', 'Module sent: ', code(tx), br(), txLink(tx), br(), 'Wait until it is finalized, then create the contract (step 2).');
  } catch (e) {
    say('bad', `Not sent: ${e?.message ?? e}`);
    $('deploy').disabled = false;
  }
}

async function init() {
  const ref = $('ref').value.trim();
  if (!account || !/^[0-9a-f]{64}$/.test(ref)) return;
  $('init').disabled = true;
  try {
    const tx = await provider.sendTransaction(
      account,
      INIT_CONTRACT,
      { amount: CcdAmount.zero(), moduleRef: ModuleReference.fromHexString(ref), initName: ContractName.fromString('ctp_escrow'), maxContractExecutionEnergy: Energy.create(30000) },
      { hold_ms: holdMs(), registry: REGISTRY },
      { type: 'parameter', value: INIT_SCHEMA_B64 },
    );
    say('ok', 'Contract creation sent: ', code(tx), br(), txLink(tx), br(), 'The new contract address (index, subindex) is shown on CCDScan once finalized. This account is now the buyer admin.');
  } catch (e) {
    say('bad', `Not sent: ${e?.message ?? e}`);
    $('init').disabled = false;
  }
}

$('file').onchange = (e) => e.target.files?.[0] && pick(e.target.files[0]).catch((err) => say('bad', String(err.message ?? err)));
$('ref').oninput = refresh;
$('connect').onclick = () => connect().catch((e) => say('bad', String(e.message ?? e)));
$('deploy').onclick = deploy;
$('init').onclick = init;
$('expected').textContent = EXPECTED_MODULE_SHA256;
