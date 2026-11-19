// Safe status messages for the signing pages (audit F-13).
// Every part is added as a DOM text node; nothing is ever parsed as HTML.
//   say('ok', 'Sent. Transaction ', code(hash), br(), txLink(hash))
export const code = (t) => ({ tag: 'code', text: String(t) });
export const bold = (t) => ({ tag: 'b', text: String(t) });
export const br = () => ({ tag: 'br' });

/** A CCDScan link, only for a real 64-hex transaction hash. */
export function txLink(hash) {
  const h = String(hash);
  if (!/^[0-9a-f]{64}$/.test(h)) return { tag: 'span', text: '' };
  return { tag: 'a', text: 'View on testnet CCDScan', href: `https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=${h}` };
}

export function say(cls, ...parts) {
  const out = document.getElementById('out');
  const box = document.createElement('div');
  box.className = `msg ${['ok', 'bad', 'info'].includes(cls) ? cls : 'info'}`;
  for (const p of parts) {
    if (typeof p === 'string' || typeof p === 'number') {
      box.appendChild(document.createTextNode(String(p)));
      continue;
    }
    const el = document.createElement(p.tag);
    if (p.text) el.textContent = p.text;
    if (p.href) {
      el.href = p.href;
      el.target = '_blank';
      el.rel = 'noopener';
    }
    box.appendChild(el);
  }
  out.replaceChildren(box);
}
