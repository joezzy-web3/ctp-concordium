# Clear to Pay on Concordium

**An AI agent can be fooled into believing an invoice. Clear to Pay makes sure that belief is not enough to move the company's money** — and on Concordium, every agent and every signer involved is accountable to a verified human or company.

**Try it:** [landing page](https://cleartopay-concordium.vercel.app/) · [app](https://cleartopay-concordium.vercel.app/app/) (Concordium Browser Wallet on testnet) · Also served from GitHub Pages, where the Agent Card keeps its registered address.

Built for the [Concordium Trusted Agents Hackathon](https://www.encodeclub.com/programmes/concordium-trusted-agents-hackathon) (Encode Club, Nov–Dec 2026). Runs on **Concordium testnet**.

## Status: live today vs in progress

Every row marked live links to on-chain evidence or runs in the test suite. Rows in progress are not claimed as protections until they are deployed.

| Piece | Status | Evidence |
|---|---|---|
| Agent #1287 registered (CIS-8004), Agent Card anchored, Verified by Concordium badge | **Live (testnet)** | registry `check-badge`: all 15 checks pass; card anchor tx below |
| Cross-chain link to the Clear to Pay agent on NEAR (CIS-8) | **Live (testnet)** | CIS-8 checked the NEAR signature; registry confirmed the binding before attaching it (link tx below) |
| **Escrow v6, full live run with Claude (21 Nov 2026):** receiver proved with Concordium ID, blind count 20 = 20, Claude submitted the invoice over MCP, refused to skip the checks, was sent anyway and got **Held** on-chain; the supplier approved from its own account and the same request **Cleared**, 2 CCD to the supplier's payout account | **Live (testnet)** | `<13106,0>`, module `ec8aa1da…` = verifiable build ([check it yourself](#check-the-contract-yourself)); 26 rule tests, 54 end-to-end tests; [contract on CCDExplorer](https://ccdexplorer.io/testnet/instance/13106/0) |
| Escrow contract v4: two named people in two roles count blind (each seal bound to its signer), the supplier accepts the order and its latest date, approves its own invoice and amount, payout hold on new payout accounts, pays only on CLEARED, logs every decision | **Live (testnet)**, full order paid on 20 Nov 2026 | `<13098,0>`, module `ad60bdff…a28c7e52` = verifiable build ([first payment](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=e921b5657c0105d768122ee070dad4efd97eec9ac4a806d45fc2cb40852f2947)); 20 rule tests, 34 end-to-end tests |
| The contract checks the agent in the CIS-8004 registry itself, when the agent is added and at every invoice and payment request | **Live (testnet)** | it read the real registry for Agent #1287 at setup and again at the invoice in the first live order; end-to-end tests cover revoked, transferred and hijacked agents |
| Escrow v5: each side has a counter the other does not choose (buyer's receiver, supplier's delivery rep), a referee for disputes, one agent per order, seals bound to signer and round, refunds to the funder | **Live (testnet)**, deployed 20 Nov 2026 | `<13102,0>`, module `ae80470a…` = verifiable build; 23 rule tests, 47 end-to-end tests on the compiled contract, one per attack from the 20 Nov audit |
| MCP server: any MCP client (Claude Desktop and others) works the escrow as Agent #1287: list and read orders, dry-run a payment, submit an invoice, ask for payment. The contract still decides every payment | **Built and tested** | `mcp/`, `npm test` (tools run against a fake chain; the server starts and lists its tools); setup in `mcp/README.md` |
| Payment receipts: the receipt's fingerprint is written into the contract's own Decision event | **Live (testnet)** | `receipt/escrowReceipt.js`, `npm test`; check a receipt in the app under Judge mode |
| Badge gate: refuse counterparty agents whose badge or card does not check out | **Live (off-chain code)** | `gate/`, `npm test` |
| Counters proven with Concordium ID (zero knowledge): each receiver and approver proves they are a verified adult; the escrow keeps only a salted fingerprint and refuses an order whose two counters are the same person | **Live (testnet)**: the receiver on order #1 of `<13106,0>` was verified and recorded on the escrow | ID checks in the app (`#/buyer/ids`), `test/idcheck.test.js`, design in `docs/F01_SIGNER_IDENTITY.md` |
| Stablecoin payout, sponsored fees, shared escrow, mainnet | Next steps, each an extension of what runs today | [PATH_TO_PRODUCTION.md](PATH_TO_PRODUCTION.md) |

The Agent Card describes the product as a whole; it will be re-anchored with the escrow contract address once the final demo contract is deployed.

## Testnet references
| What | Value |
|---|---|
| Agent Registry (CIS-8004) | `<12802,0>` |
| Key registry (CIS-8) | `<12801,0>` |
| Explorer | [Escrow `<13151,0>` on CCDExplorer](https://ccdexplorer.io/testnet/instance/13151/0) (module **Verified**) · [on CCDScan](https://testnet.ccdscan.io/?dentity=contract&dcontractAddressIndex=13151&dcontractAddressSubIndex=0) · [Agent Registry `<12802,0>`](https://ccdexplorer.io/testnet/instance/12802/0) |
| Agent Card | https://joezzy-web3.github.io/ctp-concordium/agent-card.json |
| **Escrow contract (live, test run)** | `<13151,0>` (v6) · module `196930b8de58a1ef92a97480322cd0c0051c99be3fdb2f459567e9c426e6fdde`, **Verified on CCDExplorer** (source and module match) · buyer admin `4QzE6Z…cEmTthG` · payout hold 1 minute, so the full flow runs in one sitting · [app](https://cleartopay-concordium.vercel.app/app/) |
| **Escrow contract (21 Nov run)** | `<13106,0>`, the same v6 code as module `ec8aa1da1bf370b3241a723862ff089cd6549b41e8f38e19bd7fcfad33a94b73`, built before the source link was embedded |
| **Escrow contract (earlier)** | `<13092,0>` (v2), superseded by v4 · module `532e6af284237b73fec30571e715cbd2e6567a1c110d82aeaa7cea64da537f27` |
| **Registered agent** | **#1287** · Agent ID `JyP9U25oUQ6KdnBBHdTYP` · owner `44Fcwcy…mbiWeG` · badge valid ([card anchor tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=9556522bc1a0decb964276fd7b4d13b9a6f5404a25d5a02692ae3c6ad80dec23)) · linked via CIS-8 to the NEAR agent `buyer.cleartopay.testnet` ([link tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=3837cc7a487731da88b6aa183fd62489e9e9f1da534cddc082cdfcc271f7c1d7)) |

Earlier work: [Clear to Pay on NEAR](https://github.com/joezzy-web3/clear-to-pay) (the idea and threat model; no code reused).

## Check the contract yourself

The escrow at `<13151,0>` runs module `196930b8de58a1ef92a97480322cd0c0051c99be3fdb2f459567e9c426e6fdde`. CCDExplorer downloads its source from the link embedded in the module, rebuilds it in Concordium's verifiable build image and shows **[Verified: source and module match](https://ccdexplorer.io/testnet/module/196930b8de58a1ef92a97480322cd0c0051c99be3fdb2f459567e9c426e6fdde)**.

To check it yourself:

1. Download the source archive: [release `escrow-v6-src1`](https://github.com/joezzy-web3/ctp-concordium/releases/tag/escrow-v6-src1) (`ctp_escrow.wasm.v1.tar`, SHA-256 `491ddddcc2691d5c2c0cd407d8257e9cd7ec1213d50fc334169fea78b27bbcc0`).
2. With Docker and `cargo-concordium` installed, from `contract/`:
   ```
   cargo concordium build --verifiable --out ctp_escrow.wasm.v1
   sha256sum ctp_escrow.wasm.v1
   ```
   This prints `ec8aa1da…a94b73`: the same code before its source link was embedded. The [publish-module run](https://github.com/joezzy-web3/ctp-concordium/actions/runs/45031516327) does exactly this in public, then embeds the link with `edit-build-info --verify`, which gives `196930b8…`.

While building this, we found that CCDExplorer could not verify builds from the `wasm32v1` image. We reported it with the module, archive and CI run; the CCDExplorer maintainer confirmed the bug and shipped a fix, and this module now verifies.

## How a payment clears (escrow contract)

`contract/` holds the escrow; `contract/DESIGN.md` has every rule (it describes v5, deploying next). In the app, each person has their own space: buyer, delivery signers, supplier, agent and referee.

1. The buyer creates the order, locks the money in the contract, names its receiver (and, for a company, an approver), the agent and a referee, and sets the latest date for delivery and invoice. An individual buying for themselves is their own receiver.
2. The supplier accepts the order and that date from its own account, and names its delivery rep (the driver).
3. At the gate, the buyer's receiver and the supplier's rep each count and seal their number. Neither can see or copy the other's. The rep unloads only after the receiver has sealed: no count, no unload. The buyer's approver can check inside too.
4. The agent named on the order submits the invoice's fingerprint and amount. The contract asks the Concordium agent registry whether the agent is active and owned by the caller.
5. The supplier approves that exact invoice and amount.
6. The agent, the supplier or the buyer asks for the decision. The contract pays only when the receiver's and the rep's counts match the order, the approver (if it counted) agrees, the supplier approved, and the payout account has waited out its hold. It records a Decision event either way.
7. If the counts disagree after the rep has counted, the referee decides: delivered, or money back.

Design choices, and what protects the user:
- **The agent can be fooled; the money cannot.** A wrong, fake or edited invoice cannot change who is paid or how much: payment is fixed by the amount in escrow, the counts and the supplier's approval of that exact file's fingerprint.
- **The supplier is protected from the buyer's own counters.** If the supplier's rep counted a delivery and the buyer's counters disagree or stay silent, the buyer cannot take the money back alone, even after the date; only the referee can. A confirmed delivery is the supplier's money as long as it approves its invoice by the agreed date. The buyer cannot throw out an invoice the supplier approved for the full amount.
- **The buyer is protected from a false delivery.** The rep alone never confirms a delivery: the buyer's receiver must agree, and the buyer's approver can hold a payment by counting a different number. If the rep never counted, the buyer gets the money back after the date.
- **Stalls have a way out.** A lost seal key can be replaced before anyone unseals, a miscount gets a recount (at most 2, opened by the buyer or supplier), a disagreement goes to the referee, and an offline agent is replaced by the supplier or buyer asking under the same rules.
- **Fails safe.** If the contract cannot read the agent registry, it refuses.
- **Checks scale with the risk of the order.** ID checks and the approver are optional: the buyer chooses which counters prove their ID, and whether an order needs an approver. A small or high-volume buyer runs the minimum: buyer, one receiver, supplier. A counter proves their ID once; the escrow keeps them on its signer list, so every later order and delivery adds no extra steps.

## Payment receipts

Asking for payment builds a receipt from the order as the contract holds it at that moment: the counts, any referee ruling, the invoice fingerprint, the supplier's approval, the payout account and who asked. The app keeps it before sending, so a fingerprint never lands on-chain without its receipt. Its SHA-256 is sent as `receipt_hash`, and the contract writes it into its own `Decision` event, next to the verdict.

Design choices, and what protects the user:
- **Anchored inside the decision itself.** No separate transaction, and a receipt cannot be attached to a different decision.
- **The verdict is the contract's.** The receipt records facts, never a verdict. The checker compares its fingerprint, contract, order, asker, agent and payee with the decision, and its counts, amounts, invoice and approval with the order on-chain.
- **Easy to check.** Download a receipt from any order; in Judge mode, pick the file and paste the decision's transaction hash, and the page reads the decision from the chain and confirms (or refutes) that this exact receipt is the one it recorded.

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

## Accountability receipt (badge-gate decisions)

Decisions made outside the escrow, such as the badge gate refusing a counterparty agent, become receipts whose hash is anchored on Concordium with RegisterData.

```bash
node receipt/cli.js demo JyP9U25oUQ6KdnBBHdTYP     # check the agent, write receipts/<hash>.json, print the anchor data
node receipt/cli.js verify receipts/<hash>.json <on-chain data hex>
```

Anchor a receipt from the browser wallet at `anchor/` (https://cleartopay-concordium.vercel.app/anchor/).

Design choices, and what protects the user:
- **Only a hash goes on-chain.** The 36-byte anchor is `CTP1` plus the receipt's SHA-256. Invoice details stay with the business, and a random salt in every receipt means the hash cannot be matched to a guessed invoice.
- **The rules are enforced in the record itself.** A receipt cannot say CLEARED unless the sending agent passed the badge gate and two different people signed.
- **Tamper-evident link.** Each receipt carries the hash of the one before it, so a receipt that was changed breaks the link to the next one. On its own this is a link, not a complete log: the escrow contract's `Decision` events are the authoritative, ordered record.
- **What an anchor proves.** A RegisterData anchor proves that this exact receipt existed, unchanged, at that time, and the verifier refuses any receipt that breaks a rule (for example CLEARED without the badge gate or without two people in two roles). It does not by itself prove who issued the receipt; that is what the contract's `Decision` event is for.
- **Same bytes everywhere.** Receipts use a strict canonical JSON (sorted keys, amounts as strings, no floats), so the command line and the browser compute the same hash.

## Licence
MIT
