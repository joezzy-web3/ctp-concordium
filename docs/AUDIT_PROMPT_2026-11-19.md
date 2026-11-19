# Audit prompt: Clear to Pay on Concordium (19 Nov 2026)

Copy everything below the line into the auditing AI, together with the repo link https://github.com/joezzy-web3/ctp-concordium (commit `28ecbac` or later).

---

You are a senior security auditor and hackathon judge. Audit the repository **joezzy-web3/ctp-concordium**: Clear to Pay, an accountable supplier-payment agent for the Concordium Trusted Agents Hackathon (submission due Wed 9 Dec 2026, 23:59 UTC). Judging order: (1) depth of integration with Concordium identity, the Agent Registry and payments, (2) path to production, (3) a working end-to-end demo, (4) usefulness. The brief asks teams to take an agent they already run on another chain and make it accountable: a verified human behind it, paying and getting paid on its own, leaving a record.

Be adversarial and specific. For every finding give: file and line, severity (critical / high / medium / low / note), a concrete exploit or failure scenario, and a fix. Do not report style preferences. Say clearly when something is fine.

## What exists (all on Concordium testnet)
- **Agent #1287** in the CIS-8004 registry `<12802,0>`; Agent Card at `agent-card.json`, its SHA-256 anchored with `setAgentURI` (signing page `sign/`); the registry's own `check-badge` passes all 15 checks.
- **Badge gate** `gate/badgeGate.js`: checks a counterparty agent from two sources (the registry service, plus fetching and hashing the card itself); returns CLEARED / HELD / REFUSED with codes; fails closed.
- **Receipts** `receipt/`: canonical JSON, salted, chained by `prev`; `CTP1` + SHA-256 anchored with RegisterData from `anchor/`. First receipt anchored (see PLAN.md).
- **NEAR link** `link/`: the NEAR owner key of `buyer.cleartopay.testnet` signs the CIS-8 canonical message (namespace `near:testnet`, scheme `solana-ed25519`); `registerExternalKey` on CIS-8 `<12801,0>` and `setExternalReference` on Agent #1287 both succeeded on-chain. `prepare.mjs` rebuilds every registry-built byte from the spec.
- **Escrow contract draft** `contract/` (Rust, concordium-std 11), **not deployed yet**: `rules.rs` (pure verdict logic, 13 tests) and `lib.rs` (admin, signers, agents, suppliers, CCD escrow, commit-reveal blind counts, `submit_invoice`, `execute_payment`, `refund`, views, `Decision` event). Design: `contract/DESIGN.md`.
- Browser pages `sign/`, `anchor/`, `link/` are esbuild bundles (`app.js`) of `*/src/*.js`.
- Tests: `npm test` (34 Node tests), `cd contract && cargo test --lib` (13 Rust tests). CI: `.github/workflows/test.yml`.

## Audit these in particular
1. **Escrow contract (highest priority).**
   - Can anyone get paid without two different accounts in two different roles revealing counts equal to `expected_qty`?
   - Can money be paid twice, paid to the wrong account, or stuck forever? Check the order of `paid = true` vs `invoke_transfer`, `refund` vs `execute_payment` races, and refunds after payment.
   - Is the commit-reveal truly blind? Can a signer see or copy the other's count? Is the salt or preimage design weak?
   - Can the admin (buyer) redirect payouts? (Only the supplier should be able to change its payout account, and every change must restart the hold.)
   - Can an unregistered agent, a contract caller or a removed signer act? What happens to commits from a signer removed later?
   - Is `hold_ms` safe as an init parameter? Check timestamp overflow and slot-time assumptions.
   - Event size limits, unbounded vectors, energy exhaustion, and the error type mapping.
   - Anything a judge would call "not really on-chain".
2. **NEAR link.** Is signing the CIS-8 canonical message with a NEAR **full-access** key safe? Can the signature be replayed on NEAR, on mainnet, or on another contract? Is the secret key handling in `link/prepare.mjs` sound (read, sign, wipe, never print)? Is using `solana-ed25519` for a NEAR key correct and honestly explained?
3. **Badge gate.** SSRF via `agent_uri`, base58 validation, redirect handling, size caps, timeouts, the fail-closed behaviour, and trust in the hosted registry service.
4. **Receipts.** Canonical JSON correctness (key order, unicode, numbers), salt entropy, `prev` chaining, and whether "anyone can anchor any hash with RegisterData" weakens the claim. (The plan is that the contract's `Decision` event becomes the authoritative record.)
5. **Browser pages.** XSS (all values written with `innerHTML`), whether a page can be tricked into signing something other than what it shows, chain and account checks, and bundle provenance.
6. **Secrets and repo hygiene.** Anything secret committed, `.gitignore` gaps, and whether `link/bundle.json` and `link/registry-responses.json` contain only public data.
7. **Docs vs reality.** Every claim in README.md, PLAN.md, `*/README.md` and `contract/DESIGN.md` that the code or on-chain data does not support. Limitations must be written as a design choice plus what protects the user, never as a gap; flag any that are not.
8. **Judging.** The three highest-impact things to build or fix before 9 Dec for depth of integration (identity with Concordium ID proofs for the two signers, payments with x402 and/or a PLT stablecoin, the contract deployed and demoed), and anything that would embarrass us in the demo.

## Output format
1. Summary: up to 5 sentences.
2. Findings table, most severe first: id, severity, file:line, issue, scenario, fix.
3. "Verified fine" list: what you checked and found correct.
4. Top 3 priorities before submission.
