// Run with: npm test   (inside worker/, after npm install)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare, FormData } from 'miniflare';

const ADMIN = 'test-admin-token-0123456789';
const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL('../worker.js', import.meta.url)),
  compatibilityDate: '2026-07-01',
  kvNamespaces: ['SUBMISSIONS'],
  bindings: { ADMIN_TOKEN: ADMIN, UPLOADS_PER_DAY: '6' },
});
after(() => mf.dispose());

const BASE = 'https://upload.example/';
let ipCounter = 1;
const freshIp = () => `203.0.113.${ipCounter++}`;

// Real lines from the archive (3.4M-3.6M range).
const PRP_C = '{"status":"C", "k":1, "b":2, "n":3400047, "c":-25, "worktype":"PRP-3", "res64":"90203D5BB69D9FF8", "residue-type":1, "fft-length":245760, "error-code":"00000000", "security-code":"10C5F2FD", "program":{"name":"Prime95", "version":"30.19", "build":20, "port":4}, "timestamp":"2025-06-08 12:29:43", "errors":{"gerbicz":0}, "proof":{"version":2, "power":7, "hashsize":64, "md5":"2ab443919cf8fe9b28e179efcb82664d"}}';
const PM1_NF = '{"status":"NF", "k":1, "b":2, "n":3400017, "c":-25, "worktype":"P-1", "b1":330000, "b2":9446850, "d":3150, "poly1-size":360, "poly2-size":1629, "stage2-fft-length":262144, "fft-length":229376, "security-code":"588CADAD", "program":{"name":"Prime95", "version":"30.19", "build":20, "port":4}, "timestamp":"2025-05-23 00:32:30"}';
const PM1_F = '{"status":"F", "k":1, "b":2, "n":3400093, "c":-25, "worktype":"P-1", "factors":["3147135032515841"], "b1":330000, "fft-length":229376, "security-code":"580291A8", "program":{"name":"Prime95", "version":"30.19", "build":20, "port":4}, "timestamp":"2025-05-23 00:45:56"}';
const MERSENNE = '{"status":"C", "exponent":136279841, "worktype":"PRP-3", "res64":"0123456789ABCDEF", "fft-length":7340032, "security-code":"12345678", "program":{"name":"Prime95", "version":"30.19"}, "timestamp":"2025-01-01 00:00:00"}';
const RESULTS_TXT = '[Sun Jun  8 12:29:43 2025] 2^3400047-25 is not prime.  RES64: 90203D5BB69D9FF8.';

const PROOF = Buffer.concat([Buffer.from('PRP PROOF\nVERSION=2\nHASHSIZE=64\nPOWER=8\nNUMBER=2^2421175-25\n'), Buffer.alloc(4096, 7)]);
const PROOF_MD5 = createHash('md5').update(PROOF).digest('hex');
const PRP_P = `{"status":"P", "k":1, "b":2, "n":2421175, "c":-25, "worktype":"PRP-3", "fft-length":163840, "error-code":"00000000", "security-code":"1A2B3C4D", "program":{"name":"Prime95", "version":"30.19", "build":20, "port":4}, "timestamp":"2025-02-14 03:12:45", "errors":{"gerbicz":0}, "proof":{"version":2, "power":8, "hashsize":64, "md5":"${PROOF_MD5}"}}`;

async function submit(text, { handle = 'tester', note = '', ip = freshIp() } = {}) {
  const fd = new FormData();
  fd.append('handle', handle);
  fd.append('note', note);
  fd.append('results', new Blob([text], { type: 'text/plain' }), 'results.json.txt');
  const res = await mf.dispatchFetch(BASE + 'submit', { method: 'POST', body: fd, headers: { 'CF-Connecting-IP': ip } });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const adminGet = (path) => mf.dispatchFetch(BASE + path, { headers: { Authorization: 'Bearer ' + ADMIN } });

test('status endpoint answers with open CORS', async () => {
  const res = await mf.dispatchFetch(BASE + 'status');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.accepting, true);
});

test('preflight request is answered', async () => {
  const res = await mf.dispatchFetch(BASE + 'submit', { method: 'OPTIONS', headers: { Origin: 'https://rp-12000.github.io' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

test('valid lines are kept, foreign lines skipped, factor checked', async () => {
  const { status, body } = await submit([PRP_C, PM1_NF, PM1_F, MERSENNE, RESULTS_TXT, PRP_C].join('\r\n'));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.accepted, 3); // duplicate PRP_C line counted once
  assert.equal(body.counts.prp, 1);
  assert.equal(body.counts.pm1, 2);
  assert.deepEqual(body.factors, [{ n: 3400093, factor: '3147135032515841' }]);
  assert.equal(body.skipped.length, 2);
  assert.equal(body.primes.length, 0);
  // stored exactly as written
  const stored = await (await adminGet('admin/get?key=' + encodeURIComponent('sub/' + body.id))).json();
  assert.deepEqual(stored.lines, [PRP_C, PM1_NF, PM1_F]);
  assert.equal(stored.handle, 'tester');
});

test('a wrong factor is rejected', async () => {
  const bad = PM1_F.replace('3147135032515841', '3147135032515843');
  const { status, body } = await submit(bad);
  assert.equal(status, 422);
  assert.match(body.rejected[0].reason, /does not divide/);
});

test('even n and out-of-range n are rejected', async () => {
  const even = PRP_C.replace('"n":3400047', '"n":3400048');
  const big = PRP_C.replace('"n":3400047', '"n":10000001');
  const { status, body } = await submit([even, big].join('\n'));
  assert.equal(status, 422);
  assert.match(body.rejected[0].reason, /even n/);
  assert.match(body.rejected[1].reason, /from 5 to/);
});

test('results.txt instead of results.json.txt gets a clear message', async () => {
  const { status, body } = await submit(RESULTS_TXT + '\n' + RESULTS_TXT);
  assert.equal(status, 422);
  assert.match(body.errors[0], /results\.json\.txt/);
});

test('composite without residue is rejected', async () => {
  const noRes = PRP_C.replace('"res64":"90203D5BB69D9FF8", ', '');
  const { status, body } = await submit(noRes);
  assert.equal(status, 422);
  assert.match(body.rejected[0].reason, /residue/);
});

test('bad credit names are refused', async () => {
  const { status } = await submit(PRP_C, { handle: '<script>alert(1)</script>' });
  assert.equal(status, 400);
  const ok = await submit(PRP_C, { handle: 'RP-12000 (laptop)' });
  assert.equal(ok.status, 200);
  const anon = await submit(PRP_C, { handle: '' });
  assert.equal(anon.body.handle, 'anonymous');
});

test('a prime gets a proof link; proof upload is checked', async () => {
  const { status, body } = await submit(PRP_P + '\n' + PRP_C);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.primes.length, 1);
  const p = body.primes[0];
  assert.equal(p.n, 2421175);
  assert.equal(p.md5, PROOF_MD5);
  assert.ok(p.token);

  // wrong file
  let res = await mf.dispatchFetch(BASE + 'proof?token=' + encodeURIComponent(p.token), { method: 'POST', body: Buffer.from('hello world, not a proof') });
  assert.equal(res.status, 422);

  // tampered token
  const forged = p.token.slice(0, -3) + (p.token.endsWith('AAA') ? 'BBB' : 'AAA');
  res = await mf.dispatchFetch(BASE + 'proof?token=' + encodeURIComponent(forged), { method: 'POST', body: PROOF });
  assert.equal(res.status, 403);

  // good upload
  res = await mf.dispatchFetch(BASE + 'proof?token=' + encodeURIComponent(p.token), { method: 'POST', body: PROOF });
  const ok = await res.json();
  assert.equal(res.status, 200, JSON.stringify(ok));
  assert.equal(ok.bytes, PROOF.length);

  const stored = Buffer.from(await (await adminGet('admin/get?key=' + encodeURIComponent(ok.key))).arrayBuffer());
  assert.equal(createHash('md5').update(stored).digest('hex'), PROOF_MD5);

  const listed = await (await adminGet('admin/list?prefix=proof/')).json();
  const entry = listed.keys.find((k) => k.name === ok.key);
  assert.ok(entry);
  assert.equal(entry.metadata.md5, PROOF_MD5);
});

test('no proof link for composite results', async () => {
  const { body } = await submit(PRP_C);
  assert.equal(body.primes.length, 0);
  const res = await mf.dispatchFetch(BASE + 'proof?token=abc.def', { method: 'POST', body: PROOF });
  assert.equal(res.status, 403);
});

test('admin endpoints need the token', async () => {
  let res = await mf.dispatchFetch(BASE + 'admin/list');
  assert.equal(res.status, 401);
  res = await mf.dispatchFetch(BASE + 'admin/list', { headers: { Authorization: 'Bearer wrong' } });
  assert.equal(res.status, 401);
  res = await adminGet('admin/list');
  const listed = await res.json();
  assert.equal(res.status, 200);
  assert.ok(listed.keys.length >= 3);
  assert.ok(listed.keys.every((k) => k.name.startsWith('sub/')));
  assert.ok(listed.keys[0].metadata.handle);

  const key = listed.keys[0].name;
  res = await mf.dispatchFetch(BASE + 'admin/delete?key=' + encodeURIComponent(key), { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN } });
  assert.equal(res.status, 200);
  res = await adminGet('admin/get?key=' + encodeURIComponent(key));
  assert.equal(res.status, 404);
  res = await mf.dispatchFetch(BASE + 'admin/delete?key=rl/x', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN } });
  assert.equal(res.status, 400);
});

test('per-address daily cap', async () => {
  const ip = '198.51.100.7';
  for (let i = 0; i < 6; i++) {
    const r = await submit(PM1_NF, { ip });
    assert.equal(r.status, 200);
  }
  const blocked = await submit(PM1_NF, { ip });
  assert.equal(blocked.status, 429);
  const other = await submit(PM1_NF, { ip: '198.51.100.8' });
  assert.equal(other.status, 200);
});

test('oversized uploads are refused early', async () => {
  const big = (PRP_C + '\n').repeat(1200); // about 580 kB
  const { status } = await submit(big);
  assert.equal(status, 413);
});

test('too many lines are cut off with a reason', async () => {
  const lines = [];
  for (let n = 3400001; lines.length < 1100; n += 2) lines.push(PM1_NF.replace('"n":3400017', `"n":${n}`).replace(', "poly1-size":360, "poly2-size":1629, "stage2-fft-length":262144', ''));
  const { status, body } = await submit(lines.join('\n'));
  assert.equal(status, 200, JSON.stringify(body).slice(0, 300));
  assert.equal(body.accepted, 1000);
  assert.match(body.rejected[0].reason, /more than 1000 lines/);
});
