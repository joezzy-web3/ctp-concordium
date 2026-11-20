// The app turns a contract error code (-1, -2, ...) into a name by position, so its list
// must follow the contract's Error enum exactly. This keeps the two from drifting apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('app error names follow the contract Error enum, in order', () => {
  const rs = read('contract/src/lib.rs').split('pub enum Error {')[1].split('\n}')[0];
  const contract = [...rs.matchAll(/^ {4}([A-Z][A-Za-z]+),/gm)].map((m) => m[1]);
  const app = JSON.parse(read('app/src/errors.js').match(/const ERRORS = (\[.*?\]);/)[1].replaceAll("'", '"'));
  assert.ok(contract.length > 20);
  assert.deepEqual(app, contract);
});

test('every error a person can hit has a plain explanation', () => {
  const src = read('app/src/errors.js');
  const app = JSON.parse(src.match(/const ERRORS = (\[.*?\]);/)[1].replaceAll("'", '"'));
  const explained = new Set([...src.split('export const EXPLAIN = {')[1].split('\n};')[0].matchAll(/^ {2}([A-Za-z]+):/gm)].map((m) => m[1]));
  const internal = new Set(['Parse', 'LogFull', 'LogMalformed', 'NotSigner', 'BadHold']);
  assert.deepEqual(app.filter((n) => !explained.has(n) && !internal.has(n)), []);
});
