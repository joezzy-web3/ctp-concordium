
// Wallet API helpers and SDK types, pinned to the versions this page was tested with.
import { detectConcordiumProvider } from '@concordium/browser-wallet-api-helpers';
import { AccountTransactionType, CcdAmount, ContractAddress, ReceiveName, Energy } from '@concordium/web-sdk';

// ---- Fixed facts about this agent (testnet) ----
const TESTNET_GENESIS_PREFIX = '4221332d34e1694168c2a0c0b3fd0f27';
const OWNER = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
const TOKEN_ID_HEX = '0705000000000000';          // agent #1287, TokenIdU64 little-endian
const AGENT_URI = 'https://joezzy-web3.github.io/ctp-concordium/agent-card.json';
const EXPECTED_HASH = 'b6567d9bdb984846f7f72a2769a42485888be98928b11398c6a58be1828e9588'; // agent-card.json v2
const CONTRACT =ContractAddress.create(12802, 0);
const RECEIVE = ReceiveName.fromString('CIS-8004.setAgentURI');
const ENERGY = Energy.create(30000);

// Parameter schema for setAgentURI, written by hand and verified with
// @concordium/web-sdk 12.0.3 to serialize to exactly the bytes that the
// hosted MCP tool `build_set_agent_uri` produced (107 bytes, MATCH true).
//   struct { token_id: ByteList<U8>, agent_uri: Option<String<U32>>, metadata_hash: Option<[u8; 32]> }
const PARAM_SCHEMA_B64 = 'FAADAAAACAAAAHRva2VuX2lkHQAJAAAAYWdlbnRfdXJpFQIAAAAEAAAATm9uZQIEAAAAU29tZQEBAAAAFgINAAAAbWV0YWRhdGFfaGFzaBUCAAAABAAAAE5vbmUCBAAAAFNvbWUBAQAAABMgAAAAAg==';

import { say, code, bold, br, txLink } from '../../ui/say.js';

const $ = (id) => document.getElementById(id);

$('owner').textContent = OWNER;
$('uri').textContent = AGENT_URI;

let provider = null;
let account = null;
let hashBytes = null;

// 1. Hash the card exactly as it is served (no reformatting), in the browser.
async function hashServedCard() {
  const res = await fetch(AGENT_URI, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Card fetch failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = [...hashBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  $('hash').textContent = hex;
  if (hex !== EXPECTED_HASH) {
    hashBytes = null; // never anchor a card we did not build and check
    throw new Error('The served card does not match the card built in the repo (hash differs). Nothing will be sent.');
  }
}

// 2. Connect the wallet and refuse anything that is not testnet + the owner account.
async function connect() {
  provider = await detectConcordiumProvider();
  const accounts = await provider.requestAccounts();
  account = accounts?.[0] ?? null;
  $('acct').textContent = account ?? 'none';
  const chain = (await provider.getSelectedChain()) ?? '';
  if (!chain.startsWith(TESTNET_GENESIS_PREFIX)) {
    say('bad', 'Your wallet is not on ', bold('testnet'), '. Switch the network in the wallet and connect again.');
    return;
  }
  if (account !== OWNER) {
    say('bad', 'The connected account is not the agent owner. Select account ', code('44Fc…iWeG'), ' in the wallet.');
    return;
  }
  say('info', 'Wallet on testnet with the owner account. Check the hash above, then press ', bold('Sign and send'), '.');
  $('send').disabled = !hashBytes;
}

// 3. Hand the transaction to the wallet. The wallet shows it; you approve.
async function send() {
  if (!hashBytes || !account || account !== OWNER) return;
  $('send').disabled = true;
  const parameters = {
    token_id: TOKEN_ID_HEX,
    agent_uri: { Some: [AGENT_URI] },
    metadata_hash: { Some: [Array.from(hashBytes)] },
  };
  try {
    const txHash = await provider.sendTransaction(
      account,
      AccountTransactionType.Update,
      { amount: CcdAmount.zero(), address: CONTRACT, receiveName: RECEIVE, maxContractExecutionEnergy: ENERGY },
      parameters,
      { type: 'parameter', value: PARAM_SCHEMA_B64 },
    );
    say('ok', 'Sent. Transaction ', code(txHash), br(), txLink(txHash));
  } catch (err) {
    say('bad', `Not sent: ${err?.message ?? err}`);
    $('send').disabled = false;
  }
}

$('connect').onclick = () => connect().catch((e) => say('bad', e.message ?? String(e)));
$('send').onclick = send;
hashServedCard().catch((e) => { $('hash').textContent = 'error'; say('bad', e.message); });
