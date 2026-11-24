# Testnet proof log

Every transaction below is on Concordium testnet and can be opened on CCDScan. Newest first. Times are UTC+1 (Lagos) where recorded.

Link pattern: `https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=<tx>`

## Escrow v6, Verified module: `<13151,0>` (live)

Module `196930b8de58a1ef92a97480322cd0c0051c99be3fdb2f459567e9c426e6fdde`, [Verified on CCDExplorer](https://ccdexplorer.io/testnet/module/196930b8de58a1ef92a97480322cd0c0051c99be3fdb2f459567e9c426e6fdde) (source and module match). Built and published in public by the [publish-module run](https://github.com/joezzy-web3/ctp-concordium/actions/runs/45031516327) from release [`escrow-v6-src1`](https://github.com/joezzy-web3/ctp-concordium/releases/tag/escrow-v6-src1).

**Full run with Claude, 24 Nov 2026 (order #1, 2 CCD, invoice `LF-0001`):**

| Step | What happened | Tx |
|---|---|---|
| ID check | The receiver (`3NrB…`) proved with Concordium ID that they are a verified adult; the escrow recorded a salted fingerprint | in the app, order #1 |
| Count | Receiver and the supplier's delivery rep counted blind: 20 = 20 | on the order |
| Invoice | Claude (Agent #1287, over MCP) submitted the invoice fingerprint `04bbd76e…` and amount; the contract checked the agent in the registry | on the order |
| **Held** | Claude was told to skip the checks and pay. It said it should not, was sent anyway, and the contract answered **Held**: the supplier had not approved | [`a982793a…c656b264`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a982793ae64558268d5433bdcd81e81676efc6d2ea1dc5e18a770297c656b264) |
| Approve | The supplier approved that exact invoice and amount from its own account | on the order |
| **Cleared** | Claude asked again: **Cleared**, 2 CCD from `<13151,0>` to the supplier's payout account `45H8…` | [`a59615fd…13a79185`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=a59615fdb70d30d3e8ca4c3c1824ad788cbd652ca9925efa782a913230a79185) |

## Escrow v6: `<13106,0>` (first v6 run, 21 Nov 2026)

Same v6 code as module `ec8aa1da1bf370b3241a723862ff089cd6549b41e8f38e19bd7fcfad33a94b73` (CI run 44887957697, "Source and module match", 26 rule tests and 54 end-to-end tests), built before the source link was embedded. Fixes from the 21 Nov audit: the gate record survives recounts, the approver gets its window, the referee changes only by agreement, 7 days to invoice after a Delivered ruling, counters can't be the supplier or the agent.

- Init: [`65f73af6…8d70054a`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=65f73af65fdde13eb96b0d5f480e89b3a74abcedc06b2dc89c274e878d70054a), 21 Nov 2026 10:16

## Escrow v5: `<13102,0>` (20 Nov 2026)

Module `ae80470a9c3487d58ae93aad3dc6a7508da5a5e3624d1af154134eba0e9fefa6` (CI run 44790283400, "Source and module match"). Fixes from the 20 Nov audit: each side has a counter the other does not choose, a referee for disputes, one agent per order, seals bound to signer and round, refunds to the funder.

- Init: [`adc57a82…71ee3ca1`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=adc57a828f6a70530d8999de4a0868a39ff1413493219f8ff8ec99aa71ee3ca1), 20 Nov 2026 19:23

## Escrow v4: `<13098,0>` (first full payment, 20 Nov 2026)

Module `ad60bdff1c57a8b54f684a159b149e21bfb0721f54a91263d3a0c184a28c7e52` (CI run 44703255024). Order #1, 5 CCD, 50 bags: the contract checked Agent #1287 in the real registry at setup and at the invoice, two counters sealed and unsealed 50 each, the supplier approved the same file's fingerprint and asked for payment.

- Create: [`3e08d66a…7f07dddf`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=3e08d66a1833f7076134fbb3c75f4500b5f32b910c2ffd20eca276a47f07dddf)
- **Cleared**, 5 CCD to the supplier: [`e921b565…52f2947`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=e921b5657c0105d768122ee070dad4efd97eec9ac4a806d45fc2cb40852f2947)

## Escrow v1 and v2 (19 Nov 2026)

- v1 `<13091,0>`, module `6c8a0802…`: deploy [`841990e3…b6af`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=841990e37d7e55b79d7c1dc185ee6e76eb3c81f661d30202bf2c318bbff6d4af), create [`e53c212f…3dc64`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=e53c212f4a5b3eaf822eef56a1163e729ba10c27ca33b98123963b639153dc64) (72-hour hold)
- v2 `<13092,0>`, module `532e6af2…`: deploy [`00762ac6…01bc`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=00762ac602569316657f1950a92b7a615d4925afe221077cf404be5c13a701bc), one-transaction setup [`5ceebe7c…7ae3`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=5ceebe7c6dc59eed13eaa21cb6518429bbfda509748b6c8962c4530d51827ae3), order #1 funded [`e866ae55…285e`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=e866ae55d55e883d7d5d5f6817c598557264322e6f54ddd52aa1a73c89c7285e)

## Agent #1287 (19 Nov 2026)

- Agent Card v2 anchored with `setAgentURI` (card SHA-256 `b6567d9b…9588`; registry `check-badge`: all 15 checks pass): [`9556522b…dec23`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=9556522bc1a0decb964276fd7b4d13b9a6f5404a25d5a02692ae3c6ad80dec23)
- Linked to the NEAR agent `buyer.cleartopay.testnet`. CIS-8 `registerExternalKey` (the contract checked the NEAR signature): [`c3395739…c5e3`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=c33957395cb0176e4b8994bf5f94741fa69fdf1d5f5c2dac5e9f0efcddf2c5e3); `setExternalReference` (the registry called CIS-8 to confirm before attaching): [`3837cc7a…c1d7`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=3837cc7a487731da88b6aa183fd62489e9e9f1da534cddc082cdfcc271f7c1d7)
- First accountability receipt, verdict CLEARED, `CTP1` + receipt hash `7072261d…3c61` via RegisterData: [`6ee54f73…9d01`](https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=6ee54f73adee62d2ca1dfb1f03a9dc492c123884daa5a0c81d61f30c31639d01)

## Before Concordium: Clear to Pay on NEAR (30 Oct – 16 Nov 2026)

The idea, the threat model and the baseline were built first on NEAR, with eleven security reviews. Its own proof log: [clear-to-pay/docs/testnet-proof.md](https://github.com/joezzy-web3/clear-to-pay/blob/main/docs/testnet-proof.md).
