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
cargo concordium verify-build --module dist/ctp_escrow.wasm.v1     # rebuilds from the packaged source and compares
```

CI (`.github/workflows/test.yml`, job "Escrow contract") does all three on every push and publishes `ctp_escrow.wasm.v1` and its source archive as the artifact `ctp_escrow-verifiable`.

| Build | Image | SHA-256 of `ctp_escrow.wasm.v1` |
|---|---|---|
| commit `d1bd4bf` | `concordium/verifiable-sc-wasm32v1:1` | `29e25639c578ee88e44a98f22ced8ef1057a4cc511bcdba252b96896d7d48914` |

The deployed module reference and contract address will be added here after deployment.
