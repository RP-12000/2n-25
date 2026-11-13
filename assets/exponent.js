/* Exponent page: everything known about one n, in the layout of mersenne.ca/exponent/<p>. */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc;
  var ctx = null, token = 0;
  var TRIAL = 10000000; // trial division on this page goes up to 10^7

  S.all(['summary', 'ranges', 'primes', 'site', 'sieve']).then(function (d) {
    ctx = { sum: d[0], rows: d[1].rows, primes: d[2].primes.map(function (p) { return p.n; }).sort(function (a, b) { return a - b; }),
      primeInfo: {}, rankDate: d[2].rank_date, site: d[3], sieve: d[4], M: S.model(d[3]) };
    d[2].primes.forEach(function (p) { ctx.primeInfo[p.n] = p; });
    show(fromUrl(), false);
  }).catch(function (e) { S.fail('facts', e); });

  S.onLookup = function (n) { go(n); };
  window.addEventListener('popstate', function () { if (ctx) show(fromUrl(), false); });

  function fromUrl() {
    var q = new URLSearchParams(location.search).get('n');
    if (q === null) {
      var h = location.hash.replace(/^#(n=)?/, '');
      if (h) q = h;
    }
    if (q === null || q === '') return ctx.sum.latest && ctx.sum.latest[0] ? ctx.sum.latest[0].n : 3600025;
    var n = S.parseN(q);
    return Number.isFinite(n) ? n : q;
  }
  function go(n) {
    try { history.pushState({ n: n }, '', 'exponent.html?n=' + n); } catch (e) { /* sandboxed frames */ }
    show(n, true);
  }
  function link(n, label, title) {
    return '<a href="exponent.html?n=' + n + '" data-n="' + n + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + label + '</a>';
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[data-n]') : null;
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(Number(a.getAttribute('data-n')));
  });

  function rowOf(n) { return ctx.rows[Math.floor(n / 200000)] || null; }
  function prevPrime(n) { var p = null; ctx.primes.forEach(function (x) { if (x < n) p = x; }); return p; }
  function nextPrime(n) { for (var i = 0; i < ctx.primes.length; i++) if (ctx.primes[i] > n) return ctx.primes[i]; return null; }
  function user(shard, rec, pos) { return rec.length > pos && shard ? shard.users[rec[pos]] : ctx.site.credit; }
  function program(shard, rec, pos) { return shard && shard.programs[rec[pos]] ? S.prog(shard.programs[rec[pos]]) : 'Prime95'; }

  function decimal(n) {
    var B = BigInt;
    if (n < 64) return String(B(2) ** B(n) - B(25));
    var t = n * Math.log10(2), f = t - Math.floor(t);
    var lead = String(Math.floor(Math.pow(10, f) * 1e7));
    var last = (S.powmodBig(B(2), B(n), B(100000000)) - B(25) + B(100000000)) % B(100000000);
    return lead + '…' + String(last).padStart(8, '0');
  }

  function show(n, scroll) {
    var my = ++token;
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.floor(n) !== n) return paint(my, n, { kind: 'bad' });
    if (n >= 1e7) return paint(my, n, { kind: 'out' });
    if (n < 5) return paint(my, n, { kind: 'neg' });
    if (n % 2 === 0) return paint(my, n, { kind: 'even' });
    S.shard(n, ctx.sum.shards).then(function (shard) {
      if (my !== token) return;
      var row = rowOf(n);
      var info = { shard: shard, row: row };
      var pm1 = shard && shard.pm1[n] ? shard.pm1[n] : [];
      var prp = shard && shard.prp[n] ? shard.prp[n] : [];
      info.pm1 = pm1; info.prp = prp;
      var survivors = shard ? new Set(shard.s) : null;
      info.survivors = survivors;
      var fac = pm1.filter(function (r) { return r[3]; });
      if (ctx.primeInfo[n]) info.kind = 'prime';
      else if (fac.length) {
        info.kind = 'p1'; info.factorRec = fac[0];
        info.parts = shard && shard.pm1f && shard.pm1f[n] ? shard.pm1f[n] : null;   // P-1 reported their product
      }
      else if (prp.length) info.kind = prp.some(function (r) { return r[1] === 'P'; }) ? 'prime' : prp.some(function (r) { return r[1] === 'R'; }) ? 'reported' : 'comp';
      else if (row && row.sieved) {
        if (survivors && survivors.has(n)) info.kind = 'untested';
        else if (shard && shard.sf && shard.sf[n]) {
          // Mass Prime Siever keeps the factor it found; build.py checked that it divides 2^n - 25
          info.sp = shard.sf[n];
          info.kind = 'sieve';
        } else {
          var depth = row.sieve && row.sieve.depth ? row.sieve.depth : TRIAL;
          info.sp = S.smallestFactor(n, Math.min(TRIAL, depth));
          info.kind = info.sp ? 'sieve' : 'sieve-big';
        }
      } else {
        info.sp = S.smallestFactor(n, TRIAL);
        var act = ctx.site.active || {};
        info.kind = info.sp ? 'future' : (n >= act.lo && n < act.hi ? 'queued' : 'todo');
      }
      paint(my, n, info);
      if (scroll) window.scrollTo(0, 0);
    });
  }

  /* ---------- painting ---------- */
  function paint(my, n, info) {
    if (my !== token) return;
    var kind = info.kind, valid = typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n;
    var row = valid && n < 1e7 && n >= 0 ? rowOf(n) : null;
    var rangeLabel = row ? S.rangeLabel(row.lo, row.hi) : '—';
    var site = ctx.site, M = ctx.M;
    document.title = (valid ? 'n = ' + fmt(n) : 'Exponent') + ' · 2ⁿ−25 Prime Search';
    document.getElementById('crumb-range').textContent = rangeLabel;
    document.getElementById('crumb-n').textContent = 'n = ' + (valid ? fmt(n) : String(n));
    var hdr = document.getElementById('hdr-n');
    if (hdr && document.activeElement !== hdr) hdr.value = valid ? String(n) : '';

    // identity
    document.getElementById('exp-title').innerHTML = '2<sup>' + (valid ? fmt(n) : 'n') + '</sup> − 25';
    var facts = [];
    var inRange = valid && n >= 5 && n < 1e7;
    if (inRange) {
      var dec = decimal(n);
      if (n < 64) facts.push('<div>= <span class="mono">' + S.fmtBig(dec) + '</span></div>');
      else facts.push('<div>≈ <span class="mono">' + dec[0] + '.' + dec.slice(1, 8) + ' × 10<sup>' + fmt(S.digits(n) - 1) + '</sup></span></div>');
      facts.push('<div>has <strong>' + fmt(S.digits(n)) + '</strong> decimal digits</div>');
      facts.push('<div>takes ' + S.cost(M.prpMinutes(n)) + ' to do one PRP test</div>');
    }
    document.getElementById('facts').innerHTML = facts.join('');
    var pIdx = ctx.primes.indexOf(n), pInfo = ctx.primeInfo[n] || {};
    var depth = row && row.sieve ? row.sieve.depth : null;
    var stage0 = (site.stages && site.stages[0]) || { title: 'the sieve', where: '' };
    var V = {
      comp: ['Is composite.', 'The PRP-3 residue is not 1, so 2ⁿ − 25 is not prime. No factor is known.', 'good'],
      p1: ['Has a known factor.', 'P-1 found a factor, so no PRP test was needed.', 'good'],
      sieve: ['Has a known factor.', 'The sieve struck it out' + (row && row.sieve && row.sieve.end ? ' on ' + S.day(row.sieve.end) : '') + ', before any P-1 or PRP work.', 'good'],
      'sieve-big': ['Has a known factor.', 'The sieve to ' + S.depth(depth) + ' struck it out; its factor lies between 10⁷ and ' + S.depth(depth) + ' and is not stored.', 'good'],
      future: ['Has a small factor.', 'Trial division on this page finds it; the first sieve pass will remove this n.', 'good'],
      prime: ['Is a probable prime!', 'Prime ' + (pIdx + 1) + ' of the ' + ctx.primes.length + ' known, in order of n.' + (pInfo.rank ? ' Top PRP ' + pInfo.rank + ' in the list of ' + ctx.rankDate + '.' : ''), 'prime'],
      reported: ['Reported as a probable prime.', 'A PRP-3 test sent to the project says 2ⁿ − 25 is a probable prime. The project re-tests it before counting it as a known prime.', 'prime'],
      untested: ['Waiting for a PRP test.', 'It survived the sieve to ' + S.depth(depth) + (info.pm1 && info.pm1.length ? ' and P-1' : '') + '. A PRP test will decide it.', 'accent'],
      queued: ['Waiting for the sieve.', 'No prime below 10⁷ divides it. ' + S.supHTML(esc(stage0.title)) + ' comes first; if it survives, a PRP test follows, smallest n first.', 'accent'],
      todo: ['Not started.', 'This range starts after ' + (site.active ? S.rangeLabel(site.active.lo, site.active.hi) : 'the active range') + ' is finished.', 'muted'],
      even: ['Factors algebraically.', 'For even n, 2ⁿ − 25 = (2^(n/2) − 5)(2^(n/2) + 5), so even n are never tested.', 'good'],
      neg: ['Not part of the search.', '2ⁿ − 25 is negative for n < 5.', 'muted'],
      out: ['Outside the tracked range.', 'The database covers n < 10⁷.', 'muted'],
      bad: ['Not a valid n.', 'Enter a whole number with 5 ≤ n < 10,000,000.', 'muted']
    }[kind];
    var tiny = kind === 'prime' && !pInfo.found;
    if (tiny) { V = ['Is prime.', 'Small enough to check by trial division: 2^' + n + ' − 25 = ' + decimal(n) + '.', 'prime']; }
    var vEl = document.getElementById('verdict');
    vEl.textContent = V[0];
    vEl.className = 'verdict ' + V[2];
    document.getElementById('verdict-sub').innerHTML = V[1];

    paintNav(n, valid && n >= 0 && n < 1e7, my);

    paintStatus(n, info, row, pInfo, tiny);
    paintEffort(n, info, row);
    paintFactors(n, info, row);
    paintHistory(n, info, row, pInfo, tiny);
    paintProps(n, valid, row, rangeLabel);
    paintStrip(n, info, row);
  }

  /* ---------- previous / next: odd n, unfactored n, known prime ---------- */
  function navButton(m, label, value, title) {
    var inner = '<small>' + label + '</small><b>' + value + '</b>';
    return m !== null && m >= 5 && m < 1e7
      ? '<a href="exponent.html?n=' + m + '" data-n="' + m + '" title="' + esc(title) + '">' + inner + '</a>'
      : '<span title="' + esc(title) + '">' + inner + '</span>';
  }
  function paintNav(n, ok, my) {
    var el = document.getElementById('navs');
    if (!ok) { el.innerHTML = ''; return; }
    var pv = n % 2 ? n - 2 : n - 1, nx = n % 2 ? n + 2 : n + 1, pp = prevPrime(n), np = nextPrime(n);
    el.innerHTML = [
      navButton(pv >= 5 ? pv : null, 'Previous odd n', '← ' + (pv >= 5 ? fmt(pv) : '—'), 'Previous odd n'),
      navButton(nx < 1e7 ? nx : null, 'Next odd n', (nx < 1e7 ? fmt(nx) : '—') + ' →', 'Next odd n'),
      '<span class="pending" id="nav-pu"><small>Previous unfactored</small><b>← …</b></span>',
      '<span class="pending" id="nav-nu"><small>Next unfactored</small><b>… →</b></span>',
      navButton(pp, 'Previous prime', '← ' + (pp ? fmt(pp) : '—'), 'Previous known prime'),
      np ? navButton(np, 'Next prime', fmt(np) + ' →', 'Next known prime')
        : '<span class="unknown" title="No larger prime is known yet"><small>Next prime</small><b>? →</b></span>'
    ].join('');
    [-1, 1].forEach(function (dir) {
      unfactored(n, dir).then(function (m) {
        var slot = document.getElementById(dir < 0 ? 'nav-pu' : 'nav-nu');
        if (my !== token || !slot) return;
        var label = dir < 0 ? 'Previous unfactored' : 'Next unfactored';
        slot.outerHTML = navButton(m, label, dir < 0 ? '← ' + (m ? fmt(m) : '—') : (m ? fmt(m) : '—') + ' →', label + ' n: no factor known');
      });
    });
  }
  // the nearest odd n beyond n in direction dir (+1 or -1) with no known factor that is not a known prime:
  // a sieve survivor without a P-1 factor, or, where the sieve has not run yet, an n with no factor below 10^7
  function unfactored(n, dir) {
    var m = n % 2 ? n + 2 * dir : n + dir, tries = 0;
    var factored = function (shard, x) {
      var recs = shard && shard.pm1 && shard.pm1[x];
      return !!recs && recs.some(function (r) { return r[3]; });
    };
    function walk() {
      while (m >= 5 && m < 1e7) {
        var row = rowOf(m);
        if (row && row.sieved) {
          var lo = Math.floor(m / 100000) * 100000;
          return S.shard(m, ctx.sum.shards).then(function (shard) {
            var s = shard && shard.s ? shard.s : [], a = 0, b = s.length;
            while (a < b) { var c = (a + b) >> 1; if (s[c] < m) a = c + 1; else b = c; }
            if (dir > 0) {
              for (var i = a; i < s.length; i++) if (!factored(shard, s[i]) && !ctx.primeInfo[s[i]]) return s[i];
              m = lo + 100001;
            } else {
              for (var j = a < s.length && s[a] === m ? a : a - 1; j >= 0; j--) if (!factored(shard, s[j]) && !ctx.primeInfo[s[j]]) return s[j];
              m = lo - 1;
            }
            return walk();
          });
        }
        if (++tries > 2000) return Promise.resolve(null);
        if (!ctx.primeInfo[m] && !S.smallestFactor(m, TRIAL)) return Promise.resolve(m);
        m += 2 * dir;
      }
      return Promise.resolve(null);
    }
    return new Promise(function (done) { setTimeout(done, 0); }).then(walk);
  }

  function state(text, cls) { return '<span class="state ' + (cls || '') + '">' + text + '</span>'; }

  function paintStatus(n, info, row, pInfo, tiny) {
    var kind = info.kind, site = ctx.site, shard = info.shard;
    document.getElementById('status-meta').textContent = 'project database · ' + ctx.sum.generated;
    var band = ['muted', 'not tracked'], line = '', lineCls = '', tests = [], banner = ['', ''];
    var depth = row && row.sieve ? row.sieve.depth : null;
    var stage0 = (site.stages && site.stages[0]) || { title: 'the sieve', where: '' };
    var chance = function (p) {
      var x = 2 * ctx.M.C * Math.log(p) / (ctx.M.K * n);
      return x > 0 ? 'chance it is prime: about 1 in ' + fmt(Math.round(1 / x / 100) * 100 || 1) : '';
    };
    var notNeeded = [['PRP-3', '—', state('Not needed', 'good')], ['Proof', '—', '—']];
    if (kind === 'comp') {
      var r = info.prp[info.prp.length - 1];
      band = ['good', 'composite · 0 primality tests remaining'];
      line = 'PRP-3 result ' + esc(r[0]) + ' UTC · ' + esc(user(shard, r, 7)) + ' · ' + esc(program(shard, r, 6));
      var seen = {};
      info.prp.forEach(function (x, i) {
        var match = x[2] && seen[x[2]];
        tests.push(['PRP-3' + (info.prp.length > 1 ? ' #' + (i + 1) : ''), x[2] || '—', state(match ? 'Matches, verified' : 'Composite', match ? 'good' : '')]);
        if (x[2]) seen[x[2]] = true;
      });
      var withProof = info.prp.filter(function (x) { return x[4]; })[0];
      tests.push(['Proof', withProof ? 'power ' + withProof[4] + (withProof[5] ? ' · md5 ' + esc(withProof[5]) + '…' : '') : '—',
        withProof ? state('Kept · not certified yet', 'muted') : '—']);
      banner = ['', 'No factor known'];
    } else if (kind === 'p1') {
      var f = info.factorRec;
      band = ['good', 'factored · 0 primality tests remaining'];
      line = 'P-1 factor ' + esc(f[0]) + ' UTC · ' + esc(user(shard, f, 5)) + ' · ' + esc(program(shard, f, 4));
      tests = notNeeded;
      banner = ['', (info.parts ? info.parts.length + ' known factors' : '1 known factor') + ' · cofactor not tested'];
    } else if (kind === 'sieve' || kind === 'sieve-big') {
      band = ['good', 'factored · 0 primality tests remaining'];
      line = 'Removed by the sieve' + (row.sieve.end ? ' ' + S.day(row.sieve.end) : '') + (row.sieve.program ? ' · ' + esc(S.prog(row.sieve.program)) : '');
      tests = notNeeded;
      banner = ['', kind === 'sieve' ? '1 known factor · cofactor not tested' : 'Factor between 10⁷ and ' + S.depth(depth) + ' · not stored'];
    } else if (kind === 'future') {
      band = ['accent', 'will be removed by the sieve · no test needed'];
      var act = site.active || {};
      line = n >= act.lo && n < act.hi ? 'Queued: ' + S.supHTML(esc(stage0.title)) + (stage0.where ? ' · ' + esc(stage0.where) : '') : 'Not assigned yet; the first sieve pass will remove it';
      lineCls = 'accent';
      tests = notNeeded;
      banner = ['', '1 known factor · cofactor not tested'];
    } else if (kind === 'prime') {
      band = ['prime', (tiny ? 'prime' : 'probable prime') + ' · 0 primality tests remaining'];
      var digitsBig = S.digits(n) > 40000;
      if (tiny) {
        line = 'Checked directly' + (pInfo.note && !/^checked directly$/i.test(pInfo.note) ? '; ' + esc(pInfo.note) : '');
        tests = [['Proof', 'trial division', state('Prime', 'prime')]];
      } else {
        // a prime known before this project: name who found it first, then this project's re-test
        var before = pInfo.discoverer && pInfo.discoverer !== (pInfo.who || site.credit);
        line = (before ? 'First found by ' + esc(pInfo.discoverer) + (pInfo.discovered ? ', ' + esc(pInfo.discovered) : '') + ' · PRP-3 re-test ' : 'PRP-3 result ') +
          esc(pInfo.found) + ' UTC · ' + esc(pInfo.who || site.credit) + (pInfo.program ? ' · ' + esc(pInfo.program) : '');
        tests = [['PRP-3', 'probable prime', state('Probable prime', 'prime')],
          pInfo.proof_power ? ['Proof', 'power ' + pInfo.proof_power, state('Kept · not certified yet', 'muted')] : ['Proof', '—', '—']];
      }
      var k = ctx.primes.indexOf(n) + 1;
      banner = ['prime', pInfo.rank ? 'Top PRP ' + esc(pInfo.rank) + ' (list of ' + esc(ctx.rankDate) + ') · prime ' + k + ' of ' + ctx.primes.length
        : 'Prime ' + k + ' of ' + ctx.primes.length + (tiny ? '' : ' · ' + (digitsBig ? 'too large for a primality proof' : 'small enough for an ECPP proof'))];
    } else if (kind === 'reported') {
      // a probable prime from an upload, listed as a known prime only after the project re-tests it
      var rr = info.prp.filter(function (x) { return x[1] === 'R'; })[0];
      band = ['accent', 'reported probable prime · being verified'];
      line = 'PRP-3 result ' + esc(rr[0]) + ' UTC · ' + esc(user(shard, rr, 7)) + ' · ' + esc(program(shard, rr, 6));
      lineCls = 'accent';
      tests = [['PRP-3', 'probable prime', state('Reported', 'prime')], ['Re-test', '—', state('Being verified', 'accent')],
        ['Proof', rr[4] ? 'power ' + rr[4] + (rr[5] ? ' · md5 ' + esc(rr[5]) + '…' : '') : '—', rr[4] ? state('Kept · not certified yet', 'muted') : '—']];
      banner = ['', 'Counted as a known prime once the project has confirmed it'];
    } else if (kind === 'untested') {
      band = ['accent', '1 PRP test remaining'];
      var p1 = info.pm1[0];
      line = 'Sieved to ' + S.depth(depth) + (p1 ? '; P-1 with B1 = ' + fmt(p1[1]) + ' found nothing' : '') + '. Waiting for a PRP test.';
      lineCls = 'accent';
      tests = [['PRP-3', '—', state('Not tested', 'accent')], ['Proof', '—', '—']];
      banner = ['', 'Survived the sieve · ' + chance(depth || TRIAL)];
    } else if (kind === 'queued' || kind === 'todo') {
      band = [kind === 'queued' ? 'accent' : '', '1 PRP test remaining unless the sieve finds a factor'];
      line = kind === 'queued' ? 'Queued: ' + S.supHTML(esc(stage0.title)) + (stage0.where ? ' · ' + esc(stage0.where) : '') : 'Not assigned yet';
      lineCls = kind === 'queued' ? 'accent' : '';
      tests = [['PRP-3', '—', state('Not tested', 'accent')], ['Proof', '—', '—']];
      banner = ['', 'No factor below 10⁷ · ' + chance(TRIAL)];
    } else if (kind === 'even') {
      band = ['good', 'factored algebraically · 0 primality tests remaining'];
      line = 'Never assigned';
      tests = [['PRP-3', '—', state('Not needed', 'good')]];
      banner = ['', 'Factors 2^' + fmt(n / 2) + ' − 5 and 2^' + fmt(n / 2) + ' + 5'];
    } else {
      line = '—';
      banner = ['', 'Enter an n from 5 to 9,999,999 in the box at the top'];
    }
    var l = document.getElementById('status-line');
    l.innerHTML = line;
    l.className = 'status-line ' + lineCls;
    var b = document.getElementById('band');
    b.textContent = band[1];
    b.className = 'band ' + band[0];
    document.getElementById('tests').innerHTML = tests.length ? '<div class="scroll-x"><table class="data"><thead><tr><th>Test</th><th>Residue / file</th><th class="text">Status</th></tr></thead><tbody>' +
      tests.map(function (t) { return '<tr><td>' + t[0] + '</td><td>' + t[1] + '</td><td class="text">' + t[2] + '</td></tr>'; }).join('') + '</tbody></table></div>' : '';
    var bn = document.getElementById('banner');
    bn.textContent = banner[1];
    bn.className = 'banner ' + banner[0];
  }

  function paintEffort(n, info, row) {
    var kind = info.kind, card = document.getElementById('fx-card');
    var show = row && ['comp', 'p1', 'sieve', 'sieve-big', 'untested', 'future', 'queued', 'todo'].indexOf(kind) >= 0 && n > 13;
    card.hidden = !show;
    if (!show) return;
    var target = ctx.site.sieve_target || 1e14;
    var K = row.survivor_K || ctx.M.K;
    var sTgt = 1 - K / Math.log(target);
    var pct = function (x) { return (x * 100).toFixed(2) + ' %'; };
    var sign = function (x, s) { return '<td class="r ' + (x >= 0 ? 'pos' : 'neg') + '">' + (x >= 0 ? '+' : '−') + s + '</td>'; };
    var cell = function (v) { return '<td class="r">' + v + '</td>'; };
    var rows = [];
    var scope, note;
    if (row.sieved) {
      var surv = row.survivors || 0, odd = row.odd;
      var sAct = 1 - surv / odd;
      var ranP1 = row.pm1.runs > 0 && kind !== 'sieve' && kind !== 'sieve-big';
      var pAct = ranP1 ? row.pm1.factors / row.pm1.runs : 0;
      var cAct = ranP1 ? 1 - (surv - row.pm1.factors) / odd : sAct;
      var own = info.pm1 && info.pm1[0];
      var b1 = own ? own[1] : (ranP1 ? row.pm1.b1 : 0);
      var b2 = own ? own[2] : (ranP1 ? row.pm1.b2_median : 0);
      var b2Text = b1 ? (b2 ? (own ? '' : '≈ ') + fmt(b2) : 'stage 1 only') : '—';
      var bits = Math.log2(row.sieve.depth) - Math.log2(target);
      rows.push('<tr><th class="text" scope="row">Actual</th>' + cell(S.depth(row.sieve.depth)) + cell(pct(sAct)) + cell(b1 ? fmt(b1) : '—') + cell(b2Text) +
        cell(ranP1 ? pct(pAct) : '—') + cell(pct(cAct)) + '</tr>');
      rows.push('<tr class="alt"><th class="text" scope="row">Target</th>' + cell(S.depth(target)) + cell(pct(sTgt)) + cell('—') + cell('—') + cell('—') + cell(pct(sTgt)) + '</tr>');
      rows.push('<tr><th class="text" scope="row">Difference</th>' + sign(bits, Math.abs(bits).toFixed(1) + ' bits') + sign(sAct - sTgt, pct(Math.abs(sAct - sTgt))) +
        (b1 ? sign(1, fmt(b1)) : cell('—')) + (b1 && b2 ? sign(1, fmt(b2)) : cell('—')) + (ranP1 ? sign(1, pct(pAct)) : cell('—')) +
        sign(cAct - sTgt, pct(Math.abs(cAct - sTgt))) + '</tr>');
      scope = 'probabilities measured on ' + S.rangeLabel(row.lo, row.hi);
      note = '* Share of odd n in ' + S.rangeLabel(row.lo, row.hi) + ' removed by that much work: the sieve to ' + S.depth(row.sieve.depth) + ' left ' + fmt(surv) +
        ' of ' + fmt(odd) + (ranP1 ? ', then P-1 removed ' + fmt(row.pm1.factors) + ' of those ' + fmt(row.pm1.runs) : '') +
        '. Target is today’s plan for new ranges: sieve to ' + S.depth(target) + ' and skip P-1, which stopped paying off once the sieve went deep.';
    } else {
      var tb = Math.log2(target);
      rows.push('<tr><th class="text" scope="row">Actual</th>' + cell('—') + cell('0.00 %') + cell('—') + cell('—') + cell('—') + cell('0.00 %') + '</tr>');
      rows.push('<tr class="alt"><th class="text" scope="row">Target</th>' + cell(S.depth(target)) + cell(pct(sTgt)) + cell('—') + cell('—') + cell('—') + cell(pct(sTgt)) + '</tr>');
      rows.push('<tr><th class="text" scope="row">Difference</th>' + sign(-1, tb.toFixed(1) + ' bits') + sign(-1, pct(sTgt)) + cell('—') + cell('—') + cell('—') + sign(-1, pct(sTgt)) + '</tr>');
      var act = ctx.site.active || {};
      scope = n >= act.lo && n < act.hi ? (ctx.site.stages || []).slice(0, 3).map(function (s) { return s.title.replace(/\^(\d+)/g, function (m, e) { return S.sup(e); }); }).join(', then ') : 'not started';
      var odd7 = 700000;
      note = '* Expected share of odd n removed, from the survivor model (survivors fall like ' + ctx.M.K + ' / ln p). For 700,000 odd n that leaves about ' +
        fmt(Math.round(ctx.M.survivors(odd7, 1e12) / 100) * 100) + ' at 10¹² and ' + fmt(Math.round(ctx.M.survivors(odd7, target) / 100) * 100) + ' at ' + S.depth(target) + '.';
    }
    document.getElementById('fx-scope').textContent = scope;
    document.getElementById('fx').innerHTML = '<table class="data"><thead><tr><th rowspan="2"></th><th class="group" colspan="2">Sieve</th><th class="group" colspan="3">P-1 factoring</th><th class="group">Combined</th></tr>' +
      '<tr><th class="r">Limit p</th><th class="r">Probability*</th><th class="r">B1</th><th class="r">B2</th><th class="r">Probability*</th><th class="r">Probability*</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table>';
    document.getElementById('fx-note').textContent = note;
  }

  // a long number with a line break allowed after each comma (copies without extra characters)
  function wrapBig(v) { return S.fmtBig(v).replace(/,/g, ',<wbr>'); }

  function countClass(c, m) {
    var lo = 5, hi = 1e7;
    return Math.floor((hi - 1 - c) / m) - Math.floor((lo - 1 - c) / m);
  }
  function powText(fs) {
    return fs.map(function (x) { return S.fmtBig(x[0]) + (x[1] > 1 ? S.sup(x[1]) : ''); }).join(' × ');
  }

  function factorRow(n, pStr, date, how, who, bound) {
    var p = BigInt(pStr);
    var bits = (pStr.length > 15 ? Math.log2(Number(pStr.slice(0, 15))) + (pStr.length - 15) * Math.log2(10) : Math.log2(Number(pStr))).toFixed(3);
    var row = { p: S.fmtBig(pStr), digits: pStr.length, bits: bits, date: date, how: how, who: who, pm1: '—', ord: '—', b1: '—', b2: '—', rel: '' };
    if (!S.isProbablePrime(p)) {
      row.pm1 = 'composite factor';
      row.rel = S.fmtBig(pStr) + ' is itself composite: P-1 found two or more prime factors at once.';
      return row;
    }
    var fz = S.factorize(p - BigInt(1), bound);
    row.pm1 = powText(fz.factors) + (fz.rest ? ' × (' + S.fmtBig(fz.rest) + ')' : '');
    if (fz.rest) return row;
    var o = S.order2(p, fz.factors);
    row.ord = wrapBig(o);
    var mb = S.minB(fz.factors);
    row.b1 = S.fmtBig(mb[0]);
    row.b2 = mb[1] ? S.fmtBig(mb[1]) : '—';
    var r = BigInt(n) % o;
    if (o < BigInt(1e7)) {
      var on = Number(o), rn = Number(r);
      var cnt = on % 2 === 0 ? countClass(rn, on) : countClass(rn % 2 ? rn : rn + on, 2 * on);
      row.rel = S.fmtBig(pStr) + ' divides 2ⁿ − 25 exactly when n ≡ ' + fmt(rn) + ' (mod ' + fmt(on) + ')' +
        (cnt > 1 ? ': one sieve step strikes out all ' + fmt(cnt) + ' such odd n below 10⁷.' : ', so this is the only odd n below 10⁷ it divides.');
    } else {
      row.rel = S.fmtBig(pStr) + ' divides 2ⁿ − 25 exactly when n ≡ ' + S.fmtBig(r) + ' (mod ' + S.fmtBig(o) + '), so this is the only n below 10⁷ it divides.';
    }
    return row;
  }

  function paintFactors(n, info, row) {
    var kind = info.kind, out = [], sum = '', text = '';
    var bitsOf = function (s) { return s.length > 15 ? Math.log2(Number(s.slice(0, 15))) + (s.length - 15) * Math.log2(10) : Math.log2(Number(s)); };
    if (kind === 'p1') {
      var f = info.factorRec, bound = Math.max(1000, Math.min(f[1] || 1e6, 2e6)), F = String(f[3]);
      var day = S.day(f[0]), how = 'P-1, stage ' + (f[2] ? 2 : 1), who = user(info.shard, f, 5);
      if (info.parts) {
        // P-1 reported the product of primes it found in the same run: show that number, then its primes
        var k = info.parts.length;
        out.push({ p: wrapBig(F), digits: F.length, bits: bitsOf(F).toFixed(3), date: day, how: how, who: who,
          pm1: 'composite: the product of the ' + k + ' primes below', ord: '—', b1: '—', b2: '—', rel: '', cls: 'group' });
        info.parts.forEach(function (q, i) {
          var r = factorRow(n, String(q), '', '', '', bound);
          r.p = (i ? '× ' : '= ') + r.p;
          r.cls = 'sub';
          out.push(r);
        });
        out[0].rel = 'P-1 found ' + (k === 2 ? 'two' : k === 3 ? 'three' : k === 4 ? 'four' : fmt(k)) + ' prime factors in the same run and reported their product, the ' +
          F.length + '-digit number in the first row.';
        sum = k + ' prime factors, found together · ' + bitsOf(F).toFixed(1) + ' of ' + fmt(n) + ' bits known';
      } else {
        out.push(factorRow(n, F, day, how, who, bound));
        sum = '1 factor · ' + bitsOf(F).toFixed(1) + ' of ' + fmt(n) + ' bits known';
      }
    } else if ((kind === 'sieve' || kind === 'future') && info.sp) {
      var sfu = info.shard && info.shard.sfu, finder = sfu && sfu[n] !== undefined && info.shard.users[sfu[n]];
      out.push(factorRow(n, String(info.sp), kind === 'sieve' && row.sieve && row.sieve.end ? S.day(row.sieve.end) : '—', kind === 'sieve' ? (finder ? 'Sieve, uploaded' : 'Sieve') : 'Trial division (this page)',
        kind === 'sieve' ? finder || (info.sp >= 1e7 ? ctx.site.credit : '—') : '—', 4000));
      sum = '1 factor · ' + Math.log2(info.sp).toFixed(1) + ' of ' + fmt(n) + ' bits known';
    } else if (kind === 'even') {
      sum = 'algebraic';
      text = '2^' + fmt(n) + ' − 25 = (2^' + fmt(n / 2) + ' − 5) × (2^' + fmt(n / 2) + ' + 5), and 3 divides the first factor.';
    } else {
      var depth = row && row.sieve ? S.depth(row.sieve.depth) : '';
      sum = kind === 'prime' ? 'none: it is prime' : kind === 'sieve-big' ? 'one, not stored' : 'none known';
      text = {
        comp: 'None known. No prime below ' + depth + ' divides it' + (info.pm1 && info.pm1[0] ? ', and P-1 with B1 = ' + fmt(info.pm1[0][1]) + (info.pm1[0][2] ? ', B2 = ' + fmt(info.pm1[0][2]) : '') + ' found nothing' : '') + '. The PRP-3 residue shows it is composite all the same.',
        prime: 'It is ' + (ctx.primeInfo[n] && !ctx.primeInfo[n].found ? 'prime' : 'a probable prime') + ', so there are no factors to list.',
        'sieve-big': 'The sieve removed it, so some prime between 10⁷ and ' + depth + ' divides it. The sieve output keeps only the survivors, so that factor is not on record yet.',
        untested: 'None. No prime below ' + depth + ' divides it' + (info.pm1 && info.pm1[0] ? ', and P-1 found nothing' : '') + '.',
        queued: 'None yet: no prime below 10⁷ divides it. The sieve will try every p up to ' + S.depth(ctx.site.sieve_target || 1e14) + '.',
        todo: 'None yet: no prime below 10⁷ divides it.'
      }[kind] || '—';
    }
    document.getElementById('fac-sum').textContent = sum;
    var html = '';
    if (out.length) {
      html = '<div class="table-wrap"><table class="data"><thead><tr><th class="r">Factor p</th><th class="r">Digits</th><th class="r">Bits</th><th>p − 1</th><th class="r">Order of 2 mod p</th>' +
        '<th>Found</th><th class="text">How</th><th class="text">Who</th><th class="r">Min B1</th><th class="r">Min B2</th></tr></thead><tbody>' +
        out.map(function (r) {
          return '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '><td class="r' + (r.cls === 'group' ? ' wrap big' : '') + '">' + r.p + '</td><td class="r">' + r.digits + '</td><td class="r">' + r.bits +
            '</td><td class="wrap' + (r.cls === 'group' ? ' text muted' : '') + '">' + r.pm1 + '</td><td class="r wrap num">' + r.ord +
            '</td><td>' + esc(r.date) + '</td><td class="text">' + esc(r.how) + '</td><td class="text">' + esc(r.who) + '</td><td class="r">' + r.b1 + '</td><td class="r">' + r.b2 + '</td></tr>';
        }).join('') + '</tbody></table></div>' + '<p class="small">' + out.map(function (r) { return esc(r.rel); }).join(' ') + '</p>';
    } else {
      html = '<p class="body">' + esc(text) + '</p>';
    }
    document.getElementById('factors').innerHTML = html;
  }

  function paintHistory(n, info, row, pInfo, tiny) {
    var kind = info.kind, H = [];
    if (row && row.sieved && !tiny && kind !== 'even') {
      H.push([row.sieve.end ? S.day(row.sieve.end) : '—', 'Sieve', esc(S.prog(row.sieve.program)) || '—', 'every p &lt; ' + S.depth(row.sieve.depth),
        kind === 'sieve' ? 'factor ' + fmt(info.sp) : kind === 'sieve-big' ? 'factor &gt; 10⁷' : 'no factor']);
    }
    (info.pm1 || []).forEach(function (r) {
      var who = user(info.shard, r, 5);
      H.push([esc(r[0]), 'P-1', esc(program(info.shard, r, 4)) + (who !== ctx.site.credit ? ' · ' + esc(who) : ''),
        'B1 = ' + fmt(r[1]) + (r[2] ? ', B2 = ' + fmt(r[2]) : ', stage 1'),
        r[3] ? 'factor ' + wrapBig(r[3]) + (info.parts && r === info.factorRec ? ' <span class="muted">(' + info.parts.length + ' primes, listed above)</span>' : '') : 'no factor']);
    });
    (info.prp || []).forEach(function (r) {
      var who = user(info.shard, r, 7);
      H.push([esc(r[0]), 'PRP-3', esc(program(info.shard, r, 6)) + (who !== ctx.site.credit ? ' · ' + esc(who) : ''),
        'FFT ' + S.fft(r[3]) + (r[4] ? ' · proof power ' + r[4] : ''), r[1] === 'P' ? 'probable prime' : r[1] === 'R' ? 'reported probable prime' : 'composite · ' + esc(r[2])]);
    });
    if (kind === 'prime' && !tiny && !(info.prp || []).length) {
      H.push([esc(pInfo.found), 'PRP-3', esc(pInfo.program || ''), 'FFT ' + S.fft(pInfo.fft) + (pInfo.proof_power ? ' · proof power ' + pInfo.proof_power : ''), 'probable prime']);
    }
    var el = document.getElementById('history');
    if (H.length) {
      el.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Date (UTC)</th><th class="text">Work</th><th class="text">Program</th><th>Parameters</th><th>Result</th></tr></thead><tbody>' +
        H.map(function (h) { return '<tr><td>' + h[0] + '</td><td class="text">' + h[1] + '</td><td class="text">' + h[2] + '</td><td>' + h[3] + '</td><td class="wrap">' + h[4] + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    } else {
      var t = { queued: 'No work yet. ' + ((ctx.site.stages && ctx.site.stages[0]) ? S.supHTML(esc(ctx.site.stages[0].title)) + ' is next.' : ''),
        future: 'No work yet; the first sieve pass will remove it.', todo: 'No work yet.', even: 'Never assigned: even n are excluded.',
        prime: 'Too small for the search programs; checked directly.' }[kind] || 'No work recorded.';
      el.innerHTML = '<p class="body">' + t + '</p>';
    }
  }

  function paintProps(n, valid, row, rangeLabel) {
    var P = [];
    if (valid && n >= 5 && n < 1e7) {
      P = [
        ['n mod 6', String(n % 6) + (n % 2 === 0 ? ' (even)' : n % 6 === 5 && n > 5 ? ' (7 divides)' : '')],
        ['Bits', n >= 6 ? fmt(n) : '3'],
        ['Binary', fmt(n - 5) + ' ones, then 00111'],
        ['Decimal', esc(decimal(n))],
        ['Range', rangeLabel],
        ['Data file', ctx.sum.shards && ctx.sum.shards.indexOf(S.shardName(n)) < 0 ? '— <span class="muted">(nothing recorded yet)</span>'
          : '<a href="data/n/' + S.shardName(n) + '.json">data/n/' + S.shardName(n) + '.json</a>']
      ];
    }
    document.getElementById('props').innerHTML = P.map(function (p) { return '<div><dt>' + p[0] + '</dt><dd>' + p[1] + '</dd></div>'; }).join('');
  }

  function paintStrip(n, info, row) {
    var card = document.getElementById('nb-card');
    var ok = typeof n === 'number' && n >= 5 && n < 1e7 && Number.isInteger(n);
    card.hidden = !ok;
    if (!ok) return;
    var base = Math.floor(n / 200) * 200, cells = [], counts = {};
    var sieved = row && row.sieved && info.shard;
    var P = sieved ? null : S.primesUpTo(100000);
    var names = { S: 'sieve factor', F: 'P-1 factor', C: 'PRP composite', P: 'prime', R: 'reported prime, being verified', U: sieved ? 'waiting for PRP' : 'no factor below 10⁵', X: 'not part of the search' };
    for (var m = base + 1; m < base + 200; m += 2) {
      var code;
      if (m < 5) code = 'X';
      else if (ctx.primeInfo[m]) code = 'P';
      else if (sieved) {
        var pm = info.shard.pm1[m], pr = info.shard.prp[m];
        if (pm && pm.some(function (r) { return r[3]; })) code = 'F';
        else if (pr && pr.length) code = pr.some(function (r) { return r[1] === 'P'; }) ? 'P' : pr.some(function (r) { return r[1] === 'R'; }) ? 'R' : 'C';
        else if (info.survivors.has(m)) code = 'U';
        else code = 'S';
      } else {
        code = 'U';
        var value = m < 53 ? Math.pow(2, m) - 25 : Infinity;
        for (var k = 0; k < P.length; k++) {
          var p = P[k];
          if (p >= value) break;
          if (p === 2 || p === 5) continue;
          if (S.powmod(2, m, p) === 25 % p) { code = 'S'; break; }
        }
      }
      counts[code] = (counts[code] || 0) + 1;
      var label = 'n = ' + fmt(m) + ': ' + names[code];
      cells.push(m === n ? '<span class="' + code + ' cur" title="' + label + '" aria-label="' + label + ' (this n)"></span>'
        : (m < 5 ? '<span class="' + code + '" title="' + label + '"></span>' : '<a class="' + code + '" href="exponent.html?n=' + m + '" data-n="' + m + '" title="' + label + '" aria-label="' + label + '"></a>'));
    }
    document.getElementById('nb-meta').textContent = 'odd n from ' + fmt(base + 1) + ' to ' + fmt(base + 199) + ' · select a cell to open that n';
    document.getElementById('strip').innerHTML = cells.join('');
    document.getElementById('strip-ends').innerHTML = '<span>' + fmt(base + 1) + '</span><span>' + fmt(base + 199) + '</span>';
    var keyCls = { S: 's', F: 'f', C: 'c', P: 'prime', R: 'r', U: 'u', X: 'open' };
    document.getElementById('strip-legend').innerHTML = ['S', 'F', 'C', 'P', 'R', 'U', 'X'].filter(function (c) { return counts[c]; }).map(function (c) {
      return '<span><i class="key ' + keyCls[c] + '" aria-hidden="true"></i>' + counts[c] + ' ' + names[c] + '</span>';
    }).join('') + '<span><i class="key cur" aria-hidden="true"></i>this n' + (sieved ? '' : ' · tested on this page up to 10⁵') + '</span>';
  }
})();
