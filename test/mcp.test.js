// The MCP server's tools, run against a fake chain: what an AI is told, what is sent, and
// that nothing is sent when the contract would refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { makeTools } from '../mcp/tools.js';
import { invoiceParams, executeParams, loadAgentSigner, publicKeyOf, accountVerifyKeys, createEscrow } from '../mcp/escrow.js';

const A = (c) => `3${c.repeat(49)}`; // shape only; the tools never decode these
const AGENT = { id: 1287, badge: 'B', owner: A('a') };
const SUP = A('s');
const DAY = 24 * 3600 * 1000;

const order = (patch = {}) => ({
  id: 1, supplier: SUP, receiver: A('r'), approver: null, expected_qty: 10n, amount: 5_000_000n,
  commits: [{ signer: A('r'), role: 'Receiver', hash: '0'.repeat(64) }, { signer: SUP, role: 'SupplierRep', hash: '1'.repeat(64) }],
  reveals: [{ signer: A('r'), role: 'Receiver', qty: 10n }, { signer: SUP, role: 'SupplierRep', qty: 10n }],
  invoice: null, supplier_approval: null, paid: false, refunded: false, invoice_by: Date.now() + 7 * DAY,
  accepted: true, date_proposal: null, recounts: 0, agent: AGENT.owner, referee: A('f'), rep: SUP, funder: A('b'), ruled_delivered: false,
  ...patch,
});

function fakeChain({ orders = [order()], sim = {}, canSend = true } = {}) {
  const sent = [];
  return {
    sent,
    escrow: { index: 13102, subindex: 0 },
    agent: AGENT,
    canSend,
    viewConfig: async () => ({ hold_ms: 60000 }),
    viewSupplier: async () => ({ payout: SUP, payout_set_at: Date.now() - DAY }),
    viewOrder: async (id) => { const o = orders.find((x) => x.id === id); if (!o) { const e = new Error('There is no order with this number.'); e.code = 'UnknownOrder'; throw e; } return o; },
    listOrders: async () => orders,
    simulate: async (m, bytes) => sim[m] ?? { ok: true, decisions: [], energy: 1200 },
    send: async (m, bytes) => { sent.push({ m, bytes }); return { ok: true, tx: 'ab'.repeat(32), decisions: m === 'execute_payment' ? [{ verdict: 'Held', codes: ['HeldNoInvoice'], paid_to: null }] : [] }; },
  };
}

test('parameter bytes follow the contract structs', () => {
  const inv = invoiceParams(3, 'ff'.repeat(32), 2_500_000n);
  assert.equal(inv.length, 8 + 32 + 8);
  assert.deepEqual([...inv.slice(0, 8)], [3, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(inv[8], 0xff);
  assert.equal(new DataView(inv.buffer).getBigUint64(40, true), 2_500_000n);
  assert.equal(executeParams(1, '00'.repeat(32)).length, 40);
  assert.throws(() => executeParams(1, 'nothex'));
});

test('without a key file the server cannot send', () => {
  assert.throws(() => loadAgentSigner(undefined, AGENT.owner), /CTP_AGENT_KEY_FILE/);
});

// RFC 8032 test vector 1: a public test key, not anyone's account.
const TEST_SK = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const TEST_PK = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';

test('a copied private key loads, with its public key for the on-chain check', () => {
  assert.equal(publicKeyOf(TEST_SK), TEST_PK);
  const dir = mkdtempSync(join(tmpdir(), 'ctp-'));
  const file = join(dir, 'agent.key');
  writeFileSync(file, `${TEST_SK}\n`);
  const s = loadAgentSigner(file, AGENT.owner);
  assert.equal(s.publicKey, TEST_PK);
  writeFileSync(file, 'not a key');
  assert.throws(() => loadAgentSigner(file, AGENT.owner), /neither a Concordium wallet export nor/);
});

test('verify keys are read from account credentials', () => {
  const info = { accountCredentials: { 0: { v: 0, value: { type: 'normal', contents: { credentialPublicKeys: { keys: { 0: { schemeId: 'Ed25519', verifyKey: TEST_PK.toUpperCase() } } } } } } } };
  assert.ok(accountVerifyKeys(info).has(TEST_PK));
});

test('a key that does not belong to the agent account is never used to send', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctp-'));
  const file = join(dir, 'agent.key');
  writeFileSync(file, TEST_SK);
  let sent = false;
  const client = {
    getAccountInfo: async () => ({ accountCredentials: { 0: { value: { contents: { credentialPublicKeys: { keys: { 0: { verifyKey: 'ab'.repeat(32) } } } } } } } }),
    getNextAccountNonce: async () => { sent = true; return { nonce: 1n }; },
    sendAccountTransaction: async () => { sent = true; },
  };
  const owner = '44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG';
  const chain = createEscrow({ escrow: { index: 13102, subindex: 0 }, agent: { id: 1287, owner }, keyFile: file, client });
  await assert.rejects(chain.send('execute_payment', executeParams(1, '00'.repeat(32)), 1000), /does not belong to the agent account/);
  assert.equal(sent, false);
});

test('list and get describe the order and who acts next', async () => {
  const t = makeTools(fakeChain());
  const list = await t.listOrders();
  assert.match(list, /#1: 5 CCD, 10 units/);
  assert.match(list, /Next: the agent submits the invoice/);
  const one = await t.getOrder({ order_id: 1 });
  assert.match(one, /approver none \(individual buyer\)/);
  assert.match(one, /Delivery confirmed: yes/);
});

test('a dry run reports the contract’s verdict and sends nothing', async () => {
  const chain = fakeChain({ sim: { execute_payment: { ok: true, decisions: [{ verdict: 'Held', codes: ['HeldNoSupplierApproval'] }], energy: 900 } } });
  const out = await makeTools(chain).dryRunPayment({ order_id: 1 });
  assert.match(out, /Held: The supplier has not approved/);
  assert.match(out, /Nothing was sent/);
  assert.equal(chain.sent.length, 0);
});

test('an invoice the contract would refuse is never sent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctp-'));
  const file = join(dir, 'invoice.pdf');
  writeFileSync(file, 'invoice');
  const chain = fakeChain({ sim: { submit_invoice: { ok: false, error: 'NotOrderAgent', explain: 'Only the agent named on this order can submit its invoice.' } } });
  const out = await makeTools(chain).submitInvoice({ order_id: 1, invoice_file: file, amount_ccd: '5' });
  assert.match(out, /would refuse this invoice \(NotOrderAgent\)/);
  assert.equal(chain.sent.length, 0);
});

test('the invoice tool reads only regular files', async () => {
  const chain = fakeChain();
  const out = await makeTools(chain).submitInvoice({ order_id: 1, invoice_file: tmpdir(), amount_ccd: '5' });
  assert.match(out, /not a regular file/);
  assert.equal(chain.sent.length, 0);
});

test('an accepted invoice is sent with only its fingerprint', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctp-'));
  const file = join(dir, 'invoice.pdf');
  writeFileSync(file, 'invoice');
  const chain = fakeChain();
  const out = await makeTools(chain).submitInvoice({ order_id: 1, invoice_file: file, amount_ccd: '5' });
  assert.match(out, /Invoice submitted on order #1: 5 CCD/);
  assert.equal(chain.sent.length, 1);
  assert.equal(chain.sent[0].bytes.length, 48);
});

test('asking for payment saves the receipt first and relays a held verdict', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctp-'));
  const chain = fakeChain();
  const out = await makeTools(chain, { receiptsDir: dir }).requestPayment({ order_id: 1 });
  assert.match(out, /Held: No invoice yet/);
  assert.match(out, /cannot override it/);
  assert.equal(readdirSync(dir).length, 1);
  assert.equal(chain.sent[0].m, 'execute_payment');
});

test('read-only mode dry-runs but sends nothing', async () => {
  const chain = fakeChain({ canSend: false });
  const out = await makeTools(chain, { receiptsDir: mkdtempSync(join(tmpdir(), 'ctp-')) }).requestPayment({ order_id: 1 });
  assert.match(out, /nothing was sent/);
  assert.equal(chain.sent.length, 0);
});

test('the server starts and lists its six tools', async () => {
  const env = { ...process.env };
  delete env.CTP_AGENT_KEY_FILE;
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/server.js', import.meta.url))], env }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), ['check_agent_badge', 'dry_run_payment', 'get_order', 'list_orders', 'request_payment', 'submit_invoice']);
  await client.close();
});
