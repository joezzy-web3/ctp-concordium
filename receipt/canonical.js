// Canonical JSON for receipts: the same receipt always gives the same bytes,
// so the same hash, on any machine and in the browser.
//
// Rules (a strict subset of RFC 8785, enough for our receipts):
// - object keys sorted by UTF-16 code units, no whitespace;
// - only strings, booleans, null, safe integers, arrays and plain objects;
// - money is always a decimal STRING ("1250.00"), never a float;
// - undefined values are rejected rather than silently dropped.
// No Node-only APIs here, so the page can bundle this file unchanged.

export function canonicalize(value) {
  return walk(value, '$');
}

function walk(v, path) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(v)) throw new Error(`${path}: only safe integers allowed (use strings for amounts)`);
      return String(v);
    case 'object': {
      if (Array.isArray(v)) return `[${v.map((x, i) => walk(x, `${path}[${i}]`)).join(',')}]`;
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error(`${path}: only plain objects allowed`);
      const keys = Object.keys(v).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${walk(v[k], `${path}.${k}`)}`).join(',')}}`;
    }
    default:
      throw new Error(`${path}: ${typeof v} is not allowed in a receipt`);
  }
}

/** UTF-8 bytes of the canonical form. */
export function canonicalBytes(value) {
  return new TextEncoder().encode(canonicalize(value));
}

/** SHA-256 hex using Web Crypto (Node 20+ and browsers). */
export async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
