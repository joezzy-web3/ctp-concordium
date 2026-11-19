# Audit prompt: Clear to Pay escrow v3 (19 Nov 2026, night)

Paste everything below the line into the auditing AI, with the repo link https://github.com/joezzy-web3/ctp-concordium (commit `fa403c2` or later).

---

You are a senior smart-contract security auditor and a hackathon judge. Audit **joezzy-web3/ctp-concordium**: Clear to Pay, an accountable supplier-payment agent for the Concordium Trusted Agents Hackathon (final submission Wed 9 Dec 2026, 23:59 UTC). Judging order: (1) depth of integration with Concordium identity, the Agent Registry and payments, (2) path to production, (3) a working end-to-end demo, (4) usefulness.

Core claim we must be able to defend: **"Even if the AI agent is bypassed or hijacked, the contract still protects the money."**

Be adversarial and specific. For every finding give: file and line, severity (critical / high / medium / low / note), a concrete exploit or failure scenario, and a fix. No style preferences. Say clearly when something is fine. Do not repeat a finding from the "Already known" list unless you disagree with our assessment or the fix.

## What changed since the last audit (escrow v3, not yet deployed)
- `contract/src/registry.rs`: parses the CIS-8004 registry's real `agentOf` answer (Option tag, AgentView, then a u32 metadata count and entries, capped at 64). Tested against the real bytes of Agent #1287.
- `contract/src/lib.rs` `verify_agent`: the escrow calls the registry `<12802,0>` read-only (`agentOf`, parameter `[8, token_id LE]`) when an agent is added, and again at every `submit_invoice` and `execute_payment`. It requires active, the same token id, and owner == the calling account. LogicReject means AgentNotVerified; any other failure means RegistryUnavailable (fail closed).
- `reject_invoice(order_id)`: the buyer (admin) or the supplier clears a junk invoice and the supplier's approval, so a hijacked agent cannot jam an order.
- `approve_invoice{order_id, invoice_hash, amount}`: the supplier approves the exact invoice and amount from its own account. The rules hold payment without it.
- `setup`: signers, agents and suppliers in one transaction.
- Tonight's self-audit fix (`fa403c2`): the count seal is now `sha256("CTP-count/v2" ‖ order_id LE ‖ signer account 32 bytes ‖ qty LE ‖ salt 32)`. Before, the seal did not include the signer, so the second signer could commit the first signer's public seal and replay the first reveal. The app's `app/src/codec.js` `sealOf` matches, with a test.
- `contract/mock-registry/`: a test-only registry; `contract/tests/escrow.rs` has 22 end-to-end tests on the compiled Wasm. `contract/src/rules.rs` has the pure verdict logic (20 unit tests).
- Verifiable build in CI (`.github/workflows/test.yml`), with `verify-build` against the source tar. The deploy page `deploy/` refuses any module whose SHA-256 is not the pinned one.
- App `app/`: role spaces for buyer, delivery signers, supplier and agent (vanilla JS, esbuild bundle `app/app.js` built from `app/src/*.js`).

## Already known (our own assessment; challenge it if you disagree)
1. **The buyer chooses the two signers** (audit F-01). They could be two accounts the buyer controls. The plan is Concordium ID proofs so the two signers are two different verified people. This is the question for office hours on Tue 24 Nov.
2. **The buyer can refund any unpaid order at any time**, including after delivery was counted and the supplier approved the invoice. Today the supplier relies on the buyer's good faith at that point. Options under consideration: block `refund` once both counts are revealed and match, or allow refund only after a deadline.
3. **Only the agent can call `execute_payment`.** If the agent goes offline, a fully approved order cannot clear until the buyer registers another agent. Option: let the supplier also ask for the decision (the rules still gate the payment).
4. `remove_signer` and `remove_agent` log no event, so the audit trail misses removals.
5. `setup` reverts entirely if any supplier already exists, so it is a one-time action.
6. The admin cannot be rotated. A lost buyer key leaves unpaid escrow stuck until an agent clears it.

## Audit these in particular
1. **Money paths in `contract/src/lib.rs`.** Any way to pay twice, pay the wrong account, pay less or more than escrowed, or lock funds forever. Check `paid = true` before `invoke_transfer`, `refund` vs `execute_payment`, `reject_invoice` vs `approve_invoice` ordering, and re-submission after a reject.
2. **`verify_agent` and `registry.rs`.** Can a malicious or upgraded registry answer make the escrow accept a bad agent, or brick it? Is the strict parser too strict, so a harmless registry change refuses every agent? Is `invoke_contract_raw_read_only` handled correctly (`Ok(None)`, reentrancy, energy)? Does checking `owner == caller` hold up if the registry allows delegates or operators?
3. **Blind counts after the fix.** Is the v2 seal now sound? Front-running a reveal, a signer revealing a different count than they physically saw, grinding, and salt reuse across orders.
4. **Supplier approval.** Can an approval meant for one invoice satisfy another? What if the supplier approves before the invoice exists? Does `reject_invoice` by the supplier let it stall forever, and does that matter?
5. **Roles and admin.** What a hijacked buyer key, a hijacked supplier key, a hijacked agent key, or one hijacked signer key can each do. Be precise about the worst case for each.
6. **Our "Already known" list.** Rank it. Which items must be fixed before the final deploy (target: about 4 Dec), and which can be written up as design choices with what protects the user?
7. **App ↔ contract consistency.** `app/src/codec.js` decoders and `sealOf` vs the Rust serialization; `app/src/chain.js` error codes vs the `Error` enum order (concordium-std assigns -1, -2, … in variant order); anything the UI shows that the chain does not enforce.
8. **Browser safety.** XSS (the app builds DOM with `h()`/`fill()`, never `innerHTML` of data; check that), what is stored in localStorage (`ctp:seal:*` holds the count and its key), and whether the wallet could be asked to sign something the page does not show.
9. **Docs vs reality.** Claims in README.md, PLAN.md and `contract/DESIGN.md` that the code or chain does not support. Limitations must be written as a design choice plus what protects the user; flag any that are not.
10. **Judging.** The three highest-impact things to build before 9 Dec, and anything that would embarrass us in the demo.

## Output format
1. Summary: up to 5 sentences, including whether the core claim holds.
2. Findings table, most severe first: id, severity, file:line, issue, scenario, fix.
3. Verdict on each "Already known" item: must fix / document as a design choice / fine.
4. Top 3 build priorities for judging.
