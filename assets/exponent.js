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
    start();
  }).catch(function (e) { S.fail('facts', e); });

  S.onLookup = function (n) { go(n); };
  window.addEventListener('popstate', function () { if (ctx) start(); });

  // without an n in the address: the smallest n with no known factor and no PRP test (summary.json next_open), the n
  // the lookup box suggests; without that list, the first n above exponent_start_after (content/site.json) with no known factor
  function start() {
    var n = fromUrl();
    if (n !== null) return show(n, false);
    var next = ctx.sum.next_open && ctx.sum.next_open[0];
    if (next) return show(next, false);
    var from = Number(ctx.site.exponent_start_after) || 3600000;
    unfactored(from, 1).then(function (m) { show(m || from + 1, false); });
  }
  function fromUrl() {
    var q = new URLSearchParams(location.search).get('n');
    if (q === null) {
      var h = location.hash.replace(/^#(n=)?/, '');
      if (h) q = h;
    }
    if (q === null || q === '') return null;
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
    Promise.all([S.shard(n, ctx.sum.shards), S.factorFile(n, ctx.sum.factor_files)]).then(function (got) {
      if (my !== token) return;
      var shard = got[0], row = rowOf(n);
      var info = { shard: shard, row: row, ff: got[1] };
      var pm1 = shard && shard.pm1[n] ? shard.pm1[n] : [];
      var prp = shard && shard.prp[n] ? shard.prp[n] : [];
      info.pm1 = pm1; info.prp = prp;
      var survivors = shard ? new Set(shard.s) : null;
      info.survivors = survivors;
      // a range sieved twice: the first sieve (the one P-1 and the PRP tests ran after), and whether n survived it
      info.before = row && row.sieved && row.sieve_before ? row.sieve_before : null;
      info.oldSurvivor = !!(info.before && shard && shard.s0 && shard.s0.indexOf(n) >= 0);
      // the sieve (the second one, in a range sieved twice) found a factor of n
      var struck = !!(row && row.sieved && !(survivors && survivors.has(n)));
      var limit = Math.min(TRIAL, row && row.sieve && row.sieve.depth ? row.sieve.depth : TRIAL);
      var fac = pm1.filter(function (r) { return r[3]; });
      if (ctx.primeInfo[n]) info.kind = 'prime';
      else if (fac.length) {
        info.kind = 'p1'; info.factorRec = fac[0];
        info.p1 = p1List(n, shard, pm1);
        // P-1 runs on sieve survivors; should the sieve have removed n as well, its factors belong here too
        if (struck) {
          var p1Seen = {};
          info.p1.forEach(function (x) { (x.parts || [x.F]).forEach(function (q) { p1Seen[String(q)] = true; }); });
          info.factors = sieveFactors(n, info.ff, shard, limit).filter(function (f) { return !p1Seen[f.p]; });
        }
      }
      else if (prp.some(function (r) { return r[1] === 'P'; })) info.kind = 'prime';
      else if (prp.some(function (r) { return r[1] === 'R'; })) info.kind = 'reported';
      else if (struck) {
        // removed by the sieve; or, in a range sieved twice, a PRP composite the second sieve found a factor for
        info.factors = sieveFactors(n, info.ff, shard, limit);
        info.kind = info.factors.length ? 'sieve' : 'sieve-big';
      }
      else if (prp.length) info.kind = 'comp';
      else if (row && row.sieved) info.kind = 'untested';
      else {
        // not sieved from the small primes yet: trial division here, and whatever the sieve slices so far found
        info.factors = sieveFactors(n, info.ff, shard, TRIAL);
        var act = ctx.site.active || {};
        info.kind = info.factors.some(function (f) { return f.small; }) ? 'future' : info.factors.length ? 'sieve-part'
          : (n >= act.lo && n < act.hi ? 'queued' : 'todo');
      }
      // in a range sieved twice, the factors of n the first sieve kept: a factor it did not keep counts as not found
      // by it, so an n it struck out without keeping a factor goes to the second sieve
      info.firstKept = info.before && !info.oldSurvivor ? (info.factors || []).filter(function (f) { return f.src && f.src.before; }) : [];
      // when the sieve first struck n out: the first sieve of a range sieved twice if it kept a factor of n,
      // else the earliest run that found one of its factors
      info.struck = info.firstKept.length && /^sieve/.test(info.kind) ? info.before.end
        : (info.factors || []).reduce(function (t, f) { return f.src && f.src.end && (!t || f.src.end < t) ? f.src.end : t; }, null);
      paint(my, n, info);
      if (scroll) window.scrollTo(0, 0);
    });
  }

  /* Every known sieve factor of 2^n - 25, smallest first: the primes up to `limit` found here by trial division
     (they are no news to any sieve, so data/ leaves them out) and every larger one in the sieve output
     (data/f/<x.x>.json), each with the slice that found it: {p: string, src: slice or null, small: bool}. */
  function sieveFactors(n, ff, shard, limit) {
    var slices = ff && ff.slices ? ff.slices : [];
    var out = S.factorsBelow(n, limit).map(function (p) {
      var src = null;
      for (var i = 0; i < slices.length && !src; i++) {
        var x = slices[i];
        if (x.n[0] <= n && n < x.n[1] && x.p[0] <= p && p < x.p[1]) src = x;
      }
      return { p: String(p), src: src, small: true };
    });
    slices.forEach(function (x) {
      ((x.f || {})[n] || []).forEach(function (p) { out.push({ p: String(p), src: x, small: false }); });
    });
    if (!slices.length && shard && shard.sf && shard.sf[n]) {
      // data from before the factor files: one factor above 10^7, with the uploader's name if it came from an upload
      var u = shard.sfu && shard.sfu[n] !== undefined ? shard.users[shard.sfu[n]] : null;
      out.push({ p: String(shard.sf[n]), src: null, small: false, by: u });
    }
    out.sort(function (a, b) { return a.p.length - b.p.length || (a.p < b.p ? -1 : a.p > b.p ? 1 : 0); });
    return out.filter(function (f, i) { return !i || f.p !== out[i - 1].p; });
  }
  /* Every P-1 factor of n once, in the order found: {F: as reported, parts: its primes when P-1 found several in
     the same run and reported their product, rec: the run}. A result line may report several, comma-separated. */
  function p1List(n, shard, pm1) {
    var pf = shard && shard.pm1f ? shard.pm1f[n] : null, seen = {}, out = [];
    pm1.forEach(function (r) {
      if (!r[3]) return;
      String(r[3]).split(',').forEach(function (F) {
        if (!F || seen[F]) return;
        seen[F] = true;
        // data from before every factor was kept: the primes of the first factor, as a list
        var parts = pf ? (Array.isArray(pf) ? (out.length ? null : pf) : pf[F] || null) : null;
        out.push({ F: F, parts: parts, rec: r });
      });
    });
    return out;
  }
  function p1Primes(list) { return list.reduce(function (k, x) { return k + (x.parts ? x.parts.length : 1); }, 0); }
  // whether a sieve slice found a factor above 10^7 for m
  function hasBig(ff, shard, m) {
    if (ff && ff.slices) return ff.slices.some(function (x) { return !!(x.f && x.f[m]); });
    return !!(shard && shard.sf && shard.sf[m]);
  }
  function countText(k) { return k === 1 ? '1 known factor' : fmt(k) + ' known factors'; }

  /* "p from 10¹³ to 2.4×10¹³": the p ranges a row not sieved from p = 2 yet has been sieved for */
  function partText(row) {
    var sp = row && row.sieve_part;
    if (!sp || !sp.p || !sp.p.length) return 'part of the p range';
    return 'p from ' + sp.p.map(function (x) { return S.depth(x[0]) + ' to ' + S.depth(x[1]); }).join(' and ');
  }

  /* ---------- painting ---------- */
  function paint(my, n, info) {
    if (my !== token) return;
    var kind = info.kind, valid = typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n;
    var none = ['even', 'neg', 'out', 'bad'].indexOf(kind) >= 0;
    document.getElementById('exp-main').hidden = none;
    document.getElementById('exp-none').hidden = !none;
    if (none) return paintNone(n, kind);
    var row = valid && n < 1e7 && n >= 0 ? rowOf(n) : null;
    var rangeLabel = row ? S.rangeLabel(row.lo, row.hi) : '—';
    var site = ctx.site, M = ctx.M;
    document.title = (valid ? 'n = ' + fmt(n) : 'Exponent') + ' · 2ⁿ−25 Prime Search';
    crumbs(rangeLabel, 'n = ' + (valid ? fmt(n) : String(n)));
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
    var nFac = (info.factors || []).length, nP1 = info.p1 ? p1Primes(info.p1) : 0;
    var hasText = function (k) { return k > 1 ? 'Has ' + fmt(k) + ' known factors.' : 'Has a known factor.'; };
    // in a range sieved twice: what the second sieve added to the P-1 factors, or to a PRP test that found no factor
    var again = info.before && nFac ? 'The second sieve, to ' + S.depth(depth) + ', found ' + (nFac === 1 ? 'one more' : fmt(nFac) + ' more') +
      (info.struck ? ' on ' + S.when(info.struck) : '') + '.' : '';
    var later = info.before && info.oldSurvivor ? 'It survived the first sieve, to ' + S.depth(info.before.depth) +
      ((info.prp || []).length ? ', and a PRP test showed 2ⁿ − 25 composite' : '') + '. The second sieve, to ' + S.depth(depth) + ', found ' +
      (nFac > 1 ? 'its factors' : 'its factor') + (info.struck ? ' on ' + S.when(info.struck) : '') + '.' : '';
    // struck out by the first sieve, which kept none of its factors: the second sieve found them
    var fresh = info.before && !info.oldSurvivor && nFac && !(info.firstKept || []).length ? 'The sieve to ' + S.depth(depth) + ' found ' +
      (nFac > 1 ? 'its factors' : 'its factor') + (info.struck ? ' on ' + S.when(info.struck) : '') + '.' : '';
    var V = {
      comp: ['Is composite.', 'The PRP-3 residue is not 1, so 2ⁿ − 25 is not prime. No factor is known.', 'good'],
      p1: [hasText(nP1 + nFac), 'P-1 found a factor, so no PRP test was needed.' + (again ? ' ' + again : ''), 'good'],
      sieve: [hasText(nFac), later || fresh ||
        'The sieve struck it out' + (info.struck || (row && row.sieve && row.sieve.end) ? ' on ' + S.when(info.struck || row.sieve.end) : '') + ', before any P-1 or PRP work.', 'good'],
      'sieve-big': ['Has a known factor.', 'The sieve to ' + S.depth(depth) + ' struck it out; its factor lies between 10⁷ and ' + S.depth(depth) + ' and is not stored.', 'good'],
      future: ['Has a small factor.', 'Trial division on this page finds it; the first sieve pass will remove this n.', 'good'],
      'sieve-part': ['Has a known factor.', 'The sieve found it while sieving ' + partText(row) + '. The sieve of the smaller p is still running.', 'good'],
      prime: ['Is a probable prime!', 'Prime ' + (pIdx + 1) + ' of the ' + ctx.primes.length + ' known, in order of n.' + (pInfo.rank ? ' Top PRP ' + pInfo.rank + ' in PRP Records as of ' + ctx.rankDate + '.' : ''), 'prime'],
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
    paintProps(n, valid, row);
    paintStrip(n, info, row);
  }

  /* Ranges / <range> / n = …; an n outside the search has no range, so that crumb is left out */
  function crumbs(range, last) {
    var r = document.getElementById('crumb-range'), sep = document.getElementById('crumb-sep');
    r.textContent = range || '';
    r.hidden = sep.hidden = !range;
    document.getElementById('crumb-n').textContent = last;
  }

  /* An n outside the search (even, below 5, 10^7 or more, or not a whole number): say so, and link the nearest odd n. */
  function paintNone(n, kind) {
    var num = typeof n === 'number' && Number.isFinite(n);
    var label = num ? 'n = ' + (Math.abs(n) < 1e15 ? fmt(n) : String(n)) : '“' + esc(String(n).slice(0, 40)) + '”';
    document.title = (num ? label : 'Exponent') + ' does not exist · 2ⁿ−25 Prime Search';
    crumbs(null, num ? label : String(n).slice(0, 40));
    var hdr = document.getElementById('hdr-n');
    if (hdr && document.activeElement !== hdr) hdr.value = num ? String(n) : '';
    var near = [];
    if (kind === 'even') {
      if (n - 1 >= 5) near.push(n - 1);
      if (n + 1 < 1e7) near.push(n + 1);
    } else if (num) {
      var below = 2 * Math.floor((n - 1) / 2) + 1, best = n - below <= below + 2 - n ? below : below + 2;
      near.push(Math.min(9999999, Math.max(5, best)));
    }
    document.getElementById('none-title').innerHTML = label + ' does not exist';
    document.getElementById('none-why').innerHTML = {
      even: 'The search covers odd n only. For even n, 2<sup>n</sup> − 25 = (2<sup>n/2</sup> − 5)(2<sup>n/2</sup> + 5), so it is never prime.',
      neg: '2<sup>n</sup> − 25 is negative for n below 5, so the search starts at n = 5.',
      out: 'The search and its database cover n below 10,000,000.',
      bad: 'Enter a whole number from 5 to 9,999,999.'
    }[kind] + (near.length ? ' The nearest odd n ' + (near.length > 1 ? 'are' : 'is') + ':' : '');
    document.getElementById('none-near').innerHTML = near.map(function (m) {
      return navButton(m, near.length > 1 ? (m < n ? 'Odd n below' : 'Odd n above') : 'Nearest odd n',
        m < n ? '← ' + fmt(m) : fmt(m) + ' →', 'n = ' + fmt(m));
    }).join('');
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
        // not sieved from the small primes yet: trial division here, and the factors of any sieve slice
        var blockLo = Math.floor(m / 100000) * 100000;
        return Promise.all([S.shard(m, ctx.sum.shards), S.factorFile(m, ctx.sum.factor_files)]).then(function (got) {
          while (m >= Math.max(5, blockLo) && m < Math.min(1e7, blockLo + 100000)) {
            if (++tries > 2000) return null;
            if (!ctx.primeInfo[m] && !hasBig(got[1], got[0], m) && !S.smallestFactor(m, TRIAL)) return m;
            m += 2 * dir;
          }
          return walk();
        });
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
    // the PRP tests n had, with whether the residues match, and its proof file
    var prpTests = function () {
      var seen = {}, out = [];
      info.prp.forEach(function (x, i) {
        var match = x[2] && seen[x[2]];
        out.push(['PRP-3' + (info.prp.length > 1 ? ' #' + (i + 1) : ''), x[2] || '—', state(match ? 'Matches, verified' : 'Composite', match ? 'good' : '')]);
        if (x[2]) seen[x[2]] = true;
      });
      var withProof = info.prp.filter(function (x) { return x[4]; })[0];
      out.push(['Proof', withProof ? 'power ' + withProof[4] + (withProof[5] ? ' · md5 ' + esc(withProof[5]) + '…' : '') : '—',
        withProof ? state('Kept · not certified yet', 'muted') : '—']);
      return out;
    };
    if (kind === 'comp') {
      var r = info.prp[info.prp.length - 1];
      band = ['good', 'composite · 0 primality tests remaining'];
      line = 'PRP-3 result ' + esc(r[0]) + ' UTC · ' + esc(user(shard, r, 7)) + ' · ' + esc(program(shard, r, 6));
      tests = prpTests();
      banner = ['', 'No factor known'];
    } else if (kind === 'p1') {
      var f = info.factorRec;
      band = ['good', 'factored · 0 primality tests remaining'];
      line = 'P-1 factor ' + esc(f[0]) + ' UTC · ' + esc(user(shard, f, 5)) + ' · ' + esc(program(shard, f, 4));
      tests = notNeeded;
      banner = ['', countText(p1Primes(info.p1) + (info.factors || []).length) + ' · cofactor not tested'];
    } else if (kind === 'sieve' || kind === 'sieve-big') {
      band = ['good', 'factored · 0 primality tests remaining'];
      // in a range sieved twice: the first sieve removed n and kept a factor, or the second sieve found the first one kept
      var first = info.before && (info.firstKept || []).length;
      var by = first ? info.before.program : row.sieve.program;
      line = (info.oldSurvivor ? 'Factor found by the second sieve' : info.before && !first ? 'Factor found by the sieve' : 'Removed by the sieve') +
        (info.struck || row.sieve.end ? ' ' + S.when(info.struck || row.sieve.end) : '') + (by ? ' · ' + esc(S.prog(by)) : '');
      tests = (info.prp || []).length ? prpTests() : notNeeded;
      banner = ['', kind === 'sieve' ? countText(info.factors.length) + ' · cofactor not tested' : 'Factor between 10⁷ and ' + S.depth(depth) + ' · not stored'];
    } else if (kind === 'sieve-part') {
      band = ['good', 'factored · 0 primality tests remaining'];
      var sp = row.sieve_part || {};
      line = 'Removed by the sieve' + (info.struck || sp.end ? ' ' + S.when(info.struck || sp.end) : '') + ' · ' + partText(row);
      tests = notNeeded;
      banner = ['', countText(info.factors.length) + ' · cofactor not tested'];
    } else if (kind === 'future') {
      band = ['accent', 'will be removed by the sieve · no test needed'];
      var act = site.active || {};
      line = n >= act.lo && n < act.hi ? 'Queued: ' + S.supHTML(esc(stage0.title)) + (stage0.where ? ' · ' + S.supHTML(esc(stage0.where)) : '') : 'Not assigned yet; the first sieve pass will remove it';
      lineCls = 'accent';
      tests = notNeeded;
      banner = ['', countText(info.factors.length) + ' · cofactor not tested'];
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
      banner = ['prime', pInfo.rank ? 'Top PRP ' + esc(pInfo.rank) + ' (PRP Records, ' + esc(ctx.rankDate) + ') · prime ' + k + ' of ' + ctx.primes.length
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
      line = kind === 'queued' ? 'Queued: ' + S.supHTML(esc(stage0.title)) + (stage0.where ? ' · ' + S.supHTML(esc(stage0.where)) : '') : 'Not assigned yet';
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
    var show = row && ['comp', 'p1', 'sieve', 'sieve-big', 'sieve-part', 'untested', 'future', 'queued', 'todo'].indexOf(kind) >= 0 && n > 13;
    card.hidden = !show;
    if (!show) return;
    var tg = S.sieveTarget(ctx.site, n), target = tg.target;
    var plan = tg.note ? tg.note : 'Target is today’s plan for new ranges: sieve to ' + S.depth(target) + ' and skip P-1, which stopped paying off once the sieve went deep.';
    var K = row.survivor_K || ctx.M.K;
    var sTgt = 1 - K / Math.log(target);
    var pct = function (x) { return (x * 100).toFixed(2) + ' %'; };
    var sign = function (x, s) {
      x = Math.round(x * 1e6) / 1e6;     // a difference of 0 that rounding made −0.000001 is still 0
      return '<td class="r ' + (x >= 0 ? 'pos' : 'neg') + '">' + (x >= 0 ? '+' : '−') + s + '</td>';
    };
    // a limit against the target in powers of ten: 3.5×10¹³ against 10¹⁴ is −0.46
    var decCell = function (d) {
      var r = Math.round(d * 100) / 100;
      var t = (r > 0 ? '+' : r < 0 ? '−' : '') + (Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(2));
      return '<td class="r ' + (r >= 0 ? 'pos' : 'neg') + '" title="Limit ÷ target = 10^' + t + '">' + t + '</td>';
    };
    var cell = function (v) { return '<td class="r">' + v + '</td>'; };
    var rows = [];
    var scope, note;
    if (row.sieved) {
      var surv = row.survivors || 0, odd = row.odd, before = row.sieve_before;
      var sAct = 1 - surv / odd;
      // sieved twice: P-1 ran after the first sieve; on top of the second it adds the n it factored that this one left
      var p1Left = before ? (row.pm1.after_sieve || 0) : row.pm1.factors;
      var ranP1 = row.pm1.runs > 0 && (!/^sieve/.test(kind) || !!(info.pm1 && info.pm1.length));
      var pAct = ranP1 ? (before ? (surv ? p1Left / surv : 0) : row.pm1.factors / row.pm1.runs) : 0;
      var cAct = ranP1 ? 1 - (surv - p1Left) / odd : sAct;
      var own = info.pm1 && info.pm1[0];
      var b1 = own ? own[1] : (ranP1 ? row.pm1.b1 : 0);
      var b2 = own ? own[2] : (ranP1 ? row.pm1.b2_median : 0);
      var b2Text = b1 ? (b2 ? (own ? '' : '≈ ') + fmt(b2) : 'stage 1 only') : '—';
      var dec = Math.log10(row.sieve.depth / target);
      rows.push('<tr><th class="text" scope="row">Actual</th>' + cell(S.depth(row.sieve.depth)) + cell(pct(sAct)) + cell(b1 ? fmt(b1) : '—') + cell(b2Text) +
        cell(ranP1 ? pct(pAct) : '—') + cell(pct(cAct)) + '</tr>');
      rows.push('<tr class="alt"><th class="text" scope="row">Target</th>' + cell(S.depth(target)) + cell(pct(sTgt)) + cell('—') + cell('—') + cell('—') + cell(pct(sTgt)) + '</tr>');
      rows.push('<tr><th class="text" scope="row">Difference</th>' + decCell(dec) + sign(sAct - sTgt, pct(Math.abs(sAct - sTgt))) +
        (b1 ? sign(1, fmt(b1)) : cell('—')) + (b1 && b2 ? sign(1, fmt(b2)) : cell('—')) + (ranP1 ? sign(1, pct(pAct)) : cell('—')) +
        sign(cAct - sTgt, pct(Math.abs(cAct - sTgt))) + '</tr>');
      scope = 'probabilities measured on ' + S.rangeLabel(row.lo, row.hi);
      note = before
        ? '* Share of odd n in ' + S.rangeLabel(row.lo, row.hi) + ' removed by that much work. The first sieve, to ' + S.depth(before.depth) + ', left ' +
          fmt(before.survivors) + ' of ' + fmt(odd) + (row.pm1.runs ? '; P-1 and the PRP tests ran on those' : '; the PRP tests ran on those') +
          '. The second sieve, to ' + S.depth(row.sieve.depth) + ', left ' + fmt(surv) + (ranP1 ? ', and P-1 had found a factor for ' + fmt(p1Left) + ' of them' : '') + '. ' + plan
        : '* Share of odd n in ' + S.rangeLabel(row.lo, row.hi) + ' removed by that much work: the sieve to ' + S.depth(row.sieve.depth) + ' left ' + fmt(surv) +
          ' of ' + fmt(odd) + (ranP1 ? ', then P-1 removed ' + fmt(row.pm1.factors) + ' of those ' + fmt(row.pm1.runs) : '') + '. ' + plan;
    } else {
      var sp = row.sieve_part;
      var act = ctx.site.active || {};
      scope = n >= act.lo && n < act.hi ? (ctx.site.stages || []).slice(0, 3).map(function (s) { return s.title.replace(/\^(\d+)/g, function (m, e) { return S.sup(e); }); }).join(', then ') : 'not started';
      if (sp && sp.p && sp.p.length && row.odd) {
        // sieved for part of the p range only: the share of odd n it found a factor for, and what the model expects for those p
        var share = sp.factored / row.odd;
        var expect = 1 - sp.p.reduce(function (k, x) { return k * Math.log(x[0]) / Math.log(x[1]); }, 1);
        var span = sp.p.map(function (x) { return S.depth(x[0]) + ' – ' + S.depth(x[1]); }).join(', ');
        rows.push('<tr><th class="text" scope="row">Actual</th>' + cell(span) + cell(pct(share)) + cell('—') + cell('—') + cell('—') + cell(pct(share)) + '</tr>');
        rows.push('<tr class="alt"><th class="text" scope="row">Target</th>' + cell(S.depth(target)) + cell(pct(sTgt)) + cell('—') + cell('—') + cell('—') + cell(pct(sTgt)) + '</tr>');
        rows.push('<tr><th class="text" scope="row">Difference</th>' + cell('—') + sign(share - sTgt, pct(Math.abs(share - sTgt))) + cell('—') + cell('—') + cell('—') +
          sign(share - sTgt, pct(Math.abs(share - sTgt))) + '</tr>');
        note = '* Share of odd n in ' + S.rangeLabel(row.lo, row.hi) + ' removed by that much work. So far the sieve has covered ' + partText(row).replace(/<[^>]+>/g, '') +
          ' only, and found a factor for ' + fmt(sp.factored) + ' of the ' + fmt(row.odd) + ' odd n (the survivor model expects ' + pct(expect) +
          '). The sieve of the smaller p is still running. ' + plan;
      } else {
        rows.push('<tr><th class="text" scope="row">Actual</th>' + cell('—') + cell('0.00 %') + cell('—') + cell('—') + cell('—') + cell('0.00 %') + '</tr>');
        rows.push('<tr class="alt"><th class="text" scope="row">Target</th>' + cell(S.depth(target)) + cell(pct(sTgt)) + cell('—') + cell('—') + cell('—') + cell(pct(sTgt)) + '</tr>');
        rows.push('<tr><th class="text" scope="row">Difference</th>' + decCell(-Math.log10(target)) + sign(-1, pct(sTgt)) + cell('—') + cell('—') + cell('—') + sign(-1, pct(sTgt)) + '</tr>');
        var odd7 = 700000;
        note = '* Expected share of odd n removed, from the survivor model (survivors fall like ' + ctx.M.K + ' / ln p). For 700,000 odd n that leaves about ' +
          fmt(Math.round(ctx.M.survivors(odd7, 1e12) / 100) * 100) + ' at 10¹² and ' + fmt(Math.round(ctx.M.survivors(odd7, target) / 100) * 100) + ' at ' + S.depth(target) + '.';
      }
    }
    document.getElementById('fx-scope').textContent = scope;
    document.getElementById('fx').innerHTML = '<table class="data"><thead><tr><th rowspan="2"></th><th class="group" colspan="2">Sieve</th><th class="group" colspan="3">P-1 factoring</th><th class="group">Combined</th></tr>' +
      '<tr><th class="r">Limit p</th><th class="r">Probability*</th><th class="r">B1</th><th class="r">B2</th><th class="r">Probability*</th><th class="r">Probability*</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table>';
    document.getElementById('fx-note').textContent = note;
  }

  // a long number with a line break allowed after each comma (copies without extra characters)
  function wrapBig(v) { return S.fmtBig(v).replace(/,/g, ',<wbr>'); }

  function powText(fs) {
    return fs.map(function (x) { return S.fmtBig(x[0]) + (x[1] > 1 ? S.sup(x[1]) : ''); }).join(' × ');
  }

  // log2 of a factor given as a decimal string (it may be beyond 2^53)
  function bitsOf(s) { return s.length > 15 ? Math.log2(Number(s.slice(0, 15))) + (s.length - 15) * Math.log2(10) : Math.log2(Number(s)); }

  function factorRow(pStr, date, how, who, bound) {
    var p = BigInt(pStr);
    var bits = bitsOf(pStr).toFixed(3);
    var row = { p: S.fmtBig(pStr), digits: pStr.length, bits: bits, date: date, how: how, who: who, pm1: '—', b1: '—', b2: '—' };
    if (!S.isProbablePrime(p)) {
      row.pm1 = 'composite factor';
      return row;
    }
    var fz = S.factorize(p - BigInt(1), bound);
    row.pm1 = powText(fz.factors) + (fz.rest ? ' × <span title="Composite, not factored further on this page">(' + S.fmtBig(fz.rest) + ')</span>' : '');
    if (fz.rest) return row;
    var mb = S.minB(fz.factors);
    row.b1 = S.fmtBig(mb[0]);
    row.b2 = mb[1] ? S.fmtBig(mb[1]) : '—';
    return row;
  }

  function paintFactors(n, info, row) {
    var kind = info.kind, out = [], sum = '', text = '';
    if (kind === 'p1') {
      var bitsKnown = 0, primes = p1Primes(info.p1);
      info.p1.forEach(function (x) {
        var f = x.rec, bound = Math.max(1000, Math.min(f[1] || 1e6, 2e6));
        var day = S.when(f[0]), who = user(info.shard, f, 5);
        bitsKnown += bitsOf(x.F);
        // when P-1 reported the product of several primes found in the same run, each prime gets its own row
        (x.parts || [x.F]).forEach(function (q) { out.push(factorRow(String(q), day, 'P-1', who, bound)); });
      });
      (info.factors || []).forEach(function (f) {
        var x = f.src;
        out.push(factorRow(f.p, S.when(x && x.end ? x.end : row.sieve && row.sieve.end), 'TF',
          f.small ? '—' : x && info.ff ? info.ff.users[x.by] || ctx.site.credit : f.by || ctx.site.credit, 4000));
        bitsKnown += bitsOf(f.p);
        primes += 1;
      });
      sum = (primes === 1 ? '1 factor' : primes + ' prime factors' + (info.p1.length === 1 && !(info.factors || []).length ? ', found together' : '')) + ' · ' +
        bitsKnown.toFixed(1) + ' of ' + fmt(n) + ' bits known';
    } else if ((kind === 'sieve' || kind === 'future' || kind === 'sieve-part') && info.factors && info.factors.length) {
      // every factor the sieve found, each with the run that found it; those below 10^7 carry no name
      var known = 0, users = info.ff && info.ff.users ? info.ff.users : [];
      info.factors.forEach(function (f) {
        var x = f.src, who, date;
        if (x) {
          who = f.small ? '—' : users[x.by] || ctx.site.credit;
          date = S.when(x.end);
        } else if (kind === 'sieve') {
          // a range sieved before the factor files (or by the older sievers): the row's sieve
          who = f.small ? '—' : f.by || ctx.site.credit;
          date = S.when(row.sieve && row.sieve.end);
        } else if (f.small) {
          who = '—'; date = '—';             // trial division on this page
        } else {
          var part = row.sieve_part || {};
          who = f.by || ctx.site.credit; date = S.when(part.end);
        }
        out.push(factorRow(f.p, date, 'TF', who, 4000));
        known += bitsOf(f.p);
      });
      sum = out.length + (out.length === 1 ? ' factor · ' : ' factors · ') + known.toFixed(1) + ' of ' + fmt(n) + ' bits known';
      var limit = row && row.sieved && row.sieve ? row.sieve.depth : null;
      text = info.ff && info.ff.slices && info.ff.slices.length
        ? (row && row.sieved ? 'Every prime factor below the sieve limit, ' + S.depth(limit) + ', is listed: the sieve output keeps them all, and this page finds the ones below 10⁷ itself.'
          : 'The factors below 10⁷ come from trial division on this page, the rest from the sieve slices run so far (' + partText(row) + ').')
        : (row && row.sieved ? 'The factors below 10⁷ come from trial division on this page. The sieve that removed this n' +
          (row.sieve && row.sieve.program ? ' (' + S.prog(row.sieve.program) + ')' : '') + ' kept only its survivors, so a factor between 10⁷ and ' + S.depth(limit) + ' would not be on record.'
          : 'Trial division on this page goes up to 10⁷.');
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
        queued: 'None yet: no prime below 10⁷ divides it. The sieve will try every p up to ' + S.depth(S.sieveTarget(ctx.site, n).target) + '.',
        todo: 'None yet: no prime below 10⁷ divides it.'
      }[kind] || '—';
    }
    document.getElementById('fac-sum').textContent = sum;
    var html = '';
    if (out.length) {
      html = '<div class="table-wrap"><table class="data"><thead><tr><th class="r">Factor p</th><th class="r">Digits</th><th class="r">Bits</th><th>p − 1</th>' +
        '<th>Found</th><th>Method</th><th class="text">Who</th><th class="r">Min B1</th><th class="r">Min B2</th></tr></thead><tbody>' +
        out.map(function (r) {
          return '<tr><td class="r">' + r.p + '</td><td class="r">' + r.digits + '</td><td class="r">' + r.bits + '</td><td>' + r.pm1 +
            '</td><td>' + r.date + '</td><td>' + esc(r.how) + '</td><td class="text">' + esc(r.who) + '</td><td class="r">' + r.b1 + '</td><td class="r">' + r.b2 + '</td></tr>';
        }).join('') + '</tbody></table></div>' + (text ? '<p class="small">' + esc(text) + '</p>' : '');
    } else {
      html = '<p class="body">' + esc(text) + '</p>';
    }
    document.getElementById('factors').innerHTML = html;
  }

  // "factor 7" or "13 factors, listed above"
  function factorsText(fs) {
    return fs.length === 1 ? 'factor ' + wrapBig(fs[0].p) : fmt(fs.length) + ' factors, listed above';
  }
  // the date column: to the second where the result files have the time
  function stamp(ts) { return ts ? esc(String(ts).slice(0, 19).replace('T', ' ')) : '—'; }
  /* The second sieve of a range sieved twice, as a history row: every factor below its depth, the ones known
     before it (found by the first sieve, by P-1, or below 10⁷) marked as already known */
  function secondSieve(info, row) {
    var depth = row.sieve.depth, all = [], seen = {};
    var add = function (p, known) { if (!seen[p]) { seen[p] = true; all.push({ p: p, known: known }); } };
    (info.p1 || []).forEach(function (x) {
      (x.parts || [x.F]).forEach(function (q) { if (BigInt(String(q)) < BigInt(depth)) add(String(q), true); });
    });
    (info.factors || []).forEach(function (f) { add(f.p, f.small || !!(f.src && f.src.before)); });
    var k = all.filter(function (f) { return f.known; }).length;
    var result = !all.length ? 'no factor'
      : all.length === 1 ? 'factor ' + wrapBig(all[0].p) + (k ? ', already known' : '')
      : fmt(all.length) + ' factors, listed above' + (k === all.length ? ' · all already known' : k ? ' · ' + fmt(k) + ' already known' : '');
    return [stamp(row.sieve.end), 'Sieve', esc(S.prog(row.sieve.program)) || '—', 'every p &lt; ' + S.depth(depth), result];
  }
  /* ---------- history ---------- */
  // odd n (n ≥ 5) in [a, b)
  function oddIn(a, b) { return Math.max(0, Math.floor(b / 2) - Math.floor(Math.max(a, 5) / 2)); }
  function sig3(x) { return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2); }
  // run time: 49 s, 32 min 49 s, 8 h 50 min
  function runTime(s) {
    if (!(s > 0)) return '—';
    s = Math.round(s);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '');
    var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    return fmt(h) + ' h' + (m ? ' ' + m + ' min' : '');
  }
  // one n's share of a run: 45.5 ms, 1.13 s
  function perN(s) {
    if (!(s > 0)) return '—';
    return s < 1e-3 ? sig3(s * 1e6) + ' µs' : s < 1 ? sig3(s * 1e3) + ' ms' : s < 60 ? sig3(s) + ' s' : sig3(s / 60) + ' min';
  }
  // a p bound, exactly: 2, 10⁷, 2³², 1.25×10¹³, 2.4375×10¹³
  function pText(v) {
    v = Number(v);
    if (v < 1e4) return fmt(v);
    var d = S.depth(v);
    if (/^2[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/.test(d)) return d;
    var e = Math.floor(Math.log10(v) + 1e-9), m = Number((v / Math.pow(10, e)).toPrecision(6));
    return (m === 1 ? '' : m + '×') + '10' + S.sup(e);
  }
  // the n a run sieved: 3.6M – 5M, or to the unit where a station's block does not end on a round number
  function blockText(b) {
    var round = function (x) { return x % 100000 < 2; };   // an old origin.txt names both ends: 0 200000
    return round(b[0]) && round(b[1]) ? S.rangeLabel(b[0] - b[0] % 100000, b[1] - b[1] % 100000) : fmt(b[0]) + ' – ' + fmt(b[1] - 1);
  }
  // "Kelvinizer - w2g0": who sent the run, and the computer it ran on
  function whoAndComputer(h) {
    h = String(h || ctx.site.credit);
    var i = h.indexOf(' - ');
    return i > 0 ? [h.slice(0, i), h.slice(i + 3)] : [h, ''];
  }
  function runKey(x) { return [x.p[0], x.p[1], x.end || '', x.before ? 1 : 0].join('|'); }

  /* Every sieve run over n, from the slices of data/f/<x.x>.json that cover it, smallest p first; a slice the old
     sievers ran as several stations gives the stations whose n range holds n. Each run lists the factors of n it
     found: a run of the old sievers only those it kept, any other run every known factor in its p range, with
     what found it first when that was another run or P-1. */
  function sieveRuns(n, info, row) {
    var ff = info.ff, users = (ff && ff.users) || [], runs = [], seen = {};
    ((ff && ff.slices) || []).forEach(function (x) {
      var k = runKey(x);
      if (!(x.n[0] <= n && n < x.n[1]) || seen[k]) return;   // one run listed twice counts once
      seen[k] = true;
      var h = whoAndComputer(users[x.by]);
      var base = { key: k, who: h[0], computer: h[1], before: !!x.before, p: [Number(x.p[0]), Number(x.p[1])],
        pb: [BigInt(String(x.p[0])), BigInt(String(x.p[1]))],
        prog: x.prog || (x.before ? (info.before || {}).program : ((row && (row.sieve || row.sieve_part)) || {}).program) || '',
        st: x.st, end: x.end, s: x.s, block: x.rn || x.n };
      var st = (x.runs || []).filter(function (r) { return r.n && r.n[0] <= n && n < r.n[1]; });
      if (!st.length) runs.push(base);
      st.forEach(function (r) {
        var top = r.depth ? Number(r.depth) : base.p[1];
        runs.push(Object.assign({}, base, { computer: r.name || base.computer, prog: r.prog || base.prog, st: r.st, end: r.end || base.end,
          s: r.s, block: r.n, p: [base.p[0], top], pb: [base.pb[0], BigInt(String(r.depth || x.p[1]))] }));
      });
    });
    var known = (info.factors || []).map(function (f) { return { p: f.p, src: f.src }; });
    (info.p1 || []).forEach(function (x) {
      (x.parts || [x.F]).forEach(function (q) { known.push({ p: String(q), p1: x.rec }); });
    });
    runs.forEach(function (r) {
      r.found = known.filter(function (f) {
        if (r.before) return !!f.src && runKey(f.src) === r.key;   // the old sievers kept only some of their factors
        var q = BigInt(f.p);
        return q >= r.pb[0] && q < r.pb[1];
      }).map(function (f) {
        var first = f.p1 ? (!r.end || String(f.p1[0]) < String(r.end) ? 'P-1, ' + S.day(f.p1[0]) : '')
          : f.src && runKey(f.src) !== r.key ? (f.src.before ? 'the first sieve, ' + S.day(f.src.end) : 'the run of ' + S.day(f.src.end)) : '';
        return { p: f.p, first: first };
      });
    });
    runs.sort(function (a, b) { return a.p[0] - b.p[0] || (String(a.end) < String(b.end) ? -1 : String(a.end) > String(b.end) ? 1 : 0); });
    return runs;
  }
  // "every p below 5×10¹³", or the p ranges a row not sieved from p = 2 yet has been sieved for
  function coverage(runs) {
    var m = [];
    runs.map(function (r) { return [r.p[0], r.p[1]]; }).sort(function (a, b) { return a[0] - b[0]; }).forEach(function (x) {
      var l = m[m.length - 1];
      if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else m.push([x[0], x[1]]);
    });
    if (m.length === 1 && m[0][0] <= 7) return 'every p below ' + pText(m[0][1]);
    return 'p from ' + m.map(function (x) { return pText(x[0]) + ' to ' + pText(x[1]); }).join(' and from ');
  }
  /* The sieve runs as a table, the way mersenne.ca lists trial factoring: one row per run, with its p range, the
     factors of n it found, and its run time; a run sieves a whole block of n at once, so each n gets a share. */
  function sieveTable(info, runs) {
    var progs = [];
    runs.forEach(function (r) { if (r.prog && progs.indexOf(r.prog) < 0) progs.push(r.prog); });
    var showProg = progs.length > 1, showPC = runs.some(function (r) { return r.computer; });
    var anyKnown = runs.some(function (r) { return r.found.some(function (f) { return f.first; }); });
    var total = 0, share = 0, found = {};
    var body = runs.map(function (r) {
      var odd = r.block ? oddIn(r.block[0], r.block[1]) : 0, mine = r.s && odd ? r.s / odd : 0;
      total += r.s || 0;
      share += mine;
      r.found.forEach(function (f) { found[f.p] = true; });
      var lines = function (f) { return r.found.map(f).join('<br>'); };
      var when = 'Finished ' + String(r.end || '').slice(0, 19) + ' UTC' + (r.st ? '; started ' + String(r.st).slice(0, 19) : '');
      var tip = r.s ? fmt(Math.round(r.s)) + ' s of run time' + (odd ? ' for the ' + fmt(odd) + ' odd n in ' + blockText(r.block) : '') : '';
      return '<tr><td title="' + esc(when) + '">' + stamp(r.end) + '</td><td class="text">' + esc(r.who) + '</td>' +
        (showPC ? '<td class="text">' + (r.computer ? esc(r.computer) : '<span class="muted">—</span>') + '</td>' : '') +
        (showProg ? '<td class="text">' + (esc(S.prog(r.prog)) || '—') + '</td>' : '') +
        '<td class="r">' + pText(r.p[0]) + '</td><td class="r">' + pText(r.p[1]) + '</td>' +
        (r.found.length ? '<td class="r">' + lines(function (f) { return S.fmtBig(f.p); }) + '</td><td class="r">' + lines(function (f) { return f.p.length; }) +
          '</td><td class="r">' + lines(function (f) { return bitsOf(f.p).toFixed(3); }) + '</td>'
          : '<td class="r"><span class="muted">no factor</span></td><td></td><td></td>') +
        (anyKnown ? '<td class="text">' + lines(function (f) { return f.first ? '<span class="muted" title="Found first by ' + esc(f.first) + '">already known</span>' : '&nbsp;'; }) + '</td>' : '') +
        '<td class="r"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + runTime(r.s) + '</td><td>' + (r.block ? blockText(r.block) : '—') + '</td>' +
        '<td class="r">' + perN(mine) + '</td></tr>';
    }).join('');
    var lead = 2 + (showPC ? 1 : 0) + (showProg ? 1 : 0) + 2 + 3 + (anyKnown ? 1 : 0);
    var head = '<thead><tr><th rowspan="2">Date (UTC)</th><th class="text" rowspan="2">Who</th>' + (showPC ? '<th class="text" rowspan="2">Computer</th>' : '') +
      (showProg ? '<th class="text" rowspan="2">Program</th>' : '') + '<th class="group" colspan="2">p</th><th class="group" colspan="' + (anyKnown ? 4 : 3) + '">Factor found</th>' +
      '<th class="group" colspan="3">Run</th></tr><tr><th class="r">from</th><th class="r">to</th><th class="r">p</th><th class="r">digits</th><th class="r">bits</th>' +
      (anyKnown ? '<th></th>' : '') + '<th class="r">time</th><th>n sieved</th><th class="r">per n</th></tr></thead>';
    var foot = runs.length > 1 && total ? '<tfoot><tr><td class="text" colspan="' + lead + '">All ' + fmt(runs.length) + ' runs</td><td class="r">' + runTime(total) +
      '</td><td></td><td class="r">' + perN(share) + '</td></tr></tfoot>' : '';
    var k = Object.keys(found).length;
    var sum = (runs.length === 1 ? '1 run' : fmt(runs.length) + ' runs') + (progs.length === 1 ? ' of ' + esc(S.prog(progs[0])) : '') + ', ' + coverage(runs) +
      ' · ' + (k ? (k === 1 ? '1 factor' : fmt(k) + ' factors') + ' found' : 'no factor found');
    var note = 'A sieve run covers a whole block of n at once; per n is its run time divided by the odd n in that block.' +
      (anyKnown ? ' Already known: found first by another run or by P-1, which keeps the credit.' : '') +
      (info.kind === 'sieve-big' && !k ? ' The sieve removed this n, but its factor is not on record.' : '');
    return '<div class="hist-sec"><h3>Sieve</h3><p class="small">' + sum + '</p><div class="table-wrap"><table class="data hist-sieve">' + head + '<tbody>' + body +
      '</tbody>' + foot + '</table></div><p class="small">' + note + '</p></div>';
  }
  function paintHistory(n, info, row, pInfo, tiny) {
    var kind = info.kind, H = [], before = info.before, again = null;
    // the first sieve counts only with the factors it kept: for an n it struck out without keeping one, it gets no row
    var runs = row && !tiny && kind !== 'even' ? sieveRuns(n, info, row).filter(function (r) { return !r.before || info.oldSurvivor || r.found.length; }) : [];
    if (runs.length) {
      // one row per sieve run, in a table of its own
    } else if (row && row.sieved && !tiny && kind !== 'even' && before) {
      // sieved twice: the first sieve, then the P-1 and PRP work, then the second sieve (below). The first sieve
      // counts only with the factors it kept: for an n it struck out without keeping one, it gets no row
      var kept = info.firstKept || [];
      if (info.oldSurvivor || kept.length) {
        H.push([stamp(before.end), 'Sieve', esc(S.prog(before.program)) || '—', 'every p &lt; ' + S.depth(before.depth),
          info.oldSurvivor ? 'no factor' : factorsText(kept)]);
      }
      again = secondSieve(info, row);
    } else if (row && row.sieved && !tiny && kind !== 'even') {
      H.push([stamp(row.sieve.end), 'Sieve', esc(S.prog(row.sieve.program)) || '—', 'every p &lt; ' + S.depth(row.sieve.depth),
        info.factors && info.factors.length ? factorsText(info.factors) : kind === 'sieve-big' ? 'factor &gt; 10⁷' : 'no factor']);
    }
    if (!runs.length && row && !row.sieved && row.sieve_part && kind !== 'even') {
      H.push([stamp(row.sieve_part.end), 'Sieve', esc(S.prog(row.sieve_part.program || '')) || '—', partText(row),
        (info.factors || []).some(function (f) { return !f.small; }) ? factorsText(info.factors.filter(function (f) { return !f.small; })) : 'no factor']);
    }
    (info.pm1 || []).forEach(function (r) {
      var who = user(info.shard, r, 5), qs = [];
      // the primes this run found: a reported product of several primes counts as those primes
      String(r[3] || '').split(',').forEach(function (F) {
        var x = F ? (info.p1 || []).filter(function (y) { return y.F === F; })[0] : null;
        if (F) qs = qs.concat(x && x.parts ? x.parts.map(String) : [F]);
      });
      H.push([esc(r[0]), 'P-1', esc(program(info.shard, r, 4)) + (who !== ctx.site.credit ? ' · ' + esc(who) : ''),
        'B1 = ' + fmt(r[1]) + (r[2] ? ', B2 = ' + fmt(r[2]) : ', stage 1'),
        !qs.length ? 'no factor' : qs.length === 1 ? 'factor ' + wrapBig(qs[0]) : fmt(qs.length) + ' factors, listed above']);
    });
    (info.prp || []).forEach(function (r) {
      var who = user(info.shard, r, 7);
      H.push([esc(r[0]), 'PRP-3', esc(program(info.shard, r, 6)) + (who !== ctx.site.credit ? ' · ' + esc(who) : ''),
        'FFT ' + S.fft(r[3]) + (r[4] ? ' · proof power ' + r[4] : ''), r[1] === 'P' ? 'probable prime' : r[1] === 'R' ? 'reported probable prime' : 'composite · ' + esc(r[2])]);
    });
    if (kind === 'prime' && !tiny && !(info.prp || []).length) {
      H.push([esc(pInfo.found), 'PRP-3', esc(pInfo.program || ''), 'FFT ' + S.fft(pInfo.fft) + (pInfo.proof_power ? ' · proof power ' + pInfo.proof_power : ''), 'probable prime']);
    }
    if (again) H.push(again);
    var el = document.getElementById('history');
    if (runs.length || H.length) {
      var p1 = H.some(function (h) { return h[1] === 'P-1'; }), prp = H.some(function (h) { return h[1] !== 'P-1'; });
      el.innerHTML = (runs.length ? sieveTable(info, runs) : '') + (H.length ? '<div class="hist-sec">' +
        (runs.length ? '<h3>' + (p1 && prp ? 'P-1 and PRP' : p1 ? 'P-1' : 'PRP') + '</h3>' : '') +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Date (UTC)</th><th class="text">Work</th><th class="text">Program</th><th>Parameters</th><th>Result</th></tr></thead><tbody>' +
        H.map(function (h) { return '<tr><td>' + h[0] + '</td><td class="text">' + h[1] + '</td><td class="text">' + h[2] + '</td><td>' + h[3] + '</td><td class="wrap">' + h[4] + '</td></tr>'; }).join('') +
        '</tbody></table></div></div>' : '');
    } else {
      var t = { queued: 'No work yet. ' + ((ctx.site.stages && ctx.site.stages[0]) ? S.supHTML(esc(ctx.site.stages[0].title)) + ' is next.' : ''),
        future: 'No work yet; the first sieve pass will remove it.', todo: 'No work yet.', even: 'Never assigned: even n are excluded.',
        prime: 'Too small for the search programs; checked directly.' }[kind] || 'No work recorded.';
      el.innerHTML = '<p class="body">' + t + '</p>';
    }
  }

  function paintProps(n, valid, row) {
    var P = [];
    if (valid && n >= 5 && n < 1e7) {
      P = [
        ['n mod 6', String(n % 6) + (n % 2 === 0 ? ' (even)' : n % 6 === 5 && n > 5 ? ' (7 divides)' : '')],
        ['Binary', fmt(n - 5) + ' ones, then 00111'],
        ['Decimal', esc(decimal(n))],
        ['Data file', (ctx.sum.shards && ctx.sum.shards.indexOf(S.shardName(n)) < 0 ? '— <span class="muted">(nothing recorded yet)</span>'
          : '<a href="data/n/' + S.shardName(n) + '.json">data/n/' + S.shardName(n) + '.json</a>') +
          (ctx.sum.factor_files && ctx.sum.factor_files.indexOf(S.shardName(n)) >= 0
            ? ' · sieve factors <a href="data/f/' + S.shardName(n) + '.json">data/f/' + S.shardName(n) + '.json</a>' : '')]
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
        var pm = info.shard.pm1[m], pr = info.shard.prp[m] || [];
        var got = function (c) { return pr.some(function (r) { return r[1] === c; }); };
        // what is known now: a P-1 factor, a prime, a sieve factor (a second sieve finds some for PRP composites), else the PRP result
        if (pm && pm.some(function (r) { return r[3]; })) code = 'F';
        else if (got('P')) code = 'P';
        else if (got('R')) code = 'R';
        else if (!info.survivors.has(m)) code = 'S';
        else code = pr.length ? 'C' : 'U';
      } else {
        code = 'U';
        var value = m < 53 ? Math.pow(2, m) - 25 : Infinity;
        for (var k = 0; k < P.length; k++) {
          var p = P[k];
          if (p >= value) break;
          if (p === 2 || p === 5) continue;
          if (S.powmod(2, m, p) === 25 % p) { code = 'S'; break; }
        }
        if (code === 'U' && hasBig(info.ff, info.shard, m)) code = 'S';
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
