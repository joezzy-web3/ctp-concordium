# Audit prompt: Clear to Pay escrow v4 and payment receipts (20 Nov 2026)

Paste everything below the line into the auditing AI, with the repo link https://github.com/joezzy-web3/ctp-concordium (branch `main` after PR #2 is merged, or branch `payment-receipts`). This replaces `AUDIT_PROMPT_2026-11-19-v3.md`.

---

You are a senior smart-contract security auditor and a hackathon judge. Audit **joezzy-web3/ctp-concordium**: Clear to Pay, an accountable supplier-payment agent for the Concordium Trusted Agents Hackathon (final submission Wed 9 Dec 2026, 23:59 UTC). Judging order: (1) depth of integration with Concordium identity, the Agent Registry and payments, (2) path to production, (3) a working end-to-end demo, (4) usefulness.

Core claim we must be able to defend: **"Even if the AI agent is bypassed or hijacked, the contract still protects the money."**

Be adversarial and specific. For every finding give: file and line, severity (critical / high / medium / low / note), a concrete exploit or failure scenario, and a fix. No style preferences. Say clearly when something is fine. Do not repeat an item from "Known and accepted" unless you disagree with our reasoning.

## What is live
- Escrow v4 at `<13098,0>` on Concordium testnet, module `ad60bdff1c57a8b54f684a159b149e21bfb0721f54a91263d3a0c184a28c7e52` (verifiable build from CI; deploy page `deploy/` refuses any other module). Payout hold 1 minute on this test contract (72 h for the demo contract).
- One full order paid live on 20 Nov 2026: setup (the contract read the real CIS-8004 registry `<12802,0>` for Agent #1287), order, supplier accepted, two blind counts, agent invoice (registry read again), supplier approval, supplier asked, CLEARED, 5 CCD paid (tx `e921b565…`).

## The contract (`contract/src/lib.rs`, `rules.rs`, `registry.rs`; rules in `contract/DESIGN.md`)
- Roles: buyer admin; listed signers (Receiver/Approver); agents (account + registry token id); suppliers with their own payout account and a hold after any change.
- `create_order` (payable) names a supplier, quantity, receiver, approver and `invoice_by` (latest date for delivery and invoice, in the future).
- `accept_order{order_id, invoice_by}` by the supplier at the exact current date. `change_date`: buyer alone before acceptance; after acceptance one side proposes and the other must confirm the same date.
- Blind counts: `commit_count` seal = `sha256("CTP-count/v2" ‖ order_id LE ‖ signer account ‖ qty LE ‖ salt32)`; `reveal_count` only after both seals.
- `submit_invoice` and `execute_payment` by the agent re-check the registry (active, same token, owner == caller; fails closed).
- `approve_invoice{order_id, invoice_hash, amount}` by the supplier, only after it accepted and before the date.
- After `invoice_by`: no new seals, reveals, invoices or approvals.
- `refund` (buyer): allowed before acceptance, or after the date if the order is not ready to pay (delivery confirmed AND invoice approved for the full amount). `release_to_buyer` (supplier) any time before payment.
- `reject_invoice`: supplier any time; buyer only if the supplier has not approved that invoice for the full amount.
- `recount` (buyer or supplier, never a signer): only when both counts are unsealed and do not confirm delivery; at most 2; clears seals and reveals.
- `execute_payment{order_id, receipt_hash}`: callable by the invoice's agent (registry re-checked), the supplier or the buyer; same rules; pays on CLEARED; logs `Decision {order_id, verdict, codes, agent, agent_token_id, receipt_hash, paid_to, at, asked_by}`; a paid order is final.
- `setup` (one transaction; skips an existing supplier), `propose_admin` / `accept_admin` (two-step), removal events.
- Tests: 20 unit (`rules.rs`), 34 end-to-end on the compiled Wasm (`contract/tests/escrow.rs`, with a mock registry), plus a fixture test that the app's decoder fixtures equal the contract's own bytes.

## Payment receipts (`receipt/escrowReceipt.js`, `app/src/payreceipt.js`)
- Before asking for payment, the app reads the order and supplier from the contract and builds a receipt (schema `ctp.escrow-receipt/v1`): network, escrow, order id, supplier, amount, quantity, latest date, both revealed counts, recounts, invoice fingerprint/amount/agent/token, supplier approval, payout account, asked_by, asked_at. Canonical JSON (`receipt/canonical.js`), SHA-256 sent as `receipt_hash`, so it lands in the contract's `Decision` event.
- `checkReceiptAgainstDecision` verifies a receipt against a decoded `Decision` (hash, order, contract, asker, agent, and payee when cleared). Judge mode lets anyone check a receipt file against a decision transaction read from the node.

## Known and accepted (challenge only if you disagree)
1. The buyer names the two signers. They are different accounts in different roles, but could be two accounts of one person. Planned: Concordium ID proofs (see `docs/F01_SIGNER_IDENTITY.md` if present). Office hours Tue 24 Nov.
2. The receipt is built by the asker's browser from on-chain reads just before the transaction; state could change between the read and the decision (for example the supplier changes its payout account). The Decision event is authoritative; the receipt check flags a mismatching payee.
3. `asked_at` is the asker's clock; the Decision's `at` is the chain's.
4. A buyer who never refunds after an unready date leaves funds in the contract until they act; the supplier can always release them back.
5. The app scans order ids 1, 2, 3… until three in a row are missing.

## Audit these in particular
1. **Money paths.** Pay twice, pay the wrong account, pay a different amount, lock funds forever, or let the buyer pull money after a confirmed delivery with an approved invoice. Check the interaction of `refund`, `release_to_buyer`, `reject_invoice`, `recount`, `change_date` and the deadline checks, including at exactly `invoice_by` (`<=` vs `>`).
2. **Deadline logic.** Can either side move the date alone after acceptance? Can a stale proposal be confirmed later to surprise the other side? Can the supplier accept a date that was changed under it? What happens to a pending proposal when the date passes or the order closes?
3. **Recounts.** Can a party force recounts to stall until the date and then refund? Can a signer reuse an old seal across rounds to its advantage? Should the round be in the seal?
4. **Registry check.** Parser strictness (`registry.rs`), `invoke_contract_raw_read_only` handling, and whether the supplier/buyer path in `execute_payment` (no registry re-check, by design) can be abused by a revoked agent's invoice.
5. **Receipts.** Can two different receipts share a hash (canonicalization gaps, number vs string, key order, Unicode)? Can the check pass for a receipt that does not match the decision? Is `decodeDecision` (`app/src/codec.js`) strict enough? Any way to make the app send a receipt hash for a receipt it does not keep?
6. **App ↔ contract.** `app/src/codec.js` decoders vs Rust serialization (fixtures in `test/fixtures/escrow-bytes.json`); `app/src/chain.js` error list vs the `Error` enum (also checked by `test/errors.test.js`); anything the UI shows that the chain does not enforce; JSON `Timestamp` format sent to the wallet.
7. **Browser safety.** DOM built with `h()`/`fill()` (no `innerHTML` of data); localStorage holds seals (`ctp:seal:*`) and receipts (`ctp:receipts:*`); the receipt file upload in Judge mode (size cap, JSON parse); the badge check fetch.
8. **Docs vs reality.** README.md status table, `contract/DESIGN.md`, PLAN.md: any claim not backed by code or chain. Limitations must be written as a design choice plus what protects the user.
9. **Judging.** The three highest-impact things to build before 9 Dec, and anything that would embarrass us in the demo.

## Output format
1. Summary in up to 5 sentences, including whether the core claim holds.
2. Findings table, most severe first: id, severity, file:line, issue, scenario, fix.
3. Verdict on each "Known and accepted" item: must fix / fine as a design choice.
4. Top 3 build priorities for judging.
