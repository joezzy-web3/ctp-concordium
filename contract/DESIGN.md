# Clear to Pay escrow contract (Concordium testnet)

The rules that decide whether a supplier gets paid run **on-chain**. The AI agent can propose; only the contract can pay, and only when every rule passes. Each decision is logged by the contract itself, so the accountability record cannot be forged by anchoring an arbitrary hash.

## Roles
| Role | Who | Can |
|---|---|---|
| Buyer admin | the buyer's Concordium account | create and fund orders, add or remove signers, register suppliers |
| Signer | a person in the buying team, with a role (`receiver` or `approver`) | commit and reveal a blind delivery count, only on orders that name them |
| Supplier | the supplier's Concordium account | approve its own invoice by hash; set or change its own payout account (starts the hold) |
| Agent | the account that owns a registered agent (e.g. Agent #1287) | submit an invoice for an order; ask for payment |

Every Concordium account belongs to an identity verified by an identity provider. Concordium ID proofs for signers (step 3 of the build order) tighten "two accounts" into "two verified people".

## Flow
1. **Order.** Admin calls `create_order(order_id, supplier, expected_qty, receiver, approver)` and attaches the CCD. The order names exactly two people: a listed Receiver and a different listed Approver. Money sits in the contract.
2. **Blind counts.** Each named signer calls `commit_count(order_id, sha256("CTP-count/v1" ‖ order_id ‖ qty ‖ salt))`. Only after both have committed can they `reveal_count(order_id, qty, salt)`. Neither can copy the other's number; a reveal that does not match its commit is rejected; a signer removed or moved to another role after committing can no longer reveal. Nobody else can count the order, so a third person cannot block it.
3. **Invoice.** A registered agent calls `submit_invoice(order_id, invoice_hash, amount)`. The supplier calls `approve_invoice(order_id, invoice_hash)` from its own account, so an agent cannot get an invented invoice paid.
4. **Decision.** The submitting agent, while still registered, calls `execute_payment(order_id, receipt_hash)`. The contract runs the rules and pays only on CLEARED. HELD can be retried after the cause is fixed; once paid, the order is final and accepts no further decisions.

## Rules checked by `execute_payment`
| Code | Verdict | Rule |
|---|---|---|
Before any rule runs, the call is rejected outright (nothing logged) if: there is no invoice (`NoInvoice`), the caller is not the agent that submitted it or is no longer registered (`NotAgent`), or the order is already paid or refunded (`OrderClosed`).

| Code | Verdict | Rule |
|---|---|---|
| `HeldOneSignature` | HELD | not both named people (different accounts, different roles) have revealed |
| `HeldCountMismatch` | HELD | the revealed counts differ from each other or from the ordered quantity |
| `HeldAmountMismatch` | HELD | invoice amount is not the escrowed amount |
| `HeldNoSupplierApproval` | HELD | the supplier has not approved this exact invoice hash |
| `HeldPayoutCoolOff` | HELD | the supplier's payout account changed less than the hold ago (72 h in production; init refuses anything outside 1 minute to 30 days) |

On HELD the contract **logs the decision and pays nothing** (the call still succeeds, so the record is kept). On CLEARED it marks the order paid, transfers the escrowed CCD to the supplier's payout account and logs the decision.

## Decision event (the on-chain receipt)
`Decision { order_id, verdict, codes, agent, receipt_hash, at }`, emitted by the contract. `receipt_hash` is the off-chain receipt's SHA-256 (see `../receipt/`), so the full record stays private while the contract vouches that this decision happened under these rules.

## Design choices, and what protects the user
- **The AI is never in charge of money.** The agent can submit and ask; the contract checks counts, amounts, signers and payout age itself.
- **Blind counts by commit and reveal**, so the second signer cannot just agree with the first.
- **Payout changes wait 72 hours**, which defeats "we changed our bank details" fraud: a hijacked supplier account cannot redirect a payment that is due now.
- **Fail closed.** Anything missing gives HELD, never CLEARED.
- **CCD first, stablecoin next.** Escrow uses CCD on testnet for the demo; paying out in a PLT stablecoin is the next step (build order item 4).
- **Agent check today, on-chain registry check next.** The admin registers an agent only after the badge gate (`../gate/`) clears it, the contract re-checks that the agent is still registered at every decision, and records its token id. Next step (build order): the contract asks the CIS-8004 registry itself that the agent is Active and owned by the caller.
- **Two listed accounts today, two verified people next.** Every Concordium account belongs to an ID-verified identity, but one person can hold several accounts. The Concordium ID step adds zero-knowledge proofs that the receiver and approver are different verified people.
