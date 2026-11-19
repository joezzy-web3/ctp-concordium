import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, safeFetchBytes } from '../gate/safeFetch.js';

test('non-public addresses are recognised (audit F-09)', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', 'ff02::1', 'not-an-ip']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['185.199.108.153', '8.8.8.8', '172.32.0.1', '2606:50c0:8000::153']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('card fetch refuses private targets, plain http and credentials before any request', async () => {
  for (const url of ['https://127.0.0.1/card.json', 'https://[::1]/card.json', 'https://169.254.169.254/latest/meta-data', 'http://example.com/card.json', 'https://user:pw@example.com/card.json', 'nonsense']) {
    await assert.rejects(safeFetchBytes(url), /non-public|https|credentials|bad card URL/, url);
  }
});

test('a hostname that resolves to loopback is refused at connect time', async () => {
  await assert.rejects(safeFetchBytes('https://localhost/card.json', { timeoutMs: 3000 }), /non-public/);
});
