# Plan and open items

## Dates (UTC)
- **Checkpoint 1:** Sun 22 Nov, 23:59 (idea text; draft Sat 21 Nov)
- **Office hours:** from Tue 24 Nov, 15:00 (ask: Agent IDP on testnet; NEAR namespace in CIS-8)
- **Submission:** Wed 9 Dec, 23:59 (repo, demo video, CCDExplorer links)

## Build order (agreed 19 Nov)
1. ~~NEAR link~~ done 19 Nov
2. **Escrow contract in Rust on testnet:** the two-signer rule, blind delivery counts, the 72-hour hold on new payout accounts and the badge requirement enforced on-chain; the contract itself emits the decision record, so a receipt can no longer be anchored by just anyone
3. Verified human signers with Concordium ID proofs
4. Payments: x402 service fees (and PLT stablecoin payout from escrow)
5. PATH_TO_PRODUCTION.md, mainnet registration, UI pass, demo video, audit prompt
6. Stretch: supplier trust passport, one-click team onboarding

## Audit 19 Nov (external AI, report F-01 to F-15)
- Fixed and tested: F-03 supplier approves its own invoice; F-05 removed signers cannot reveal; F-06 orders name their two signers; F-07 strict receipt validation; F-08/F-04 honest wording and a live-vs-in-progress table; F-09 hardened card fetch; F-10 pinned link bundle; F-11 timeouts and best-effort wipe documented; F-12 CI runs contract rules, WASM build and 14 end-to-end tests, rebuilds page bundles, runs on Windows; F-13 no HTML injection in pages; F-14 byte-exact JSON and wider ignores; F-15 hold range at init; decisions final once paid.
- F-02 fixed in escrow v3 (built and tested, to deploy): the contract asks the CIS-8004 registry `agentOf` itself at add_agent, submit_invoice and execute_payment; parser tested against the registry's real answer for Agent #1287. Also v3: `reject_invoice` (buyer or supplier) so a hijacked agent cannot jam an order.
- Open: F-01 two verified people (Concordium ID proofs; needs a verifier design: question for office hours Tue 24 Nov); re-anchor the Agent Card with the final escrow address.
- Reproducible contract: `Cargo.lock` committed, Rust pinned to 1.97.0, verifiable build in CI (`concordium/verifiable-sc-wasm32v1:1`), module SHA-256 at `d1bd4bf`: `29e25639c578ee88e44a98f22ced8ef1057a4cc511bcdba252b96896d7d48914`. End-to-end tests 14/14 in CI and on the developer machine.
- **Module to deploy:** verifiable build of commit `471f25f` (CI run 44586331198, artifact `ctp_escrow-verifiable`), SHA-256 = module reference `6c8a0802c70dce0a169515ac0a32ceda0c60b2aa5fe8cd43e80fcf121f10a34c`; `verify-build` reports "Source and module match". Deploy page `deploy/` refuses any other file.

## Escrow v2: deployed 19 Nov 2026 20:34 at `<13092,0>`
- Deploy tx `00762ac602569316657f1950a92b7a615d4925afe221077cf404be5c13a701bc`; created by buyer admin `4QzE6Z…cEmTthG` (init tx `62b5bc…`, block 51029168), hold 72 h.
- Cast set up in one transaction `5ceebe7c6dc59eed13eaa21cb6518429bbfda509748b6c8962c4530d51827ae3` (19 Nov 2026 20:43 Lagos, block 51029412): receiver, approver, agent #1287, supplier with its own payout account. **The supplier's 72-hour hold ends Sun 22 Nov 2026 19:43 UTC** (20:43 Lagos): from then, order #1 can clear and pay.
- Order #1 created and funded with 25 CCD (100 units, receiver 3NrB…, approver 3byi…, supplier 45H8…): tx `e866ae55d55e883d7d5d5f6817c598557264322e6f54ddd52aa1a73c89c7285e`, 19 Nov 2026 20:47 Lagos.
- Verifiable build of `1796a52` (CI run 44595683477), module `532e6af284237b73fec30571e715cbd2e6567a1c110d82aeaa7cea64da537f27`, "Source and module match", 16/16 end-to-end tests incl. the underpay attack.
- Console UX pass after deploy, from the NEAR console: Review pane showing exactly what the wallet signs, order wizard with Edit per section and one signed transaction, PO as printable PDF, re-read the contract before signing, invite links for suppliers and signers.

## Escrow v5: deployed 20 Nov 2026 19:23 Lagos at `<13102,0>` (module ae80470a, 1-minute hold; init tx adc57a828f6a70530d8999de4a0868a39ff1413493219f8ff8ec99aa71ee3ca1)
- **Escrow v6 (audit of 21 Nov):** branch `v6-audit-fixes`, CI run 44887957697, module `ec8aa1da1bf370b3241a723862ff089cd6549b41e8f38e19bd7fcfad33a94b73`, "Source and module match", 26 rule tests + 54 end-to-end tests. Fixes H1 (gate record survives recounts), H2 (approver window), M1 (referee change by agreement), M2 (7 days to invoice after a Delivered ruling), L3 (counters are not the supplier or agent). Deployed 21 Nov 2026 10:16 Lagos at `<13106,0>` (init tx 65f73af65fdde13eb96b0d5f480e89b3a74abcedc06b2dc89c274e878d70054a), replacing `<13102,0>`.
- Approver is optional (individual buyers): branch `optional-approver`, CI run 44790283400, module `ae80470a9c3487d58ae93aad3dc6a7508da5a5e3624d1af154134eba0e9fefa6`, "Source and module match", 23 rule tests + 48 end-to-end tests. This is the module to deploy; it replaces the `160f7155` build below.
- Superseded: verifiable build of branch `escrow-v5` (CI run 44787255174), module `160f7155f5d14c0ab6e016085dbee0b6c171968dd7125a054acad1e072cdbf96`, "Source and module match", 23 rule tests + 47 end-to-end tests. Init unchanged (`hold_ms`, `registry <12802,0>`).
- What changed: supplier names a delivery rep at acceptance; delivery confirmed when receiver and rep agree (approver can hold by disagreeing); referee named per order rules disputes; counters fixed per order; reseal before unsealing and recount on missing unseal; one agent per order; date proposals by side with 7-day expiry; agent token checked at payment; round in the seal (CTP-count/v3); quantity > 0; refunds to the funder; SamePerson check on signer identity fingerprints (F-01 groundwork).
- Before the live run: a referee account (any account outside the cast) and, for F-01 later, a signer account under a second identity.

## Escrow v4 (test run): deployed 20 Nov 2026 10:56 Lagos at `<13098,0>`
- Module `ad60bdff1c57a8b54f684a159b149e21bfb0721f54a91263d3a0c184a28c7e52` (verifiable build, CI run 44703255024), created by the buyer `4QzE6Z…TthG` in tx `3e08d66a1833f7076134fbb3c75f4500b5f32b910c2ffd20eca276a47f07dddf` (block 51055007). **Payout hold 1 minute**, so the whole flow can be tested in one sitting. The demo contract will be created again with the 72-hour hold.
- The app and the console now point at `<13098,0>`.
- **First full live run, 20 Nov 2026 (order #1, 5 CCD, 50 bags):** setup (the contract checked Agent #1287 in the real registry), order, supplier accepted the date, receiver and approver sealed and unsealed 50 each, agent submitted the invoice (registry checked again), supplier approved the same file's fingerprint, supplier asked for payment: CLEARED, 5 CCD to `45H8…ixMY` in tx `e921b5657c0105d768122ee070dad4efd97eec9ac4a806d45fc2cb40852f2947`. Fee 15.26 CCD on testnet (contract creation cost 8.16 CCD), so measure energy per step in CI for the cost write-up.

## Escrow v4: ready to deploy (supersedes v3, never deployed)
- Verifiable build of `e8da788` (CI run 44702936059; contract code from `01b697a`), module `ad60bdff1c57a8b54f684a159b149e21bfb0721f54a91263d3a0c184a28c7e52`, "Source and module match", 20 unit + 34 end-to-end tests. Init unchanged: `hold_ms` and `registry: <12802,0>`. Deploy page pinned to it; it offers a 1-minute hold for test runs.
- v3 self-audit (19 Nov night): each count seal now includes its signer's account (a copied seal never opens). v4 (20 Nov): agreed date accepted by the supplier, refund locked once accepted (until the date passes with the order not ready, or the supplier releases), buyer cannot reject an invoice the supplier approved, recounts (max 2, buyer or supplier), supplier or buyer can ask for payment, removal events, setup skips an existing supplier, two-step admin handover.
- After deploy: Buyer, then Readiness, then "Set up the whole cast" (the contract checks Agent #1287 in the real registry), point the app at the new index. Final demo contract must be set up 72 h before recording; deadline Wed 9 Dec.
- Not yet audited by a second AI (the prompt is kept outside the repo).

## Demo cast (testnet accounts, public addresses)
| Role | Account |
|---|---|
| Buyer admin of `<13091,0>` | `4QzE6ZTUg2j5FCH4fxyvNLEvcmuY3w8PrTZ66qjqocycEmTthG` |
| Agent (owner of Agent #1287) | `44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG` |
| Receiver | `3NrB4khEwjL32cM8qVsay6iHTRznthBFPNCG6GvmLNQygyVE2S` |
| Approver | `3byivDufzZzRRFasdEcL6pYM9zyyER73kaYvraPWb1rVixy9pA` |
| Supplier (also its payout account) | `45H81t8SBw5z84LjPcX3VFZRWPrcEKv3bTbao8yC5hbP2BixMY` |

All five come from one tester's identity on testnet. That is exactly the gap Concordium ID proofs close (build order 3): in production each signer proves they are a different verified person.

## Done
- [x] Agent Card built with the hosted MCP tool `build_agent_card`, hosted on GitHub Pages, served bytes verified (v1, superseded by v2 below).
- [x] **Registered on testnet: Agent #1287**, native, active. Agent ID (badge) `JyP9U25oUQ6KdnBBHdTYP`, owner `44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG`, registered 19 Nov 2026 13:41 (UTC+1), via the testnet Agent Registry app.
- [x] **Card v2 anchored on-chain.** Card rebuilt for testnet (v2, 2943 bytes, SHA-256 `b6567d9bdb984846f7f72a2769a42485888be98928b11398c6a58be1828e9588`) and anchored with `CIS-8004.setAgentURI` from the browser wallet via `sign/` (tx `9556522bc1a0decb964276fd7b4d13b9a6f5404a25d5a02692ae3c6ad80dec23`). The registry's own checks pass: `verify-agent-card` → `match: true`; `check-badge` → `badge_valid: true`, all 15 checks true, no issues.
- [x] **Feature 1, verify before you pay: badge gate** (`gate/`). Checks a counterparty agent's badge from two independent sources (the registry reads the chain; Clear to Pay fetches and hashes the card itself) and returns CLEARED / HELD / REFUSED with reason codes and evidence for the receipt. Fails closed. 15 tests (`npm test`), CI on every push.
- [x] **Feature 2, accountability receipt** (`receipt/`, `anchor/`). One canonical JSON record per decision (invoice, badge-gate evidence, verdict and codes, signers, deciding agent #1287, link to the previous receipt, random salt). Only `CTP1` + its SHA-256 (36 bytes) goes on-chain via RegisterData, signed by the agent owner in the browser wallet. Refuses to record CLEARED unless the gate cleared and two different humans signed. 13 tests; First receipt anchored on testnet 19 Nov 2026: verdict CLEARED, receipt hash `7072261d7d5b212647c4be64469d8fba9c9e69e8e6869cbdab0c83fe06673c61`, RegisterData tx `6ee54f73adee62d2ca1dfb1f03a9dc492c123884daa5a0c81d61f30c31639d01`; CCDScan shows the data as `CTP1` + that hash.
- [x] **NEAR link: Agent #1287 is bound to the NEAR agent.** The NEAR owner key of `buyer.cleartopay.testnet` (`ed25519:CbHyry…QvbK`, namespace `near:testnet`) signed the CIS-8 canonical message; every registry-built byte matched our spec encoder. `registerExternalKey` on CIS-8 `<12801,0>` (tx `c33957395cb0176e4b8994bf5f94741fa69fdf1d5f5c2dac5e9f0efcddf2c5e3`, the contract verified the NEAR signature) and `setExternalReference` on Agent #1287 (tx `3837cc7a487731da88b6aa183fd62489e9e9f1da534cddc082cdfcc271f7c1d7`; the registry called CIS-8 mid-transaction to confirm the binding before attaching it). 19 Nov 2026.
- [x] **Escrow v1 deployed on testnet: `<13091,0>` (superseded by v2: the supplier now approves the amount too, so a buyer cannot underpay; one-transaction setup).** Module `6c8a0802c70dce0a169515ac0a32ceda0c60b2aa5fe8cd43e80fcf121f10a34c` (verifiable build of `471f25f`; verify with that commit's source archive, since later edits under `contract/` change the build hash), deploy tx `841990e37d7e55b79d7c1dc185ee6e76eb3c81f661d30202bf2c318bbff6d4af`, create tx `e53c212f4a5b3eaf822eef56a1163e729ba10c27ca33b98123963b639153dc64` with `hold_ms` 259200000 (72 h). Buyer admin `4QzE6ZTUg2j5FCH4fxyvNLEvcmuY3w8PrTZ66qjqocycEmTthG`. 19 Nov 2026.

## How we answer the brief
The brief: *take an AI agent you already run on another chain and make it accountable: prove a verified human stands behind it, pay and get paid on its own, and leave a record.*

| Brief asks | Clear to Pay answer | Concordium component |
|---|---|---|
| An agent you already run, on another chain | The Clear to Pay agent already guards supplier payments on **NEAR**; linked to Agent #1287 by a CIS-8 key binding | Agent Registry (CIS-8004), CIS-8, ERC-8004 / A2A Agent Card |
| Prove a verified human stands behind it | Verified by Concordium badge; owner account backed by Concordium ID; signers prove a role attribute in zero knowledge | Badge, Concordium ID, Verify and Access |
| Other agents check it before dealing with it | Clear to Pay checks every counterparty agent's badge and card hash; refuses unverified ones with a reason code | Agent Registry MCP server / REST (`check-badge`, `verify-agent-card`) |
| Pay and get paid on its own | **Service money only:** other agents pay Clear to Pay per invoice check (get paid); Clear to Pay pays for the data it needs, e.g. a company-registry lookup (pay). **Supplier money never moves on an AI's word:** it stays in escrow until humans sign | x402, sponsored transactions, PLTs |
| Leave a record | Accountability receipt for every pay or block decision, anchored on-chain, checkable by an auditor | EU AI Act Art. 12 audit trail |

Judging: 1 depth of integration (identity + registry + payments), 2 path to production, 3 end-to-end demo, 4 usefulness. Submission needs a CCDExplorer link (ccdexplorer.io) plus testnet.ccdscan.io.

## Features (approved 19 Nov)
1. **Verify before you pay:** plain-English verdict on any incoming agent ("sent by an agent owned by a verified company: badge valid, card untampered" / "unverified agent: blocked").
2. **Accountability receipt** (signature feature): every decision produces a receipt with link and QR code: agent, verified owner, signers, rules passed, on-chain proof. Checkable by an auditor with no crypto knowledge.
3. **Supplier trust passport** (stretch): a supplier verifies once with Concordium ID; it travels to every buyer.
4. **One-click team onboarding** (polish, last): connect company, invite storekeeper and weighbridge, done.

## Next
- [ ] Confirm the on-chain hash matches the hosted card (`verify_agent_card` / `GET /v1/verify-agent-card/{badge}` -> `match: true`).
- [ ] Badge gate: Clear to Pay refuses invoices from agents whose badge fails `check-badge` or `verify-agent-card` (reason codes).
- [ ] Verified human signers with Concordium ID (ZK proof of a role attribute). Ask at office hours whether Agent IDP is live on testnet.
- [ ] Escrow contract on testnet (Rust).
- [ ] Payouts (x402 / PLT, sponsored fees) and EU AI Act Article 12 audit trail.
- [ ] PATH_TO_PRODUCTION.md: LEI-verified buyer companies, signer keys via wallet-as-a-service (Dfns, MPC) or Tether WDK, branded app (no crypto wallet in sight), ZK attribute proofs.

## Do not forget
- [ ] **Cross-chain link to the NEAR agent (now a headline item: the brief asks for an agent you already run on another chain).** Agent #1287 was registered as **Native** on purpose. Later, link the original Clear to Pay NEAR agent (github.com/joezzy-web3/clear-to-pay) as a cross-chain reference: CIS-8 key binding with its own ownership proof (`build_cis8_canonical_bytes` -> sign with the NEAR key -> `build_cis8_register` -> `build_set_external_reference`). The registry dashboard lists NEAR among supported cross-chain agents.
