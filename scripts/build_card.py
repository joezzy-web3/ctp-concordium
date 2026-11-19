#!/usr/bin/env python3
"""Build the Clear to Pay Agent Card with Concordium's hosted MCP tool.

Calls the `build_agent_card` tool, writes the card to agent-card.json byte
for byte, and checks that the SHA-256 of the file equals the hash the tool
returned. That hash is what gets anchored on-chain, and verifiers compare it
with the SHA-256 of the file as served, so the bytes must not change.

Read-only: it builds JSON, it signs and sends nothing.
Usage: python3 scripts/build_card.py <your testnet account address>
"""
import hashlib
import json
import sys
import urllib.request

MCP = "https://agent-registry-mcp.concordium.com/mcp"
AGENT_URI = "https://joezzy-web3.github.io/ctp-concordium/agent-card.json"

NAME = "Clear to Pay"
DESCRIPTION = (
    "Supplier-payment guard for AI agents. Clear to Pay reads supplier invoices "
    "but can never release payment on its own: money is released only when two "
    "verified people sign blind delivery counts, the invoice is signed by the "
    "supplier's registered key and matches the order, and any new payout account "
    "has waited 72 hours. It refuses invoices from agents whose Verified by "
    "Concordium badge does not check out, and keeps an audit trail for EU AI Act "
    "record keeping."
)
SKILLS = [
    {"id": "check-invoice", "name": "Check an invoice",
     "description": "Returns CLEARED, HELD or SEIZED with reason codes for a supplier invoice. Never pays.",
     "tags": ["invoice", "payments", "fraud", "accountability"]},
    {"id": "verify-agent", "name": "Verify a counterparty agent",
     "description": "Checks another agent's Verified by Concordium badge and Agent Card hash before dealing with it.",
     "tags": ["badge", "cis-8004", "verification"]},
]


def call(name, arguments):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": arguments}}).encode()
    req = urllib.request.Request(MCP, data=body, headers={
        "content-type": "application/json", "accept": "application/json, text/event-stream"})
    raw = urllib.request.urlopen(req, timeout=60).read().decode()
    raw = raw[raw.find("{"):]                      # tolerate an SSE "data:" prefix
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        msg = json.loads(raw.splitlines()[0])
    if "error" in msg:
        raise SystemExit(f"MCP error: {msg['error']}")
    res = msg["result"]
    text = res["content"][0]["text"]
    if res.get("isError"):
        raise SystemExit(f"Tool error: {text}")
    return json.loads(text)


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    owner = sys.argv[1].strip()
    args = {"name": NAME, "description": DESCRIPTION, "agent_uri": AGENT_URI, "owner_account": owner}
    try:
        out = call("build_agent_card", {**args, "skills": SKILLS})
    except SystemExit as e:
        print(f"(retrying without skills: {e})")
        out = call("build_agent_card", args)

    print("Tool returned keys:", ", ".join(out.keys()))
    # The hash is whichever returned value is a 64-character hex string.
    want = next((v for v in out.values() if isinstance(v, str) and len(v) == 64
                 and all(c in "0123456789abcdefABCDEF" for c in v)), None)
    if want is None:
        raise SystemExit("No SHA-256 in the tool output. Paste me the 'Tool returned keys' line.")
    # Prefer a ready-made JSON string from the tool; otherwise try common serialisations.
    candidates = [v for v in out.values() if isinstance(v, str) and v.lstrip().startswith("{")]
    card_obj = next((v for k, v in out.items() if isinstance(v, dict) and "name" in v), None)
    if card_obj is not None:
        candidates += [json.dumps(card_obj, separators=(",", ":")),
                       json.dumps(card_obj, separators=(",", ":"), sort_keys=True),
                       json.dumps(card_obj, indent=2), json.dumps(card_obj, indent=2) + "\n",
                       json.dumps(card_obj, indent=2, sort_keys=True)]
    for text in candidates:
        data = text.encode("utf-8")
        if hashlib.sha256(data).hexdigest() == want.lower():
            with open("agent-card.json", "wb") as f:
                f.write(data)
            print("Wrote agent-card.json,", len(data), "bytes")
            print("SHA-256:", hashlib.sha256(data).hexdigest())
            print("Matches the tool's hash: yes")
            return
    raise SystemExit("Could not reproduce the tool's hash. Paste me the 'Tool returned keys' line.")


if __name__ == "__main__":
    main()
