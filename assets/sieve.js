/* Sieve page: depth by range, candidates-left model, P-1 factor sizes, assignments, benchmark, runs, versions. */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc;

  S.all(['ranges', 'sieve', 'site', 'summary']).then(function (d) {
    var rows = d[0].rows, sv = d[1], site = d[2], sum = d[3];
    var M = S.model(site);
    var act = site.active || null;
    renderLede(site, M, act, sum);
    document.getElementById('depth-chart').innerHTML = depthChart(rows, site, act);
    renderDepthLegend(rows, site, act);
    renderCandidates(rows, site, M, act);
    renderPm1(rows, sv, site);
    renderBigFactors(sv);
    renderPm1Stats(rows, sv);
    renderTogether(sv);
    renderPlan(rows, site, act);
    renderBench(site);
    renderRuns(rows, sv, M);
    renderLineage(site);
  }).catch(function (e) { S.fail('depth-chart', e); });

  function prog(s) { return esc(S.prog(s)); }
  function pLabel(p) { return p ? S.depth(p) : '0'; }
  function mLabel(n) { return n ? S.M(n) : '0'; }
  function round100(x) { return Math.round(x / 100) * 100; }
  function inAct(r, act) { return act && r.lo >= act.lo && r.hi <= act.hi; }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function monthName(ts) {
    var m = /^(\d{4})-(\d{2})/.exec(String(ts || ''));
    return m ? 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[Number(m[2]) - 1] + ' ' + m[1] : '';
  }
  function kLabel(v) { return v >= 1000 ? fmt(v / 1000) + 'k' : fmt(v); }
  function duration(sec) {
    if (!sec) return '—';
    if (sec < 90) return Math.round(sec) + ' s';
    if (sec < 5400) return Math.round(sec / 60) + ' min';
    return fmt(sec / 3600, sec < 36000 ? 1 : 0) + ' h';
  }

  function renderLede(site, M, act, sum) {
    var n0 = act ? act.lo : sum.frontier;
    document.getElementById('sieve-lede').innerHTML =
      'Before any PRP test, every prime p up to the sieve depth is tried against all n at once: the siever solves 2<sup>n</sup> ≡ 25 (mod p) ' +
      'and strikes out each n that p divides. Removing a candidate this way costs a fraction of a second; a PRP test near n = ' + S.M(n0) +
      ' costs ' + S.prpCost(M, n0) + '.';
  }

  /* ---------- depth by range ---------- */
  function versionSpan(site) {
    var old = (site.siever_versions || []).filter(function (v) { return v.hi !== null && v.hi !== undefined; });
    if (!old.length) return null;
    var a = old[0].program, b = old[old.length - 1].program;
    var ma = /^(.*?)\s+v?(\d[\w.]*)$/.exec(a), mb = /^(.*?)\s+v?(\d[\w.]*)$/.exec(b);
    var name = old.length === 1 ? a : ma && mb && ma[1] === mb[1] ? ma[1] + ' ' + ma[2] + ' – ' + mb[2] : a + ' – ' + b;
    var cpu = old.every(function (v) { return /^CPU/i.test(v.hardware || ''); });
    return {
      lo: Math.min.apply(null, old.map(function (v) { return v.lo; })),
      hi: Math.max.apply(null, old.map(function (v) { return v.hi; })),
      label: prog(name) + (cpu ? ' · CPU only' : '')
    };
  }
  function planSteps(site, fromDepth) {
    return (site.sieve_plan || []).filter(function (s) { return s.p_to > fromDepth && !/^done$/i.test(s.status || ''); });
  }

  function depthChart(rows, site, act) {
    var L = 60, R = 1140, B = 250, T = 20;
    var target = site.sieve_target || 1e14;
    var depths = [];
    rows.forEach(function (r) { if (r.sieve && r.sieve.depth) depths.push(r.sieve.depth, r.sieve_before ? r.sieve_before.depth : r.sieve.depth); });
    var E0 = Math.max(0, Math.floor(Math.log10(depths.length ? Math.min.apply(null, depths) : 1e7)) - 1);
    var E1 = Math.ceil(Math.log10(target)) + 1;
    var X = function (n) { return L + n / 1e7 * (R - L); };
    var Y = function (p) { return B - (Math.log10(Math.max(p, Math.pow(10, E0))) - E0) / (E1 - E0) * (B - T); };
    var o = ['<svg class="chart" viewBox="0 0 1160 290" role="img" aria-label="' + esc(depthSummary(rows, site, act)) + '">'];
    var g = [], yl = [];
    for (var e = E0; e <= E1; e++) {
      if (e > E0) g.push('<line x1="' + L + '" y1="' + S.r1(Y(Math.pow(10, e))) + '" x2="' + R + '" y2="' + S.r1(Y(Math.pow(10, e))) + '"></line>');
      yl.push('<text class="end" x="' + (L - 8) + '" y="' + S.r1(Y(Math.pow(10, e)) + 3) + '">' + S.tenTo(e) + '</text>');
    }
    o.push('<g class="grid">' + g.join('') + '</g><line class="axis" x1="' + L + '" y1="' + B + '" x2="' + R + '" y2="' + B + '"></line>' + yl.join(''));

    // sieved rows; a range sieved twice shows the first sieve (before P-1 and PRP) in the lighter shade below the second
    rows.forEach(function (r) {
      if (!r.sieve || !r.sieve.depth) return;
      var x0 = X(r.lo) + 1.5, w = X(r.hi) - X(r.lo) - 3, y = Y(r.sieve.depth), b = r.sieve_before;
      var title = S.rangeLabel(r.lo, r.hi) + (b ? ' · first sieved to ' + S.depth(b.depth) + (b.program ? ' · ' + prog(b.program) : '') + '; sieved again to '
        : ' · sieved to ') + S.depth(r.sieve.depth) + (r.sieve.program ? ' · ' + prog(r.sieve.program) : '');
      var yb = b ? Y(b.depth) : B;
      if (b) o.push('<rect class="bar soft" x="' + S.r1(x0) + '" y="' + S.r1(yb) + '" width="' + S.r1(w) + '" height="' + S.r1(B - yb) + '"><title>' + title + '</title></rect>');
      o.push('<rect class="bar" x="' + S.r1(x0) + '" y="' + S.r1(y) + '" width="' + S.r1(w) + '" height="' + S.r1(Math.max(0, yb - y - (b ? 2 : 0))) + '"><title>' + title + '</title></rect>');
    });
    // the second sieve over the ranges sieved twice
    var twice = rows.filter(function (r) { return r.sieve && r.sieve.depth && r.sieve_before; });
    if (twice.length) {
      var t0 = Math.min.apply(null, twice.map(function (r) { return r.lo; })), t1 = Math.max.apply(null, twice.map(function (r) { return r.hi; }));
      var tTop = Math.max.apply(null, twice.map(function (r) { return r.sieve.depth; }));
      var tEnd = twice.map(function (r) { return r.sieve.end || ''; }).sort().pop();
      o.push('<text class="sans mid strong" x="' + S.r1(X((t0 + t1) / 2)) + '" y="' + S.r1(Y(tTop) - 8) + '">' + prog(twice[0].sieve.program || '') + ' · sieved again' +
        (tEnd ? ', ' + esc(monthName(tEnd)) : '') + '</text>');
    }

    // the active range: a sieve step running on it now (planned steps are not drawn), and the program that sieves it
    if (act) {
      var actRows = rows.filter(function (r) { return inAct(r, act); });
      var actDepth = Math.max.apply(null, [0].concat(actRows.map(function (r) { return r.sieve && r.sieve.depth ? r.sieve.depth : 0; })));
      var first = planSteps(site, actDepth)[0];
      var live = first && /^(next|running)$/i.test(first.status || '');
      var xa = X(act.lo) + 1.5, xb = X(act.hi) - 1.5, xm = (xa + xb) / 2;
      var yTop = Y(Math.max(actDepth, Math.pow(10, E0)));
      if (live) {
        var yFirst = Y(first.p_to);
        o.push('<rect class="bar plan" x="' + S.r1(xa) + '" y="' + S.r1(yFirst) + '" width="' + S.r1(xb - xa) + '" height="' + S.r1(yTop - yFirst) + '"></rect>');
        o.push('<text class="mid accent" style="font-weight:600" x="' + S.r1(xm) + '" y="' + S.r1(yFirst + 19) + '">' + S.depth(first.p_to) + ' ' + esc(String(first.status).toLowerCase()) + '</text>');
        yTop = yFirst;
      }
      var cur = (site.siever_versions || []).filter(function (v) { return v.hi === null || v.hi === undefined; })[0];
      if (cur && (actDepth || live)) o.push('<text class="sans mid accent" style="font-weight:600" x="' + S.r1(xm) + '" y="' + S.r1(yTop - 10) + '">' + prog(cur.program) + '</text>');
    }

    // label for the older CPU sievers
    var vs = versionSpan(site);
    if (vs) {
      var oldRows = rows.filter(function (r) { return r.hi <= vs.hi && r.sieve && r.sieve.depth; });
      if (oldRows.some(function (r) { return r.sieve_before; })) {
        // sieved again since: the label goes inside the first-sieve bars, where they are tall enough around its middle
        var mid = (vs.lo + vs.hi) / 2, half = 1.1e6;
        var low = Math.min.apply(null, [Infinity].concat(oldRows.filter(function (r) { return r.hi > mid - half && r.lo < mid + half; })
          .map(function (r) { return (r.sieve_before || r.sieve).depth; })));
        if (low < Infinity) o.push('<text class="sans mid strong" x="' + S.r1(X(mid)) + '" y="' + S.r1((Y(low) + B) / 2 + 4) + '">' + vs.label + '</text>');
      } else {
        var oldTop = Math.max.apply(null, [Math.pow(10, E0)].concat(oldRows.map(function (r) { return r.sieve.depth; })));
        o.push('<text class="sans mid strong" x="' + S.r1(X((vs.lo + vs.hi) / 2)) + '" y="' + S.r1(Y(oldTop) - 21) + '">' + vs.label + '</text>');
      }
    }
    // the part nobody has touched yet
    var tail = rows.filter(function (r) { return !(r.sieve && r.sieve.depth) && !inAct(r, act) && (!act || r.lo >= act.hi); });
    if (tail.length) {
      var tlo = Math.min.apply(null, tail.map(function (r) { return r.lo; })), thi = Math.max.apply(null, tail.map(function (r) { return r.hi; }));
      o.push('<text class="sans mid" x="' + S.r1(X((tlo + thi) / 2)) + '" y="' + (B - 20) + '">' + S.rangeLabel(tlo, thi) + ' · not started</text>');
    }
    var xt = [];
    for (var m = 0; m <= 10; m++) xt.push('<text class="mid" x="' + S.r1(X(m * 1e6)) + '" y="' + (B + 20) + '">' + (m ? m + 'M' : '0') + '</text>');
    o.push(xt.join('') + '</svg>');
    return o.join('');
  }
  function depthSummary(rows, site, act) {
    var d = rows.filter(function (r) { return r.sieve && r.sieve.depth; }).map(function (r) { return r.sieve.depth; });
    var s = 'Sieve depth per 0.2M range of n';
    if (d.length) s += ': from ' + S.depth(Math.min.apply(null, d)) + ' to ' + S.depth(Math.max.apply(null, d));
    var twice = rows.filter(function (r) { return r.sieve && r.sieve_before; });
    if (twice.length) s += '. ' + S.rangeLabel(Math.min.apply(null, twice.map(function (r) { return r.lo; })), Math.max.apply(null, twice.map(function (r) { return r.hi; }))) +
      ' was sieved twice: first to between ' + S.depth(Math.min.apply(null, twice.map(function (r) { return r.sieve_before.depth; }))) + ' and ' +
      S.depth(Math.max.apply(null, twice.map(function (r) { return r.sieve_before.depth; }))) + ' before P-1 and PRP, then again to ' +
      S.depth(Math.min.apply(null, twice.map(function (r) { return r.sieve.depth; })));
    return s + '.';
  }
  function renderDepthLegend(rows, site, act) {
    var h = ['<span><i class="key solid" aria-hidden="true"></i>Sieved</span>'];
    if (rows.some(function (r) { return r.sieve && r.sieve_before; })) h.push('<span><i class="key soft" aria-hidden="true"></i>First sieve, before P-1 and PRP</span>');
    if (act) {
      var actDepth = Math.max.apply(null, [0].concat(rows.filter(function (r) { return inAct(r, act); }).map(function (r) { return r.sieve && r.sieve.depth ? r.sieve.depth : 0; })));
      var steps = planSteps(site, actDepth);
      if (steps.length && /^(next|running)$/i.test(steps[0].status || '')) {
        h.push('<span><i class="key u" aria-hidden="true"></i>' + esc(steps[0].status) + ': to ' + S.depth(steps[0].p_to) + ' · ' + esc(steps[0].machine) + '</span>');
      }
    }
    h.push('<span><i class="key open" aria-hidden="true"></i>Not sieved yet</span>');
    document.getElementById('depth-legend').innerHTML = h.join('');
  }

  /* ---------- candidates left ---------- */
  function renderCandidates(rows, site, M, act) {
    if (!act) { document.getElementById('cand-chart').innerHTML = ''; return; }
    var actRows = rows.filter(function (r) { return inAct(r, act); });
    var odd = actRows.reduce(function (s, r) { return s + r.odd; }, 0);
    if (!odd) return;
    var f = function (p) { return M.survivors(odd, p); };
    document.getElementById('cand-title').textContent = 'Candidates left in ' + S.rangeLabel(act.lo, act.hi);
    document.getElementById('cand-note').innerHTML = 'Survivors fall like 1 / ln p: about ' + M.K + ' × ' + fmt(odd) +
      ' odd n ÷ ln p, with the constant measured on the ranges already sieved.';

    // the depth the old sievers reached below this range (the first sieve, where a range was sieved again since)
    var old = Math.max.apply(null, [0].concat(rows.filter(function (r) { return r.hi <= act.lo && r.sieve && r.sieve.depth; })
      .map(function (r) { return (r.sieve_before || r.sieve).depth; })));
    var target = S.rangeSieveTarget(site, rows).target;
    var e0 = Math.min(9, Math.floor(Math.log10(old || 1e9))), e1 = Math.ceil(Math.log10(target)) + 1;
    var L = 60, R = 560, B = 210, T = 30;
    var X = function (p) { return L + (Math.log10(p) - e0) / (e1 - e0) * (R - L); };
    var vHi = f(Math.pow(10, e0)), vLo = f(Math.pow(10, e1));
    var step = niceStep((vHi - vLo) / 4);
    var lo = Math.floor(vLo / step) * step, hi = Math.ceil(vHi / step) * step;
    var Y = function (v) { return B - (v - lo) / (hi - lo) * (B - T); };
    var o = ['<svg class="chart small" viewBox="0 0 620 250" role="img" aria-label="Predicted candidates left in ' + esc(S.rangeLabel(act.lo, act.hi)) +
      ' against sieve depth' + (old ? ': about ' + fmt(round100(f(old))) + ' at ' + S.depth(old) : '') + '.">'];
    var g = [], yl = [], xl = [];
    for (var v = lo; v <= hi + 1e-9; v += step) {
      if (v > lo) g.push('<line x1="' + L + '" y1="' + S.r1(Y(v)) + '" x2="' + R + '" y2="' + S.r1(Y(v)) + '"></line>');
      yl.push('<text class="end" x="' + (L - 8) + '" y="' + S.r1(Y(v) + 3) + '">' + kLabel(v) + '</text>');
    }
    for (var e = e0; e <= e1; e++) xl.push('<text class="mid" x="' + S.r1(X(Math.pow(10, e))) + '" y="' + (B + 20) + '">' + S.tenTo(e) + '</text>');
    o.push('<g class="grid">' + g.join('') + '</g><line class="axis" x1="' + L + '" y1="' + B + '" x2="' + R + '" y2="' + B + '"></line>' + yl.join('') + xl.join(''));
    o.push('<text class="sans mid" x="' + ((L + R) / 2) + '" y="' + (B + 38) + '">sieve depth p (log scale)</text>');
    var pts = [];
    for (var i = 0; i <= 60; i++) {
      var p = Math.pow(10, e0 + (e1 - e0) * i / 60);
      pts.push((i ? 'L' : 'M') + S.r1(X(p)) + ' ' + S.r1(Y(f(p))));
    }
    o.push('<path class="line" d="' + pts.join(' ') + '"></path>');
    // the measured point, once the active range has been sieved
    var measured = null;
    if (actRows.length && actRows.every(function (r) { return r.sieve && r.sieve.depth; })) {
      var dm = Math.min.apply(null, actRows.map(function (r) { return r.sieve.depth; }));
      var sm = actRows.reduce(function (s, r) { return s + (r.survivors || 0); }, 0);
      if (sm >= lo && sm <= hi) measured = { p: dm, v: sm };
    }
    var marks = [];
    if (old) marks.push({ x: X(old), y: Y(f(old)), dot: 'open', text: S.depth(old) + ' (old depth) · ' + fmt(round100(f(old))), tc: 'strong' });
    // where the sieve is now, with the candidates it actually left
    if (measured) marks.push({ x: X(measured.p), y: Y(measured.v), dot: 'ink', text: S.depth(measured.p) + ' (now) · ' + fmt(measured.v), tc: 'strong' });
    marks.forEach(function (m) {
      o.push(m.dot === 'ink' ? '<circle cx="' + S.r1(m.x) + '" cy="' + S.r1(m.y) + '" r="5" style="fill: var(--ink)"></circle>'
        : '<circle cx="' + S.r1(m.x) + '" cy="' + S.r1(m.y) + '" r="4.5" style="fill: var(--surface); stroke: var(--ink-2); stroke-width: 2"></circle>');
    });
    // each label beside its dot, where it stays inside the chart and clear of the curve, the dots and the other labels
    var curveY = function (px) { return Y(f(Math.pow(10, e0 + (px - L) / (R - L) * (e1 - e0)))); };
    o.push(placeLabels(marks, { L: L + 2, R: 616, T: 6, B: B - 3 }, curveY));
    o.push('</svg>');
    document.getElementById('cand-chart').innerHTML = o.join('');
  }
  /* Labels beside points on a small chart: for each, the first of right-above, right-below, left-above and left-below
     (then the same on two lines) that stays inside box and clear of the curve, the points and the labels placed before. */
  function placeLabels(marks, box, curveY) {
    var CW = 6.6, LH = 13, placed = [], out = [];
    marks.forEach(function (m) {
      var cut = m.text.lastIndexOf(' · ');
      var variants = [[m.text]];
      if (cut > 0) variants.push([m.text.slice(0, cut), m.text.slice(cut + 3)]);
      var pick = null;
      variants.some(function (lines) {
        var w = Math.max.apply(null, lines.map(function (t) { return t.length * CW; })), h = lines.length * LH;
        return [[1, -1], [1, 1], [-1, -1], [-1, 1]].some(function (c) {
          var x0 = c[0] > 0 ? m.x + 9 : m.x - 9 - w, x1 = x0 + w;
          var y0 = c[1] < 0 ? m.y - 7 - h : m.y + 8, y1 = y0 + h;
          if (x0 < box.L || x1 > box.R || y0 < box.T || y1 > box.B) return false;
          var clash = function (a0, a1, b0, b1) { return a0 < a1 && b0 < b1; };
          if (placed.some(function (b) { return clash(x0, b.x1, b.x0, x1) && clash(y0, b.y1, b.y0, y1); })) return false;
          if (marks.some(function (d) { return clash(x0, d.x + 6, d.x - 6, x1) && clash(y0, d.y + 6, d.y - 6, y1); })) return false;
          for (var px = x0; px <= x1; px += 4) { var cy = curveY(px); if (cy > y0 - 3 && cy < y1 + 3) return false; }
          pick = { x0: x0, x1: x1, y0: y0, y1: y1, end: c[0] < 0, lines: lines };
          return true;
        });
      });
      if (!pick) pick = { x0: m.x + 9, x1: m.x + 9 + m.text.length * CW, y0: m.y - 7 - LH, y1: m.y - 7, end: false, lines: [m.text] };
      placed.push(pick);
      pick.lines.forEach(function (t, k) {
        out.push('<text class="' + m.tc + (pick.end ? ' end' : '') + '" x="' + S.r1(pick.end ? pick.x1 : pick.x0) + '" y="' + S.r1(pick.y0 + (k + 1) * LH - 3) + '">' + esc(t) + '</text>');
      });
    });
    return out.join('');
  }

  /* ---------- P-1 factor sizes ---------- */
  function renderPm1(rows, sv, site) {
    var bits = sv.pm1_factor_bits || {};
    var keys = Object.keys(bits).map(Number).sort(function (a, b) { return a - b; });
    var total = sv.pm1_factor_count || keys.reduce(function (s, k) { return s + bits[k]; }, 0);   // prime factors
    var nFact = sv.pm1_n_factored || total;                                                        // n that P-1 factored
    var pmRows = rows.filter(function (r) { return r.pm1 && r.pm1.runs > 0; });
    if (!keys.length || !pmRows.length) {
      document.getElementById('pm1-note').textContent = 'No P-1 results in the archive.';
      return;
    }
    var stop = pmRows[pmRows.length - 1].hi;
    document.getElementById('pm1-title').textContent = 'Why P-1 stopped at ' + S.M(stop);
    var below = {};
    (sv.pm1_factors_below || []).forEach(function (t) { below[t[0]] = t[1]; });
    // three p ranges marked on the chart: below 10^13, 10^14 and 10^15, each with the share of the n P-1 factored
    // that have a factor there (a sieve that deep would have removed them)
    var zones = [1e13, 1e14, 1e15];
    var share = function (p) { return below[p] !== undefined ? below[p] / nFact : null; };
    var s1 = share(zones[0]), s2 = share(zones[1]);
    var note = 'Sizes of the ' + fmt(total) + ' prime factors Prime95 P-1 found for ' + S.rangeLabel(pmRows[0].lo, stop) + '.';
    if (sv.pm1_composite) {
      note += ' ' + fmt(sv.pm1_composite) + ' of its ' + fmt(nFact) + ' results were the product of two or more primes found at once; they are split here.';
    }
    if (s1 !== null && s2 !== null) {
      note += ' For ' + Math.round(s1 * 100) + '% of the n it factored, one of the factors is below ' + S.depth(zones[0]) + ' (' + Math.round(s2 * 100) +
        '% below ' + S.depth(zones[1]) + '), where the new sieve removes the same n more cheaply.';
    }
    document.getElementById('pm1-note').innerHTML = note;

    var lo = keys[0], cap = lo + 49, maxK = keys[keys.length - 1];
    var over = keys.filter(function (k) { return k > cap; }).reduce(function (s, k) { return s + bits[k]; }, 0);
    var nb = Math.min(maxK, cap) - lo + 1 + (over ? 1 : 0);
    var L = 50, R = 560, B = 200, T = 22, W = (R - L) / nb;
    var counts = [];
    for (var k = lo; k <= Math.min(maxK, cap); k++) counts.push(bits[k] || 0);
    if (over) counts.push(over);
    var top = Math.max.apply(null, counts), step = niceStep(top / 4);
    top = Math.ceil(top / step) * step;
    var Y = function (v) { return B - v / top * (B - T); };
    var XL = function (lg) { return L + Math.max(0, Math.min(nb, lg - lo + 1)) * W; };
    var o = ['<svg class="chart small" viewBox="0 0 620 250" role="img" aria-label="Histogram of P-1 factor sizes from ' + lo + ' to ' + maxK +
      ' bits; the tallest bar has ' + fmt(Math.max.apply(null, counts)) + ' factors.">'];
    var zx = [L].concat(zones.map(function (p) { return XL(Math.log2(p)); }));
    zones.forEach(function (p, i) {
      if (zx[i + 1] > zx[i]) o.push('<rect class="pz-' + (i + 1) + '" x="' + S.r1(zx[i]) + '" y="' + T + '" width="' + S.r1(zx[i + 1] - zx[i]) + '" height="' + (B - T) + '"></rect>');
    });
    var g = [], yl = [];
    for (var v = 0; v <= top + 1e-9; v += step) {
      if (v > 0) g.push('<line x1="' + L + '" y1="' + S.r1(Y(v)) + '" x2="' + R + '" y2="' + S.r1(Y(v)) + '"></line>');
      yl.push('<text class="end" x="' + (L - 6) + '" y="' + S.r1(Y(v) + 3) + '">' + fmt(v) + '</text>');
    }
    o.push('<g class="grid">' + g.join('') + '</g><line class="axis" x1="' + L + '" y1="' + B + '" x2="' + R + '" y2="' + B + '"></line>' + yl.join(''));
    var bw = Math.max(1, W * 0.84);
    counts.forEach(function (c, i) {
      if (!c) return;
      var isOver = over && i === counts.length - 1;
      var label = isOver ? (cap + 1) + '+ bits' : (lo + i) + ' bits';
      o.push('<rect class="bar' + (isOver ? ' soft' : '') + '" x="' + S.r1(L + i * W + (W - bw) / 2) + '" y="' + S.r1(Y(c)) + '" width="' + S.r1(bw) +
        '" height="' + S.r1(B - Y(c)) + '"><title>' + label + ': ' + fmt(c) + '</title></rect>');
    });
    var xl = [];
    for (var b = lo; b <= Math.min(maxK, cap); b++) {
      if ((b === lo || b % 10 === 0) && !(over && Math.min(maxK, cap) - b < 3)) xl.push('<text class="mid" x="' + S.r1(L + (b - lo + 0.5) * W) + '" y="' + (B + 18) + '">' + b + '</text>');
    }
    if (over) xl.push('<text class="mid" x="' + S.r1(L + (nb - 0.5) * W) + '" y="' + (B + 18) + '">' + (cap + 1) + '+</text>');
    o.push(xl.join('') + '<text class="sans mid" x="' + ((L + R) / 2) + '" y="' + (B + 38) + '">factor size in bits</text></svg>');
    document.getElementById('pm1-chart').innerHTML = o.join('');
    var lg = zones.map(function (p, i) {
      var s = share(p);
      return '<span><i class="key pz-' + (i + 1) + '" aria-hidden="true"></i>p &lt; ' + S.depth(p) + (s !== null ? ': ' + Math.round(s * 100) + '% of the n' : '') + '</span>';
    });
    if (over) lg.push('<span><i class="key" style="background:var(--axis)" aria-hidden="true"></i>' + (cap + 1) + ' bits or more: ' + fmt(over) + '</span>');
    document.getElementById('pm1-legend').innerHTML = lg.join('');

  }

  function renderBigFactors(sv) {
    var list = sv.largest_pm1 || [];
    var el = document.getElementById('big-factors');
    if (!el) return;
    if (!list.length) { el.closest('section').hidden = true; return; }
    var showWho = list.some(function (f) { return f.who && f.who !== list[0].who; });
    el.innerHTML = '<table class="data"><thead><tr><th class="r">n</th><th>Factor</th><th class="r">Digits</th><th class="r">Bits</th>' +
      '<th class="r">B1</th><th class="r">B2</th><th>Found (UTC)</th>' + (showWho ? '<th class="text">By</th>' : '') + '</tr></thead><tbody>' +
      list.map(function (f) {
        return '<tr><td class="r"><a href="exponent.html?n=' + f.n + '">' + fmt(f.n) + '</a></td><td class="wrap">' + bigNum(f.p) +
          (f.together ? '<br><span class="muted small">found in one run with ' + (f.together === 2 ? 'another prime' : (f.together - 1) + ' other primes') + '</span>' : '') + '</td><td class="r">' +
          f.digits + '</td><td class="r">' + f.bits + '</td><td class="r">' + fmt(f.b1) + '</td><td class="r">' + (f.b2 ? fmt(f.b2) : '—') + '</td><td>' +
          esc(S.minute(f.found)) + '</td>' + (showWho ? '<td class="text">' + S.creditHTML(f.who) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  // a long number with a line break allowed after each comma
  function bigNum(v) { return S.fmtBig(v).replace(/,/g, ',<wbr>'); }
  function nLink(n) { return '<a href="exponent.html?n=' + n + '">n = ' + fmt(n) + '</a>'; }
  var WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  function word(k) { return WORDS[k] || fmt(k); }

  function renderPm1Stats(rows, sv) {
    var st = sv.pm1_stats, el = document.getElementById('pm1-stats');
    if (!st || !st.with_factor) { el.closest('section').hidden = true; return; }
    var pmRows = rows.filter(function (r) { return r.pm1 && r.pm1.runs > 0; });
    var big = (sv.largest_pm1 || [])[0], comp = (sv.pm1_together || [])[0], s1 = st.largest_stage1, sm = st.smallest;
    var per = st.per_result || {}, ks = Object.keys(per).map(Number).filter(function (k) { return k > 1; }).sort(function (a, b) { return a - b; });
    var several = ks.reduce(function (s, k) { return s + per[k]; }, 0);
    var most = ks[ks.length - 1], mostRun = most ? (sv.pm1_together || []).filter(function (t) { return t.parts.length === most; })[0] : null;
    var T = [];
    var tile = function (label, value, sub, cls) { T.push('<div class="tile"><div class="eyebrow">' + label + '</div><div class="v' + (cls ? ' ' + cls : '') + '">' + value + '</div><div class="s">' + sub + '</div></div>'); };
    tile('P-1 runs', fmt(st.runs), (st.runs === st.n_tested ? 'one per n' : fmt(st.n_tested) + ' n') + (pmRows.length ? ', ' + S.rangeLabel(pmRows[0].lo, pmRows[pmRows.length - 1].hi) : ''));
    tile('Found a factor', S.pct(st.with_factor / st.runs), fmt(st.with_factor) + ' runs: ' + fmt(st.stage1) + ' in stage 1, ' + fmt(st.stage2) + ' in stage 2');
    tile('Prime factors', fmt(st.primes), st.median_bits ? 'median size ' + fmt(st.median_bits) + ' bits' : '');
    if (several) tile('Several in one run', fmt(several), ks.map(function (k) { return fmt(per[k]) + ' × ' + word(k); }).join(', ') +
      (mostRun && per[most] === 1 ? ' (' + nLink(mostRun.n) + ')' : ''));
    if (big) tile('Largest prime factor', big.digits + ' digits', big.bits + ' bits · ' + nLink(big.n) + (big.b2 ? ' · stage 2' : ' · stage 1'));
    if (s1) tile('Largest stage-1 factor', s1.digits + ' digits', s1.bits + ' bits · ' + nLink(s1.n) + ' · p − 1 has no prime factor above ' + fmt(s1.b1));
    if (comp) tile('Largest product reported', comp.digits + ' digits', word(comp.parts.length) + ' primes · ' + nLink(comp.n));
    if (sm) tile('Smallest factor', S.fmtBig(sm.p), nLink(sm.n) + (sm.sieve_depth ? ' · the sieve had gone to ' + S.fmtBig(sm.sieve_depth) + ' there' : ''), sm.p.length > 10 ? 'long' : 'mid');
    el.innerHTML = T.join('');
    document.getElementById('pm1-stats-meta').textContent = 'Prime95 P-1, ' + (pmRows.length ? S.rangeLabel(pmRows[0].lo, pmRows[pmRows.length - 1].hi) : '');
    document.getElementById('pm1-stats-note').innerHTML = 'Stage 1 finds a prime factor p when every prime factor of p − 1 is at most B1; stage 2 also allows one prime factor of p − 1 between B1 and B2. ' +
      (st.below_sieve_depth === 0 ? 'Every factor P-1 found lies above the sieve depth of its range, as it should: the sieve had already removed every n with a smaller factor.'
        : st.below_sieve_depth ? fmt(st.below_sieve_depth) + ' factors P-1 found lie at or below the sieve depth of their range, where the sieve should have found them first.' : '');
  }

  function renderTogether(sv) {
    var list = sv.pm1_together || [], st = sv.pm1_stats || {}, el = document.getElementById('together');
    if (!list.length) { el.closest('section').hidden = true; return; }
    var several = sv.pm1_composite || list.length;
    document.getElementById('together-meta').textContent = 'the ' + list.length + ' largest of ' + fmt(several);
    document.getElementById('together-note').innerHTML = 'When two or more prime factors of 2<sup>n</sup> − 25 turn up in the same P-1 run, Prime95 reports only their product. ' +
      'The site splits each product by replaying the run in small steps, and shows both: the number P-1 reported, and below it the primes it is made of. ' +
      'This happened in ' + fmt(several) + ' of the ' + fmt(st.with_factor || 0) + ' runs that found a factor.';
    el.innerHTML = '<table class="data"><thead><tr><th class="r">n</th><th>Factor P-1 reported = its prime factors</th><th class="r">Digits</th><th class="r">Primes</th>' +
      '<th class="text">Stage</th><th class="r">B1</th><th class="r">B2</th><th>Found (UTC)</th></tr></thead><tbody>' +
      list.map(function (t) {
        return '<tr><td class="r top"><a href="exponent.html?n=' + t.n + '">' + fmt(t.n) + '</a></td><td class="wrap prod"><b>' + bigNum(t.p) + '</b><span class="parts">= ' +
          t.parts.map(function (q) { return '<span class="nw">' + S.fmtBig(q) + '</span>'; }).join(' × ') + '</span></td><td class="r top">' + t.digits +
          '</td><td class="r top">' + t.parts.length + '</td><td class="text top">' + (t.b2 ? '2' : '1') + '</td><td class="r top">' + fmt(t.b1) + '</td><td class="r top">' +
          (t.b2 ? fmt(t.b2) : '—') + '</td><td class="top">' + S.when(t.found) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- assignments, benchmark ---------- */
  function statusPill(s) {
    var t = String(s || '');
    var cls = /^done$/i.test(t) ? 'good' : /^(next|running)$/i.test(t) ? 'accent' : 'muted';
    return '<span class="pill ' + cls + '">' + (/^running$/i.test(t) ? '<span class="dot"></span>' : '') + esc(t) + '</span>';
  }
  function renderPlan(rows, site, act) {
    var plan = site.sieve_plan || [];
    var el = document.getElementById('plan-table');
    if (!plan.length) { el.innerHTML = '<p class="small">No sieve work planned.</p>'; return; }
    if (act) {
      var odd = rows.filter(function (r) { return inAct(r, act); }).reduce(function (s, r) { return s + r.odd; }, 0);
      document.getElementById('plan-title').innerHTML = 'Sieve assignments · ' + fmt(act.lo) + ' ≤ n &lt; ' + fmt(act.hi);
      document.getElementById('plan-meta').textContent = fmt(odd) + ' odd n';
    }
    // a step counts as done once every row of the active range is sieved at least that deep
    var actRows = act ? rows.filter(function (r) { return inAct(r, act); }) : [];
    var depth = actRows.length && actRows.every(function (r) { return r.sieved && r.sieve && r.sieve.depth; }) ?
      Math.min.apply(null, actRows.map(function (r) { return r.sieve.depth; })) : 0;
    var left = actRows.reduce(function (t, r) { return t + (r.survivors || 0); }, 0);
    // sieve work in T4-Hours (content/site.json model.t4.tf): what Mass Prime Siever 14.0 on one T4 needs for the p range
    var t4 = site.model && site.model.t4, hasT4 = S.tfT4Hours(t4, 0, 1e9) !== null, doneH = 0, leftH = 0;
    el.innerHTML = '<table class="data"><thead><tr><th>p range</th><th class="text">Machine</th><th>Backend</th><th class="text">Status</th>' +
      '<th class="r">Survivors</th>' + (hasT4 ? '<th class="r">T4-Hours</th>' : '') + '</tr></thead><tbody>' +
      plan.map(function (s) {
        var reached = depth && depth >= s.p_to && !/^done$/i.test(s.status || '');
        var surv = reached && depth === s.p_to ? fmt(left) : s.survivors;
        var h = hasT4 ? S.tfT4Hours(t4, s.p_from, s.p_to) : null;
        if (h !== null) { if (reached || /^done$/i.test(s.status || '')) doneH += h; else leftH += h; }
        return '<tr><td>' + pLabel(s.p_from) + ' – ' + pLabel(s.p_to) + '</td><td class="text">' + esc(s.machine) + '</td><td>' + esc(s.backend) +
          '</td><td class="text">' + statusPill(reached ? 'Done' : s.status) + '</td><td class="r">' + esc(surv) + '</td>' +
          (hasT4 ? '<td class="r">' + (h === null ? '—' : S.t4num(h)) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
    var note = document.getElementById('plan-t4');
    if (note) note.innerHTML = hasT4 ? 'Sieve work in T4-Hours: the time Mass Prime Siever 14.0 on one Tesla T4 needs for that p range ' +
      '(about ' + S.depth(t4.tf.primes_per_hour) + ' primes an hour, measured on Kaggle). Done so far ' + S.t4cost(doneH) +
      (leftH ? ', still planned ' + S.t4cost(leftH) : '') + '.' : '';
  }
  function renderBench(site) {
    var b = site.benchmarks;
    if (!b || !b.rows || !b.rows.length) return;
    document.getElementById('bench-setup').textContent = b.setup || '';
    var best = Math.min.apply(null, b.rows.map(function (r) { return r[1]; }));
    document.getElementById('bench').innerHTML = '<table class="data"><thead><tr><th class="text">Hardware</th><th class="r">Time</th><th class="text">Speed</th></tr></thead><tbody>' +
      b.rows.map(function (r) {
        var rel = best / r[1];
        return '<tr><td class="text" style="white-space:normal">' + esc(r[0]) + '</td><td class="r">' + fmt(r[1]) + ' s</td><td class="text" style="min-width:64px;width:30%"><div class="meter" style="margin:0" title="' +
          Math.round(rel * 100) + '% of the fastest"><i style="width:' + (rel * 100).toFixed(1) + '%"></i></div></td></tr>';
      }).join('') + '</tbody></table>';
    document.getElementById('bench-note').textContent = b.note || '';
  }

  /* ---------- per-range runs ---------- */
  function renderRuns(rows, sv, M) {
    var done = rows.filter(function (r) { return r.sieve && r.sieve.depth; });
    var el = document.getElementById('runs-table');
    if (!done.length) { el.innerHTML = '<p class="small">No sieve runs yet.</p>'; return; }
    var showStations = done.some(function (r) { return r.sieve.stations > 1 || (r.sieve_before && r.sieve_before.stations > 1); });
    el.innerHTML = '<table class="data"><thead><tr><th>Range of n</th><th class="text">Program</th><th class="r">Sieved to p</th><th>Finished (UTC)</th>' +
      '<th class="r">Run time</th>' + (showStations ? '<th class="r">Stations</th>' : '') + '<th class="r">Odd n</th><th class="r">Survivors</th><th class="r">Removed</th><th class="r">K</th></tr></thead><tbody>' +
      done.map(function (r) {
        // a range sieved twice: the first sieve (before P-1 and PRP), then the second
        var runs = r.sieve_before ? [[r.sieve_before, r.sieve_before.survivors, r.sieve_before.survivor_K, ' (first)'], [r.sieve, r.survivors, r.survivor_K, ' (again)']]
          : [[r.sieve, r.survivors, r.survivor_K, '']];
        return runs.map(function (x) {
          var sv = x[0], removed = r.odd ? (r.odd - (x[1] || 0)) / r.odd : 0;
          return '<tr><td>' + S.rangeLabel(r.lo, r.hi) + '</td><td class="text">' + prog(sv.program || '—') + '<span class="muted">' + x[3] + '</span></td><td class="r">' + S.depth(sv.depth) +
            '</td><td>' + S.when(sv.end) + '</td><td class="r">' + duration(sv.cpu_s) + '</td>' +
            (showStations ? '<td class="r">' + (sv.stations || 1) + '</td>' : '') + '<td class="r">' + fmt(r.odd) + '</td><td class="r">' + fmt(x[1]) +
            '</td><td class="r">' + S.pct(removed) + '</td><td class="r">' + (x[2] ? x[2].toFixed(3) : '—') + '</td></tr>';
        }).join('');
      }).join('') + '</tbody></table>';
    document.getElementById('runs-note').innerHTML = 'K = survivors × ln p ÷ odd n. If the sieve behaves as expected, K stays the same at every depth; the model uses K = ' +
      M.K + (sv.survivor_K_mean ? ', and the ranges above average ' + Number(sv.survivor_K_mean).toFixed(3) : '') + '. Run time is the wall-clock time in the siever logs, added up over stations and machines.' +
      (function () {
        var up = done.filter(function (r) { return r.sieve.by && r.sieve.by.length; });
        return up.length ? ' Slices sent through the Join page: ' + up.map(function (r) { return S.rangeLabel(r.lo, r.hi) + ' by ' + r.sieve.by.map(esc).join(', '); }).join('; ') + '.' : '';
      })();
  }

  function renderLineage(site) {
    var vs = site.siever_versions || [];
    var link = site.links && site.links.siever;
    if (link) document.getElementById('siever-link').href = link;
    document.getElementById('lineage-table').innerHTML = '<table class="data"><thead><tr><th class="text">Program</th><th>First run</th><th>Ranges of n</th><th>Depth</th><th class="text">Hardware</th></tr></thead><tbody>' +
      vs.map(function (v) {
        var cur = v.hi === null || v.hi === undefined;
        return '<tr><td class="text">' + prog(v.program) + '</td><td>' + esc(v.first_run) + '</td><td>' + mLabel(v.lo) + (cur ? ' →' : ' – ' + mLabel(v.hi)) +
          '</td><td>' + S.supHTML(esc(v.depth)) + '</td><td class="text">' + esc(v.hardware) + (cur && link ? ' · <a href="' + esc(link) + '">source</a>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
})();
