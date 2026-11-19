# Clear to Pay escrow contract (Concordium testnet)

The rules that decide whether a supplier gets paid run **on-chain**. The AI agent can propose; only the contract can pay, and only when every rule passes. Each decision is logged by the contract itself, so the accountability record cannot be forged by anchoring an arbitrary hash.

## Roles
| Role | Who | Can |
|---|---|---|
| Buyer admin | the buyer's Concordium account | create and fund orders, add or remove signers, register suppliers |
| Signer | a person in the buying team, with a role (`receiver` or `approver`) | commit and reveal a blind delivery count |
| Supplier | the supplier's Concordium account | set or change its own payout account (starts a 72-hour hold) |
| Agent | the account that owns a registered agent (e.g. Agent #1287) | submit an invoice for an order; ask for payment |

Every Concordium account belongs to an identity verified by an identity provider. Concordium ID proofs for signers (step 3 of the build order) tighten "two accounts" into "two verified people".

## Flow
1. **Order.** Admin calls `create_order(order_id, supplier, expected_qty, amount)` and attaches the CCD. Money sits in the contract.
2. **Blind counts.** Each signer calls `commit_count(order_id, sha256(order_id ‖ qty ‖ salt))`. Only after two signers in **different roles** have committed can they `reveal_count(order_id, qty, salt)`. Neither can copy the other's number; a reveal that does not match its commit is rejected.
3. **Invoice.** The agent calls `submit_invoice(order_id, invoice_hash, amount, agent_token_id)`. The contract records which agent submitted it.
4. **Decision.** `execute_payment(order_id, receipt_hash)` runs the rules and returns a verdict. It pays only on CLEARED.

## Rules checked by `execute_payment`
| Code | Verdict | Rule |
|---|---|---|
| `REFUSED_NOT_AGENT` | REFUSED | caller is not the agent that submitted the invoice |
| `HELD_NO_INVOICE` | HELD | no invoice submitted |
| `HELD_ONE_SIGNATURE` | HELD | fewer than two revealed counts from different roles and different accounts |
| `HELD_COUNT_MISMATCH` | HELD | the two revealed counts differ, or differ from the ordered quantity |
| `HELD_AMOUNT_MISMATCH` | HELD | invoice amount is not the order amount |
| `HELD_PAYOUT_COOL_OFF` | HELD | the supplier's payout account changed less than 72 hours ago |
| `SEIZED_ALREADY_PAID` | SEIZED | the order was already paid |

On HELD or REFUSED the contract **logs the decision and pays nothing** (the call still succeeds, so the record is kept). On CLEARED it transfers the escrowed CCD to the supplier's payout account and logs the decision.

## Decision event (the on-chain receipt)
`Decision { order_id, verdict, codes, agent, receipt_hash, at }`, emitted by the contract. `receipt_hash` is the off-chain receipt's SHA-256 (see `../receipt/`), so the full record stays private while the contract vouches that this decision happened under these rules.

## Design choices, and what protects the user
- **The AI is never in charge of money.** The agent can submit and ask; the contract checks counts, amounts, signers and payout age itself.
- **Blind counts by commit and reveal**, so the second signer cannot just agree with the first.
- **Payout changes wait 72 hours**, which defeats "we changed our bank details" fraud: a hijacked supplier account cannot redirect a payment that is due now.
- **Fail closed.** Anything missing gives HELD, never CLEARED.
- **CCD first, stablecoin next.** Escrow uses CCD on testnet for the demo; paying out in a PLT stablecoin is the next step (build order item 4).
- **Badge check stays at the edge for now.** The off-chain badge gate (`../gate/`) refuses unverified agents before they reach the contract; the contract records the agent token id with every decision so it is auditable.
