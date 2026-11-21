// Signer ID check (F-01): the parts with no wallet or page in them, so Node tests run them.
// A signer proves with Concordium ID, in zero knowledge, that the account that will seal
// counts belongs to a verified adult, and reveals only their ID document issuer and number
// to the buyer's page. The page keeps a salted fingerprint of those (the person tag); the
// contract refuses an order whose receiver and approver carry the same tag.

const enc = new TextEncoder();
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
export const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
export const sha256 = async (bytes) => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));

export const TAG_DOMAIN = 'CTP-person/v1';
export const RESOURCE = (escrow, account) => `ctp-escrow:<${escrow.index},${escrow.subindex}>:signer:${account}`;
export const SALT_MESSAGE = (escrow) => `Clear to Pay person-tag salt v1 for escrow <${escrow.index},${escrow.subindex}>. Signing this reveals nothing and moves no funds.`;

/** Trims, uppercases and drops inner spaces, so "a12 345" and "A12345" are one document. */
export const normDoc = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');

/**
 * person_tag = SHA-256("CTP-person/v1" ‖ 0 ‖ escrow ‖ 0 ‖ salt ‖ issuer ‖ 0 ‖ document number).
 * The salt is secret to the buyer, so the on-chain tag cannot be matched to a guessed document.
 */
export async function personTag(escrow, salt, issuer, docNo) {
  const i = normDoc(issuer);
  const d = normDoc(docNo);
  if (!i || !d) throw new Error('The proof did not reveal the ID document issuer and number.');
  if (!(salt instanceof Uint8Array) || salt.length !== 32) throw new Error('The person-tag salt must be 32 bytes.');
  return toHex(await sha256(cat(enc.encode(TAG_DOMAIN), [0], enc.encode(`<${escrow.index},${escrow.subindex}>`), [0], salt, enc.encode(i), [0], enc.encode(d))));
}

/** The salt from the buyer's deterministic Ed25519 signature on a fixed message. */
export async function saltFromSignature(sig) {
  const parts = [];
  for (const cred of Object.keys(sig ?? {}).sort()) for (const k of Object.keys(sig[cred]).sort()) parts.push(String(sig[cred][k]));
  if (!parts.length) throw new Error('The wallet returned no signature.');
  return sha256(enc.encode(`CTP-salt/v1|${parts.join('|')}`));
}

/** Revealed attribute values in a presentation (AttributeValue statements), by tag. */
export function revealed(presentation) {
  const out = {};
  for (const vc of presentation?.verifiableCredential ?? []) {
    for (const s of vc?.credentialSubject?.statement ?? []) if (s?.type === 'AttributeValue') out[s.attributeTag] = String(s.attributeValue);
  }
  return out;
}

/** Credential registration ids the presentation is about (account credentials only). */
export function presentedCredIds(presentation) {
  const ids = [];
  for (const vc of presentation?.verifiableCredential ?? []) {
    const id = vc?.credentialSubject?.id;
    if (typeof id === 'string' && /:cred:[0-9a-f]+$/i.test(id)) ids.push(id.split(':').pop().toLowerCase());
  }
  return ids;
}

/** Every credential registration id on an account (from getAccountInfo). */
export function accountCredIds(info) {
  const out = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    for (const k of ['credId', 'regId']) if (typeof v[k] === 'string') out.add(v[k].toLowerCase());
    for (const x of Object.values(v)) walk(x);
  };
  walk(info?.accountCredentials);
  return out;
}

/** The proof must be about the signer's own account, and about nothing else. */
export function boundToAccount(presentation, info) {
  const ids = presentedCredIds(presentation);
  const mine = accountCredIds(info);
  return ids.length === 1 && mine.has(ids[0]);
}

// ---------- links: JSON → deflate → base64url, carried after # so it never reaches a server ----------
const b64u = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); };
const unb64u = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
async function pipe(bytes, stream, maxBytes = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    // Stop as soon as it is too large, before unpacking the rest (audit 21 Nov L4).
    if (n > maxBytes) { await reader.cancel(); throw new Error('That link is too large to be a signer proof.'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

export async function pack(obj) { return b64u(await pipe(enc.encode(JSON.stringify(obj)), new CompressionStream('deflate-raw'))); }
export async function unpack(s, maxBytes = 512 * 1024) {
  if (String(s).length > 2 * maxBytes) throw new Error('That link is too large to be a signer proof.');
  const out = await pipe(unb64u(String(s).trim()), new DecompressionStream('deflate-raw'), maxBytes);
  return JSON.parse(new TextDecoder().decode(out));
}
