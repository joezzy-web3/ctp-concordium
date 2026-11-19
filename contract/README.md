# ctp_escrow: Clear to Pay escrow contract

Status: **built and tested, not deployed yet.** 14 rule tests and 14 end-to-end tests against the compiled module pass in CI and on a developer machine.

Rules and roles: see [DESIGN.md](DESIGN.md).

```bash
cargo test --lib                       # 14 rule tests, run natively
rustup target add wasm32v1-none        # once
cargo install --locked cargo-concordium  # once
cargo concordium build --schema-embed --out ctp_escrow.wasm.v1
cargo test --test escrow               # 14 end-to-end tests against the compiled module
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

The deployed module reference and contract address will be added here after deployment.
