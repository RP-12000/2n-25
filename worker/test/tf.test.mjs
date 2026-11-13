// Sieve output uploads: /tf/begin, /tf/check, /tf/finish.   Run with: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, FormData } from 'miniflare';
import fs from 'node:fs';
import vm from 'node:vm';
import { checkFactorLines, factorProblem, isPrime50, mulmod50, powmod50, tfHead } from '../worker.js';

const ADMIN = 'test-admin-token-tf-0123456789';
const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL('../worker.js', import.meta.url)),
  modulesRoot: fileURLToPath(new URL('..', import.meta.url)),
  compatibilityDate: '2026-07-01',
  kvNamespaces: ['SUBMISSIONS'],
  bindings: { ADMIN_TOKEN: ADMIN, TF_UPLOADS_PER_DAY: '5' },
});
after(() => mf.dispose());
const BASE = 'https://upload.example/';
let ipCounter = 1;
const freshIp = () => `192.0.2.${ipCounter++}`;

// Real factors: every prime p in [P0, P1) that divides 2^n - 25, for odd n in [N0, N1).
function primesIn(a, b) {
  const s = new Uint8Array(b);
  const out = [];
  for (let i = 2; i < b; i++) {
    if (s[i]) continue;
    if (i >= a) out.push(i);
    for (let j = i * i; j < b; j += i) s[j] = 1;
  }
  return out;
}
function sieveSlice(P0, P1, N0, N1) {
  const hits = new Map();
  const first = N0 % 2 ? N0 : N0 + 1;
  for (const p of primesIn(Math.max(P0, 7), P1)) {
    const t = 25 % p;
    let x = powmod50(2, first, p);           // 2^n mod p, stepping n by 2
    for (let n = first; n < N1; n += 2) {
      if (x === t) {
        if (!hits.has(n)) hits.set(n, []);
        hits.get(n).push(p);
      }
      x = (x * 4) % p;
    }
  }
  return [...hits.entries()].sort((x, y) => x[0] - y[0]);
}
const HEAD = { P0: 1000, P1: 20000, N0: 3600000, N1: 3610000 };
const ROWS = sieveSlice(HEAD.P0, HEAD.P1, HEAD.N0, HEAD.N1);
const TEXT = ROWS.map(([n, ps]) => n + ' ' + ps.join(' ') + '\n').join('');
// Real factors with p near 10^9 (found by stepping 2^n mod p) and above 10^12 (from `factor 2^n-25`).
const MID = [[1323709, 1000024679], [8822477, 1000025777], [4465879, 1000028639], [7115325, 1345295681]];
const BIG = [[55, 11816594627407], [67, 23227705626217], [71, 808887840332527], [75, 105574268742353], [115, 5111176520881]];

test('the arithmetic is exact up to 2^50', () => {
  const M = 2 ** 50 - 27; // prime
  assert.equal(isPrime50(M), true);
  for (const [a, b] of [[M - 1, M - 1], [M - 2, 12345678901234], [2 ** 49, 3], [1, M - 1]]) {
    assert.equal(mulmod50(a, b, M), Number((BigInt(a) * BigInt(b)) % BigInt(M)));
  }
  assert.equal(powmod50(2, 3600003, 1000000007), Number(2n ** 3600003n % 1000000007n));
  for (const c of [2047, 1373653, 25326001, 3215031751, 2152302898747, 3474749660383, 341550071728321]) assert.equal(isPrime50(c), false);
  for (const p of [1000000000039, 10000000000037, 100000000000031]) assert.equal(isPrime50(p), true);
});

test('factor checks: divides, prime, range, not the number itself', () => {
  assert.ok(ROWS.length > 100);
  const [n, ps] = ROWS[0];
  assert.equal(factorProblem(n, ps[0], HEAD.P0, HEAD.P1), '');
  assert.equal(factorProblem(n, ps[0] + 2, HEAD.P0, HEAD.P1), 'does not divide 2^n - 25');
  assert.equal(factorProblem(n, ps[0], ps[0] + 1, HEAD.P1), "outside the file's [P0, P1)");
  assert.equal(factorProblem(7, 103, 0, 1000), 'is 2^n - 25 itself');
  for (const [m, p] of MID) assert.equal(factorProblem(m, p, 1e9, 2e9), '');
  for (const [m, p] of BIG) assert.equal(factorProblem(m, p, 0, 2 ** 50), '');
  assert.equal(factorProblem(BIG[2][0], BIG[2][1], 0, 2 ** 49), "outside the file's [P0, P1)");
  assert.equal(factorProblem(BIG[2][0] + 2, BIG[2][1], 0, 2 ** 50), 'does not divide 2^n - 25');
  const two = sieveSlice(7, 400, 3600001, 3600200).find(([, f]) => f.length >= 2);
  assert.equal(factorProblem(two[0], two[1][0] * two[1][1], 0, 1e6), 'is not prime');
});

test('factor lines: order, parity, range and duplicates', () => {
  const good = checkFactorLines(TEXT, HEAD, HEAD.N0 - 1);
  assert.deepEqual(good.bad, []);
  assert.equal(good.entries, ROWS.length);
  const [n1, p1] = [ROWS[1][0], ROWS[1][1][0]];
  const cases = [
    [`${n1} ${p1}\n${n1} ${p1}\n`, 'n repeated or out of order'],
    [`${n1 + 1} ${p1}\n`, 'even n'],
    [`${HEAD.N1 + 1} ${p1}\n`, 'n outside [N0, N1)'],
    [`${n1} ${p1} ${p1}\n`, 'listed twice'],
  ];
  for (const [text, reason] of cases) {
    const r = checkFactorLines(text, HEAD, HEAD.N0 - 1);
    assert.ok(r.bad.some((b) => b.reason === reason), reason + ' ' + JSON.stringify(r.bad));
  }
  assert.match(checkFactorLines('12 \n', HEAD, 0).error, /malformed/);
  assert.equal(checkFactorLines(TEXT, HEAD, HEAD.N0 - 1, 50).tooMany, true);
});

test('head checks', () => {
  assert.deepEqual(tfHead(HEAD), HEAD);
  assert.match(tfHead({ ...HEAD, P1: 2 ** 51 }), /2\^50/);
  assert.match(tfHead({ ...HEAD, N1: 2e7 }), /N1/);
  assert.match(tfHead({ ...HEAD, P0: HEAD.P1 }), /P0 < P1/);
});

async function begin(text, { head = HEAD, handle = 'sieve tester', ip = freshIp(), meta = {} } = {}) {
  const fd = new FormData();
  fd.append('meta', JSON.stringify({ head, handle, note: 'test', timestamp: '2026-11-20 10:00:00 UTC+0',
    run: { program: 'Mass Prime Siever 12.0', start: '2026-11-19 08:00:00', end: '2026-11-20 10:00:00', wall_s: 93600 },
    counts: { odd: (HEAD.N1 - HEAD.N0) / 2, prp: (HEAD.N1 - HEAD.N0) / 2 - ROWS.length }, ...meta }));
  fd.append('factors', new Blob([text], { type: 'text/plain' }), 'factors.txt');
  const res = await mf.dispatchFetch(BASE + 'tf/begin', { method: 'POST', body: fd, headers: { 'CF-Connecting-IP': ip } });
  return { status: res.status, body: await res.json() };
}
async function post(path, obj) {
  const res = await mf.dispatchFetch(BASE + path, { method: 'POST', body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json' } });
  return { status: res.status, body: await res.json() };
}
/** Line-aligned slices of at most `per` factors. */
function slices(text, per) {
  const ends = [];
  let off = 0, count = 0;
  for (const line of text.split('\n').slice(0, -1)) {
    const k = line.split(' ').length - 1;
    if (count + k > per && count) { ends.push(off); count = 0; }
    off += line.length + 1;
    count += k;
  }
  ends.push(off);
  return ends;
}

test('a clean upload is checked slice by slice and filed', async () => {
  const b = await begin(TEXT);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  let token = b.body.token;
  const ends = slices(TEXT, b.body.factorsPerCheck);
  assert.ok(ends.length > 1);
  const early = await post('tf/finish', { token });
  assert.equal(early.status, 400);
  for (const end of ends) {
    const c = await post('tf/check', { token, end });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    token = c.body.token;
  }
  const f = await post('tf/finish', { token });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.entries, ROWS.length);

  const auth = { headers: { Authorization: 'Bearer ' + ADMIN } };
  const listed = await (await mf.dispatchFetch(BASE + 'admin/list?prefix=tf/', auth)).json();
  assert.equal(listed.keys.length, 1);
  const rec = await (await mf.dispatchFetch(BASE + 'admin/get?key=' + encodeURIComponent(listed.keys[0].name), auth)).json();
  assert.equal(rec.handle, 'sieve tester');
  assert.deepEqual(rec.head, HEAD);
  assert.equal(rec.run.program, 'Mass Prime Siever 12.0');
  assert.equal(rec.factors, ROWS.reduce((s, [, ps]) => s + ps.length, 0));
  const data = await (await mf.dispatchFetch(BASE + 'admin/get?key=' + encodeURIComponent('tfdata/' + rec.id), auth)).text();
  assert.equal(data, TEXT);
});

test('a wrong factor stops the upload at its slice', async () => {
  const bad = ROWS.map(([n, ps], i) => n + ' ' + (i === 40 ? [ps[0] + 2] : ps).join(' ') + '\n').join('');
  const b = await begin(bad);
  let token = b.body.token, stopped = null;
  for (const end of slices(bad, b.body.factorsPerCheck)) {
    const c = await post('tf/check', { token, end });
    if (c.status !== 200) { stopped = c; break; }
    token = c.body.token;
  }
  assert.equal(stopped.status, 422);
  assert.equal(stopped.body.bad[0].n, ROWS[40][0]);
  assert.equal(stopped.body.bad[0].reason, 'does not divide 2^n - 25');
  assert.equal((await post('tf/finish', { token })).status, 400);
});

test('tokens, slice ends and slice sizes are enforced', async () => {
  const b = await begin(TEXT);
  const token = b.body.token;
  const forged = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.equal((await post('tf/check', { token: forged, end: 20 })).status, 403);
  assert.equal((await post('tf/check', { token, end: TEXT.indexOf('\n') })).status, 400); // inside a line
  assert.equal((await post('tf/check', { token, end: TEXT.length })).status, 413);          // too many factors at once
  assert.equal((await post('tf/check', { token, end: TEXT.length + 5 })).status, 400);
});

test('malformed uploads are refused at the start', async () => {
  assert.equal((await begin('3600001 7 x\n')).status, 400);
  assert.equal((await begin(TEXT.slice(0, -1))).status, 400);
  assert.equal((await begin(TEXT, { head: { ...HEAD, P1: 2 ** 52 } })).status, 400);
  assert.equal((await begin(TEXT, { handle: 'bad<name>' })).status, 400);
});

test('per-address cap on sieve uploads', async () => {
  const ip = '198.51.100.77';
  for (let i = 0; i < 5; i++) assert.equal((await begin(TEXT, { ip })).status, 200);
  assert.equal((await begin(TEXT, { ip })).status, 429);
});

test('one check of 150 large factors stays far below 10 ms of CPU', () => {
  // The slowest case: primes just below 2^50 (nine Miller-Rabin bases) and n near 10^7.
  const primes = [];
  for (let q = 2 ** 50 - 1; primes.length < 150; q -= 2) if (isPrime50(q)) primes.push(q);
  const head = { P0: 0, P1: 2 ** 50, N0: 0, N1: 1e7 };
  const real = BIG.map(([n, p]) => n + ' ' + p).join('\n') + '\n';
  assert.deepEqual(checkFactorLines(real, head, 0).bad, []);
  let best = Infinity;
  for (let round = 0; round < 5; round++) {
    const t0 = performance.now();
    for (const q of primes) { powmod50(2, 9999999, q); isPrime50(q); }
    best = Math.min(best, performance.now() - t0);
  }
  console.log(`  150 factor checks near 2^50: ${best.toFixed(2)} ms`);
  assert.ok(best < 5, `150 factor checks took ${best.toFixed(1)} ms`);
});

test('a run that found no factor is filed straight away', async () => {
  const b = await begin('', { head: { P0: 10 ** 14, P1: 10 ** 14 + 1000, N0: 3600000, N1: 3600010 } });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.bytes, 0);
  assert.equal((await post('tf/check', { token: b.body.token, end: 1 })).status, 400);
  const f = await post('tf/finish', { token: b.body.token });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(f.body.entries, 0);
});

test('status says sieve uploads are open', async () => {
  const s = await (await mf.dispatchFetch(BASE + 'status')).json();
  assert.equal(s.sieve, true);
  assert.equal(s.limits.tf.factorsPerCheck, 150);
});

test('the Join page checks factors with the same arithmetic', () => {
  const ctx = { fetch: () => new Promise(() => {}), window: {}, console, BigInt, Math, Number,
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; }, documentElement: { setAttribute() {} } },
    localStorage: { getItem() { return null; }, setItem() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(fileURLToPath(new URL('../../assets/app.js', import.meta.url)), 'utf8'), ctx);
  const S = ctx.window.Site;
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 20000; i++) {
    const m = Math.max(2, Math.floor(rand() * 2 ** (2 + Math.floor(rand() * 49))));
    const a = Math.floor(rand() * m), b = Math.floor(rand() * m), e = Math.floor(rand() * 1e7);
    assert.equal(S.mulmod50(a, b, m), mulmod50(a, b, m));
    assert.equal(S.powmod50(2, e, m), powmod50(2, e, m));
    if (i % 10 === 0) assert.equal(S.isPrime50(m), isPrime50(m));
  }
  for (const [n, p] of [...BIG, ...MID, [7, 103], [3600005, 7]]) assert.equal(S.factorProblem(n, p, 0, 2 ** 50), factorProblem(n, p, 0, 2 ** 50));
  const [n, ps] = ROWS[3];
  assert.equal(S.factorProblem(n, ps[0], HEAD.P0, HEAD.P1), '');
});
