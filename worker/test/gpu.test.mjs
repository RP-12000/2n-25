// dfprp result lines: the checksum leads with the line's own program name, "dfprp", or "hyprp" before the rename.
// Run with: npm test   (inside worker/, after npm install)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, FormData } from 'miniflare';
import { gpuChecksum, checkGpuLine } from '../worker.js';

// n = 20011, the test vector of the dfprp thread (2026-11-27): the same result under both program names
const RES64 = 'D6077DAFC085AB4C';
const RES2048 = 'B840D6224D48A90AA85AFA933C47492D30F4C2F657338151101EDC8132BFBF1999E41BF1F720B8BDEE2B72A522FA92F7D6B99E7C69122BC078D383CDB43AF9C5971FD6E45397A2F599A374C685D25D9841A4C4D5B7C1A7F5DA1FED05B3A4D99A56CBD06555A7818427F99BBD52BA639C73218DBF235D4EBC001C272C4ABAC94B8C4263DA2E37C288A0C973970E6F9187A82DEF3B2213E885D2B1AF570EE05B36628CA2CB53B8D512611F8DC30BFC678B6D88FC66AFDE67663759372266CD4B105BC5270C1BC05FEEFE5028111CDF267B011D262CC76EE22034E56B93D48B0DB45B753D9831A14B005B6E336F330B36F8AA6E827A7794BB59D6077DAFC085AB4C';
const line = (program, checksum) => ({ n: 20011, k: 1, b: 2, c: -25, worktype: 'PRP-3', status: 'C', res64: RES64, res2048: RES2048,
  program, version: 1.0, checksum, gpu_uuid: 'GPU-12345678-1234-1234-1234-123456789abc', user: 'Tester', timestamp: '2026-11-27 02:00:00' });

test('the checksum leads with the program name: dfprp and hyprp vectors', () => {
  assert.equal(gpuChecksum(line('dfprp')), 'CECB788E');
  assert.equal(gpuChecksum(line('hyprp')), '83E716D5');
});

test('a dfprp line and an older hyprp line are both taken; swapped checksums are not', () => {
  assert.ok(checkGpuLine(line('dfprp', 'CECB788E'), 20011, 'PRP-3').rec);
  assert.ok(checkGpuLine(line('hyprp', '83E716D5'), 20011, 'PRP-3').rec);
  assert.match(checkGpuLine(line('dfprp', '83E716D5'), 20011, 'PRP-3').error, /checksum does not match/);
  assert.match(checkGpuLine(line('hyprp', 'CECB788E'), 20011, 'PRP-3').error, /checksum does not match/);
  assert.match(checkGpuLine(line('dfprp'), 20011, 'PRP-3').error, /no checksum/);
});

const mf = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL('../worker.js', import.meta.url)),
  compatibilityDate: '2026-07-01',
  kvNamespaces: ['SUBMISSIONS'],
  bindings: { ADMIN_TOKEN: 'test-admin-token-0123456789', UPLOADS_PER_DAY: '6' },
});
after(() => mf.dispose());

test('an upload of dfprp results.json.txt keeps the line that checks out', async () => {
  const text = [line('dfprp', 'CECB788E'), Object.assign(line('dfprp', '00000000'), { n: 20013 })].map((j) => JSON.stringify(j)).join('\n');
  const fd = new FormData();
  fd.append('handle', 'Tester');
  fd.append('note', '');
  fd.append('results', new Blob([text], { type: 'text/plain' }), 'results.json.txt');
  const res = await mf.dispatchFetch('https://upload.example/submit', { method: 'POST', body: fd, headers: { 'CF-Connecting-IP': '203.0.113.200' } });
  const body = await res.json();
  assert.equal(body.accepted, 1, JSON.stringify(body));
  assert.equal(body.rejected.length, 1);
});
