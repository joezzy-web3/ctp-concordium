#!/usr/bin/env python3
"""Prepare (but do NOT sign or send) the setAgentURI transaction that anchors
the hosted Agent Card's hash on-chain, using the hosted MCP tool.

It hashes the card exactly as GitHub Pages serves it, so the anchored hash is
the hash of the real bytes. Prints the sign-ready payload for the wallet.
Usage: python3 scripts/prepare_set_uri.py <sender account> <token_id>
"""
import hashlib
import json
import sys
import urllib.request

sys.path.insert(0, "scripts")
from build_card import call, AGENT_URI  # noqa: E402


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    sender, token_id = sys.argv[1].strip(), sys.argv[2].strip()
    served = urllib.request.urlopen(AGENT_URI, timeout=30).read()
    h = hashlib.sha256(served).hexdigest()
    local = hashlib.sha256(open("agent-card.json", "rb").read()).hexdigest()
    print("Served card SHA-256:", h)
    if h != local:
        raise SystemExit("Served card differs from local agent-card.json. Push it and wait for Pages, then retry.")
    out = call("build_set_agent_uri", {"token_id": token_id, "agent_uri": AGENT_URI,
                                        "metadata_hash_hex": h, "sender": sender, "network": "testnet"})
    print(json.dumps(out, indent=2)[:4000])


if __name__ == "__main__":
    main()
