# Clear to Pay on Concordium

**An AI agent can be fooled into believing an invoice. Clear to Pay makes sure that belief is not enough to move the company's money** — and on Concordium, every agent and every signer involved is accountable to a verified human or company.

Built for the [Concordium Trusted Agents Hackathon](https://www.encodeclub.com/programmes/concordium-trusted-agents-hackathon) (Encode Club, Nov–Dec 2026). Runs on **Concordium testnet**.

## What it will do
1. **The Clear to Pay agent is registered** in the Concordium Agent Registry (CIS-8004) with an Agent Card and the *Verified by Concordium* badge.
2. **Badge-gated agents:** Clear to Pay refuses invoices from any agent whose badge does not check out (missing, revoked, or card hash mismatch).
3. **Verified human signers:** storekeeper and weighbridge prove a role attribute with Concordium ID zero-knowledge proofs; no personal data is stored.
4. **Escrow on testnet:** funds lock when an order is created and release only when blind-count delivery signatures and the supplier-signed invoice check out, after a 72-hour hold on new payout accounts.
5. **Audit trail** built for EU AI Act Article 12 record keeping.

## Testnet references
| What | Value |
|---|---|
| Agent Registry (CIS-8004) | `<12802,0>` |
| Key registry (CIS-8) | `<12801,0>` |
| Explorer | https://testnet.ccdscan.io |
| Agent Card | https://joezzy-web3.github.io/ctp-concordium/agent-card.json |
| **Registered agent** | **#1287** · Agent ID `JyP9U25oUQ6KdnBBHdTYP` · owner `44Fcwcy…mbiWeG` · badge valid (linked to the NEAR agent `buyer.cleartopay.testnet` via CIS-8 (tx [`3837cc7a48…`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=3837cc7a487731da88b6aa183fd62489e9e9f1da534cddc082cdfcc271f7c1d7)) · anchor tx [`9556522bc1…`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=9556522bc1a0decb964276fd7b4d13b9a6f5404a25d5a02692ae3c6ad80dec23)) |

Earlier work: [Clear to Pay on NEAR](https://github.com/joezzy-web3/clear-to-pay) (the idea and threat model; no code reused).

## Licence
MIT

## Verify before you pay (badge gate)

Before Clear to Pay accepts an invoice from another AI agent, it checks that agent's Verified by Concordium badge:

```bash
npm test                                      # 15 offline tests
node gate/cli.js JyP9U25oUQ6KdnBBHdTYP         # live check of our own agent on testnet
```

The answer is `CLEARED`, `HELD` or `REFUSED`, with reason codes (`gate/codes.js`) and evidence: token id, owner, status, the on-chain hash and Clear to Pay's own hash of the card.

Design choices, and what protects the user:
- **Two independent sources.** The registry service reads the chain; Clear to Pay fetches the card and hashes the raw bytes itself. A card edited after anchoring is refused even if another check says it is fine.
- **Fails closed.** If the registry or the card cannot be reached, the agent is HELD, never CLEARED, so an outage can only delay a payment, not let one through.
- **Careful with untrusted input.** Agent IDs are checked before they go into a URL; cards must be https, at most 256 KB, fetched with a timeout and no redirects.

## Accountability receipt

Every decision Clear to Pay makes becomes a receipt, and the receipt's hash is anchored on Concordium.

```bash
node receipt/cli.js demo JyP9U25oUQ6KdnBBHdTYP     # check the agent, write receipts/<hash>.json, print the anchor data
node receipt/cli.js verify receipts/<hash>.json <on-chain data hex>
```

Anchor a receipt from the browser wallet at `anchor/` (https://joezzy-web3.github.io/ctp-concordium/anchor/).

Design choices, and what protects the user:
- **Only a hash goes on-chain.** The 36-byte anchor is `CTP1` plus the receipt's SHA-256. Invoice details stay with the business, and a random salt in every receipt means the hash cannot be matched to a guessed invoice.
- **The rules are enforced in the record itself.** A receipt cannot say CLEARED unless the sending agent passed the badge gate and two different people signed.
- **Tamper-evident log.** Each receipt carries the hash of the one before it, so a receipt removed or reordered later shows up.
- **Same bytes everywhere.** Receipts use a strict canonical JSON (sorted keys, amounts as strings, no floats), so the command line and the browser compute the same hash.

