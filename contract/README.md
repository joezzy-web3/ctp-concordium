# ctp_escrow: Clear to Pay escrow contract

Status: **live on Concordium testnet** at `<13161,0>`, module `67e4c0b6…db6e` (v8), **[Verified on CCDExplorer](https://ccdexplorer.io/testnet/module/67e4c0b60ea3945b594ca3ddd32f1287ae89d2eec399827bc3f8ee7eeff1db6e)**. 26 rule tests and 61 end-to-end tests against the compiled module pass in CI.

Rules and roles: see [DESIGN.md](DESIGN.md).

```bash
cargo test --lib                       # 26 rule tests, run natively
rustup target add wasm32v1-none        # once
cargo install --locked cargo-concordium  # once
cargo concordium build --schema-embed --out ctp_escrow.wasm.v1
cargo test --test escrow               # 61 end-to-end tests against the compiled module
```

## Reproducible, verifiable build

`Cargo.lock` pins every crate and `rust-toolchain.toml` pins the compiler. The module we deploy is the **verifiable build** CI makes in Concordium's own build image, so anyone can check that the code in this repo is the code on-chain:

```bash
cargo concordium build --verifiable --out dist/ctp_escrow.wasm.v1   # needs Docker
sha256sum dist/ctp_escrow.wasm.v1
cargo concordium verify-build --module dist/ctp_escrow.wasm.v1 --source dist/ctp_escrow.wasm.v1.tar   # rebuilds from the packaged source and compares
```

CI (`.github/workflows/test.yml`, job "Escrow contract") does all three on every push and publishes `ctp_escrow.wasm.v1` and its source archive as the artifact `ctp_escrow-verifiable`.

The verifiable build embeds a fingerprint of the packaged `contract/` sources, so any change in that folder (even a README edit) gives a new module hash. The hash that matters is the one of the deployed module; it is recorded here at deployment, with the commit it was built from.

## Deployed

| | |
|---|---|
| Contract | `<13161,0>` on Concordium testnet (v8; v7 was `<13155,0>`) |
| Module | `67e4c0b60ea3945b594ca3ddd32f1287ae89d2eec399827bc3f8ee7eeff1db6e`: the verifiable build `36764425…2cc04` with the link to its source archive embedded ([publish-module run](https://github.com/joezzy-web3/ctp-concordium/actions/runs/45600450904), source in release [`escrow-v8-src1`](https://github.com/joezzy-web3/ctp-concordium/releases/tag/escrow-v8-src1)) |
| Verification | CCDExplorer rebuilds the source and shows **Verified: source and module match** |
