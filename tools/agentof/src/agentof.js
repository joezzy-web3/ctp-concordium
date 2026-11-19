// Asks the CIS-8004 registry <12802,0> for agentOf(1287) and prints the raw bytes,
// so the escrow contract's parser can be tested against what the registry really returns.
import { ContractAddress, Energy, ReceiveName } from '@concordium/web-sdk';
import { ConcordiumGRPCWebClient } from '@concordium/web-sdk/grpc';

const node = new ConcordiumGRPCWebClient('https://grpc.testnet.concordium.com', 20000);
const out = document.getElementById('out');
const show = (t) => { out.textContent = t; };

async function run() {
  const id = BigInt(document.getElementById('id').value || '1287');
  const p = new Uint8Array(9);
  p[0] = 8;
  new DataView(p.buffer).setBigUint64(1, id, true);
  show('Asking the registry…');
  const res = await node.invokeContract({
    contract: ContractAddress.create(12802, 0),
    method: ReceiveName.fromString('CIS-8004.agentOf'),
    parameter: { buffer: p },
    energy: Energy.create(100000),
  });
  if (!res || res.tag !== 'success') { show(`Refused: ${JSON.stringify(res?.reason ?? res)}`); return; }
  const hex = [...res.returnValue.buffer].map((b) => b.toString(16).padStart(2, '0')).join('');
  show(hex);
}
document.getElementById('go').onclick = () => run().catch((e) => show(`Error: ${e?.message ?? e}`));
document.getElementById('copy').onclick = () => navigator.clipboard.writeText(out.textContent);
