# Plan and open items

## Done
- [x] Agent Card built with the hosted MCP tool `build_agent_card`, hosted on GitHub Pages, served bytes verified (v1, superseded by v2 below).
- [x] **Registered on testnet: Agent #1287**, native, active. Agent ID (badge) `JyP9U25oUQ6KdnBBHdTYP`, owner `44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG`, registered 19 Nov 2026 13:41 (UTC+1), via the testnet Agent Registry app.
- [x] **Card v2 anchored on-chain.** Card rebuilt for testnet (v2, 2943 bytes, SHA-256 `b6567d9bdb984846f7f72a2769a42485888be98928b11398c6a58be1828e9588`) and anchored with `CIS-8004.setAgentURI` from the browser wallet via `sign/` (tx `9556522bc1a0decb964276fd7b4d13b9a6f5404a25d5a02692ae3c6ad80dec23`). The registry's own checks pass: `verify-agent-card` → `match: true`; `check-badge` → `badge_valid: true`, all 15 checks true, no issues.
- [x] **Feature 1, verify before you pay: badge gate** (`gate/`). Checks a counterparty agent's badge from two independent sources (the registry reads the chain; Clear to Pay fetches and hashes the card itself) and returns CLEARED / HELD / REFUSED with reason codes and evidence for the receipt. Fails closed. 15 tests (`npm test`), CI on every push.
- [x] **Feature 2, accountability receipt** (`receipt/`, `anchor/`). One canonical JSON record per decision (invoice, badge-gate evidence, verdict and codes, signers, deciding agent #1287, link to the previous receipt, random salt). Only `CTP1` + its SHA-256 (36 bytes) goes on-chain via RegisterData, signed by the agent owner in the browser wallet. Refuses to record CLEARED unless the gate cleared and two different humans signed. 13 tests; anchoring page dry-run checked against a mock wallet.

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
