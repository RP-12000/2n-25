/**
 * 2^n-25 Prime Search: result upload endpoint (Cloudflare Worker, free plan).
 *
 * Needs, in the Cloudflare dashboard (Worker > Settings) or in wrangler.toml:
 *   SUBMISSIONS  binding to a Workers KV namespace. Uploads wait there until
 *                tools/pull_submissions.py copies them into the archive.
 *   ADMIN_TOKEN  secret. Lets the pull script list, read and delete uploads,
 *                and signs the one-time links used to send a proof file.
 *
 * Public endpoints (no cookies, open CORS):
 *   GET  /status            limits, health check
 *   POST /submit            multipart form: results (file or pasted text), handle, note
 *   POST /proof?token=...   raw proof file, only for a PRP line that reported a prime
 *   POST /tf/begin          sieve output: multipart meta (JSON) + factors ("n p p ..." lines)
 *   POST /tf/check          JSON {token, end}: checks the next lines, every factor, returns a new token
 *   POST /tf/finish         JSON {token}: files the upload once every line has been checked
 * Admin endpoints (header "Authorization: Bearer <ADMIN_TOKEN>"):
 *   GET  /admin/list?prefix=sub/&cursor=...
 *   GET  /admin/get?key=...
 *   POST /admin/delete?key=...
 *
 * Only Prime95 / mprime JSON result lines for 1*2^n-25 are kept: PRP tests and
 * P-1 runs. Proof files are taken only for results that report a probable prime.
 *
 * Sieve output (Mass Prime Siever results.json) is reduced by the Join page to the
 * odd n that have a factor, one line "n p p ..." each. The Worker stores those lines
 * once, then checks them in small slices as the page asks for them, so that every
 * factor is verified (P0 <= p < P1, p divides 2^n - 25, p is prime and not 2^n - 25
 * itself) within the free plan's CPU time per request. A signed token carries the
 * position from one slice to the next; the upload is filed only after the last one.
 * p may go up to 2^53 - 1, the largest whole number a JSON number holds exactly;
 * from 2^50 up the checks use BigInt, which is slower, so those slices are smaller.
 */

const LIMITS = {
  resultsBytes: 400000,                 // per request; the Join page splits bigger files
  lines: 1000,                          // keeps one request well inside the 10 ms CPU budget
  proofBytes: 25 * 1024 * 1024 - 65536, // a Workers KV value holds at most 25 MiB
  maxN: 10000000,                       // the database covers n < 10^7
  uploadsPerDay: 40,                    // per IP address, counted after a valid upload
  handleChars: 40,
  noteChars: 500,
  proofTokenDays: 7,
  tf: {
    textBytes: 3 * 1024 * 1024,        // factor lines per upload; the Join page splits bigger files by n
    factorsPerCheck: 150,              // one /tf/check stays well inside 10 ms of CPU time
    factorsPerCheckBig: 40,            // the same when P1 is above 2^50, where the factors are checked with BigInt
    maxP: Number.MAX_SAFE_INTEGER,     // 2^53 - 1: every factor below it is an exact JSON number
    uploadsPerDay: 20,
    tokenHours: 48,
  },
};

const HEX8 = /^[0-9A-Fa-f]{8}$/;
const HEX16 = /^[0-9A-Fa-f]{16}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const HANDLE = /^[\p{L}\p{N} ._\-()[\]+#]+$/u;
const OPEN_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (path.startsWith('/admin/')) return await admin(request, env, url, path);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: OPEN_CORS });
      if (path === '/' || path === '/status') {
        return reply({ ok: true, service: '2^n-25 result upload', accepting: Boolean(env.SUBMISSIONS), sieve: Boolean(env.SUBMISSIONS && env.ADMIN_TOKEN), limits: LIMITS });
      }
      if (path === '/submit') {
        if (request.method !== 'POST') return reply({ ok: false, errors: ['Use POST'] }, 405);
        return await submit(request, env);
      }
      if (path === '/proof') {
        if (request.method !== 'POST' && request.method !== 'PUT') return reply({ ok: false, errors: ['Use POST'] }, 405);
        return await proof(request, env, url);
      }
      if (path === '/tf/begin' || path === '/tf/check' || path === '/tf/finish') {
        if (request.method !== 'POST') return reply({ ok: false, errors: ['Use POST'] }, 405);
        if (!env.SUBMISSIONS || !env.ADMIN_TOKEN) return reply({ ok: false, errors: ['Sieve uploads are not set up yet.'] }, 503);
        if (path === '/tf/begin') return await tfBegin(request, env);
        if (path === '/tf/check') return await tfCheck(request, env);
        return await tfFinish(request, env);
      }
      return reply({ ok: false, errors: ['Not found'] }, 404);
    } catch (err) {
      return reply({ ok: false, errors: ['Server error: ' + (err && err.message ? err.message : String(err))] }, 500);
    }
  },
};

/* ---------- POST /submit ---------- */

async function submit(request, env) {
  if (!env.SUBMISSIONS) return reply({ ok: false, errors: ['Uploads are not set up yet (no KV binding).'] }, 503);
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > LIMITS.resultsBytes + 65536) {
    return reply({ ok: false, errors: [`Upload is larger than ${LIMITS.resultsBytes} bytes. Split results.json.txt into smaller parts.`] }, 413);
  }
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return reply({ ok: false, errors: ['Send the upload as multipart/form-data with a "results" field.'] }, 400);
  }

  const parts = [];
  for (const item of form.getAll('results')) {
    parts.push(typeof item === 'string' ? item : await item.text());
  }
  const text = parts.join('\n');
  if (!text.trim()) return reply({ ok: false, errors: ['No results: attach results.json.txt or paste its lines.'] }, 400);
  if (text.length > LIMITS.resultsBytes) {
    return reply({ ok: false, errors: [`Results are larger than ${LIMITS.resultsBytes} bytes. Split them into smaller parts.`] }, 413);
  }

  const handleRaw = String(form.get('handle') || '').replace(/\s+/g, ' ').trim();
  if (handleRaw.length > LIMITS.handleChars || (handleRaw && !HANDLE.test(handleRaw))) {
    return reply({ ok: false, errors: [`The credit name may use letters, digits, spaces and . _ - ( ) [ ] + # (at most ${LIMITS.handleChars} characters).`] }, 400);
  }
  const handle = handleRaw || 'anonymous';
  const note = String(form.get('note') || '').slice(0, LIMITS.noteChars);

  const check = checkResults(text);
  if (check.records.length === 0) {
    const errors = [];
    if (check.nonJson > 0 && check.rejected.length === 0 && check.skipped.length === check.nonJson) {
      errors.push('No JSON lines found. Upload results.json.txt (one JSON object per line), not results.txt.');
    } else {
      errors.push('None of the lines is a usable 2^n-25 result.');
    }
    return reply({ ok: false, errors, rejected: check.rejected.slice(0, 50), skipped: check.skipped.slice(0, 50) }, 422);
  }

  if (await overDailyLimit(request, env, 'rl/', Number(env.UPLOADS_PER_DAY) || LIMITS.uploadsPerDay)) {
    return reply({ ok: false, errors: [`More than ${LIMITS.uploadsPerDay} uploads from this address today. Try again tomorrow or contact the project.`] }, 429);
  }

  const now = new Date();
  const id = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + randomHex(4);
  const primes = check.records.filter((r) => r.prime).map((r) => ({ n: r.n, md5: r.md5 || '' }));
  const record = {
    id,
    received: now.toISOString(),
    handle,
    note,
    counts: {
      prp: check.records.filter((r) => r.kind === 'prp').length,
      pm1: check.records.filter((r) => r.kind === 'pm1').length,
      primes: primes.length,
      factors: check.factors.length,
      rejected: check.rejected.length,
      skipped: check.skipped.length,
    },
    primes: primes.map((p) => p.n),
    factors: check.factors,
    lines: check.records.map((r) => r.line),
    rejected: check.rejected.slice(0, 200),
  };
  await env.SUBMISSIONS.put('sub/' + id, JSON.stringify(record), {
    metadata: { handle: handle.slice(0, 40), lines: record.lines.length, primes: record.primes.slice(0, 8) },
  });

  const proofs = [];
  for (const p of primes) {
    const token = env.ADMIN_TOKEN ? await signToken(env, { id, n: p.n, md5: p.md5 }) : null;
    proofs.push({ n: p.n, md5: p.md5, token });
  }
  return reply({
    ok: true,
    id,
    handle,
    accepted: record.lines.length,
    counts: record.counts,
    factors: check.factors,
    primes: proofs,
    rejected: check.rejected.slice(0, 50),
    skipped: check.skipped.slice(0, 50),
  });
}

/* ---------- result line checks (shared logic with the Join page preview) ---------- */

export function checkResults(text) {
  const records = [];
  const rejected = [];
  const skipped = [];
  const factors = [];
  const seen = new Set();
  let nonJson = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (records.length + rejected.length >= LIMITS.lines) {
      rejected.push({ line: i + 1, reason: `more than ${LIMITS.lines} lines in one upload` });
      break;
    }
    if (line[0] !== '{') {
      nonJson++;
      skipped.push({ line: i + 1, reason: 'not a JSON line (results.txt text is not collected)' });
      continue;
    }
    let j;
    try {
      j = JSON.parse(line);
    } catch (e) {
      rejected.push({ line: i + 1, reason: 'broken JSON' });
      continue;
    }
    const verdict = checkLine(j);
    if (verdict.skip) {
      skipped.push({ line: i + 1, reason: verdict.skip });
      continue;
    }
    if (verdict.error) {
      rejected.push({ line: i + 1, n: Number.isInteger(j && j.n) ? j.n : null, reason: verdict.error });
      continue;
    }
    if (seen.has(line)) continue;
    seen.add(line);
    const rec = verdict.rec;
    rec.line = line;
    records.push(rec);
    if (rec.factors) for (const f of rec.factors) factors.push({ n: rec.n, factor: f });
  }
  return { records, rejected, skipped, factors, nonJson };
}

export function checkLine(j) {
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return { skip: 'not a JSON object' };
  if (j.k !== 1 || j.b !== 2 || j.c !== -25) return { skip: 'not a 2^n-25 result' };
  const n = j.n;
  if (!Number.isInteger(n) || n < 5 || n >= LIMITS.maxN) return { error: `n must be a whole number from 5 to ${LIMITS.maxN - 1}` };
  if (n % 2 === 0) return { error: 'even n: 2^n-25 = (2^(n/2)-5)(2^(n/2)+5) is never prime' };
  const wt = j.worktype;
  if (typeof wt !== 'string') return { error: 'no worktype' };
  const prog = j.program;
  if (!prog || typeof prog !== 'object' || typeof prog.name !== 'string' || typeof prog.version !== 'string') {
    return { error: 'no program name and version' };
  }
  if (typeof j.timestamp !== 'string' || !TIMESTAMP.test(j.timestamp)) return { error: 'no timestamp' };
  if (typeof j['security-code'] !== 'string' || !HEX8.test(j['security-code'])) return { error: 'no security-code' };
  const errorCode = j['error-code'];
  if (errorCode !== undefined && (typeof errorCode !== 'string' || !HEX8.test(errorCode))) return { error: 'malformed error-code' };
  const suspect = Boolean(errorCode && errorCode !== '00000000');

  if (/^PRP(-\d+)?$/.test(wt)) {
    if (j.status === 'C') {
      if (typeof j.res64 !== 'string' || !HEX16.test(j.res64)) return { error: 'composite result without a 64-bit residue' };
    } else if (j.status !== 'P') {
      return { error: 'PRP status must be C or P' };
    }
    if (!Number.isInteger(j['fft-length']) || j['fft-length'] <= 0) return { error: 'no fft-length' };
    const md5 = j.proof && typeof j.proof.md5 === 'string' && /^[0-9a-f]{32}$/i.test(j.proof.md5) ? j.proof.md5.toLowerCase() : '';
    return { rec: { kind: 'prp', n, status: j.status, prime: j.status === 'P', md5, suspect } };
  }

  if (wt === 'P-1') {
    if (j.status !== 'NF' && j.status !== 'F') return { error: 'P-1 status must be NF or F' };
    if (!Number.isInteger(j.b1) || j.b1 <= 0) return { error: 'no B1' };
    if (j.b2 !== undefined && (!Number.isInteger(j.b2) || j.b2 < j.b1)) return { error: 'malformed B2' };
    let found = null;
    if (j.status === 'F') {
      if (!Array.isArray(j.factors) || j.factors.length === 0) return { error: 'factor result without factors' };
      found = [];
      for (const f of j.factors) {
        if (typeof f !== 'string' || !/^[1-9]\d{1,199}$/.test(f)) return { error: 'malformed factor' };
        if (!divides(BigInt(f), n)) return { error: `${f} does not divide 2^${n}-25` };
        found.push(f);
      }
    }
    return { rec: { kind: 'pm1', n, status: j.status, prime: false, factors: found, suspect } };
  }

  return { skip: `worktype ${wt} is not collected` };
}

/** True when p divides 2^n - 25. */
export function divides(p, n) {
  if (p < 2n) return false;
  let result = 1n;
  let base = 2n % p;
  let e = BigInt(n);
  while (e > 0n) {
    if (e & 1n) result = (result * base) % p;
    base = (base * base) % p;
    e >>= 1n;
  }
  return (result - (25n % p) + p) % p === 0n;
}

/* ---------- POST /proof?token=... ---------- */

async function proof(request, env, url) {
  if (!env.SUBMISSIONS || !env.ADMIN_TOKEN) return reply({ ok: false, errors: ['Proof uploads are not set up yet.'] }, 503);
  const claim = await verifyToken(env, url.searchParams.get('token') || '');
  if (!claim) return reply({ ok: false, errors: ['This proof link is invalid or has expired. Upload results.json.txt again to get a new one.'] }, 403);
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > LIMITS.proofBytes) return reply({ ok: false, errors: [`Proof file is larger than ${LIMITS.proofBytes} bytes.`] }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return reply({ ok: false, errors: ['Send the proof file as the request body.'] }, 400);
  if (body.byteLength > LIMITS.proofBytes) return reply({ ok: false, errors: [`Proof file is larger than ${LIMITS.proofBytes} bytes.`] }, 413);
  const head = new TextDecoder('latin1').decode(body.slice(0, 512));
  if (!head.startsWith('PRP PROOF') || !head.includes(String(claim.n))) {
    return reply({ ok: false, errors: [`This is not a Prime95 proof file for n = ${claim.n}.`] }, 422);
  }
  const key = `proof/${claim.id}/${claim.n}`;
  await env.SUBMISSIONS.put(key, body, { metadata: { n: claim.n, md5: claim.md5 || '', size: body.byteLength } });
  return reply({ ok: true, key, n: claim.n, bytes: body.byteLength });
}

/* ---------- sieve output: POST /tf/begin, /tf/check, /tf/finish ---------- */

const RUN_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

async function tfBegin(request, env) {
  const T = LIMITS.tf;
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > T.textBytes + 65536) return reply({ ok: false, errors: [`Upload is larger than ${T.textBytes} bytes. The Join page splits bigger files.`] }, 413);
  let form, meta;
  try {
    form = await request.formData();
    meta = JSON.parse(String(form.get('meta') || ''));
  } catch (e) {
    return reply({ ok: false, errors: ['Send multipart/form-data with a "meta" JSON field and a "factors" field.'] }, 400);
  }
  if (!meta || typeof meta !== 'object') return reply({ ok: false, errors: ['meta must be a JSON object'] }, 400);
  const head = tfHead(meta.head);
  if (typeof head === 'string') return reply({ ok: false, errors: [head] }, 400);

  const handleRaw = String(meta.handle || '').replace(/\s+/g, ' ').trim();
  if (handleRaw.length > LIMITS.handleChars || (handleRaw && !HANDLE.test(handleRaw))) {
    return reply({ ok: false, errors: [`The credit name may use letters, digits, spaces and . _ - ( ) [ ] + # (at most ${LIMITS.handleChars} characters).`] }, 400);
  }
  const run = meta.run && typeof meta.run === 'object' ? meta.run : {};
  const info = {
    handle: handleRaw || 'anonymous',
    note: String(meta.note || '').slice(0, LIMITS.noteChars),
    timestamp: String(meta.timestamp || '').slice(0, 40),
    run: {
      program: /^Mass Prime Siever [\d.]{1,12}$/.test(String(run.program || '')) ? String(run.program) : '',
      start: RUN_STAMP.test(String(run.start || '')) ? String(run.start) : '',
      end: RUN_STAMP.test(String(run.end || '')) ? String(run.end) : '',
      wall_s: Number.isFinite(run.wall_s) && run.wall_s >= 0 && run.wall_s < 1e9 ? Math.round(run.wall_s) : 0,
    },
    counts: {
      odd: Number.isSafeInteger(meta.counts && meta.counts.odd) ? meta.counts.odd : null,
      prp: Number.isSafeInteger(meta.counts && meta.counts.prp) ? meta.counts.prp : null,
    },
  };

  const item = form.get('factors');
  if (item === null) return reply({ ok: false, errors: ['No "factors" field. Send it empty when the run found no factor.'] }, 400);
  const text = typeof item === 'string' ? item : await item.text();
  if (text.length > T.textBytes) return reply({ ok: false, errors: [`Factor lines are larger than ${T.textBytes} bytes. Split them by n.`] }, 413);
  if (text && (!/^[0-9 \n]+$/.test(text) || !text.endsWith('\n'))) {
    return reply({ ok: false, errors: ['Factor lines must look like "n p p ...", one odd n per line, ending with a newline.'] }, 400);
  }
  if (await overDailyLimit(request, env, 'tfrl/', Number(env.TF_UPLOADS_PER_DAY) || T.uploadsPerDay)) {
    return reply({ ok: false, errors: [`More than ${T.uploadsPerDay} sieve uploads from this address today. Try again tomorrow or contact the project.`] }, 429);
  }
  const id = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + randomHex(4);
  await env.SUBMISSIONS.put('tfdata/' + id, text, { metadata: { bytes: text.length } });
  const state = { id, len: text.length, off: 0, last: head.N0 - 1, entries: 0, factors: 0, head, info, exp: Date.now() + T.tokenHours * 3600000 };
  return reply({ ok: true, id, bytes: text.length, factorsPerCheck: factorsPerCheck(head), token: await tfSign(env, state) });
}

async function tfCheck(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return reply({ ok: false, errors: ['Send JSON {token, end}.'] }, 400);
  }
  const state = await tfVerify(env, body && body.token);
  if (!state) return reply({ ok: false, errors: ['This upload has expired or the token is not valid. Start the upload again.'] }, 403);
  const end = body.end;
  if (!Number.isInteger(end) || end <= state.off || end > state.len) return reply({ ok: false, errors: ['end must lie after the part already checked'] }, 400);
  const data = await env.SUBMISSIONS.get('tfdata/' + state.id, 'arrayBuffer');
  if (!data || data.byteLength !== state.len) return reply({ ok: false, retry: true, errors: ['The upload is not readable here yet; try again in a few seconds.'] }, 409);
  const bytes = new Uint8Array(data, state.off, end - state.off);
  if (bytes[bytes.length - 1] !== 10) return reply({ ok: false, errors: ['A check must end at the end of a line.'] }, 400);
  const res = checkFactorLines(new TextDecoder().decode(bytes), state.head, state.last, factorsPerCheck(state.head));
  if (res.error) return reply({ ok: false, errors: [res.error] }, res.tooMany ? 413 : 400);
  if (res.bad.length) {
    return reply({ ok: false, errors: [`${res.bad.length} of the lines from offset ${state.off} do not check out.`], bad: res.bad.slice(0, 20) }, 422);
  }
  const next = { ...state, off: end, last: res.last, entries: state.entries + res.entries, factors: state.factors + res.factors };
  return reply({ ok: true, off: end, entries: next.entries, factors: next.factors, token: await tfSign(env, next) });
}

async function tfFinish(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return reply({ ok: false, errors: ['Send JSON {token}.'] }, 400);
  }
  const state = await tfVerify(env, body && body.token);
  if (!state) return reply({ ok: false, errors: ['This upload has expired or the token is not valid. Start the upload again.'] }, 403);
  if (state.off !== state.len) return reply({ ok: false, errors: ['Not every line has been checked yet.'] }, 400);
  const record = {
    id: state.id,
    received: new Date().toISOString(),
    ...state.info,
    head: state.head,
    entries: state.entries,
    factors: state.factors,
    bytes: state.len,
  };
  await env.SUBMISSIONS.put('tf/' + state.id, JSON.stringify(record), {
    metadata: { handle: state.info.handle.slice(0, 40), entries: state.entries, factors: state.factors, ...state.head },
  });
  return reply({ ok: true, id: state.id, entries: state.entries, factors: state.factors });
}

/** Slice header of one sieve output: {P0, P1, N0, N1}, or an error message. */
export function tfHead(h) {
  if (!h || typeof h !== 'object') return 'no head {P0, P1, N0, N1}';
  const { P0, P1, N0, N1 } = h;
  if (![P0, P1, N0, N1].every(Number.isSafeInteger)) return 'P0, P1, N0 and N1 must be whole numbers';
  if (N0 < 0 || N1 > LIMITS.maxN || N0 >= N1) return `need 0 <= N0 < N1 <= ${LIMITS.maxN}`;
  if (P0 < 0 || P0 >= P1) return 'need 0 <= P0 < P1';
  if (P1 > LIMITS.tf.maxP) return 'P1 above 2^53 - 1 is not taken here; send the file through a GitHub issue';
  return { P0, P1, N0, N1 };
}

/** Factors per /tf/check for a slice: fewer when its p go above 2^50 (BigInt checks). */
export function factorsPerCheck(head) {
  return head.P1 > P50 ? LIMITS.tf.factorsPerCheckBig : LIMITS.tf.factorsPerCheck;
}

/**
 * Checks factor lines "n p p ..." (each ending in a newline): n odd, increasing, after `last`, inside
 * [N0, N1); every factor in [P0, P1), dividing 2^n - 25, prime, and not 2^n - 25 itself.
 */
export function checkFactorLines(text, head, last, maxFactors) {
  const lines = text.split('\n');
  lines.pop();
  let factors = 0;
  const rows = [];
  for (const line of lines) {
    const parts = line.split(' ');
    if (parts.length < 2 || parts.some((x) => x === '')) return { error: `malformed line "${line.slice(0, 60)}"` };
    factors += parts.length - 1;
    if (maxFactors && factors > maxFactors) return { error: `more than ${maxFactors} factors in one check`, tooMany: true };
    rows.push(parts);
  }
  const bad = [];
  for (const parts of rows) {
    const n = Number(parts[0]);
    if (!Number.isSafeInteger(n) || n <= last) bad.push({ n, reason: 'n repeated or out of order' });
    else if (n % 2 === 0) bad.push({ n, reason: 'even n' });
    else if (n < Math.max(5, head.N0) || n >= head.N1) bad.push({ n, reason: 'n outside [N0, N1)' });
    if (Number.isSafeInteger(n) && n > last) last = n;
    const seen = new Set();
    for (let i = 1; i < parts.length; i++) {
      const p = Number(parts[i]);
      let why = !Number.isSafeInteger(p) ? 'not a whole number' : seen.has(p) ? 'listed twice' : factorProblem(n, p, head.P0, head.P1);
      seen.add(p);
      if (why) bad.push({ n, p: parts[i], reason: why });
    }
  }
  return { bad, entries: rows.length, factors, last };
}

/** Why p is not an acceptable sieve factor of 2^n - 25, or '' when it checks out (p < 2^53). */
export function factorProblem(n, p, P0, P1) {
  if (!(p >= P0 && p < P1)) return "outside the file's [P0, P1)";
  const big = p >= P50;
  if (p < 2 || (big ? powmodBig(2n, BigInt(n), BigInt(p)) !== 25n % BigInt(p) : powmod50(2, n, p) !== 25 % p)) return 'does not divide 2^n - 25';
  if (n < 54 && p === Math.pow(2, n) - 25) return 'is 2^n - 25 itself';
  if (!(big ? isPrimeBig(p) : isPrime50(p))) return 'is not prime';
  return '';
}

// Exact modular arithmetic with doubles for moduli below 2^50 (same code as assets/app.js).
const P50 = 1125899906842624;
const T26 = 67108864, I26 = 1 / 67108864, T52 = 4503599627370496, I52 = 1 / 4503599627370496, SMALL_MUL = 94906265;
/** a*b mod m for 0 <= a, b < m < 2^50, with inv = 1/m. */
function mulmodInv(a, b, m, inv) {
  if (m <= SMALL_MUL) return (a * b) % m;
  const q = Math.floor(a * b * inv); // off by at most one
  const a1 = Math.floor(a * I26), a0 = a - a1 * T26;
  const b1 = Math.floor(b * I26), b0 = b - b1 * T26;
  const q1 = Math.floor(q * I26), q0 = q - q1 * T26;
  const m1 = Math.floor(m * I26), m0 = m - m1 * T26;
  let t = a1 * b0 + a0 * b1;
  t -= Math.floor(t * I26) * T26; // middle part of a*b, modulo 2^26
  let u = q1 * m0 + q0 * m1;
  u -= Math.floor(u * I26) * T26; // middle part of q*m
  let r = a0 * b0 + t * T26 - (q0 * m0 + u * T26); // a*b - q*m modulo 2^52
  r -= Math.round(r * I52) * T52; // the true value lies in (-m, 2m), inside (-2^51, 2^51)
  if (r < 0) r += m;
  else if (r >= m) r -= m;
  return r;
}
export function mulmod50(a, b, m) {
  return mulmodInv(a, b, m, 1 / m);
}
export function powmod50(a, e, m) {
  const inv = 1 / m;
  let r = 1 % m, x = a % m;
  while (e > 0) {
    if (e % 2 === 1) r = mulmodInv(r, x, m, inv);
    e = Math.floor(e / 2);
    if (e > 0) x = mulmodInv(x, x, m, inv);
  }
  return r;
}
const MR_BASES = [2, 3, 5, 7, 11, 13, 17, 19, 23];
const MR_BOUNDS = [[2047, 1], [1373653, 2], [25326001, 3], [3215031751, 4], [2152302898747, 5], [3474749660383, 6], [341550071728321, 7]];
/** Deterministic Miller-Rabin, exact below 3.8e18 (here p < 2^50). */
export function isPrime50(p) {
  if (p < 2) return false;
  for (const q of MR_BASES) if (p % q === 0) return p === q;
  let k = 9;
  for (const [bound, kk] of MR_BOUNDS) if (p < bound) { k = kk; break; }
  let d = p - 1, s = 0;
  while (d % 2 === 0) { d /= 2; s++; }
  const inv = 1 / p;
  for (let i = 0; i < k; i++) {
    let x = powmod50(MR_BASES[i], d, p);
    if (x === 1 || x === p - 1) continue;
    let ok = false;
    for (let t = 1; t < s && !ok; t++) { x = mulmodInv(x, x, p, inv); ok = x === p - 1; }
    if (!ok) return false;
  }
  return true;
}

// From 2^50 up to 2^53 the same checks run with BigInt (about 40 microseconds per factor near 2^53).
export function powmodBig(a, e, m) {
  let r = 1n % m, x = a % m;
  while (e > 0n) {
    if (e & 1n) r = (r * x) % m;
    e >>= 1n;
    if (e > 0n) x = (x * x) % m;
  }
  return r;
}
/** Deterministic Miller-Rabin with the bases 2..23, exact below 3.8e18 (here p < 2^53). */
export function isPrimeBig(p) {
  const P = BigInt(p);
  if (P < 2n) return false;
  for (const q of MR_BASES) if (P % BigInt(q) === 0n) return P === BigInt(q);
  let d = P - 1n, s = 0;
  while ((d & 1n) === 0n) { d >>= 1n; s++; }
  for (const a of MR_BASES) {
    let x = powmodBig(BigInt(a), d, P);
    if (x === 1n || x === P - 1n) continue;
    let ok = false;
    for (let t = 1; t < s && !ok; t++) { x = (x * x) % P; ok = x === P - 1n; }
    if (!ok) return false;
  }
  return true;
}

async function tfKey(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode('tf|' + env.ADMIN_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function tfSign(env, state) {
  const payload = new TextEncoder().encode(JSON.stringify(state));
  const sig = await crypto.subtle.sign('HMAC', await tfKey(env), payload);
  return b64url(payload) + '.' + b64url(new Uint8Array(sig));
}

async function tfVerify(env, token) {
  if (typeof token !== 'string' || token.length > 16384) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  try {
    const payload = unb64url(token.slice(0, dot));
    const ok = await crypto.subtle.verify('HMAC', await tfKey(env), unb64url(token.slice(dot + 1)), payload);
    if (!ok) return null;
    const state = JSON.parse(new TextDecoder().decode(payload));
    if (!state || typeof state.exp !== 'number' || state.exp < Date.now()) return null;
    return state;
  } catch (e) {
    return null;
  }
}

/* ---------- admin endpoints for tools/pull_submissions.py ---------- */

async function admin(request, env, url, path) {
  const plain = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (!env.ADMIN_TOKEN || !env.SUBMISSIONS) {
    return new Response(JSON.stringify({ ok: false, errors: ['ADMIN_TOKEN or the KV binding is not set.'] }), { status: 503, headers: plain });
  }
  const auth = request.headers.get('Authorization') || '';
  if (!sameString(auth, 'Bearer ' + env.ADMIN_TOKEN)) {
    return new Response(JSON.stringify({ ok: false, errors: ['Unauthorized'] }), { status: 401, headers: plain });
  }
  const key = url.searchParams.get('key') || '';
  if (path === '/admin/list' && request.method === 'GET') {
    const listed = await env.SUBMISSIONS.list({
      prefix: url.searchParams.get('prefix') || 'sub/',
      cursor: url.searchParams.get('cursor') || undefined,
      limit: 1000,
    });
    return new Response(JSON.stringify({ ok: true, keys: listed.keys, cursor: listed.list_complete ? null : listed.cursor }), { headers: plain });
  }
  if (path === '/admin/get' && request.method === 'GET') {
    const value = await env.SUBMISSIONS.get(key, 'arrayBuffer');
    if (value === null) return new Response(JSON.stringify({ ok: false, errors: ['No such key'] }), { status: 404, headers: plain });
    const type = key.startsWith('proof/') ? 'application/octet-stream' : key.startsWith('tfdata/') ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8';
    return new Response(value, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
  }
  if (path === '/admin/delete' && request.method === 'POST') {
    if (!/^(sub|proof|tf|tfdata)\//.test(key)) return new Response(JSON.stringify({ ok: false, errors: ['Only sub/, proof/, tf/ and tfdata/ keys can be deleted'] }), { status: 400, headers: plain });
    await env.SUBMISSIONS.delete(key);
    return new Response(JSON.stringify({ ok: true, deleted: key }), { headers: plain });
  }
  return new Response(JSON.stringify({ ok: false, errors: ['Not found'] }), { status: 404, headers: plain });
}

/* ---------- helpers ---------- */

function reply(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...OPEN_CORS },
  });
}

async function overDailyLimit(request, env, prefix, cap) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const key = prefix + day + '/' + (await sha256hex((env.ADMIN_TOKEN || '') + '|' + ip)).slice(0, 24);
  const count = parseInt((await env.SUBMISSIONS.get(key)) || '0', 10);
  if (count >= cap) return true;
  await env.SUBMISSIONS.put(key, String(count + 1), { expirationTtl: 2 * 86400 });
  return false;
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode('proof|' + env.ADMIN_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signToken(env, claim) {
  const body = { ...claim, exp: Date.now() + LIMITS.proofTokenDays * 86400000 };
  const payload = new TextEncoder().encode(JSON.stringify(body));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), payload);
  return b64url(payload) + '.' + b64url(new Uint8Array(sig));
}

async function verifyToken(env, token) {
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  try {
    const payload = unb64url(token.slice(0, dot));
    const sig = unb64url(token.slice(dot + 1));
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), sig, payload);
    if (!ok) return null;
    const claim = JSON.parse(new TextDecoder().decode(payload));
    if (!claim || typeof claim.exp !== 'number' || claim.exp < Date.now()) return null;
    if (typeof claim.id !== 'string' || !/^[0-9TZ]+-[0-9a-f]+$/.test(claim.id) || !Number.isInteger(claim.n)) return null;
    return claim;
  } catch (e) {
    return null;
  }
}

function sameString(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
