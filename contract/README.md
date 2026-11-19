# ctp_escrow: Clear to Pay escrow contract

Status: **draft, not deployed yet.** The rules (`src/rules.rs`) are tested; the end-to-end tests against the compiled module and the testnet deployment come next.

Rules and roles: see [DESIGN.md](DESIGN.md).

```bash
cargo test --lib                       # 14 rule tests, run natively
rustup target add wasm32v1-none        # once
cargo install --locked cargo-concordium  # once
cargo concordium build --schema-embed --out ctp_escrow.wasm.v1
cargo test --test escrow               # 14 end-to-end tests against the compiled module
```
