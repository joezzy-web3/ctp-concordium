# Plan and open items

## Done
- [x] Agent Card built with the hosted MCP tool `build_agent_card`, hosted on GitHub Pages, served bytes verified (SHA-256 `0511a48682438ff1f82ff73276be53a682050dd3f3159b57c596263e01a05d71`).
- [x] **Registered on testnet: Agent #1287**, native, active. Agent ID (badge) `JyP9U25oUQ6KdnBBHdTYP`, owner `44FcwcyGN5cPLqtPtaCcJTnELkb9TM4PKpmVTQppJXQAmbiWeG`, registered 19 Nov 2026 13:41 (UTC+1), via the testnet Agent Registry app.

## Next
- [ ] Confirm the on-chain hash matches the hosted card (`verify_agent_card` / `GET /v1/verify-agent-card/{badge}` -> `match: true`).
- [ ] Badge gate: Clear to Pay refuses invoices from agents whose badge fails `check-badge` or `verify-agent-card` (reason codes).
- [ ] Verified human signers with Concordium ID (ZK proof of a role attribute). Ask at office hours whether Agent IDP is live on testnet.
- [ ] Escrow contract on testnet (Rust).
- [ ] Payouts (x402 / PLT, sponsored fees) and EU AI Act Article 12 audit trail.
- [ ] PATH_TO_PRODUCTION.md: LEI-verified buyer companies, signer keys via wallet-as-a-service (Dfns, MPC) or Tether WDK, branded app (no crypto wallet in sight), ZK attribute proofs.

## Do not forget
- [ ] **Cross-chain link to the NEAR agent.** Agent #1287 was registered as **Native** on purpose. Later, link the original Clear to Pay NEAR agent (github.com/joezzy-web3/clear-to-pay) as a cross-chain reference: CIS-8 key binding with its own ownership proof (`build_cis8_canonical_bytes` -> sign with the NEAR key -> `build_cis8_register` -> `build_set_external_reference`). The registry dashboard lists NEAR among supported cross-chain agents.
