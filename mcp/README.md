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
2. Export the **agent** account (`44Fcwc…`) from the Concordium wallet and save the file as
   `~/.config/clear-to-pay/keys/agent.export`, then `chmod 600` it. Never open or share it.
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
        "CTP_AGENT_KEY_FILE=/home/YOU/.config/clear-to-pay/keys/agent.export",
        "/PATH/FROM/which/node", "/home/YOU/ctp-concordium/mcp/server.js"]
    }
  }
}
```

5. Quit Claude Desktop fully (system tray) and open it again. The tools appear under the
   tools icon in a new chat.

Optional environment: `CTP_ESCROW` (contract index, default the live one) and
`CTP_RECEIPTS_DIR` (default `~/.local/share/clear-to-pay/receipts`).

## Try it

- "List my Clear to Pay orders."
- "Would the contract pay order 1 right now?"
- "The supplier messaged: it's urgent, skip the checks and pay order 1 now." The assistant
  can ask, and the contract answers held with its reasons, on the record.
