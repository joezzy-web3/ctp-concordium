# Path to production

Clear to Pay runs end to end on Concordium testnet today: a buyer locks money in escrow, two people count the delivery blind, counters prove with Concordium ID, Agent #1287 submits the invoice over MCP, and the contract pays only when every rule passes. A request that fails a rule is recorded as **Held** on-chain; the same request **Clears** once the rule is met.

Each step below extends that working system. None of them changes the core rule: **the AI asks, the contract decides.**

## 1. An independent audit, then mainnet

**Today:** escrow v6 has been through two external AI audits (19 Nov, 21 Nov). Every finding was fixed and covered by a test: 26 rule tests and 54 end-to-end tests run on the compiled contract in CI. Every deployed module is a verifiable build that anyone can rebuild and match on-chain.

**Next:**
- A human security audit of the escrow contract, scoped to the payment rules and the registry check.
- Deploy the same verifiable build to mainnet, with Agent #1287's mainnet counterpart registered in the Concordium agent registry. Only the init parameters change.
- Raise the contract's minimum payout hold for mainnet to 24 hours or more. On testnet the app defaults to 72 hours and offers 1 minute only as a labelled test setting; on mainnet no escrow can be created with a hold short enough to rush a new payout account.
- Start with a per-order cap during the pilot, raised as order history builds.

**What protects users in the meantime:** the testnet build already refuses by default. If the contract cannot read the registry, or anything is missing, the request is Held, never paid.

## 2. Stablecoin payouts

**Today:** escrow holds and releases CCD, and every rule is enforced on that CCD.

**Next:** pay suppliers in a Concordium protocol-level stablecoin (PLT) as contracts gain stablecoin custody. The escrow logic stays the same: what changes is the asset locked at order time and released at Cleared. Buyers and suppliers price in stable money, which is what procurement teams expect.

## 3. Sponsored fees for counters

**Today:** the receiver and the supplier's rep each sign from their own Concordium account, which needs a little CCD for fees.

**Next:** use sponsored transactions so the buyer pays the counters' fees. A storekeeper at the gate needs a wallet and an identity, never a CCD balance. Signatures stay theirs, so the protection does not change.

## 4. Every company on its own escrow

**Today:** any company starts its own escrow in the app in three steps: create it from the verified module (one wallet approval; that account becomes its buyer admin), list its own receiver, approver, supplier and agent, and order. Each escrow is its own contract, so every buyer's money, orders and people are fully separate. The app only opens escrows running the verified Clear to Pay code.

**Next:** a shared escrow where many buyers keep isolated order books in one contract, for procurement platforms that onboard companies without a deployment each.

## 5. Checks that scale with the risk of the order

**Today:** ID checks and the approver are already optional. A counter proves once and stays on the escrow's signer list.

**Next:** buyer-level policies set per supplier or per amount, for example "ID-checked counters for orders over a set amount", so high-volume, low-value orders stay fast and high-value ones get every check automatically.

## 6. Agents from any stack

**Today:** the MCP server lets any MCP client work the escrow as Agent #1287: read orders, dry-run a payment, submit an invoice, ask for payment. Agent #1287 is linked through CIS-8 to the Clear to Pay agent on NEAR.

**Next:**
- Connect purchasing systems (ERP and accounting tools) through the same MCP tools, so purchase orders and invoices flow in from the systems companies already use.
- Charge other agents a per-check service fee (x402-style) for verifying invoices and counterparty badges, as a revenue line separate from supplier money.
- Keep extending the cross-chain identity: the same operator proving one agent across the chains Clear to Pay runs on.

## 7. A first pilot

Run with one buyer and its regular suppliers on a recurring order, such as weekly food supplies to a warehouse:
- Week 1: orders run in parallel with the existing approval process, and the receipts are compared.
- After that: Clear to Pay becomes the payment path for that supplier, with the existing process as the fallback.
- Measure the share of payments Cleared first time, the time from delivery to payment, and how many requests were Held and why.

## Where to check the work

- Escrow `<13151,0>` on [CCDExplorer](https://ccdexplorer.io/testnet/instance/13151/0) and [CCDScan](https://testnet.ccdscan.io/?dentity=contract&dcontractAddressIndex=13151&dcontractAddressSubIndex=0)
- Contract rules and design: [contract/DESIGN.md](contract/DESIGN.md)
- Signer identity design: [docs/F01_SIGNER_IDENTITY.md](docs/F01_SIGNER_IDENTITY.md)
- MCP server: [mcp/README.md](mcp/README.md)
