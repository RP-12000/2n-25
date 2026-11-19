/* Join page: work cards, example work lines, the results upload form (sent in parts to the upload Worker) and about. */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc;
  var PART_LINES = 900;              // the Worker takes at most 1,000 lines per request
  var PART_CHARS = 380000;           // and at most 400,000 characters
  var PROOF_MAX = 25 * 1024 * 1024 - 65536;
  var FILE_MAX = 64 * 1024 * 1024;
  var HANDLE = /^[\p{L}\p{N} ._\-()[\]+#]+$/u;
  var HANDLE_KEY = '2n25.handle';

  var up = { endpoint: '', open: false, fileText: '', fileNames: [], parsed: null, sending: false, site: null };
  var el = function (id) { return document.getElementById(id); };

  /* ---------- example work lines ---------- */
  var TABS = {
    prp: {
      file: 'worktodo.txt for Prime95 30.19 or later',
      code: 'PRP=1,2,n,-25',               // the next n to test once the data is in (fillCards)
      hint: 'Each line tests 1 × 2<sup>n</sup> − 25. Prime95 writes one JSON line per test to <code>results.json.txt</code>; that file is what you upload.'
    },
    sieve: {
      file: 'worktodo.txt for Mass Prime Siever (prime.ini: UseGPU=1, GPU_backend=auto)',
      code: 'Factor=2,-25,1000000000000,2000000000000,3600000,5000000\nFactor=2,-25,2000000000000,3000000000000,3600000,5000000',
      hint: 'Fields: base 2, c = −25, p from P0 to P1, n from N0 to N1. Two more fields sieve one residue class only, for example <code>,2,1</code> for odd n.'
    }
  };
  function showTab(key, focus) {
    ['prp', 'sieve'].forEach(function (k) {
      var b = el('tab-' + k);
      b.setAttribute('aria-selected', String(k === key));
      b.tabIndex = k === key ? 0 : -1;
      if (k === key && focus) b.focus();
    });
    el('work-panel').setAttribute('aria-labelledby', 'tab-' + key);
    el('work-file').textContent = TABS[key].file;
    el('work-code').textContent = TABS[key].code;
    el('work-hint').innerHTML = TABS[key].hint;
  }
  ['prp', 'sieve'].forEach(function (k) {
    el('tab-' + k).addEventListener('click', function () { showTab(k); });
    el('tab-' + k).addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); showTab(k === 'prp' ? 'sieve' : 'prp', true); }
    });
  });
  showTab('prp');

  /* ---------- page text from the data ---------- */
  S.all(['site', 'ranges', 'summary']).then(function (d) {
    var site = d[0], rows = d[1].rows, sum = d[2];
    up.site = site;
    fillCards(site, rows, sum);
    fillAbout(site);
    initUpload(site);
  }).catch(function (e) {
    S.fail('up-result', e);
    el('up-status').textContent = 'unavailable';
  });

  function round100(x) { return Math.round(x / 100) * 100; }
  function fillCards(site, rows, sum) {
    var M = S.model(site), links = site.links || {};
    var act = site.active || { lo: sum.frontier, hi: 5000000 };
    var actRows = rows.filter(function (r) { return r.lo >= act.lo && r.hi <= act.hi; });
    var odd = actRows.reduce(function (s, r) { return s + r.odd; }, 0);
    var target = site.sieve_target || 1e14, startAt = site.prp_from_depth || 1e12;
    var perDay = (site.model && site.model.laptop_prp_per_day) || 230;
    if (links.siever) el('link-siever').href = links.siever;
    if (links.prime95) el('link-prime95').href = links.prime95;
    if (links.issues) { el('link-issue').href = links.issues; el('link-issue-2').href = links.issues; }
    if (links.repo) el('link-repo').href = links.repo;
    // example work: the smallest n with no known factor and no PRP test yet
    var next = sum.next_open && sum.next_open.length ? sum.next_open : (sum.frontier < sum.n_max ? [sum.frontier] : []);
    if (next.length) {
      TABS.prp.code = next.map(function (n) { return 'PRP=1,2,' + n + ',-25'; }).join('\n');
      if (el('tab-prp').getAttribute('aria-selected') === 'true') el('work-code').textContent = TABS.prp.code;
    }

    if (odd) {
      // laptop-days: each test costs (n / n0)^e times a test at n0, and the laptop does perDay tests a day at n0
      var e = (site.model && site.model.prp_cost_exponent) || 2.1, n0 = 3600000;
      var a = act.lo / n0, b = act.hi / n0;
      var avg = (Math.pow(b, e + 1) - Math.pow(a, e + 1)) / ((e + 1) * (b - a));
      var months = Math.round(M.survivors(odd, target) * avg / perDay / 30.44);
      el('join-lede').innerHTML = 'Today the search runs on one laptop and free Kaggle GPU sessions. PRP-testing every candidate in ' + S.rangeLabel(act.lo, act.hi) +
        ' would keep that laptop busy for about ' + months + ' months on its own, so every extra machine shortens the wait for the next prime.';
    }
    var planned = (site.sieve_plan || []).filter(function (s) { return /^planned$/i.test(s.status || ''); });
    if (planned.length) {
      el('way-sieve').firstElementChild.lastElementChild.textContent = 'p ' + S.depth(planned[0].p_from) + ' – ' + S.depth(planned[0].p_to) +
        (planned.length > 1 ? ', then to ' + S.depth(planned[planned.length - 1].p_to) : '');
    }
    var prpRows = el('way-prp');
    prpRows.innerHTML = '<div><span>One test</span><span>' + S.cost(M.prpMinutes(act.lo)) + ' at n = ' + S.M(act.lo) + '</span></div>' +
      '<div><span>Laptop</span><span>8 workers · ≈ ' + fmt(perDay) + ' tests a day</span></div>' +
      (odd ? '<div><span>Queue</span><span>≈ ' + fmt(round100(M.survivors(odd, startAt))) + ' n after ' + S.depth(startAt) + ', smallest first</span></div>' : '');
    var started = actRows.some(function (r) { return r.prp && r.prp.tests > 0; });
    var pill = el('prp-pill');
    if (started) { pill.className = 'pill accent'; pill.innerHTML = '<span class="dot"></span>Running'; }
    else pill.innerHTML = 'After the ' + S.depth(startAt) + ' sieve';
  }

  function fillAbout(site) {
    var goal = site.goal;
    el('about-text').innerHTML = 'The search is run by ' + esc(site.credit || 'RP-12000') + '. It looks for n where 2<sup>n</sup> − 25 is prime, sequence <a href="' +
      esc(site.links && site.links.oeis || 'https://oeis.org/A379020') + '">' + esc(site.oeis || 'A379020') + '</a> in the OEIS' +
      (goal ? ', and aims for a prime of about ' + (goal.digits >= 1e6 ? (goal.digits / 1e6) + ' million' : fmt(goal.digits)) + ' digits (n ≈ ' + (goal.from_n / 1e6).toFixed(2) + 'M)' : '') + '.';
  }

  /* ---------- upload: setup ---------- */
  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage blocked */ } }
  function recall(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }

  function initUpload(site) {
    up.endpoint = String(site.upload_endpoint || '').trim().replace(/\/+$/, '');
    var status = el('up-status');
    if (!up.endpoint) {
      status.textContent = 'not open yet';
      el('up-result').innerHTML = '<div class="msg info">The upload server is not connected yet. Until it is, attach <code>results.json.txt</code> to a <a href="' +
        esc(site.links && site.links.issues || '#') + '">GitHub issue</a>.</div>';
      refresh();
      return;
    }
    fetch(up.endpoint + '/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      up.open = Boolean(j && j.ok && j.accepting);
      status.textContent = up.open ? 'open · up to 1,000 lines per part' : 'not accepting uploads right now';
      refresh();
    }).catch(function () {
      up.open = false;
      status.textContent = 'upload server not reachable';
      el('up-result').innerHTML = '<div class="msg err">The upload server did not answer. Try again later, or attach <code>results.json.txt</code> to a <a href="' +
        esc(site.links && site.links.issues || '#') + '">GitHub issue</a>.</div>';
      refresh();
    });
  }

  var handleInput = el('up-handle'), noteInput = el('up-note'), fileInput = el('up-file'), paste = el('up-paste'), drop = el('up-drop');
  handleInput.value = recall(HANDLE_KEY);
  handleInput.addEventListener('change', function () { store(HANDLE_KEY, handleInput.value.trim()); });
  fileInput.addEventListener('change', function () { readFiles(fileInput.files); });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) readFiles(e.dataTransfer.files); });
  var pasteTimer = null;
  paste.addEventListener('input', function () { clearTimeout(pasteTimer); pasteTimer = setTimeout(reparse, 250); });
  el('up-clear').addEventListener('click', function () {
    up.fileText = ''; up.fileNames = []; fileInput.value = ''; paste.value = '';
    el('up-result').innerHTML = ''; el('up-progress').textContent = '';
    reparse();
  });
  el('up-form').addEventListener('submit', function (e) { e.preventDefault(); send(); });

  function readFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    var big = files.filter(function (f) { return f.size > FILE_MAX; });
    if (big.length) {
      el('up-preview').innerHTML = '<div class="msg err">' + esc(big[0].name) + ' is larger than 64 MB. Split it and upload the parts one at a time.</div>';
      return;
    }
    Promise.all(files.map(function (f) { return f.text(); })).then(function (texts) {
      up.fileText = texts.join('\n');
      up.fileNames = files.map(function (f) { return f.name; });
      reparse();
    }).catch(function (err) {
      el('up-preview').innerHTML = '<div class="msg err">Could not read the file: ' + esc(err && err.message ? err.message : err) + '</div>';
    });
  }

  /* ---------- upload: the same checks the server makes ---------- */
  var HEX8 = /^[0-9A-Fa-f]{8}$/, HEX16 = /^[0-9A-Fa-f]{16}$/, STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  function lineError(j) {
    var n = j.n;
    if (!Number.isInteger(n) || n < 5 || n >= 1e7) return 'n must be a whole number from 5 to 9,999,999';
    if (n % 2 === 0) return 'even n never gives a prime';
    var prog = j.program;
    if (!prog || typeof prog !== 'object' || typeof prog.name !== 'string' || typeof prog.version !== 'string') return 'no program name and version';
    if (typeof j.timestamp !== 'string' || !STAMP.test(j.timestamp)) return 'no timestamp';
    if (typeof j['security-code'] !== 'string' || !HEX8.test(j['security-code'])) return 'no security-code';
    if (j['error-code'] !== undefined && (typeof j['error-code'] !== 'string' || !HEX8.test(j['error-code']))) return 'malformed error-code';
    if (/^PRP(-\d+)?$/.test(j.worktype)) {
      if (j.status === 'C') { if (typeof j.res64 !== 'string' || !HEX16.test(j.res64)) return 'composite result without a 64-bit residue'; }
      else if (j.status !== 'P') return 'PRP status must be C or P';
      if (!Number.isInteger(j['fft-length']) || j['fft-length'] <= 0) return 'no fft-length';
      if (j.status === 'P') {
        var sp = S.smallestFactor(n, 100000);
        if (sp) return 'reports a probable prime, but ' + fmt(sp) + ' divides 2^' + n + ' − 25';
      }
      return '';
    }
    if (j.worktype === 'P-1') {
      if (j.status !== 'NF' && j.status !== 'F') return 'P-1 status must be NF or F';
      if (!Number.isInteger(j.b1) || j.b1 <= 0) return 'no B1';
      if (j.b2 !== undefined && (!Number.isInteger(j.b2) || j.b2 < j.b1)) return 'malformed B2';
      if (j.status === 'F') {
        if (!Array.isArray(j.factors) || !j.factors.length) return 'factor result without factors';
        for (var i = 0; i < j.factors.length; i++) {
          var f = j.factors[i];
          if (typeof f !== 'string' || !/^[1-9]\d{1,199}$/.test(f)) return 'malformed factor';
          if (!S.dividesBig(f, n)) return f + ' does not divide 2^' + n + ' − 25';
        }
      }
      return '';
    }
    return null; // another work type: ignored, not an error
  }
  function check(text) {
    var o = { lines: [], rejected: [], other: 0, nonJson: 0, broken: 0, dup: 0, prpC: 0, prpP: 0, pm1: 0, factors: 0, primes: [], nMin: Infinity, nMax: 0, suspect: 0 };
    var seen = new Set();
    String(text || '').split(/\r?\n/).forEach(function (raw, i) {
      var line = raw.trim();
      if (!line) return;
      if (line[0] !== '{') { o.nonJson++; return; }
      var j;
      try { j = JSON.parse(line); } catch (e) { o.broken++; o.rejected.push({ line: i + 1, reason: 'broken JSON' }); return; }
      if (!j || typeof j !== 'object' || Array.isArray(j) || j.k !== 1 || j.b !== 2 || j.c !== -25) { o.other++; return; }
      var err = lineError(j);
      if (err === null) { o.other++; return; }
      if (err) { o.rejected.push({ line: i + 1, n: j.n, reason: err }); return; }
      if (seen.has(line)) { o.dup++; return; }
      seen.add(line);
      o.lines.push(line);
      o.nMin = Math.min(o.nMin, j.n); o.nMax = Math.max(o.nMax, j.n);
      if (j['error-code'] && j['error-code'] !== '00000000') o.suspect++;
      if (j.worktype === 'P-1') { o.pm1++; if (j.status === 'F') o.factors += j.factors.length; }
      else if (j.status === 'P') { o.prpP++; o.primes.push(j.n); }
      else o.prpC++;
    });
    return o;
  }
  function parts(lines) {
    var out = [], cur = [], size = 0;
    lines.forEach(function (l) {
      if (cur.length && (cur.length >= PART_LINES || size + l.length + 1 > PART_CHARS)) { out.push(cur); cur = []; size = 0; }
      cur.push(l); size += l.length + 1;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function reparse() {
    var text = [up.fileText, paste.value].filter(Boolean).join('\n');
    if (/^\s*\[/.test(text) && /"factored"/.test(text.slice(0, 1 << 20))) {
      up.parsed = null;
      el('up-preview').innerHTML = '<div class="msg err">This is Mass Prime Siever output. Send it with the sieve form below.</div>';
      refresh();
      return;
    }
    up.parsed = text.trim() ? check(text) : null;
    var p = up.parsed, h = [];
    if (p) {
      if (p.lines.length) {
        var bits = [];
        if (p.prpC) bits.push(fmt(p.prpC) + ' PRP composite');
        if (p.prpP) bits.push(fmt(p.prpP) + ' probable prime');
        if (p.pm1) bits.push(fmt(p.pm1) + ' P-1' + (p.factors ? ' (' + fmt(p.factors) + ' factor' + (p.factors === 1 ? '' : 's') + ', checked)' : ''));
        var k = parts(p.lines).length;
        h.push('<div class="msg info"><b>' + fmt(p.lines.length) + ' result line' + (p.lines.length === 1 ? '' : 's') + ' for 2<sup>n</sup> − 25</b>: ' + bits.join(', ') +
          '. n from ' + fmt(p.nMin) + ' to ' + fmt(p.nMax) + '.' + (k > 1 ? ' It will be sent in ' + k + ' parts.' : '') +
          (p.dup ? ' ' + fmt(p.dup) + ' repeated line' + (p.dup === 1 ? '' : 's') + ' left out.' : '') + '</div>');
      }
      if (p.primes.length) {
        h.push('<div class="msg prime"><b>This reports a probable prime: n = ' + p.primes.map(fmt).join(', ') + '.</b> After the upload you can send the proof file for it.</div>');
      }
      if (p.suspect) h.push('<div class="msg">' + fmt(p.suspect) + ' line' + (p.suspect === 1 ? ' has' : 's have') + ' a non-zero error-code; they are kept but marked for a double check.</div>');
      var ignored = [];
      if (p.other) ignored.push(fmt(p.other) + ' for other numbers or work types');
      if (p.nonJson) ignored.push(fmt(p.nonJson) + ' plain-text line' + (p.nonJson === 1 ? '' : 's'));
      if (ignored.length) h.push('<div class="msg">Ignored: ' + ignored.join(', ') + '.' +
        (!p.lines.length && p.nonJson && !p.other ? ' This looks like <code>results.txt</code>; upload <code>results.json.txt</code> instead.' : '') + '</div>');
      if (p.rejected.length) {
        h.push('<div class="msg err"><b>' + fmt(p.rejected.length) + ' line' + (p.rejected.length === 1 ? '' : 's') + ' cannot be used:</b><ul>' +
          p.rejected.slice(0, 8).map(function (r) { return '<li>line ' + r.line + (r.n ? ' (n = ' + fmt(r.n) + ')' : '') + ': ' + esc(r.reason) + '</li>'; }).join('') +
          (p.rejected.length > 8 ? '<li>and ' + fmt(p.rejected.length - 8) + ' more</li>' : '') + '</ul></div>');
      }
      if (!p.lines.length && !p.rejected.length && !p.other && !p.nonJson) h.push('<div class="msg">Nothing to upload.</div>');
    }
    el('up-preview').innerHTML = h.join('');
    refresh();
  }
  function refresh() {
    el('up-send').disabled = !(up.open && up.parsed && up.parsed.lines.length && !up.sending);
  }

  /* ---------- upload: sending ---------- */
  function postPart(lines, handle, note) {
    var fd = new FormData();
    fd.append('results', new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }), 'results.json.txt');
    fd.append('handle', handle);
    fd.append('note', note);
    return fetch(up.endpoint + '/submit', { method: 'POST', body: fd }).then(function (r) {
      return r.json().catch(function () { return { ok: false, errors: ['The server answered HTTP ' + r.status + '.'] }; })
        .then(function (j) { j.httpStatus = r.status; return j; });
    }, function () { return { ok: false, httpStatus: 0, errors: ['The upload server could not be reached.'] }; });
  }

  function send() {
    var p = up.parsed;
    if (!p || !p.lines.length || up.sending || !up.open) return;
    var handle = handleInput.value.replace(/\s+/g, ' ').trim();
    if (handle && (handle.length > 40 || !HANDLE.test(handle))) {
      el('up-result').innerHTML = '<div class="msg err">The name for credit may use letters, digits, spaces and . _ - ( ) [ ] + # (at most 40 characters).</div>';
      handleInput.focus();
      return;
    }
    store(HANDLE_KEY, handle);
    var note = noteInput.value.trim().slice(0, 500);
    var list = parts(p.lines);
    var total = { accepted: 0, ids: [], primes: [], factors: 0, rejected: [], errors: [], sent: 0 };
    up.sending = true; refresh();
    el('up-result').innerHTML = '';
    var i = 0;
    (function next() {
      if (i >= list.length) return finish();
      el('up-progress').textContent = list.length > 1 ? 'Sending part ' + (i + 1) + ' of ' + list.length + '…' : 'Sending…';
      postPart(list[i], handle, note).then(function (j) {
        if (j.ok) {
          total.sent++;
          total.accepted += j.accepted || 0;
          total.ids.push(j.id);
          total.factors += (j.factors || []).length;
          (j.primes || []).forEach(function (x) { total.primes.push(x); });
          (j.rejected || []).forEach(function (x) { total.rejected.push(x); });
          i++;
          next();
        } else if (j.httpStatus === 422) {
          (j.rejected || []).forEach(function (x) { total.rejected.push(x); });
          i++;
          next();
        } else {
          total.errors = j.errors || ['Upload failed.'];
          finish(true);
        }
      });
    })();

    function finish(stopped) {
      up.sending = false; refresh();
      el('up-progress').textContent = '';
      var h = [];
      if (total.accepted) {
        h.push('<div class="msg ok"><b>Uploaded ' + fmt(total.accepted) + ' result line' + (total.accepted === 1 ? '' : 's') + (list.length > 1 ? ' in ' + total.sent + ' part' + (total.sent === 1 ? '' : 's') : '') +
          '.</b> Thank you' + (handle ? ', ' + esc(handle) : '') + '! They appear on the site after the next update.' +
          (total.factors ? ' ' + fmt(total.factors) + ' P-1 factor' + (total.factors === 1 ? ' was' : 's were') + ' verified on arrival.' : '') +
          '<br><span class="small mono">' + total.ids.map(esc).join(' · ') + '</span></div>');
      }
      if (stopped) {
        h.push('<div class="msg err"><b>' + (total.sent ? 'Stopped after ' + total.sent + ' of ' + list.length + ' parts.' : 'Nothing was uploaded.') + '</b> ' +
          total.errors.map(esc).join(' ') + (total.sent ? ' Uploading the whole file again later is fine: repeated lines are ignored.' : '') + '</div>');
      }
      if (total.rejected.length) {
        h.push('<div class="msg err"><b>The server refused ' + fmt(total.rejected.length) + ' line' + (total.rejected.length === 1 ? '' : 's') + ':</b><ul>' +
          total.rejected.slice(0, 8).map(function (r) { return '<li>' + (r.n ? 'n = ' + fmt(r.n) + ': ' : '') + esc(r.reason) + '</li>'; }).join('') + '</ul></div>');
      }
      total.primes.forEach(function (x) { h.push(proofBox(x)); });
      el('up-result').innerHTML = h.join('');
      Array.prototype.forEach.call(el('up-result').querySelectorAll('input[data-token]'), function (inp) {
        inp.addEventListener('change', function () { sendProof(inp); });
      });
      if (total.accepted && !stopped) {
        up.fileText = ''; up.fileNames = []; fileInput.value = ''; paste.value = '';
        up.parsed = null; el('up-preview').innerHTML = ''; refresh();
      }
    }
  }

  /* ---------- proof files, only for a reported probable prime ---------- */
  function proofBox(x) {
    var id = 'proof-' + x.n;
    if (!x.token) {
      return '<div class="msg prime"><b>n = ' + fmt(x.n) + ' reported a probable prime.</b> The server cannot take proof files yet; please attach the proof file to a <a href="' +
        esc(up.site && up.site.links && up.site.links.issues || '#') + '">GitHub issue</a>.</div>';
    }
    return '<div class="msg prime"><b>n = ' + fmt(x.n) + ' reported a probable prime.</b> Please send the proof file Prime95 wrote for this test, so anyone can check the result without running it again. ' +
      'The link is valid for 7 days.<div class="actions mt12"><label class="sr-only" for="' + id + '">Proof file for n = ' + fmt(x.n) + '</label>' +
      '<input type="file" id="' + id + '" data-token="' + esc(x.token) + '" data-n="' + x.n + '"><span class="small" id="' + id + '-msg" aria-live="polite"></span></div></div>';
  }
  function sendProof(inp) {
    var file = inp.files && inp.files[0], n = inp.getAttribute('data-n'), out = el('proof-' + n + '-msg');
    if (!file) return;
    if (file.size > PROOF_MAX) { out.textContent = 'This file is larger than 25 MB, too large for a proof file.'; return; }
    file.slice(0, 512).arrayBuffer().then(function (buf) {
      var head = '';
      new Uint8Array(buf).forEach(function (b) { head += String.fromCharCode(b); });
      if (head.indexOf('PRP PROOF') !== 0 || head.indexOf(n) < 0) {
        out.textContent = 'This is not a Prime95 proof file for n = ' + fmt(Number(n)) + '.';
        return null;
      }
      out.textContent = 'Sending ' + (file.size / 1048576).toFixed(1) + ' MB…';
      inp.disabled = true;
      return fetch(up.endpoint + '/proof?token=' + encodeURIComponent(inp.getAttribute('data-token')), {
        method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' }
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) out.textContent = 'Proof received (' + (j.bytes < 1048576 ? Math.max(1, Math.round(j.bytes / 1024)) + ' kB' : (j.bytes / 1048576).toFixed(1) + ' MB') + '). Thank you!';
        else { out.textContent = (j.errors || ['Upload failed.']).join(' '); inp.disabled = false; }
      });
    }).catch(function () { out.textContent = 'The upload server could not be reached. Try again.'; inp.disabled = false; });
  }
})();

/* Join page, sieve output: reads Mass Prime Siever results.json (and siever.log), checks every factor in the
   browser, then sends the odd n that have a factor to the upload Worker, which checks every factor again in
   small slices (POST /tf/begin, then /tf/check for each slice, then /tf/finish). */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc;
  var el = function (id) { return document.getElementById(id); };
  var HANDLE = /^[\p{L}\p{N} ._\-()[\]+#]+$/u, HANDLE_KEY = '2n25.handle', COMPUTER_KEY = '2n25.computer';
  var MAX_N = 1e7, SHOW = 8, STEP = 5000;
  var L = { textBytes: 3 * 1024 * 1024, factorsPerCheck: 150, maxP: 1125899906842624, uploadsPerDay: 20 };
  var tf = { endpoint: '', open: false, issues: '#', files: {}, plan: null, busy: false, run: 0, sent: {} };

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  function recall(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function plural(k, word, many) { return fmt(k) + ' ' + (k === 1 ? word : (many || word + 's')); }
  function later(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
  function msg(kind, html) { return '<div class="msg' + (kind ? ' ' + kind : '') + '">' + html + '</div>'; }
  function list(items, more) {
    return '<ul>' + items.slice(0, SHOW).map(function (x) { return '<li>' + x + '</li>'; }).join('') +
      (more > SHOW ? '<li>and ' + fmt(more - SHOW) + ' more</li>' : '') + '</ul>';
  }
  function issueLink(text) { return '<a href="' + esc(tf.issues) + '">' + (text || 'GitHub issue') + '</a>'; }

  var handleInput = el('tf-handle'), computerInput = el('tf-computer'), noteInput = el('tf-note'), fileInput = el('tf-file'), drop = el('tf-drop');
  (function () {
    // a name saved as "Kelvinizer - w1g0" before the Computer field existed fills both fields
    var h = recall(HANDLE_KEY), c = recall(COMPUTER_KEY), m = /^(.*?\S)(?:\s+-\s*|\s*-\s+)(\S.*)$/.exec(h);
    if (m) { h = m[1]; c = c || m[2]; }
    handleInput.value = h;
    computerInput.value = c;
  })();
  handleInput.addEventListener('change', function () { store(HANDLE_KEY, handleInput.value.trim()); });
  computerInput.addEventListener('change', function () { store(COMPUTER_KEY, computerInput.value.trim()); });
  fileInput.addEventListener('change', function () { readFiles(fileInput.files); });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) readFiles(e.dataTransfer.files); });
  el('tf-clear').addEventListener('click', function () {
    if (tf.busy) return;
    tf.files = {}; tf.plan = null; tf.sent = {}; tf.run++; fileInput.value = '';
    el('tf-preview').innerHTML = ''; el('tf-result').innerHTML = ''; setProgress('', null);
    refresh();
  });
  el('tf-form').addEventListener('submit', function (e) { e.preventDefault(); send(); });

  S.load('site').then(function (site) {
    tf.issues = site.links && site.links.issues || '#';
    tf.endpoint = String(site.upload_endpoint || '').trim().replace(/\/+$/, '');
    if (!tf.endpoint) { el('tf-status').textContent = 'not open yet'; return; }
    return fetch(tf.endpoint + '/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var t = j && j.limits && j.limits.tf;
      tf.open = Boolean(j && j.ok && j.accepting && t && j.sieve !== false);
      if (t) ['textBytes', 'factorsPerCheck', 'maxP', 'uploadsPerDay'].forEach(function (k) { if (t[k] > 0) L[k] = t[k]; });
      el('tf-status').textContent = tf.open ? 'open · p below 2' + S.sup(50) : t ? 'not accepting uploads right now' : 'not open yet';
      if (!tf.open) el('tf-result').innerHTML = msg('info', 'The upload server does not take sieve output yet. Until it does, attach <code>results.json</code> and <code>siever.log</code> to a ' + issueLink() + '.');
      refresh();
    });
  }).catch(function () {
    el('tf-status').textContent = 'upload server not reachable';
    refresh();
  });

  function refresh() {
    el('tf-send').disabled = !(tf.open && tf.plan && tf.plan.ok && !tf.busy && tf.plan.parts.some(function (p, i) { return !tf.sent[i]; }));
    el('tf-clear').disabled = tf.busy;
  }
  function setProgress(text, frac) {
    el('tf-progress').textContent = text;
    var m = el('tf-meter');
    m.hidden = frac === null;
    if (frac !== null) {
      var pct = Math.max(0, Math.min(100, frac * 100));
      m.firstElementChild.style.width = pct.toFixed(1) + '%';
      m.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
  }

  /* ---------- reading ---------- */
  function readFiles(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length || tf.busy) return;
    Promise.all(files.map(function (f) { return f.text().then(function (t) { return { name: f.name, text: t }; }); })).then(function (got) {
      got.forEach(function (f) {
        var start = f.text.slice(0, 4096).replace(/^﻿/, '').trim();
        if (start[0] === '[') tf.files.results = f;
        else if (start[0] === '{') tf.files.prime95 = f;
        else if (/Mass Prime Siever|Total elapsed time/.test(f.text.slice(0, 1 << 20)) || /\.log$/i.test(f.name)) tf.files.log = f;
        else tf.files.other = f;
      });
      tf.sent = {};
      analyse();
    }).catch(function (err) {
      el('tf-preview').innerHTML = msg('err', 'Could not read the file: ' + esc(err && err.message ? err.message : err));
    });
  }

  /* Start, end, wall-clock seconds and program from siever.log (as tools/build.py reads it). */
  function parseLog(text) {
    var stamps = text.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/gm) || [];
    var totals = [], m, re = /Total elapsed time:\s+([\d.]+)/g;
    while ((m = re.exec(text))) totals.push(Number(m[1]));
    var v = /Mass Prime Siever ([\d.]{1,12}) starting/.exec(text);
    return { program: v ? 'Mass Prime Siever ' + v[1] : '', start: stamps[0] || '', end: stamps[stamps.length - 1] || '',
      wall_s: totals.length ? Math.round(totals[totals.length - 1]) : 0 };
  }

  function duration(sec) {
    if (sec < 90) return Math.round(sec) + ' s';
    if (sec < 5400) return Math.round(sec / 60) + ' min';
    return fmt(sec / 3600, sec < 36000 ? 1 : 0) + ' h';
  }
  function num(x) {
    if (typeof x === 'number') return x;
    if (typeof x === 'string' && /^\d{1,25}$/.test(x)) return Number(x);
    return NaN;
  }

  /* ---------- checking, in steps so the page stays responsive ---------- */
  function analyse() {
    var run = ++tf.run, out = el('tf-preview');
    tf.plan = null; el('tf-result').innerHTML = ''; refresh();
    var f = tf.files;
    if (!f.results) {
      out.innerHTML = f.prime95 ? msg('err', '<b>' + esc(f.prime95.name) + '</b> looks like Prime95 output; send it with the Prime95 form above.')
        : f.log || f.other ? msg('info', 'Now add <code>results.json</code> from the same folder.') : '';
      return;
    }
    var data;
    try { data = JSON.parse(f.results.text.replace(/^﻿/, '')); } catch (e) {
      out.innerHTML = msg('err', '<b>' + esc(f.results.name) + '</b> is not valid JSON. Was the run finished? Mass Prime Siever writes <code>results.json</code> at the end.');
      return;
    }
    if (!Array.isArray(data)) { out.innerHTML = msg('err', 'results.json should be a list of runs.'); return; }
    var entries = [], other = 0, beyond = 0, head = [];
    data.forEach(function (e, i) {
      if (!e || typeof e !== 'object' || num(e.b) !== 2 || num(e.c) !== -25) { other++; return; }
      var P0 = num(e.P0), P1 = num(e.P1), N0 = num(e.N0), N1 = num(e.N1), where = 'Run ' + (i + 1);
      if (![P0, P1, N0, N1].every(Number.isSafeInteger)) { head.push(where + ': P0, P1, N0 and N1 must be whole numbers'); return; }
      if (P0 < 0 || P0 >= P1 || N0 < 0 || N0 >= N1) { head.push(where + ': needs P0 < P1 and N0 < N1'); return; }
      if (N0 >= MAX_N) { beyond++; return; }
      if (P1 > L.maxP) { head.push(where + ' sieves p up to ' + S.depth(P1) + ', above 2<sup>50</sup>, which the upload server cannot check. Attach this file to a ' + issueLink() + ' instead.'); return; }
      entries.push({ i: i, e: e, P0: P0, P1: P1, N0: N0, N1: Math.min(N1, MAX_N), end: N1, cut: N1 > MAX_N });
    });
    if (head.length) { out.innerHTML = msg('err', '<b>This file cannot be uploaded:</b>' + list(head, head.length)); return; }
    if (!entries.length) {
      out.innerHTML = msg('err', other ? 'This file has no runs for 2<sup>n</sup> − 25.' : beyond ? 'Every run in this file is for n above 10<sup>7</sup>, outside this project’s range.' : 'This file has no runs.');
      return;
    }
    var total = 0;
    entries.forEach(function (x) { (x.e.factored || []).forEach(function (it) { total += it && Array.isArray(it.factors) ? it.factors.length : 1; }); });
    var done = 0, results = [], k = 0;
    setProgress('Checking factors…', 0);
    (function nextEntry() {
      if (run !== tf.run) return;
      if (k >= entries.length) { setProgress('', null); return finish(results, other, beyond); }
      checkEntry(entries[k], run, function (step) {
        done += step;
        setProgress('Checking ' + fmt(done) + ' of ' + plural(total, 'factor') + '…', total ? done / total : 1);
      }).then(function (r) { if (r) { results.push(r); k++; nextEntry(); } });
    })();
  }

  function checkEntry(x, run, progress) {
    var e = x.e, P0 = x.P0, P1 = x.P1, lo = Math.max(x.N0, 5), hi = x.N1;
    var first = lo % 2 ? lo : lo + 1, odd = hi > first ? Math.floor((hi - first + 1) / 2) : 0;
    var seen = new Uint8Array(Math.max(0, hi - lo));
    var r = { x: x, odd: odd, prp: 0, rows: [], factors: 0, problems: [], bad: 0 };
    function problem(t) { r.bad++; if (r.problems.length < SHOW) r.problems.push(t); }
    // n is usable: odd, at least 5, inside [N0, N1) and below 10^7
    function use(n, where) {
      if (!Number.isSafeInteger(n)) { problem('unreadable n in ' + where); return false; }
      if (n < x.N0 || n >= x.end) { problem('n = ' + fmt(n) + ' in ' + where + ' lies outside [N0, N1)'); return false; }
      if (n % 2 === 0 || n < 5 || n >= hi) return false;
      if (seen[n - lo]++) { problem('n = ' + fmt(n) + ' is listed twice'); return false; }
      return true;
    }
    (Array.isArray(e.prp) ? e.prp : []).forEach(function (v) { if (use(num(v), 'prp')) r.prp++; });
    var items = Array.isArray(e.factored) ? e.factored : [], i = 0;
    function step() {
      if (run !== tf.run) return null;
      var count = 0;
      while (i < items.length && count < STEP) {
        var it = items[i++], fs = it && Array.isArray(it.factors) ? it.factors : [];
        count += fs.length || 1;
        var n = num(it && it.n);
        if (!use(n, 'factored')) continue;
        if (!fs.length) { problem('n = ' + fmt(n) + ' is listed as factored without a factor'); continue; }
        var ps = [], ok = true, dup = new Set();
        for (var j = 0; j < fs.length; j++) {
          var p = num(fs[j]), why = !Number.isSafeInteger(p) ? 'factor ' + esc(String(fs[j]).slice(0, 30)) + ' is not a whole number below 2^53'
            : dup.has(p) ? 'p = ' + fmt(p) + ' is listed twice' : S.factorProblem(n, p, P0, P1);
          if (why) { ok = false; problem('n = ' + fmt(n) + (Number.isSafeInteger(p) ? ', p = ' + fmt(p) : '') + ': ' + why.replace('2^n - 25', '2ⁿ − 25').replace('2^53', '2⁵³')); }
          dup.add(p);
          ps.push(p);
        }
        if (ok) { r.rows.push([n, ps]); r.factors += ps.length; }
      }
      progress(count);
      if (i < items.length) return later().then(step);
      var missing = 0, firstMissing = 0;
      for (var m = first; m < hi; m += 2) if (!seen[m - lo]) { if (!missing) firstMissing = m; missing++; }
      if (missing) problem(plural(missing, 'odd n') + ' in [N0, N1) appear in neither prp nor factored (the first is ' + fmt(firstMissing) + ')');
      r.rows.sort(function (a, b) { return a[0] - b[0]; });
      return r;
    }
    return later().then(step);
  }

  /* Factors expected in [P0, P1) over `odd` odd n: about odd × ln(ln P1 / ln P0); matches real runs within a few percent. */
  function expected(odd, P0, P1) { return P0 >= 1000 ? odd * Math.log(Math.log(P1) / Math.log(P0)) : null; }

  function finish(results, other, beyond) {
    var out = el('tf-preview'), h = [], bad = results.filter(function (r) { return r.bad; });
    var log = tf.files.log ? parseLog(tf.files.log.text) : null;
    var parts = [], perPart = L.textBytes - 4096;
    results.forEach(function (r) {
      var x = r.x, cur = [], size = 0, start = x.N0, factors = 0;
      function close(end) {
        var a = Math.max(start, 5), oddPart = end > a ? Math.floor((end - (a % 2 ? a : a + 1) + 1) / 2) : 0;
        parts.push({ head: { P0: x.P0, P1: x.P1, N0: start, N1: end }, text: cur.join(''), entries: cur.length, factors: factors,
          odd: Math.max(0, oddPart), timestamp: String(x.e.Timestamp || '').slice(0, 40) });
      }
      r.rows.forEach(function (row) {
        var line = row[0] + ' ' + row[1].join(' ') + '\n';
        if (cur.length && size + line.length > perPart) { close(row[0]); start = row[0]; cur = []; size = 0; factors = 0; }
        cur.push(line); size += line.length; factors += row[1].length;
      });
      close(x.N1);
    });
    var checks = parts.reduce(function (s, p) { return s + slices(p.text, L.factorsPerCheck).length; }, 0);
    tf.plan = { ok: !bad.length, parts: parts, log: log, checks: checks };

    var rows = results.map(function (r) {
      var x = r.x, want = expected(r.odd, Math.max(x.P0, 2), x.P1), low = want !== null && want >= 100 && r.factors < 0.8 * want;
      return '<tr><td class="text">' + (x.i + 1) + '</td><td>' + S.depth(x.P0) + ' – ' + S.depth(x.P1) + '</td><td>' + S.rangeLabel(x.N0, x.N1) +
        (x.cut ? '*' : '') + '</td><td class="r">' + fmt(r.odd) + '</td><td class="r">' + fmt(r.rows.length) + '</td><td class="r">' + fmt(r.factors) +
        '</td><td class="r' + (low ? ' warn' : '') + '">' + (want === null ? '—' : '≈ ' + fmt(Math.round(want))) + '</td></tr>';
    }).join('');
    h.push('<div class="scroll-x"><table class="data"><thead><tr><th class="text">Run</th><th>p</th><th>n</th><th class="r">Odd n</th><th class="r">With a factor</th>' +
      '<th class="r">Factors</th><th class="r">Expected</th></tr></thead><tbody>' + rows + '</tbody></table></div>');
    var notes = [];
    if (log) notes.push('siever.log: ' + esc(log.program || 'program not named') + (log.wall_s ? ', run time ' + duration(log.wall_s) : '') + '.');
    else notes.push('No siever.log; add it to record the run time.');
    if (results.some(function (r) { return r.x.cut; })) notes.push('* n from 10<sup>7</sup> up is outside this project and is left out.');
    if (other) notes.push(plural(other, 'run') + ' for other numbers left out.');
    if (beyond) notes.push(plural(beyond, 'run') + ' above n = 10<sup>7</sup> left out.');
    h.push('<p class="small">' + notes.join(' ') + '</p>');

    if (bad.length) {
      var all = [], count = 0;
      bad.forEach(function (r) { count += r.bad; r.problems.forEach(function (t) { all.push((results.length > 1 ? 'Run ' + (r.x.i + 1) + ': ' : '') + t); }); });
      h.push(msg('err', '<b>' + plural(count, 'problem') + ' found, so nothing can be uploaded.</b> An n is only struck out when its factors check out.' + list(all, count) +
        'If the file is right and this check is wrong, attach it to a ' + issueLink() + '.'));
    } else {
      var lowRuns = results.filter(function (r) { var w = expected(r.odd, Math.max(r.x.P0, 2), r.x.P1); return w !== null && w >= 100 && r.factors < 0.8 * w; });
      if (lowRuns.length) {
        h.push(msg('', 'Fewer factors than expected for this p range. If the run stopped early, upload the finished file: an incomplete run still strikes out the n it found factors for, but does not count toward the sieve depth.'));
      }
      var factors = parts.reduce(function (s, p) { return s + p.factors; }, 0), withF = parts.reduce(function (s, p) { return s + p.entries; }, 0);
      h.push(msg('info', '<b>Every factor checks out: ' + plural(factors, 'factor') + ' for ' + plural(withF, 'n', 'n') + '.</b> ' +
        (parts.length > 1 ? 'They go up as ' + parts.length + ' uploads of at most ' + Math.round(L.textBytes / 1048576) + ' MB, and the server' : 'The server') +
        ' checks every factor again in ' + plural(checks, 'step') + '.' +
        (parts.length > L.uploadsPerDay ? ' The server takes ' + L.uploadsPerDay + ' sieve uploads a day from one address, so the rest can be sent the next day.' : '')));
    }
    out.innerHTML = h.join('');
    refresh();
  }

  /* Line-aligned slice ends with at most `per` factors each. */
  function slices(text, per) {
    var ends = [], off = 0, count = 0, lines = text.split('\n');
    lines.pop();
    lines.forEach(function (line) {
      var k = line.split(' ').length - 1;
      if (count && count + k > per) { ends.push(off); count = 0; }
      off += line.length + 1;
      count += k;
    });
    if (off > 0) ends.push(off);
    return ends;
  }

  /* ---------- sending ---------- */
  function call(path, body) {
    var tries = 0;
    function attempt() {
      var opts = body instanceof FormData ? { method: 'POST', body: body } : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
      return fetch(tf.endpoint + path, opts).then(function (r) {
        return r.json().catch(function () { return { ok: false, errors: ['The server answered HTTP ' + r.status + '.'] }; }).then(function (j) { j.httpStatus = r.status; return j; });
      }, function () { return { ok: false, httpStatus: 0, errors: ['The upload server could not be reached.'] }; }).then(function (j) {
        var again = j.httpStatus === 0 || j.httpStatus >= 500 || (j.httpStatus === 409 && j.retry);
        if (!j.ok && again && tries < 5) { tries++; return later(1000 * Math.pow(2, tries - 1)).then(attempt); }
        return j;
      });
    }
    return attempt();
  }

  function send() {
    var plan = tf.plan;
    if (!plan || !plan.ok || tf.busy || !tf.open) return;
    // the upload carries one name, "Name - Computer"; the site shows the two parts in separate columns
    var name = handleInput.value.replace(/\s+/g, ' ').trim(), computer = computerInput.value.replace(/\s+/g, ' ').trim();
    var handle = computer ? (name || 'anonymous') + ' - ' + computer : name;
    var wrong = name && !HANDLE.test(name) ? handleInput : computer && !HANDLE.test(computer) ? computerInput : handle.length > 40 ? computerInput : null;
    if (wrong) {
      el('tf-result').innerHTML = msg('err', 'The name for credit and the computer may use letters, digits, spaces and . _ - ( ) [ ] + #, at most 40 characters for both together.');
      wrong.focus();
      return;
    }
    store(HANDLE_KEY, name);
    store(COMPUTER_KEY, computer);
    var note = noteInput.value.trim().slice(0, 500), log = plan.log || {};
    var todo = [], doneChecks = 0;
    plan.parts.forEach(function (p, i) { if (!tf.sent[i]) todo.push(i); });
    var total = todo.reduce(function (s, i) { return s + slices(plan.parts[i].text, L.factorsPerCheck).length + 2; }, 0);
    var ok = [], errors = [], bad = [];
    tf.busy = true; refresh();
    el('tf-result').innerHTML = '';
    var k = 0;
    function tick(label) { doneChecks++; setProgress(label, doneChecks / total); }
    (function nextPart() {
      if (k >= todo.length) return done();
      var idx = todo[k], p = plan.parts[idx], label = todo.length > 1 ? 'Upload ' + (k + 1) + ' of ' + todo.length + ': ' : '';
      var fd = new FormData();
      fd.append('meta', JSON.stringify({ head: p.head, handle: handle, note: note, timestamp: p.timestamp,
        run: { program: log.program || '', start: log.start || '', end: log.end || '', wall_s: log.wall_s || 0 },
        counts: { odd: p.odd, prp: p.odd - p.entries } }));
      fd.append('factors', new Blob([p.text], { type: 'text/plain' }), 'factors.txt');
      setProgress(label + 'sending ' + (p.text.length < 1048576 ? Math.max(1, Math.round(p.text.length / 1024)) + ' kB' : (p.text.length / 1048576).toFixed(1) + ' MB') + '…', doneChecks / total);
      call('/tf/begin', fd).then(function (j) {
        if (!j.ok) return stop(j);
        tick(label + 'checking…');
        var ends = slices(p.text, j.factorsPerCheck || L.factorsPerCheck), s = 0, token = j.token;
        (function nextSlice() {
          if (s >= ends.length) {
            return call('/tf/finish', { token: token }).then(function (f) {
              if (!f.ok) return stop(f);
              tick(label + 'filed');
              tf.sent[idx] = f.id;
              ok.push(f);
              k++;
              nextPart();
            });
          }
          call('/tf/check', { token: token, end: ends[s] }).then(function (c) {
            if (!c.ok) return stop(c);
            token = c.token;
            s++;
            tick(label + 'checked ' + fmt(c.factors) + ' of ' + plural(p.factors, 'factor') + '…');
            nextSlice();
          });
        })();
      });
    })();

    function stop(j) {
      errors = j.errors || ['Upload failed.'];
      if (j.bad) bad = j.bad;
      if (j.httpStatus === 429) errors = ['The server takes ' + L.uploadsPerDay + ' sieve uploads a day from one address. The rest can be sent tomorrow: keep this page open, or choose the same files again.'];
      done(true);
    }
    function done(stopped) {
      tf.busy = false; setProgress('', null); refresh();
      var h = [];
      if (ok.length) {
        var factors = ok.reduce(function (s, f) { return s + (f.factors || 0); }, 0), n = ok.reduce(function (s, f) { return s + (f.entries || 0); }, 0);
        h.push(msg('ok', '<b>Uploaded ' + plural(factors, 'factor') + ' for ' + plural(n, 'n', 'n') + (ok.length > 1 ? ' in ' + ok.length + ' uploads' : '') +
          ', each checked again by the server.</b> Thank you' + (name ? ', ' + esc(name) : '') + '! The site shows them after the next update.' +
          '<br><span class="small mono">' + ok.map(function (f) { return esc(f.id); }).join(' · ') + '</span>'));
      }
      if (stopped) {
        var left = plan.parts.filter(function (p, i) { return !tf.sent[i]; }).length;
        h.push(msg('err', '<b>' + (ok.length ? 'Stopped with ' + plural(left, 'upload') + ' still to send.' : 'Nothing was uploaded.') + '</b> ' + errors.map(esc).join(' ') +
          (bad.length ? list(bad.map(function (b) { return 'n = ' + fmt(b.n) + (b.p ? ', p = ' + esc(b.p) : '') + ': ' + esc(b.reason); }), bad.length) : '') +
          (left && !bad.length ? ' Press Upload to try the rest again.' : '')));
      }
      el('tf-result').innerHTML = h.join('');
      refresh();
    }
  }
})();
