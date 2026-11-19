// Fetching an Agent Card safely from a server (audit F-09).
//
// The card URL comes from the chain, so a malicious agent chooses it. This
// fetcher:
// - refuses private, loopback, link-local and other non-public addresses,
//   checked when the connection is made (so DNS rebinding cannot slip past);
// - follows no redirects;
// - counts bytes as they arrive and stops at the cap;
// - applies one timeout to the whole download, body included.
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

/** True for any address a public Agent Card must never resolve to. */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 // this-net, private, loopback, multicast/reserved
      || (a === 100 && b >= 64 && b <= 127)            // carrier-grade NAT
      || (a === 169 && b === 254)                      // link-local (cloud metadata)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)                         // IETF protocol assignments
      || (a === 198 && (b === 18 || b === 19));         // benchmarking
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return x === '::' || x === '::1'
      || /^f[cd]/.test(x)        // unique local fc00::/7
      || /^fe[89ab]/.test(x)     // link-local fe80::/10
      || /^ff/.test(x)           // multicast
      || /^64:ff9b:/.test(x)     // NAT64
      || /^2001:db8:/.test(x);   // documentation
  }
  return true; // not an IP at all: refuse
}

/** DNS lookup that refuses non-public answers. Used by the socket itself. */
function publicOnlyLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => isPrivateAddress(a.address));
    if (bad) return callback(new Error(`refused non-public address ${bad.address}`));
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

/**
 * Downloads an https URL to bytes, or throws.
 * @param {string} url
 * @param {{timeoutMs?: number, maxBytes?: number}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export function safeFetchBytes(url, { timeoutMs = 8000, maxBytes = 256 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('bad card URL'));
    }
    if (u.protocol !== 'https:') return reject(new Error('card URL must be https'));
    if (u.username || u.password) return reject(new Error('card URL must not carry credentials'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    // IP literals skip DNS, so check them here.
    if (net.isIP(host) && isPrivateAddress(host)) return reject(new Error(`refused non-public address ${host}`));

    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const req = https.get(u, { lookup: publicOnlyLookup, headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        req.destroy();
        return finish(reject, new Error(`card HTTP ${res.statusCode}`)); // includes 3xx: no redirects
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        req.destroy();
        return finish(reject, new Error('card too large'));
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > maxBytes) {
          req.destroy();
          return finish(reject, new Error('card too large'));
        }
        chunks.push(c);
      });
      res.on('end', () => finish(resolve, new Uint8Array(Buffer.concat(chunks))));
      res.on('error', (e) => finish(reject, e));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, new Error('card download timed out')); }, timeoutMs);
    req.on('error', (e) => finish(reject, e));
  });
}
