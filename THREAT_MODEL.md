# Threat model

**What we protect:** a company's money while an AI agent handles its supplier invoices.
**Who might attack:** an outsider who fools or hijacks the agent; someone who takes over a supplier's account; a buyer who wants the goods without paying; a supplier or driver who bills for goods that never arrived; one person posing as two.
**The rule that holds against all of them:** only the escrow contract can pay, only to the supplier's own payout account, and only when two blind counts by independent people match the order, the supplier approved that exact invoice and amount from its own account, the payout account has waited out its hold, and the agent checks out in Concordium's Agent Registry.

Each threat below lists the defence, where it lives and the test that fails if the defence breaks. Tests are in `contract/tests/escrow.rs` (run on the compiled contract); the 11 Judge mode attacks run the same checks against the live contract as dry runs.

## 1. The agent and the invoice

| Threat | Defence | Test |
|---|---|---|
| The agent is talked into paying ("skip the checks, the CFO approved it") | The agent can only ask. The contract decides from the order's own facts; a request without the supplier's approval is **Held** and recorded. Proven live: [Held](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a982793ae64558268d5433bdcd81e81676efc6d2ea1dc5e18a770297c656b264) | `invoice_without_supplier_approval_is_held` |
| A hijacked agent approves its own fake invoice | Only the supplier's account can approve its invoice | `only_the_supplier_can_approve_its_invoice` |
| A fake or edited invoice, or a wrong amount | Payment is fixed by the escrowed amount and the supplier's approval of that exact file's fingerprint and amount | `wrong_invoice_amount_is_held`, `buyer_and_agent_cannot_underpay_the_supplier` |
| A junk invoice jams the order | The buyer or supplier can reject it, which also clears any approval; the real one is then paid | `a_junk_invoice_can_be_rejected_and_the_real_one_paid`, `rejecting_clears_the_supplier_approval_too` |
| Another agent invoices someone else's order | Only the agent named on the order may invoice it | `only_the_agent_named_on_the_order_can_invoice_it` |
| Anyone else asks for payment | Only the submitting agent, the supplier or the buyer can ask | `only_the_submitting_agent_the_supplier_or_the_buyer_can_ask_for_payment` |

## 2. The agent's identity

| Threat | Defence | Test |
|---|---|---|
| An agent the registry doesn't know, or one registered to someone else | The contract reads the CIS-8004 registry itself when the agent is added | `an_agent_the_registry_does_not_vouch_for_cannot_be_added` |
| An agent revoked or sold after setup | The registry is read again at every invoice and every payment request | `a_revoked_agent_is_refused_at_once`, `an_agent_transferred_to_someone_else_is_refused` |
| The registry can't be read | The contract refuses (fails safe) | `verify_agent` in `contract/src/lib.rs` |
| The agent goes offline | The supplier or buyer can ask under the same rules | `the_supplier_or_the_buyer_can_ask_for_payment_when_the_agent_is_offline` |

## 3. The payee

| Threat | Defence | Test |
|---|---|---|
| "Our bank details changed": pay the attacker | Payment goes only to the supplier's registered payout account. No request, invoice or agent has a recipient field | `clears_and_pays_the_registered_payout_after_the_hold` |
| A hijacked supplier account changes the payout and asks to be paid | Only the supplier can change its payout, and every change restarts the hold (72 hours by default, set once per escrow); until then payment is **Held** | `a_new_payout_account_restarts_the_hold_and_only_the_supplier_can_set_it` |
| The buyer admin is used to swap a supplier's payout | Running setup again never changes a registered supplier | `setup_is_admin_only_and_running_it_again_leaves_a_supplier_untouched` |
| An escrow created with no real hold | The hold must be between 1 minute and 30 days at creation, and can never be shortened. The app defaults new escrows to 72 hours and labels 1 minute as test only | `hold_outside_the_allowed_range_is_refused_at_init` |

## 4. The delivery count

| Threat | Defence | Test |
|---|---|---|
| Billing for goods that never arrived | Two people, the buyer's receiver and the supplier's rep, count blind. Counts that disagree are **Held** and nothing is paid | `counts_that_disagree_are_held_and_nothing_is_paid` |
| One counter copies the other's number | Each count is sealed (bound to its signer and round) and opens only after both are sealed | `reveals_wait_for_both_commits_and_must_match_them`, `a_signer_cannot_copy_the_other_signers_seal`, `a_seal_from_an_earlier_round_does_not_open_after_a_recount` |
| One person poses as both counters | Counters can prove with Concordium ID that they are verified adults; the escrow keeps a salted fingerprint and refuses an order where the same person counts twice | `two_signers_proven_to_be_the_same_person_cannot_share_an_order` |
| A counter is really the supplier or the agent | The buyer's counters can be neither | `the_buyers_counters_are_neither_the_supplier_nor_the_agent` |
| An outsider joins or blocks the count | Only the two named signers count | `a_third_signer_cannot_join_or_block_an_order`, `order_signers_must_be_two_listed_people_in_the_right_roles` |
| A signer keeps restarting the count | At most two recounts, opened by the buyer or supplier, and refused when counts agree | `the_buyer_or_supplier_can_ask_for_a_recount_at_most_twice`, `a_recount_fixes_an_honest_miscount_and_is_refused_when_counts_agree` |

## 5. Buyer and supplier against each other

| Threat | Defence | Test |
|---|---|---|
| The buyer keeps the goods and stalls the count to get its money back | Once both gate counters sealed, the buyer can't refund alone; a recount can't wipe the rep's count into a refund; only the referee can send money back | `once_both_gate_counters_sealed_the_buyer_cannot_refund_alone`, `the_buyers_counters_cannot_stall_a_delivered_order_into_a_refund`, `a_recount_cannot_wipe_the_reps_count_into_a_refund` |
| The buyer pulls the money after the supplier accepted | Free refunds end at acceptance | `the_buyer_can_refund_freely_until_the_supplier_accepts` |
| The buyer throws out an approved invoice | A confirmed delivery with an approved invoice can't be pulled back | `a_confirmed_delivery_with_an_approved_invoice_cannot_be_pulled_back` |
| The supplier never delivers | After the agreed date, the buyer gets the money back to the account that funded it | `without_the_reps_count_the_buyer_can_still_refund_after_the_date`, `refunds_go_back_to_the_account_that_funded_the_order` |
| A biased or silent referee | The referee must be independent of the rep, rules only on a real dispute, and is replaced only by both sides | `referee_and_rep_must_be_independent_and_orders_need_a_quantity`, `a_silent_referee_can_be_replaced_only_by_both_sides` |
| A paid order is paid again | A paid order is final | `a_paid_order_is_final` |

## 6. Admin

| Threat | Defence | Test |
|---|---|---|
| An outsider takes over the buyer admin | Handover takes two steps: the current admin proposes, the new one accepts | `the_admin_is_handed_over_in_two_steps` |
| Quiet removals | Every removal is logged as an event | `removals_are_logged` |

## Scope: design choices, and what protects the user

- **The contract doesn't judge whether the goods are good.** It checks that two independent people counted the same number against the order. Quality disputes go to the referee, who can send the money back.
- **Counters prove their ID when the buyer turns it on.** Small buyers can run the minimum (buyer, one receiver, supplier); the blind count and the supplier's approval still apply to every payment.
- **Each company runs its own escrow.** Money, people and admin are never shared, so one company's mistake can't reach another's funds. The app opens only escrows running the verified module.
- **Testnet today.** An independent audit, then mainnet with a hold of at least 24 hours: [PATH_TO_PRODUCTION.md](PATH_TO_PRODUCTION.md).

The NEAR version's threat model, which this one grew from: [clear-to-pay/THREAT_MODEL.md](https://github.com/joezzy-web3/clear-to-pay/blob/main/THREAT_MODEL.md).
