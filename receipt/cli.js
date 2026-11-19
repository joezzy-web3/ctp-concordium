#!/usr/bin/env node
// Demo: check the sending agent, build a receipt for the decision, and print
// what to anchor on Concordium.
//
// Usage:
//   node receipt/cli.js demo <AgentID> [claimedOwner]   -> writes receipts/<hash>.json, prints anchor data
//   node receipt/cli.js verify <receipt.json> <dataHex> -> checks a receipt against on-chain data
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { checkCounterparty } from '../gate/badgeGate.js';
import { buildReceipt, receiptHash, anchorDataHex, verifyReceipt } from './receipt.js';

const [cmd, a, b] = process.argv.slice(2);

if (cmd === 'demo' && a) {
  const gate = await checkCounterparty({ badge: a, claimedOwner: b });
  // Demo invoice and signers. In the product these come from the Jira issue and
  // the two people who signed blind delivery counts.
  const cleared = gate.verdict === 'CLEARED';
  const receipt = buildReceipt({
    invoice: { id: 'INV-DEMO-1', supplier: 'Demo Supplier Ltd', amount: '1250.00', currency: 'EUR', po: 'PO-DEMO-1' },
    gate,
    verdict: cleared ? 'CLEARED' : gate.verdict,
    codes: cleared ? [] : gate.codes,
    signers: cleared
      ? [
          { role: 'receiver', account: 'demo-receiver', signed_at: new Date().toISOString() },
          { role: 'approver', account: 'demo-approver', signed_at: new Date().toISOString() },
        ]
      : [],
    decided_by: { agent_id: 1287, badge: 'JyP9U25oUQ6KdnBBHdTYP', network: 'testnet' },
    decided_at: new Date().toISOString(),
  });
  const hash = await receiptHash(receipt);
  mkdirSync('receipts', { recursive: true });
  const file = `receipts/${hash}.json`;
  writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ verdict: receipt.decision.verdict, codes: receipt.decision.codes, receipt_file: file, receipt_hash: hash, anchor_data_hex: await anchorDataHex(receipt) }, null, 2));
} else if (cmd === 'verify' && a && b) {
  const receipt = JSON.parse(readFileSync(a, 'utf8'));
  const v = await verifyReceipt(receipt, b);
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.valid ? 0 : 1);
} else {
  console.error('Usage:\n  node receipt/cli.js demo <AgentID> [claimedOwner]\n  node receipt/cli.js verify <receipt.json> <dataHex>');
  process.exit(64);
}
