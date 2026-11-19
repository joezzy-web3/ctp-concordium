# Link the NEAR agent to Agent #1287 (CIS-8)

Clear to Pay already runs on NEAR (`guard.cleartopay.testnet`, owned by `buyer.cleartopay.testnet`). This links it to Concordium Agent #1287:

1. `node link/prepare.mjs --key <NEAR key file> --expect ed25519:<public key> --near-account buyer.cleartopay.testnet`
   signs the CIS-8 canonical message with the NEAR owner key on your machine and writes `bundle.json` (public key and signature only).
2. Push `bundle.json`, open `https://joezzy-web3.github.io/ctp-concordium/link/`, send step 1 (`registerExternalKey` on CIS-8 `<12801,0>`) and step 2 (`setExternalReference` on CIS-8004 `<12802,0>`).
3. `node link/verify.mjs` asks the registry, starting from the NEAR key, who owns it and which agent it belongs to.

Design choices, and what protects the user:
- **The owner key, not the agent's working key.** The NEAR key bound is the full-access key of `buyer.cleartopay.testnet`, the account that owns the NEAR contract and grants or revokes the agent's limited key. Concordium's owner account and NEAR's owner key now provably belong to the same controller.
- **The secret never leaves the machine.** It is read once into memory, used to sign one message and wiped; the script prints only the public key and the signature, and refuses to run if the key in the file is not the one named with `--expect`.
- **Nothing is trusted blindly.** Every byte the registry tools return (the message to sign and both transaction parameters) is rebuilt from the CIS-8 and CIS-8004 specifications and must match exactly, or the script stops.
- **Replay-proof.** The signed message includes the Concordium account, the CIS-8 contract address and the testnet genesis hash, so the signature is valid for this binding only.
- **NEAR as an ed25519 chain.** CIS-8 lists Ethereum, Solana, Cosmos and Fetch.ai by name and leaves the chain namespace open. NEAR keys are ed25519, so the binding uses namespace `near:testnet`, key type `ed25519` and the `solana-ed25519` proof scheme, which checks a plain ed25519 signature over the raw message: the same check a NEAR key passes.

`app.js` is an esbuild bundle of `src/link.js` (see `../anchor/README.md` for the build command).
