# Clear to Pay escrow contract (Concordium testnet)

The rules that decide whether a supplier gets paid run **on-chain**. The AI agent can propose; only the contract can pay, and only when every rule passes. Each decision is logged by the contract itself, so the accountability record cannot be forged by anchoring an arbitrary hash.

## Roles
| Role | Who | Can |
|---|---|---|
| Buyer admin | the buyer's Concordium account | set up signers, agents and suppliers (one `setup` transaction or one at a time), create and fund orders with an agreed date, take the money back while the supplier has not accepted (or after the date if the order was not ready), ask for a recount, ask for payment, hand the admin role to another account in two steps |
| Signer | a person in the buying team, with a role (`receiver` or `approver`) | commit and reveal a blind delivery count, only on orders that name them |
| Supplier | the supplier's Concordium account | accept an order at its date; agree date changes; approve its own invoice by hash; ask for a recount; ask for payment; give the money back; set or change its own payout account (starts the hold) |
| Agent | the account that owns a registered agent (e.g. Agent #1287) | submit an invoice for an order; ask for payment |

Every Concordium account belongs to an identity verified by an identity provider. Concordium ID proofs for signers (step 3 of the build order) tighten "two accounts" into "two verified people".

## Flow
1. **Order.** Admin calls `create_order(order_id, supplier, expected_qty, receiver, approver, invoice_by)` and attaches the CCD. The order names exactly two people: a listed Receiver and a different listed Approver, and an agreed date (`invoice_by`) in the future. Money sits in the contract.
   **Acceptance.** The supplier calls `accept_order(order_id, invoice_by)` from its own account, confirming the exact date (so a last-moment change cannot slip in). This is the PO acknowledgment. Before it, the buyer can change the date alone or take the money back; after it, a date change needs both sides (`change_date`: one proposes, the other confirms the same date).
2. **Blind counts.** Each named signer calls `commit_count(order_id, sha256("CTP-count/v2" ‖ order_id ‖ signer account ‖ qty ‖ salt))`. Only after both have committed can they `reveal_count(order_id, qty, salt)`. Neither can copy the other's number: each seal carries its signer's own account, so a seal copied from the chain never opens for anyone else; a reveal that does not match its commit is rejected; a signer removed or moved to another role after committing can no longer reveal. Nobody else can count the order, so a third person cannot block it.
3. **Invoice.** A registered agent calls `submit_invoice(order_id, invoice_hash, amount)`. The supplier calls `approve_invoice(order_id, invoice_hash, amount)` from its own account, so an agent cannot get an invented invoice paid, and a buyer who escrows less than the supplier approved cannot pay less: the order stays HELD until it is refunded and funded again at the right amount.
4. **Decision.** The submitting agent (while still registered and verified in the registry), the supplier, or the buyer calls `execute_payment(order_id, receipt_hash)`. The rules are the same whoever asks, so payment never stalls on an offline agent. The contract pays only on CLEARED. HELD can be retried after the cause is fixed; once paid, the order is final and accepts no further decisions.
5. **Recount.** If both counts are unsealed and do not confirm the delivery, the buyer or the supplier can call `recount(order_id)`: both signers count again, blind. At most 2 recounts; every earlier count stays in the event history.
6. **The agreed date.** By `invoice_by`, the delivery must be confirmed and an invoice approved. After it the contract takes no new counts, invoices or approvals, so the order's state is final: if it was ready to pay, the supplier is paid (only the payout hold can still be running); if not, the buyer can take the money back.

## Rules checked by `execute_payment`
| Code | Verdict | Rule |
|---|---|---|
Before any rule runs, the call is rejected outright (nothing logged) if: there is no invoice (`NoInvoice`), the caller is not the agent that submitted it (still registered and verified), the supplier, or the buyer (`NotAgent`), or the order is already paid or refunded (`OrderClosed`).

| Code | Verdict | Rule |
|---|---|---|
| `HeldOneSignature` | HELD | not both named people (different accounts, different roles) have revealed |
| `HeldCountMismatch` | HELD | the revealed counts differ from each other or from the ordered quantity |
| `HeldAmountMismatch` | HELD | invoice amount is not the escrowed amount |
| `HeldNoSupplierApproval` | HELD | the supplier has not approved this exact invoice hash for this exact amount |
| `HeldPayoutCoolOff` | HELD | the supplier's payout account changed less than the hold ago (72 h in production; init refuses anything outside 1 minute to 30 days) |

On HELD the contract **logs the decision and pays nothing** (the call still succeeds, so the record is kept). On CLEARED it marks the order paid, transfers the escrowed CCD to the supplier's payout account and logs the decision.

## Decision event (the on-chain receipt)
`Decision { order_id, verdict, codes, agent, agent_token_id, receipt_hash, paid_to, at, asked_by }`, emitted by the contract. `receipt_hash` is the off-chain receipt's SHA-256 (see `../receipt/`), so the full record stays private while the contract vouches that this decision happened under these rules.

## Design choices, and what protects the user
- **The AI is never in charge of money.** The agent can submit and ask; the contract checks counts, amounts, signers and payout age itself.
- **Blind counts by commit and reveal**, so the second signer cannot just agree with the first.
- **Payout changes wait 72 hours**, which defeats "we changed our bank details" fraud: a hijacked supplier account cannot redirect a payment that is due now.
- **Fail closed.** Anything missing gives HELD, never CLEARED.
- **CCD first, stablecoin next.** Escrow uses CCD on testnet for the demo; paying out in a PLT stablecoin is the next step (build order item 4).
- **The contract asks the agent registry itself (v3).** When the buyer adds an agent, and again at every invoice and every payment request, the escrow calls `agentOf` on the CIS-8004 registry `<12802,0>` and requires the agent to be Active and owned by the calling account. A revoked or transferred agent is refused at once. Anything the escrow cannot read or does not expect in the registry's answer is a refusal (fail closed). The parser is tested against the registry's real answer for Agent #1287.
- **A wrong invoice can be cleared (v3).** The buyer or the supplier can `reject_invoice`, which clears the invoice and any approval, so a compromised agent cannot jam an order with a junk invoice.
- **The money is locked for the supplier once it accepts.** The buyer can take it back only while the supplier has not accepted, or after the agreed date if the order was not ready (delivery not confirmed, or no invoice approved for the full amount). The buyer cannot reject an invoice the supplier approved for the full amount. The supplier can always give the money back, for example when it cancels.
- **One date, agreed by both.** The buyer proposes it, the supplier accepts it, and any change needs both. After it, nothing new is accepted, so a late invoice cannot sneak in and the buyer is free to use another supplier.
- **Honest mistakes can be fixed.** A recount (at most 2, opened by the buyer or supplier, never by a signer) corrects a miscount without letting anyone stall the order forever.
- **Nobody waits on the agent.** The supplier or buyer can ask for the decision too; the rules do not change with who asks.
- **Every change is on the record.** Removing a signer or agent, proposing or changing the admin, proposing or changing the date, and every recount emit an event.
- **The admin role moves in two steps.** The current admin proposes a new account and that account must accept, so a typo cannot lock anyone out.
- **Two listed accounts today, two verified people next.** Every Concordium account belongs to an ID-verified identity, but one person can hold several accounts. The Concordium ID step adds zero-knowledge proofs that the receiver and approver are different verified people.
