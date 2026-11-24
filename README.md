# Clear to Pay on Concordium

[![test](https://github.com/joezzy-web3/ctp-concordium/actions/workflows/test.yml/badge.svg)](https://github.com/joezzy-web3/ctp-concordium/actions/workflows/test.yml) ![Concordium testnet](https://img.shields.io/badge/Concordium-testnet-10264A) [![Verified on CCDExplorer](https://img.shields.io/badge/CCDExplorer-Verified-1E8E5E)](https://ccdexplorer.io/testnet/module/d6d99ee4b4c8c7b71e00f06aa4b410bb0552871392439f528da6183a56f58d5b) ![Licence MIT](https://img.shields.io/badge/licence-MIT-E3B23C)

### The AI asks. The contract decides.

In 2024 an AI agent guarding $47,000 had one rule: never send the money. One message later, it did. A rule in a prompt is not a rule.

Clear to Pay lets AI agents handle supplier payments without being able to move money on their own. An agent (here, Claude) submits the invoice. Two people, one from each side, count the delivery blind; the buyer's counters can prove with **Concordium ID** that they're real verified adults, and the escrow refuses an order where one person would count twice. The supplier approves the exact invoice from its own account. Only then does the escrow contract on Concordium pay, and only to the supplier's own payout account. Tell the agent to skip the checks and the contract answers **Held**, on the record.

> **Judges: 3 minutes, nothing to install.**
> 1. **See it happen on-chain.** Claude was told to skip the checks and pay; the contract answered **[Held](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=32ae2fc71afb59aa6b667917fc5dc30572468bf25657d296064235d781295095)**. The supplier approved its invoice from its own account, Claude asked again: **[Cleared](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a5157713b6999186ac4996160acd5edaefee009cd7a10b19da972e0e1693a832)**, 2 CCD to the supplier's payout account. Both on escrow `<13155,0>`.
> 2. **Check the code is the code.** CCDExplorer downloads our source, rebuilds it and shows **[Verified: source and module match](https://ccdexplorer.io/testnet/module/d6d99ee4b4c8c7b71e00f06aa4b410bb0552871392439f528da6183a56f58d5b)**.
> 3. **Try to break it yourself, no wallet.** [Judge mode](https://cleartopay-concordium.vercel.app/app/#/judge) runs 13 attacks against the live contract as dry runs (the real contract's answer, nothing spent): hijacked agents, a hijacked supplier account, a clerk fooled by "new bank details", a buyer pulling its agent to keep delivered goods unpaid, a paid order paid twice.
> 4. **Run it for a company.** [Start your own escrow](https://cleartopay-concordium.vercel.app/app/#/start) in three steps (Concordium Browser Wallet on testnet).

## Judge summary

**Threat:** an AI agent with payment powers is talked into, tricked into or hijacked into paying the wrong party, the wrong amount, or for goods that never arrived.
**Invariant:** only the escrow contract can pay, and only to the supplier's own payout account, when two blind counts by independent people match the order, the supplier approved that exact invoice and amount from its own account, the payout account has waited out its hold, and the agent checks out in Concordium's Agent Registry. Every request is decided on-chain, and recorded either way.
**Try it:** [the app](https://cleartopay-concordium.vercel.app/app/) · [Judge mode](https://cleartopay-concordium.vercel.app/app/#/judge) (no wallet) · [landing page](https://cleartopay-concordium.vercel.app/)
**Proof:** [Held](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=32ae2fc71afb59aa6b667917fc5dc30572468bf25657d296064235d781295095) · [Cleared](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a5157713b6999186ac4996160acd5edaefee009cd7a10b19da972e0e1693a832) · [Verified module](https://ccdexplorer.io/testnet/module/d6d99ee4b4c8c7b71e00f06aa4b410bb0552871392439f528da6183a56f58d5b) · 26 rule tests and 59 end-to-end tests on the compiled contract, 83 app, MCP and ID-check tests · four security reviews (19, 20, 21, 24 Nov), every finding fixed or answered in [DESIGN.md](contract/DESIGN.md)
**Status:** live on Concordium testnet; an independent audit comes before mainnet ([path to production](PATH_TO_PRODUCTION.md)). [Threat model](THREAT_MODEL.md) · [Proof log](docs/testnet-proof.md) · For AI reviewers: [llms.txt](llms.txt).

Built for the [Concordium Trusted Agents Hackathon](https://www.encodeclub.com/programmes/concordium-trusted-agents-hackathon) (Encode Club, Nov–Dec 2026). Runs on **Concordium testnet**. The idea started on [NEAR](https://github.com/joezzy-web3/clear-to-pay); the same agent is now linked across both chains.

## Why now

AI agents are starting to pay invoices, and the fraud that targets invoice payments is at a record high.

- **$3.05 billion lost to business email compromise in 2025**, across 24,768 complaints: about **$123,000 a case**. Most of it went by wire transfer, a payment pushed to an account someone changed. ([FBI IC3 2025 Internet Crime Report](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf))
- **74% of US organizations were hit by business email compromise in 2025**, up from 63% in 2024. ([AFP 2026 Payments Fraud and Control Survey](https://www.financialprofessionals.org/about/learn-more/press-releases/Details/over-75-percent-of-us-firms-experienced-payments-fraud-in-2025-while-ai-adoption-for-fraud-mitigation-lags))
- **AI fraud now has its own chapter.** The FBI's 2025 report is the first in 25 years with an AI section: 22,364 complaints and $893 million lost, both flagged as undercounts. ([FBI IC3 2025](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf))
- **67% of finance teams already run AI in accounts payable; 39% have the operating model to run it at scale.** ([Forrester Consulting for Basware, 2026](https://www.cpapracticeadvisor.com/2026/07/28/finance-leaders-are-ready-to-increase-ai-but-most-arent-ready-to-control-it/187497/))

That gap is what Clear to Pay is for. An invoice agent that can be talked into a payment is a new way in for the oldest fraud in procurement. Clear to Pay keeps the agent useful and takes the payment decision away from it.

## How Clear to Pay meets the brief

| The brief asks for | What Clear to Pay does, live on testnet | Code |
|---|---|---|
| **Concordium identity, zero knowledge** | Not only the person behind the agent: the **people who count deliveries** prove with Concordium ID that they are real verified adults (the buyer turns it on per counter; a counter proves once). The escrow keeps only a salted fingerprint and refuses an order whose receiver and approver are the same person. | `app/src/ids.js`, `idcheck/src/core.js`; the same-person check in `create_order`, `contract/src/lib.rs`; test `two_signers_proven_to_be_the_same_person_cannot_share_an_order` |
| **Agent Registry (ERC-8004 / CIS-8004)** | Agent #1287 is registered with an ERC-8004 Agent Card and the Verified by Concordium badge. The **contract itself reads the registry on-chain** when the agent is listed, at every invoice and at every payment request, and refuses a revoked, transferred or hijacked agent. | `verify_agent` in `contract/src/lib.rs`; tests `a_revoked_agent_is_refused_at_once`, `an_agent_transferred_to_someone_else_is_refused` |
| **Link the agent you already run** | Agent #1287 is linked via CIS-8 to the original Clear to Pay agent on NEAR, `buyer.cleartopay.testnet`. | `link/` ([link tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=3837cc7a487731da88b6aa183fd62489e9e9f1da534cddc082cdfcc271f7c1d7)) |
| **Agent payments** | The agent asks; the escrow pays the supplier only when every rule passes, and records a Decision event either way. | `execute_payment` in `contract/src/lib.rs`, the rules in `contract/src/rules.rs` |
| **Accountability (EU AI Act record keeping)** | Every request the agent makes is decided and logged by the contract with its reason, including refusals. Each payment's receipt fingerprint is written into the contract's own Decision event. | `Decision` events in `contract/src/lib.rs`, `receipt/escrowReceipt.js` |
| **Your existing framework** | An MCP server: Claude Desktop works the escrow without any change to Claude. | `mcp/` (setup in `mcp/README.md`) |
| **Path to production** | Any company can already start its own escrow from the verified code. Next: audit, mainnet, stablecoin payouts, sponsored fees. See [PATH_TO_PRODUCTION.md](PATH_TO_PRODUCTION.md). | `app/src/start.js` |

## What's live

Every row links to on-chain evidence or runs in the test suite.

| Piece | Status | Evidence |
|---|---|---|
| **Escrow v7, full live run with Claude (24 Nov 2026):** receiver proved with Concordium ID, blind count 20 = 20, Claude submitted the invoice over MCP, refused to skip the checks, was sent anyway and got **Held** on-chain; the supplier approved from its own account and the same request **Cleared**, 2 CCD to the supplier's payout account | **Live (testnet)** | `<13155,0>`, module `d6d99ee4…` **Verified on CCDExplorer**; [Held](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=32ae2fc71afb59aa6b667917fc5dc30572468bf25657d296064235d781295095) · [Cleared](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a5157713b6999186ac4996160acd5edaefee009cd7a10b19da972e0e1693a832); 26 rule tests, 59 end-to-end tests. v7 adds the fixes from the 24 Nov audit: a confirmed delivery is always the supplier's money (it can invoice it itself), and only the supplier decides where it is paid |
| Counters proven with Concordium ID (zero knowledge): each receiver and approver proves they are a verified adult; the escrow keeps only a salted fingerprint and refuses an order whose receiver and approver are the same person | **Live (testnet)**: the receiver on order #1 of `<13155,0>` was verified and recorded on the escrow | ID checks in the app (`#/buyer/ids`), `test/idcheck.test.js`, design in `docs/F01_SIGNER_IDENTITY.md` |
| The contract checks the agent in the CIS-8004 registry itself, when the agent is added and at every invoice and payment request | **Live (testnet)** | it read the real registry for Agent #1287 at setup and again at the invoice in the first live order; end-to-end tests cover revoked, transferred and hijacked agents |
| Agent #1287 registered (CIS-8004), Agent Card anchored, Verified by Concordium badge | **Live (testnet)** | registry `check-badge`: all 15 checks pass; card anchor tx below |
| Cross-chain link to the Clear to Pay agent on NEAR (CIS-8) | **Live (testnet)** | CIS-8 checked the NEAR signature; registry confirmed the binding before attaching it (link tx below) |
| MCP server: Claude Desktop (or any MCP client) works the escrow as Agent #1287: read orders, dry-run a payment, submit an invoice, ask for payment. The contract still decides every payment | **Live (testnet)**: Claude ran the whole 24 Nov run through it, including the refusal and the Held and Cleared requests | `mcp/`, `npm test`; setup in `mcp/README.md` |
| **Any company can start its own escrow** in the app (`#/start`): create it from the verified module, list its own people and agent, order. Each escrow is its own contract with its own money and admin; the app refuses any contract not running the verified code | **Live (testnet)** | `app/src/start.js`; open any escrow with `…/app/?escrow=<index>` |
| Payment receipts: the receipt's fingerprint is written into the contract's own Decision event | **Live (testnet)** | `receipt/escrowReceipt.js`, `npm test`; check a receipt in the app under Judge mode |
| Badge gate: refuse counterparty agents whose badge or card does not check out | **Live (off-chain code)** | `gate/`, `npm test` |
| Stablecoin payout, sponsored fees, shared escrow, mainnet | Next steps, each an extension of what runs today | [PATH_TO_PRODUCTION.md](PATH_TO_PRODUCTION.md) |

<details><summary>Earlier escrow versions (each audited, fixed and redeployed)</summary>

| Piece | Status | Evidence |
|---|---|---|
| Escrow v6: the same live run with Claude, on the first module CCDExplorer verified for us (after we reported its `wasm32v1` bug). Replaced by v7 after the 24 Nov audit | **Live (testnet)**, 24 Nov 2026 | `<13151,0>`, module `196930b8…` ([Verified](https://ccdexplorer.io/testnet/module/196930b8de58a1ef92a97480322cd0c0051c99be3fdb2f459567e9c426e6fdde)); [Held](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a982793ae64558268d5433bdcd81e81676efc6d2ea1dc5e18a770297c656b264) · [Cleared](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a59615fdb70d30d3e8ca4c3c1824ad788cbd652ca9925efa782a913230a79185); 26 rule tests, 54 end-to-end tests. First v6 run: `<13106,0>`, 21 Nov |
| Escrow v5: each side has a counter the other does not choose (buyer's receiver, supplier's delivery rep), a referee for disputes, one agent per order, seals bound to signer and round, refunds to the funder | **Live (testnet)**, deployed 20 Nov 2026 | `<13102,0>`, module `ae80470a…` = verifiable build; 23 rule tests, 47 end-to-end tests on the compiled contract, one per attack from the 20 Nov audit |
| Escrow contract v4: two named people in two roles count blind (each seal bound to its signer), the supplier accepts the order and its latest date, approves its own invoice and amount, payout hold on new payout accounts, pays only on CLEARED, logs every decision | **Live (testnet)**, full order paid on 20 Nov 2026 | `<13098,0>`, module `ad60bdff…a28c7e52` = verifiable build ([first payment](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=e921b5657c0105d768122ee070dad4efd97eec9ac4a806d45fc2cb40852f2947)); 20 rule tests, 34 end-to-end tests |

</details>

## How we got here

Clear to Pay started as a habit, not a hackathon idea. In a shipyard, nothing is paid until the goods are counted at the gate against the purchase order and the invoice matches what arrived. Ships sail when cleared. This project puts that check into code, so an AI agent can do the paperwork without holding the money.

| When | What | Evidence |
|---|---|---|
| 30 Oct 2026 | First build on NEAR: supplier registry with a 72-hour cool-off on payout changes, signed invoices and delivery notes, CI with a secret scan, first security review the same day | [NEAR repo, first commits](https://github.com/joezzy-web3/clear-to-pay/commits/main) |
| 1 Nov | Baseline: the same attacks against an allowlist-and-limits guard (paid 9 of 11) and Clear to Pay (paid 0 of 11); first threat model | [baseline](https://github.com/joezzy-web3/clear-to-pay/blob/main/docs/baseline.md) · [threat model](https://github.com/joezzy-web3/clear-to-pay/blob/main/THREAT_MODEL.md) |
| 30 Oct – 12 Nov | Eleven security reviews on NEAR, every finding answered in the README | [Security review](https://github.com/joezzy-web3/clear-to-pay#security-review) |
| 19 Nov | Rebuilt from scratch for Concordium: Agent #1287 registered and linked to the NEAR agent, escrow v1 and v2 deployed, first audit (F-01 to F-15) | [proof log](docs/testnet-proof.md) |
| 20 Nov | First full payment on-chain (v4); second audit, fixed in v5 | [Cleared, v4](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=e921b5657c0105d768122ee070dad4efd97eec9ac4a806d45fc2cb40852f2947) · [v5 fixes](https://github.com/joezzy-web3/ctp-concordium/commit/fbbcb5caf04eca9a48a8a5d777258993c59663b3) |
| 21 Nov | Third audit, fixed in v6; first v6 run | [v6 fixes](https://github.com/joezzy-web3/ctp-concordium/commit/948e9b6f406af42e8e3401989e03b7095e5b156d) |
| 22–24 Nov | Found that CCDExplorer could not verify `wasm32v1` builds, reported it, the maintainer fixed it; module **Verified** | [Verified module](https://ccdexplorer.io/testnet/module/196930b8de58a1ef92a97480322cd0c0051c99be3fdb2f459567e9c426e6fdde) |
| 24 Nov | Full run with Claude on v6 `<13151,0>`: Held, then Cleared. Any company can start its own escrow | [Held](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a982793ae64558268d5433bdcd81e81676efc6d2ea1dc5e18a770297c656b264) · [Cleared](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a59615fdb70d30d3e8ca4c3c1824ad788cbd652ca9925efa782a913230a79185) |
| 24 Nov | Fourth audit: two High findings between buyer and supplier (a buyer could keep a counted delivery unpaid; a clerk typed in the supplier's payout account). Fixed in v7 the same evening, tests first; module verified on the first try; the full run with Claude again on `<13155,0>` | [v7 fixes](https://github.com/joezzy-web3/ctp-concordium/pull/29) · [Held](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=32ae2fc71afb59aa6b667917fc5dc30572468bf25657d296064235d781295095) · [Cleared](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a5157713b6999186ac4996160acd5edaefee009cd7a10b19da972e0e1693a832) |

Over 300 commits across the two repos, fifteen security reviews, and every threat mapped to a test in [THREAT_MODEL.md](THREAT_MODEL.md).

## Testnet references
| What | Value |
|---|---|
| Agent Registry (CIS-8004) | `<12802,0>` |
| Key registry (CIS-8) | `<12801,0>` |
| Explorer | [Escrow `<13155,0>` on CCDExplorer](https://ccdexplorer.io/testnet/instance/13155/0) (module **Verified**) · [on CCDScan](https://testnet.ccdscan.io/?dentity=contract&dcontractAddressIndex=13155&dcontractAddressSubIndex=0) · [Agent Registry `<12802,0>`](https://ccdexplorer.io/testnet/instance/12802/0) |
| Agent Card | https://joezzy-web3.github.io/ctp-concordium/agent-card.json |
| **Escrow contract (live, test run)** | `<13155,0>` (v7) · module `d6d99ee4b4c8c7b71e00f06aa4b410bb0552871392439f528da6183a56f58d5b`, **Verified on CCDExplorer** (source and module match) · buyer admin `4QzE6Z…cEmTthG` · payout hold 1 minute, so the full flow runs in one sitting (new escrows default to 72 hours) · [app](https://cleartopay-concordium.vercel.app/app/) |
| **Escrow contract (v6, 24 Nov)** | `<13151,0>`, module `196930b8de58a1ef92a97480322cd0c0051c99be3fdb2f459567e9c426e6fdde` (Verified); first v6 run `<13106,0>` (21 Nov). Replaced by v7 |
| **Escrow contract (earlier)** | `<13092,0>` (v2), superseded by v4 · module `532e6af284237b73fec30571e715cbd2e6567a1c110d82aeaa7cea64da537f27` |
| **Registered agent** | **#1287** · Agent ID `JyP9U25oUQ6KdnBBHdTYP` · owner `44Fcwcy…mbiWeG` · badge valid ([card anchor tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=9556522bc1a0decb964276fd7b4d13b9a6f5404a25d5a02692ae3c6ad80dec23)) · linked via CIS-8 to the NEAR agent `buyer.cleartopay.testnet` ([link tx](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=3837cc7a487731da88b6aa183fd62489e9e9f1da534cddc082cdfcc271f7c1d7)) |

Earlier work: [Clear to Pay on NEAR](https://github.com/joezzy-web3/clear-to-pay) (the idea and threat model, rebuilt from scratch for Concordium).

## Check the contract yourself

The escrow at `<13155,0>` runs module `d6d99ee4b4c8c7b71e00f06aa4b410bb0552871392439f528da6183a56f58d5b`. CCDExplorer downloads its source from the link embedded in the module, rebuilds it in Concordium's verifiable build image and shows **[Verified: source and module match](https://ccdexplorer.io/testnet/module/d6d99ee4b4c8c7b71e00f06aa4b410bb0552871392439f528da6183a56f58d5b)**.

To check it yourself:

1. Download the source archive: [release `escrow-v7-src1`](https://github.com/joezzy-web3/ctp-concordium/releases/tag/escrow-v7-src1) (`ctp_escrow.wasm.v1.tar`, SHA-256 `f652f0ddb233933a7e94e771148ea897f7ad0444d6353252d2afb677aa76dfeb`).
2. With Docker and `cargo-concordium` installed, build from the tagged commit (any later edit inside `contract/`, even to a README, changes the hash):
   ```
   git checkout escrow-v7-src1 && cd contract
   cargo concordium build --verifiable --out ctp_escrow.wasm.v1
   sha256sum ctp_escrow.wasm.v1
   ```
   This prints `f36a55cc…c735`: the same code before its source link was embedded. The [publish-module run](https://github.com/joezzy-web3/ctp-concordium/actions/runs/45459752646) does exactly this in public, then embeds the link with `edit-build-info --verify`, which gives `d6d99ee4…`.

While building this, we found that CCDExplorer could not verify builds from the `wasm32v1` image. We reported it with the module, archive and CI run; the CCDExplorer maintainer confirmed the bug and shipped a fix, and this module now verifies.

## How a payment clears (escrow contract)

`contract/` holds the escrow; `contract/DESIGN.md` has every rule. In the app, each person has their own space: buyer, delivery signers, supplier, agent and referee.

1. The buyer creates the order, locks the money in the contract, names its receiver (and, for a company, an approver), the agent and a referee, and sets the latest date for delivery and invoice. An individual buying for themselves is their own receiver.
2. The supplier accepts the order and that date from its own account, and names its delivery rep (the driver).
3. At the gate, the buyer's receiver and the supplier's rep each count and seal their number. Neither can see or copy the other's. The rep unloads only after the receiver has sealed: no count, no unload. The buyer's approver can check inside too.
4. The agent named on the order submits the invoice's fingerprint and amount. The contract asks the Concordium agent registry whether the agent is active and owned by the caller.
5. The supplier approves that exact invoice and amount.
6. The agent, the supplier or the buyer asks for the decision. The contract pays only when the receiver's and the rep's counts match the order, the approver (if it counted) agrees, the supplier approved, and the payout account has waited out its hold. It records a Decision event either way.
7. If the counts disagree after the rep has counted, the referee decides: delivered, or money back.

Design choices, and what protects the user:
- **The agent can be fooled; the money cannot.** A wrong, fake or edited invoice cannot change who is paid or how much: payment is fixed by the amount in escrow, the counts and the supplier's approval of that exact file's fingerprint.
- **The supplier is protected from the buyer's own counters.** If the supplier's rep counted a delivery and the buyer's counters disagree or stay silent, the buyer cannot take the money back alone, even after the date; only the referee can. A delivery both counters confirmed is the supplier's money: if the buyer's agent never invoices it, the supplier invoices it itself, and the buyer cannot take the money back until a week after the agreed date (`a_confirmed_delivery_is_not_refundable_when_the_buyers_agent_never_invoices`). The buyer cannot throw out an invoice the supplier approved for the full amount.
- **The buyer is protected from a false delivery.** The rep alone never confirms a delivery: the buyer's receiver must agree, and the buyer's approver can hold a payment by counting a different number. If the rep never counted, the buyer gets the money back after the date.
- **Stalls have a way out.** A lost seal key can be replaced before anyone unseals, a miscount gets a recount (at most 2, opened by the buyer or supplier), a disagreement goes to the referee, and an offline agent is replaced by the supplier or buyer asking under the same rules; the supplier can also invoice a confirmed delivery itself.
- **Fails safe.** If the contract cannot read the agent registry, it refuses.
- **Checks scale with the risk of the order.** ID checks and the approver are optional: the buyer chooses which counters prove their ID, and whether an order needs an approver. A small or high-volume buyer runs the minimum: buyer, one receiver, supplier. A counter proves their ID once; the escrow keeps them on its signer list, so every later order and delivery adds no extra steps.

## Why a contract, not a smarter prompt or a policy wallet

- **A smarter prompt** can be talked around: that is how Freysa lost $47,000. Clear to Pay never asks the model whether to pay. Claude reads, submits and asks; the contract decides.
- **A person clicking Approve** sees what the screen shows them. They cannot know whether 20 bags arrived at the gate, or whether the payout account was changed this morning.
- **A policy wallet** (spending limits, allowlisted payees) answers *may this agent spend this much, to this address?* Clear to Pay answers *is this invoice owed?* That takes checks a spending policy cannot express: two independent people counted the delivery blind, the supplier approved this exact invoice and amount from its own account, and the payee is the supplier's own account, aged by the payout hold. A hijacked but allowlisted payee still gets paid under a spending limit; under Clear to Pay it is **Held**.

## If a supplier is hacked

- **The money can't be redirected in a hurry.** Only the supplier can change its payout account (`set_payout` checks the sender), and every change restarts the payout hold: 72 hours on a production escrow. Until it passes, payment is **Held** (`HeldPayoutCoolOff`). Test: `a_new_payout_account_restarts_the_hold_and_only_the_supplier_can_set_it`; Judge mode: *A hijacked supplier account redirects the payout and asks to be paid*.
- **The buyer can't be used to redirect it either.** The buyer never types in where a supplier is paid: a new supplier is paid to its own account, and the contract refuses any other (`only_the_supplier_decides_where_it_is_paid`). Running setup again never changes a registered supplier (`setup_is_admin_only_and_running_it_again_leaves_a_supplier_untouched`). So a "new bank details" email to the buyer's clerk has nothing to change. Judge mode: *a clerk registers a supplier with the scammer's payout account*.
- **The amount can't be inflated.** Payment is fixed by the escrowed amount, the counts and the supplier's approval of that exact invoice; anything else is **Held** (`wrong_invoice_amount_is_held`, `buyer_and_agent_cannot_underpay_the_supplier`).
- **If the agent is hijacked instead,** it can only ask. The contract checks it in the registry at every invoice and payment, and only the agent named on the order may invoice it (`only_the_agent_named_on_the_order_can_invoice_it`).

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
