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
| **Registered agent** | **#1287** · Agent ID `JyP9U25oUQ6KdnBBHdTYP` · owner `44Fcwcy…mbiWeG` |

Earlier work: [Clear to Pay on NEAR](https://github.com/joezzy-web3/clear-to-pay) (the idea and threat model; no code reused).

## Licence
MIT
