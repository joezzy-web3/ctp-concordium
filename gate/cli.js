#!/usr/bin/env node
// Usage: node gate/cli.js <AgentID> [claimedOwner] [--mainnet]
// Prints the gate's verdict, reason codes and evidence as JSON.
// Exit code: 0 CLEARED, 1 HELD, 2 REFUSED.
import { checkCounterparty } from './badgeGate.js';

const args = process.argv.slice(2);
const network = args.includes('--mainnet') ? 'mainnet' : 'testnet';
const [badge, claimedOwner] = args.filter((a) => !a.startsWith('--'));
if (!badge) {
  console.error('Usage: node gate/cli.js <AgentID> [claimedOwner] [--mainnet]');
  process.exit(64);
}
const result = await checkCounterparty({ badge, claimedOwner }, { network });
console.log(JSON.stringify(result, null, 2));
process.exit({ CLEARED: 0, HELD: 1, REFUSED: 2 }[result.verdict]);
