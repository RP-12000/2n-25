/* Ranges page: totals, stacked share bar, table of 1M groups that open into 0.2M rows. */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc;
  var state = { flat: false, open: {} };
  var data = null;

  S.all(['ranges', 'summary', 'site']).then(function (d) {
    data = { rows: d[0].rows, sum: d[1], site: d[2] };
    var frontierRow = data.rows.find(function (r) { return r.lo <= d[1].frontier && d[1].frontier < r.hi; });
    if (frontierRow) state.open[Math.floor(frontierRow.lo / 1e6)] = true;
    renderTotals();
    renderTable();
    renderNotes();
  }).catch(function (e) { S.fail('totals', e); });

  document.getElementById('by-1m').addEventListener('click', function () { setFlat(false); });
  document.getElementById('by-02m').addEventListener('click', function () { setFlat(true); });
  function setFlat(f) {
    state.flat = f;
    document.getElementById('by-1m').setAttribute('aria-pressed', String(!f));
    document.getElementById('by-02m').setAttribute('aria-pressed', String(f));
    if (data) renderTable();
  }

  function renderTotals() {
    var c = data.sum.counts, pf = p1Count(c), pt = prpTotal();
    var items = [
      ['Odd n tracked', c.odd], ['Removed by sieve', c.removed_by_sieve], ['Removed by P-1', pf],
      ['PRP-tested', pt, prpTitle(c.prp_tests, pt, true)], ['Primes', c.primes], ['Unresolved', c.unresolved]
    ];
    document.getElementById('totals').innerHTML = items.map(function (t) {
      return '<div' + (t[2] ? ' title="' + esc(t[2]) + '"' : '') + '><div class="eyebrow">' + t[0] + '</div><div class="v">' + fmt(t[1]) + '</div></div>';
    }).join('');
    var s = c.removed_by_sieve / c.odd, f = pf / c.odd, p = (c.resolved - c.removed_by_sieve - pf) / c.odd;
    document.getElementById('stack').innerHTML =
      '<i class="s" style="width:' + (s * 100).toFixed(2) + '%"></i><i class="f" style="width:' + (f * 100).toFixed(2) + '%"></i><i class="c" style="width:' + (p * 100).toFixed(2) + '%"></i>';
    document.getElementById('stack-legend').innerHTML =
      '<span><i class="key s" aria-hidden="true"></i>Sieve factor ' + S.pct(s) + '</span>' +
      '<span><i class="key f" aria-hidden="true"></i>P-1 factor ' + S.pct(f) + '</span>' +
      '<span><i class="key c" aria-hidden="true"></i>PRP composite or prime ' + S.pct(p) + '</span>' +
      '<span><i class="key open" aria-hidden="true"></i>Not yet resolved ' + S.pct(c.unresolved / c.odd) + '</span>';
  }

  /* The n P-1 removed: in a range sieved twice, those the second sieve left (it found a factor below its depth for
     the others, and the n counts as removed by the sieve) */
  function p1Count(c) { return c.pm1_after_sieve !== undefined ? c.pm1_after_sieve : c.pm1_factors; }
  function p1Of(r) { return r.pm1.after_sieve !== undefined ? r.pm1.after_sieve : r.pm1.factors || 0; }
  /* The n a PRP test settled, each n once: in a range sieved twice, the second sieve found a factor for some n that a
     PRP test had already shown composite, and those count as removed by the sieve. What is left besides the sieve and
     P-1 there are the PRP-tested n, and the small primes n = 5, 7, 9 and 13, checked directly. */
  function prpOf(r) {
    if (r.subs) return r.prp.n;
    return r.sieve_before ? Math.max(0, (r.resolved || 0) - (r.removed_by_sieve || 0) - p1Of(r)) : r.prp.tests || 0;
  }
  function prpTotal() { return data.rows.reduce(function (s, r) { return s + prpOf(r); }, 0); }
  function smallIn(lo, hi) { return (data.site.small_primes || []).filter(function (p) { return lo <= p.n && p.n < hi; }).map(function (p) { return p.n; }); }
  function prpTitle(tests, shown, all, lo, hi) {
    var small = all ? smallIn(0, 1e7) : smallIn(lo, hi);
    var refound = tests + small.length - shown;
    if (refound <= 0) return '';
    return 'PRP tests ran on ' + fmt(tests) + ' n; for ' + fmt(refound) + ' of them the second sieve has since found a factor, so they count under the sieve.' +
      (small.length ? ' Also counted here: n = ' + small.join(', ').replace(/, (\d+)$/, ' and $1') + ', where 2ⁿ − 25 is a small prime checked directly.' : '');
  }
  function share(r) {
    var sv = r.removed_by_sieve || 0, pf = p1Of(r);
    var pr = Math.max(0, (r.resolved || 0) - sv - pf);
    return { s: sv / r.odd, f: pf / r.odd, c: pr / r.odd, all: (r.resolved || 0) / r.odd };
  }
  function minibar(sh) {
    return '<span class="minibar" aria-hidden="true"><i class="s" style="width:' + (sh.s * 100).toFixed(1) + '%"></i><i class="f" style="width:' +
      (sh.f * 100).toFixed(1) + '%"></i><i class="c" style="width:' + (sh.c * 100).toFixed(1) + '%"></i></span>' + pctLabel(sh.all);
  }
  function pctLabel(x) { return x >= 0.9995 ? '100%' : x <= 0 ? '0%' : (x * 100).toFixed(x < 0.1 ? 2 : 1) + '%'; }
  function statusCell(r) {
    var badge = data.site.active && data.site.active.badge ? data.site.active.badge : 'Queued for the sieve';
    if (r.status === 'done') return '<span class="pill good"><span class="dot"></span>Done ' + esc(r.done || '') + '</span>';
    if (r.status === 'prp') return '<span class="pill accent">PRP · ' + fmt(r.untested) + ' left</span>';
    if (r.status === 'sieve') return '<span class="pill accent">' + esc(badge) + '</span>';
    return '<span class="pill muted">Not started</span>';
  }
  function dash(v) { return v ? fmt(v) : '—'; }
  function prpCell(r) {
    var n = prpOf(r), tests = r.subs ? r.prp.tests : r.prp.tests || 0;
    if (!n && !r.sieved) return '<td class="r">—';
    var t = prpTitle(tests, n, false, r.lo, r.hi);
    return '<td class="r"' + (t ? ' title="' + esc(t) + '"' : '') + '>' + fmt(n);
  }
  function rowCells(label, r, depthText) {
    return '<td>' + label + '</td><td class="r">' + fmt(r.odd) + '</td><td class="r">' + depthText + '</td><td class="r">' +
      (r.sieved ? fmt(r.removed_by_sieve) : '—') + '</td><td class="r"' + (r.pm1.after_sieve !== undefined && r.pm1.factors ? ' title="' + esc('P-1 found a factor for ' + fmt(r.pm1.factors) +
        ' n; the second sieve found one below ' + S.depth(r.sieve.depth) + ' for ' + fmt(r.pm1.factors - r.pm1.after_sieve) + ' of them') + '"' : '') + '>' + dash(p1Of(r)) + '</td>' +
      prpCell(r) + '</td><td class="r">' + (r.prp.primes || r.sieved ? fmt(r.prp.primes) : '—') +
      '</td><td>' + minibar(share(r)) + '</td><td class="text">' + statusCell(r) + '</td>';
  }

  function groups() {
    var out = [];
    for (var m = 0; m < 10; m++) {
      var subs = data.rows.filter(function (r) { return Math.floor(r.lo / 1e6) === m; });
      if (!subs.length) continue;
      var g = { lo: m * 1e6, hi: (m + 1) * 1e6, odd: 0, removed_by_sieve: 0, resolved: 0, untested: 0, sieved: subs.some(function (r) { return r.sieved; }),
        pm1: { factors: 0 }, prp: { tests: 0, n: 0, primes: 0 }, subs: subs };
      subs.forEach(function (r) {
        g.odd += r.odd; g.removed_by_sieve += r.removed_by_sieve || 0; g.resolved += r.resolved || 0; g.untested += r.untested || 0;
        g.pm1.factors += p1Of(r); g.prp.tests += r.prp.tests || 0; g.prp.n += prpOf(r); g.prp.primes += r.prp.primes || 0;
      });
      var st = subs.map(function (r) { return r.status; });
      if (st.every(function (s) { return s === 'done'; })) { g.status = 'done'; g.done = subs.map(function (r) { return r.done || ''; }).sort().pop(); }
      else if (st.every(function (s) { return s === 'todo'; })) g.status = 'todo';
      else g.status = st.indexOf('prp') >= 0 ? 'prp' : 'sieve';
      var depths = subs.filter(function (r) { return r.sieve && r.sieve.depth; }).map(function (r) { return r.sieve.depth; });
      g.depthText = depths.length ? (Math.min.apply(null, depths) === Math.max.apply(null, depths) ? S.depth(depths[0]) :
        S.depth(Math.min.apply(null, depths)) + ' – ' + S.depth(Math.max.apply(null, depths))) : '—';
      out.push(g);
    }
    return out;
  }

  function groupStatus(g) {
    if (g.status === 'done') return '<span class="pill good"><span class="dot"></span>Done ' + esc(g.done) + '</span>';
    if (g.status === 'todo') return '<span class="pill muted">Not started</span>';
    if (g.status === 'prp') return '<span class="pill accent">' + pctLabel(g.resolved / g.odd) + ' · PRP running</span>';
    var badge = data.site.active && data.site.active.badge ? data.site.active.badge : 'Queued for the sieve';
    return '<span class="pill accent">' + pctLabel(g.resolved / g.odd) + ' · ' + esc(badge.toLowerCase()) + '</span>';
  }

  function renderTable() {
    var head = '<table class="data"><thead><tr><th>Range of n</th><th class="r">Odd n</th><th class="r">Sieved to p</th><th class="r">Sieve factor</th>' +
      '<th class="r">P-1 factor</th><th class="r">PRP-tested</th><th class="r">Primes</th><th>Resolved</th><th class="text">Status</th></tr></thead><tbody>';
    var body = [];
    if (state.flat) {
      data.rows.forEach(function (r) {
        body.push('<tr>' + rowCells(S.rangeLabel(r.lo, r.hi), r, r.sieve && r.sieve.depth ? S.depth(r.sieve.depth) : '—') + '</tr>');
      });
    } else {
      groups().forEach(function (g) {
        var key = g.lo / 1e6, open = !!state.open[key];
        var btn = '<button type="button" class="caret" data-g="' + key + '" aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse ' : 'Expand ') +
          S.rangeLabel(g.lo, g.hi) + '">' + (open ? '−' : '+') + '</button>';
        var cells = rowCells(btn + S.rangeLabel(g.lo, g.hi), g, g.depthText);
        cells = cells.replace(/<td class="text">[\s\S]*<\/td>$/, '<td class="text">' + groupStatus(g) + '</td>');
        body.push('<tr>' + cells + '</tr>');
        if (open) {
          g.subs.forEach(function (r) {
            body.push('<tr class="sub">' + rowCells(S.rangeLabel(r.lo, r.hi), r, r.sieve && r.sieve.depth ? S.depth(r.sieve.depth) : '—') + '</tr>');
          });
        }
      });
    }
    var c = data.sum.counts;
    var pf = p1Count(c);
    var tot = { s: c.removed_by_sieve / c.odd, f: pf / c.odd, c: (c.resolved - c.removed_by_sieve - pf) / c.odd, all: c.resolved / c.odd };
    var foot = '</tbody><tfoot><tr><td class="text">Total &lt; 10<sup>7</sup></td><td class="r">' + fmt(c.odd) + '</td><td></td><td class="r">' +
      fmt(c.removed_by_sieve) + '</td><td class="r">' + fmt(pf) + '</td><td class="r">' + fmt(prpTotal()) + '</td><td class="r">' +
      fmt(c.primes) + '</td><td>' + minibar(tot) + '</td><td></td></tr></tfoot></table>';
    var wrap = document.getElementById('range-table');
    wrap.innerHTML = head + body.join('') + foot;
    Array.prototype.forEach.call(wrap.querySelectorAll('button.caret'), function (b) {
      b.addEventListener('click', function () {
        var k = Number(b.getAttribute('data-g'));
        state.open[k] = !state.open[k];
        renderTable();
        var again = document.querySelector('button.caret[data-g="' + k + '"]');
        if (again) again.focus();
      });
    });
  }

  function renderNotes() {
    var sieved = data.rows.filter(function (r) { return r.sieve && r.sieve.depth; });
    if (sieved.length) {
      var lo = Math.min.apply(null, sieved.map(function (r) { return r.sieve.depth; }));
      var hi = Math.max.apply(null, sieved.map(function (r) { return r.sieve.depth; }));
      var progs = [];
      sieved.forEach(function (r) { if (r.sieve.program && progs.indexOf(r.sieve.program) < 0) progs.push(r.sieve.program); });
      // ranges sieved twice: the old sievers first (before P-1 and PRP), then a second, deeper sieve
      var twice = sieved.filter(function (r) { return r.sieve_before; }), firstText = '';
      if (twice.length) {
        var bp = [], bd = twice.map(function (r) { return r.sieve_before.depth; });
        twice.forEach(function (r) { var q = r.sieve_before.program; if (q && bp.indexOf(q) < 0) bp.push(q); });
        // 2^n-25 Siever 1.0, 1.1, 2.0 and 3.0 -> 2ⁿ−25 Siever 1.0 – 3.0
        var vm = bp.map(function (q) { return /^(.*?)\s+v?(\d[\w.]*)$/.exec(q); });
        if (bp.length > 2 && vm.every(function (m) { return m && m[1] === vm[0][1]; })) bp = [vm[0][1] + ' ' + vm[0][2] + ' – ' + vm[vm.length - 1][2]];
        var t0 = Math.min.apply(null, twice.map(function (r) { return r.lo; })), t1 = Math.max.apply(null, twice.map(function (r) { return r.hi; }));
        var b0 = Math.min.apply(null, bd), b1 = Math.max.apply(null, bd);
        firstText = ' Below n = ' + S.M(t1).replace('M', ' million') + (t0 ? ' (from ' + S.M(t0) + ')' : '') + ' the sieve ran twice: first ' + (bp.length ? 'with ' + esc(bp.map(S.prog).join(', ')) + ' ' : '') +
          'to ' + (b0 === b1 ? S.depth(b0) : 'between ' + S.depth(b0) + ' and ' + S.depth(b1)) + ', before P-1 and the PRP tests, then again, deeper. ' +
          'There an n counts as removed by the sieve when the second sieve found a factor for it, even if P-1 or a PRP test had settled it first.';
      }
      document.getElementById('note-sieve').innerHTML = 'A prime p below the sieve depth divides 2<sup>n</sup> − 25, so n is struck out before any other work. ' +
        'Depths so far run from ' + S.depth(lo) + ' to ' + S.depth(hi) + (progs.length ? ', using ' + esc(progs.map(S.prog).join(', ')) : '') + '.' + firstText;
    }
    var pm = data.rows.filter(function (r) { return r.pm1.runs; });
    if (pm.length) {
      document.getElementById('note-pm1').innerHTML = 'Prime95 P-1 on the sieve survivors, B1 from ' + fmt(pm[0].pm1.b1) + ' (' + S.M(pm[0].lo) + ') to ' +
        fmt(pm[pm.length - 1].pm1.b1) + ' (' + S.M(pm[pm.length - 1].lo) + '). It found a factor for ' + fmt(data.sum.counts.pm1_factors) + ' of the ' + fmt(data.sum.counts.pm1_runs) +
        ' n' + (p1Count(data.sum.counts) < data.sum.counts.pm1_factors ? '; a later, deeper sieve found a factor for ' + fmt(data.sum.counts.pm1_factors - p1Count(data.sum.counts)) +
          ' of them, so the table counts ' + fmt(p1Count(data.sum.counts)) + ' under P-1' : '') + '. New ranges skip P-1, because a deeper GPU sieve removes candidates more cheaply.';
    }
  }
})();
