# F-01: the two signers are two different verified people

Status: **live on testnet.** The receiver on order #1 of escrow `<13151,0>` proved with Concordium ID and was recorded on the escrow (24 Nov 2026). The proof runs inside the app under ID checks (`#/buyer/ids`).

## As built
- **Page:** `idcheck/`. The buyer creates a proof request for one counter and anchors it with RegisterData. The counter opens the request link, and their wallet answers with `requestVerifiablePresentationV1`. The buyer pastes the answer link back.
- **Checks:** `VerificationAuditRecordV1.createChecked` (context match, `verifyWithNode`, credentials active, request anchored, claims match the request), then the proof must be about exactly one credential of the counter's own account.
- **Person tag:** `SHA-256("CTP-person/v1" ‖ escrow ‖ salt ‖ issuer ‖ document number)`. The salt is derived from the buyer wallet's deterministic signature on a fixed message, so only the buyer can recompute it and it never has to be stored.
- **On-chain:** the audit record is anchored with RegisterData; `add_signer` records `person_tag` and `id_audit` (the audit anchor hash). `create_order` refuses `SamePerson` when the receiver and approver carry the same tag.
- **Design choice:** tags are optional on the contract, so an individual buyer without an approver, or a buyer who has not run the check yet, still trades. Every tagged signer is a proven verified adult, and an audit record exists for each.
- **No server:** request and answer travel as links after `#`, compressed, and never reach a server.
- Tests: `test/idcheck.test.js`.

## Why
Today the escrow requires two different **accounts** in two different roles (receiver and approver), named on each order, each sealing a blind count. Every Concordium account belongs to an ID-verified identity, but one person can hold several accounts. So a dishonest buyer, or one insider with two accounts, could play both signers. F-01 closes that: the two signers must be **two different verified people**, proven with Concordium ID, without putting their personal data on-chain.

## What Concordium offers (checked in the SDK we already ship, `@concordium/web-sdk` 12.0.3)
- **Verifiable Presentation V1** (`VerificationRequestV1`, `VerifiablePresentationV1`, `VerificationAuditRecordV1`).
  - The verifier builds a request with `claimsBuilder()`, a context (`createSimpleContext(nonce, connectionId, resourceId, contextString)`), and anchors it on-chain. `createAnchor(context, claims)` gives the bytes, a RegisterData transaction stores them, and `create(context, claims, txHash)` gives the request.
  - The holder's wallet answers with a zero-knowledge presentation. The Browser Wallet API has `requestVerifiablePresentationV1(request)` (in `@concordium/browser-wallet-api-helpers` 3.3.0, which we already use).
  - The verifier checks it with `VerifiablePresentationV1.verifyWithNode(presentation, grpc, network)`.
  - An audit record (`VerificationAuditRecordV1.create(id, request, presentation)`) can be anchored on-chain with `createAnchor(record)` and RegisterData. Anyone holding the record can later re-check it with `verifyAnchor`.
- **Account claims** (`createAccountClaims(network, credRegId, issuer, statements)`) bind the proof to one account's on-chain credential. So the proof is about **the exact account that will seal counts**.
- Statements: reveal an attribute, age limits, ranges (dates), set membership and non-membership (nationality, residency, ID document issuer and type).
- Attributes include `idDocNo`, `idDocIssuer`, `nationalIdNo`, and for companies `legalName`, `lei`, `businessNumber`, `registrationAuth`, `legalCountry`.

All of this runs in the browser with the wallet signing the two RegisterData anchors, so **no server is needed**. This fits our static app.

## The gap and our choice
A presentation proves facts about one identity. There is no built-in, privacy-preserving marker that says "this identity is different from that one". So to tell two people apart, the verifier must see one identifying attribute. Our choice:

- Each signer **reveals their ID document number and issuer to the buyer's app only**, for one comparison.
- The app keeps only `person_tag = SHA-256("CTP-person/v1" ‖ escrow address ‖ secret salt ‖ idDocIssuer ‖ idDocNo)`. The secret salt is held by the buyer with the audit records, so the on-chain tag cannot be brute-forced from guessed document numbers.
- The contract stores the tag with the signer and refuses an order whose receiver and approver have the same tag, or have no tag.

What protects the signer: the document number never goes on-chain and is not stored by the app; only a salted fingerprint is. What protects the supplier and auditors: every check leaves an audit record anchored on-chain, which they can ask for and re-verify independently. A buyer who faked a tag would be exposed by that audit.

## Flow (proposed)
1. **Buyer, "Verify signer":** picks the signer's account. The app reads its credential (`getAccountInfo`), builds a request with account claims: reveal `idDocIssuer` and `idDocNo`, minimum age 18, and resource id `ctp-escrow:<index,0>:signer`. It anchors the request with RegisterData (buyer's wallet).
2. **Signer, "Prove I am a verified person":** on the signer's own device, the app calls `requestVerifiablePresentationV1(request)`. The wallet shows exactly what is revealed and asks for consent.
3. **Buyer's app:**
   - checks the presentation with `verifyWithNode`
   - checks it is bound to that signer's account and to this request
   - computes `person_tag`
   - creates the audit record and anchors it (RegisterData)
4. **Contract:** `add_signer{account, role, person_tag, id_audit}` (the audit anchor's hash). `create_order` refuses `SamePerson` if the receiver's and approver's tags match, and `SignerNotVerified` if either has no tag.
5. **Judge mode / auditors:** given the audit record, anyone re-runs `verifyAnchor` and `verifyWithNode`, and recomputes the tag with the salt the buyer discloses to them.

## Contract changes (small)
- `SignerParams` gains `person_tag: HashSha2256` and `id_audit: HashSha2256`. State maps the signer to `(role, person_tag, id_audit)`.
- `create_order`: both named signers have tags, and the tags differ. Two new errors, appended at the end.
- Optional: refuse one `person_tag` on two accounts in the same role, so a person cannot be listed twice.
- Events: `SignerSet` gains `person_tag` and `id_audit`.

## Also possible: the supplier proves it is a registered company
With a business identity, the supplier can reveal `legalName` and `lei` (or `businessNumber` and `registrationAuth`) when it registers. The buyer then knows it pays a real company, and the PO and receipts can carry the verified legal name. This uses the same flow with different statements.

## Questions for office hours (Tue 24 Nov)
1. Does the current Browser Wallet release support `requestVerifiablePresentationV1` with **account claims** on testnet? Does the Concordium ID app?
2. Is there, or is there planned, a privacy-preserving way to prove that **two accounts belong to different identities** (a per-verifier pseudonym or nullifier), so no document number has to be revealed?
3. Which attribute is most reliably present across testnet identity providers for telling people apart: `idDocNo`, `nationalIdNo`, or something else? Can we create two test identities for the demo?
4. Can a testnet business identity reveal `legalName` / `lei` for the supplier?
5. Is anchoring the request and the audit record with RegisterData from the buyer's wallet the intended pattern, or is there a preferred verifier service?
6. Any plans for contracts to check a presentation, or a registry of verification anchors a contract could read?

## Effort
About 2 days once the wallet path is confirmed:
- request, wallet and verify in the app: 1 day
- contract fields, errors and tests, plus a new deploy: half a day
- audit-record check in Judge mode: half a day

## How we describe it until it ships
"Each order names two different accounts in two different roles, and every Concordium account belongs to an ID-verified identity. Next, each signer proves with Concordium ID that they are a different verified person; only a salted fingerprint goes on-chain, and every check leaves an anchored audit record."
