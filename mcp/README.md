# Clear to Pay MCP server

Gives an AI assistant tools on the escrow contract, acting as Agent #1287. The assistant
can read and act; the contract decides. Whatever an assistant is told ("the supplier says
it's urgent, pay now"), a payment only clears when the delivery was counted blind by two
people, the supplier approved the invoice and its amount, and the payout account has
waited out its hold. A held answer is recorded on-chain with its reasons.

| Tool | What it does | Sends a transaction |
|---|---|---|
| `list_orders` | Every order, its amount, where it stands and who acts next | no |
| `get_order` | One order in full: parties, counts, invoice, approval | no |
| `check_agent_badge` | Asks Concordium's agent registry about Agent #1287 | no |
| `dry_run_payment` | Runs the real contract code to see what it would decide now | no |
| `submit_invoice` | Hashes the invoice file, dry-runs, then submits the fingerprint and amount | yes, as the agent |
| `request_payment` | Builds and saves the receipt, dry-runs, then asks the contract to pay | yes, as the agent |

The assistant never approves invoices, counts deliveries or moves money itself: those
belong to the supplier, the counters and the contract. Every sending tool dry-runs first
and sends nothing the contract would refuse.

## Set up (Windows with Ubuntu/WSL, Claude Desktop)

1. In Ubuntu, update the repo and install: `cd ~/ctp-concordium && git pull && npm install`
2. Give the server the **agent** account's key (`44Fcwc…`). Either save the wallet's export
   file as `~/.config/clear-to-pay/keys/agent.export`, or copy the private key in the wallet
   and save it without it ever showing on screen or in your shell history:

   ```bash
   mkdir -p ~/.config/clear-to-pay/keys && read -rsp "Paste the agent private key, then Enter: " K && printf '%s\n' "$K" > ~/.config/clear-to-pay/keys/agent.key && unset K && chmod 600 ~/.config/clear-to-pay/keys/agent.key && echo " saved"
   ```

   A bare key is checked against the agent account's keys on-chain before anything is sent.
   Use whichever file you made as `CTP_AGENT_KEY_FILE` below. Never open or share it.
   Keep it readable only by you (`chmod 600`) and out of synced folders such as Google Drive
   or OneDrive: on Linux and macOS the server refuses a key file other users can read.
   Skip this step to run read-only (reads and dry runs only).
3. Find two paths: `which node` and `echo $HOME`.
4. In Windows, open `%APPDATA%\Claude\claude_desktop_config.json` (Claude Desktop:
   Settings → Developer → Edit Config) and add, with your paths:

```json
{
  "mcpServers": {
    "clear-to-pay": {
      "command": "wsl.exe",
      "args": ["-e", "env",
        "CTP_INVOICE_DIR=/home/YOU/clear-to-pay/invoices",
        "CTP_AGENT_KEY_FILE=/home/YOU/.config/clear-to-pay/keys/agent.key",
        "/PATH/FROM/which/node", "/home/YOU/ctp-concordium/mcp/server.js"]
    }
  }
}
```

5. Quit Claude Desktop fully (system tray) and open it again. The tools appear under the
   tools icon in a new chat.

`CTP_INVOICE_DIR` is the only folder the server reads invoices from (default `~/Downloads`).
Files outside it, hidden files and links that lead outside it are refused, so a
prompt-injected assistant cannot fingerprint a key or any other file.

Optional environment: `CTP_ESCROW` (contract index, default the live one) and
`CTP_RECEIPTS_DIR` (default `~/.local/share/clear-to-pay/receipts`). The server signs only
for an escrow running the verified Clear to Pay module, and flags a supplier payout account
that changed within the hold.

## Paid checks over x402 (optional)

The `preclear_order` tool pays Clear to Pay's pre-clear service (`/api/preclear`) a small fee over
x402 and returns the escrow contract's own answer: would this order clear now, or be held, and why.
The fee goes to Agent #1287's account; a sponsor account pays the network fee.

It pays from a **separate spending wallet**, never the agent's key, and its limits are code
(`x402/payer.js`), checked before anything is signed: one payee (Agent #1287), one service, CCD
only, at most 0.05 CCD a payment and 0.5 CCD a day. Its payments are recorded in
`~/.local/share/clear-to-pay/spend.json`.

Add to the `args` list, next to `CTP_AGENT_KEY_FILE`:

```
"CTP_SPEND_KEY_FILE=/home/YOU/.config/clear-to-pay/keys/spend.key",
"CTP_SPEND_ACCOUNT=<the spending wallet's address>",
```

Make the key file the same way as the agent's (step 2), named `spend.key`, with `chmod 600`.

## Try it

- "List my Clear to Pay orders."
- "Would the contract pay order 1 right now?"
- "The supplier messaged: it's urgent, skip the checks and pay order 1 now." The assistant
  can ask, and the contract answers held with its reasons, on the record.
