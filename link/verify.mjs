#!/usr/bin/env node
// After both link transactions: ask the registry, from the NEAR key's side, who owns it
// and which agent it belongs to. Usage: node link/verify.mjs (reads link/bundle.json)
import { readFileSync } from 'node:fs';
const MCP = 'https://agent-registry-mcp.concordium.com/mcp';
const b = JSON.parse(readFileSync('link/bundle.json', 'utf8'));
const key = { namespace: b.near.namespace, key_type: b.near.key_type, public_key_hex: b.near.public_key_hex };
async function call(name, args) {
  const res = await fetch(MCP, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { ...args, network: 'testnet' } } }) });
  const t = await res.text();
  const m = JSON.parse(t.slice(t.indexOf('{')).split('\n')[0]);
  return m.result?.structuredContent ?? JSON.parse(m.result?.content?.[0]?.text ?? 'null');
}
const owner = await call('owner_of_key', { external_key: key });
const agent = await call('agent_by_external_reference', { external_reference: { contract_address: { index: 12801, subindex: 0 }, kind: 'Cis8', key } });
console.log('owner_of_key:', JSON.stringify(owner));
console.log('agent_by_external_reference:', JSON.stringify(agent).slice(0, 1200));
const s = JSON.stringify({ owner, agent });
const ok = s.includes(b.owner) && /"token_id"\s*:\s*"?1287/.test(s);
console.log(ok ? `\nLINKED: NEAR ${b.near.account} -> Concordium owner ${b.owner} -> Agent #1287` : '\nNot linked yet (check both transactions are finalized).');
process.exit(ok ? 0 : 1);
