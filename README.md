# Clear to Pay on Concordium

**An AI agent can be fooled into believing an invoice. Clear to Pay makes sure that belief is not enough to move the company's money** — and on Concordium, every agent and every signer involved is accountable to a verified human or company.

Built for the [Concordium Trusted Agents Hackathon](https://www.encodeclub.com/programmes/concordium-trusted-agents-hackathon) (Encode Club, Nov–Dec 2026). Runs on **Concordium testnet**.

## Status: live today vs in progress

Every row marked live links to on-chain evidence or runs in the test suite. Rows in progress are not claimed as protections until they are deployed.

| Piece | Status | Evidence |
|---|---|---|
| Agent #1287 registered (CIS-8004), Agent Card anchored, Verified by Concordium badge | **Live (testnet)** | registry `check-badge`: all 15 checks pass; card anchor tx below |
| Cross-chain link to the Clear to Pay agent on NEAR (CIS-8) | **Live (testnet)** | CIS-8 checked the NEAR signature; registry confirmed the binding before attaching it (link tx below) |
| Badge gate: refuse counterparty agents whose badge or card does not check out | **Live (off-chain code)** | `gate/`, `npm test` |
| Receipts: canonical, salted, rule-checked, hash anchored with RegisterData | **Live (testnet)** | `receipt/`, first anchor tx in PLAN.md. Proves the receipt existed unchanged; the issuer and the payment are proven by the escrow contract once deployed |
| Escrow contract: two named people in two roles count blind, supplier approves its own invoice, 72-hour hold on new payout accounts, pays only on CLEARED, logs every decision | **Deployed (testnet)**, first order next | `<13091,0>`, module `6c8a0802…f10a34c` = verifiable build of commit `471f25f` ([deploy tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=841990e37d7e55b79d7c1dc185ee6e76eb3c81f661d30202bf2c318bbff6d4af), [create tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=e53c212f4a5b3eaf822eef56a1163e729ba10c27ca33b98123963b639153dc64)); 14 rule tests, 14 end-to-end tests |
| Contract checks the agent in the CIS-8004 registry itself | In progress | today the buyer registers only agents the badge gate cleared, and the contract re-checks registration at every decision |
| Signers proven to be two different verified people (Concordium ID zero-knowledge proofs) | In progress | today: two different accounts in two different roles, each owned by an ID-verified Concordium identity |
| Payments: x402 service fees; stablecoin payout | In progress | escrow pays in CCD first |

The Agent Card describes the product as a whole; it will be re-anchored with the escrow contract address when the contract is deployed.

## Testnet references
| What | Value |
|---|---|
| Agent Registry (CIS-8004) | `<12802,0>` |
| Key registry (CIS-8) | `<12801,0>` |
| Explorer | https://testnet.ccdscan.io |
| Agent Card | https://joezzy-web3.github.io/ctp-concordium/agent-card.json |
| **Registered agent** | **#1287** · Agent ID `JyP9U25oUQ6KdnBBHdTYP` · owner `44Fcwcy…mbiWeG` · badge valid ([card anchor tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=9556522bc1a0decb964276fd7b4d13b9a6f5404a25d5a02692ae3c6ad80dec23)) · linked via CIS-8 to the NEAR agent `buyer.cleartopay.testnet` ([link tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=3837cc7a487731da88b6aa183fd62489e9e9f1da534cddc082cdfcc271f7c1d7)) |

Earlier work: [Clear to Pay on NEAR](https://github.com/joezzy-web3/clear-to-pay) (the idea and threat model; no code reused).

## Licence
MIT

## Verify before you pay (badge gate)

Before Clear to Pay accepts an invoice from another AI agent, it checks that agent's Verified by Concordium badge:

```bash
npm test                                      # offline tests
node gate/cli.js JyP9U25oUQ6KdnBBHdTYP         # live check of our own agent on testnet
```

The answer is `CLEARED`, `HELD` or `REFUSED`, with reason codes (`gate/codes.js`) and evidence: token id, owner, status, the on-chain hash and Clear to Pay's own hash of the card.

Design choices, and what protects the user:
- **Two independent sources.** The registry service reads the chain; Clear to Pay fetches the card and hashes the raw bytes itself. A card edited after anchoring is refused even if another check says it is fine.
- **Fails closed.** If the registry or the card cannot be reached, the agent is HELD, never CLEARED, so an outage can only delay a payment, not let one through.
- **Careful with untrusted input.** The card URL is chosen by the agent being checked, so it is treated as hostile: Agent IDs are checked before they go into a URL; cards must be https, are fetched with no redirects, refused if they resolve to a private, loopback or link-local address (checked when the connection is made), counted byte by byte up to 256 KB, and given one timeout for the whole download.

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
- **Tamper-evident link.** Each receipt carries the hash of the one before it, so a receipt that was changed breaks the link to the next one. On its own this is a link, not a complete log: the escrow contract's `Decision` events are the authoritative, ordered record.
- **What an anchor proves.** A RegisterData anchor proves that this exact receipt existed, unchanged, at that time, and the verifier refuses any receipt that breaks a rule (for example CLEARED without the badge gate or without two people in two roles). It does not by itself prove who issued the receipt; that is what the contract's `Decision` event is for.
- **Same bytes everywhere.** Receipts use a strict canonical JSON (sorted keys, amounts as strings, no floats), so the command line and the browser compute the same hash.

