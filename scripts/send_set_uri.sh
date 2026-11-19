#!/usr/bin/env bash
# Anchor the hosted Agent Card on-chain: CIS-8004 setAgentURI on TESTNET.
#
# Sends the EXACT parameter bytes that the hosted MCP tool built
# (scripts/prepare_set_uri.py), so the anchored hash cannot drift.
# concordium-client shows a summary and asks you to confirm before sending,
# then asks for the password of the imported account. Nothing is signed
# without your confirmation. Keys never leave concordium-client.
#
# Usage: scripts/send_set_uri.sh <parameter_hex> <account name in concordium-client>
set -euo pipefail

HEX="${1:?parameter_hex from prepare_set_uri.py}"
SENDER="${2:?account name you imported into concordium-client}"
CONTRACT=12802          # CIS-8004 Agent Registry on testnet
ENTRYPOINT=setAgentURI
ENERGY=30000

[[ "$HEX" =~ ^[0-9a-fA-F]+$ ]] || { echo "parameter_hex must be hex"; exit 1; }

BIN="$(mktemp)"
trap 'rm -f "$BIN"' EXIT
echo -n "$HEX" | xxd -r -p > "$BIN"
echo "Parameter: $(stat -c %s "$BIN") bytes, sha256 $(sha256sum "$BIN" | cut -c1-16)…"

concordium-client contract update "$CONTRACT" \
  --entrypoint "$ENTRYPOINT" \
  --parameter-binary "$BIN" \
  --sender "$SENDER" \
  --energy "$ENERGY" \
  --grpc-ip grpc.testnet.concordium.com --grpc-port 20000 --secure
