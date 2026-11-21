# Link the NEAR agent to Agent #1287 (CIS-8)

Clear to Pay already runs on NEAR (`guard.cleartopay.testnet`, owned by `buyer.cleartopay.testnet`). This links it to Concordium Agent #1287:

1. `node link/prepare.mjs --key <NEAR key file> --expect ed25519:<public key> --near-account buyer.cleartopay.testnet`
   signs the CIS-8 canonical message with the NEAR owner key on your machine and writes `bundle.json` (public key and signature only).
2. Push `bundle.json`, open `https://cleartopay-concordium.vercel.app/link/`, send step 1 (`registerExternalKey` on CIS-8 `<12801,0>`) and step 2 (`setExternalReference` on CIS-8004 `<12802,0>`).
3. `node link/verify.mjs` asks the registry, starting from the NEAR key, who owns it and which agent it belongs to.

Design choices, and what protects the user:
- **The owner key, not the agent's working key.** The NEAR key bound is the full-access key of `buyer.cleartopay.testnet`, the account that owns the NEAR contract and grants or revokes the agent's limited key. Concordium's owner account and NEAR's owner key now provably belong to the same controller.
- **Signing raw bytes with a full-access key is safe here.** NEAR signs transactions over the 32-byte SHA-256 of the transaction, and off-chain messages (NEP-413) carry their own prefix. The CIS-8 message is 195 bytes that start with the ASCII tag `CIS-8/v1/canonical`, so its signature can never be taken for a NEAR transaction or a NEP-413 message; it authorises nothing on NEAR.
- **The secret never leaves the machine.** It is read into memory on your own computer, used to sign one message, and our copies are zeroed afterwards. Zeroing in Node.js is best-effort (the runtime may keep copies until garbage collection), so the script is a one-off run on the owner's own machine; for mainnet keys, sign with a hardware or wallet signer instead. The script prints only the public key and the signature, refuses to run if the key in the file is not the one named with `--expect`, and every network call has a 30-second timeout.
- **The signing page accepts only the bundle that was signed.** `link/` pins the SHA-256 of `bundle.json`; a changed file on the server makes the page refuse to load, so it cannot be used to attach a different key.
- **Nothing is trusted blindly.** Every byte the registry tools return (the message to sign and both transaction parameters) is rebuilt from the CIS-8 and CIS-8004 specifications and must match exactly, or the script stops.
- **Replay-proof.** The signed message includes the Concordium account, the CIS-8 contract address and the testnet genesis hash, so the signature is valid for this binding only.
- **NEAR as an ed25519 chain.** CIS-8 lists Ethereum, Solana, Cosmos and Fetch.ai by name and leaves the chain namespace open. NEAR keys are ed25519, so the binding uses namespace `near:testnet`, key type `ed25519` and the `solana-ed25519` proof scheme, which checks a plain ed25519 signature over the raw message: the same check a NEAR key passes.

`app.js` is an esbuild bundle of `src/link.js` (see `../anchor/README.md` for the build command).
