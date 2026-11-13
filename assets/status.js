/* Status page: the big chart of every odd n below 10^7, key numbers, active range, outlook,
   frontier and PRP results since site.status_since, latest results. */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc, r1 = S.r1;

  S.all(['summary', 'ranges', 'primes', 'site']).then(function (d) {
    render(d[0], d[1], d[2], d[3]);
    S.load('progress').then(function (p) {
      bigChart(p, d[0], d[2], d[3]);
    }).catch(function (e) { S.fail('bigchart', e); });
  }).catch(function (e) { S.fail('hero-lede', e); });

  function render(sum, ranges, primesDoc, site) {
    var M = S.model(site);
    var c = sum.counts;
    var frontier = sum.frontier;
    var act = site.active || { lo: frontier, hi: 5000000 };
    var median = M.median(frontier);
    var primes = primesDoc.primes.slice().sort(function (a, b) { return a.n - b.n; });

    document.getElementById('hero-stamp').innerHTML = '<span class="nw">data ' + esc(sum.generated) + '</span>' +
      (sum.last_result ? ' · <span class="nw">last result ' + esc(S.day(sum.last_result)) + '</span>' : '');
    document.getElementById('hero-lede').innerHTML =
      'Every odd n below ' + fmt(frontier) + ' has been factored or PRP-tested. The database tracks all n below ' +
      S.tenHTML(7) + '; the next prime is most likely near n ≈ ' + (median / 1e6).toFixed(2) +
      ' million, a number of about ' + (S.digits(Math.round(median)) / 1e6).toFixed(1) + ' million digits.';

    // key numbers
    var pm1Rows = ranges.rows.filter(function (r) { return r.pm1.runs > 0; });
    var pm1Span = pm1Rows.length ? S.M(pm1Rows[0].lo) + ' ≤ n < ' + S.M(pm1Rows[pm1Rows.length - 1].hi) : '';
    var pAll = M.pAny(frontier, 1e7);
    var largest = primes[primes.length - 1];
    var tiles = [
      ['Frontier', fmt(frontier), '', 'every odd n below is factored or PRP-tested'],
      ['Resolved', S.pct(c.resolved / c.odd), '', fmt(c.resolved) + ' of ' + fmt(c.odd) + ' odd n < 10<sup>7</sup>'],
      ['Known primes', fmt(c.primes), 'prime', largest ? 'largest n = ' + fmt(largest.n) + ' · ' + fmt(largest.digits) + ' digits' : ''],
      ['PRP tests', fmt(c.prp_tests), '', 'Prime95 PRP-3 · ' + fmt(c.prp_with_proof) + ' with proof file'],
      ['Factored by P-1', fmt(c.pm1_factors), '', 'of ' + fmt(c.pm1_runs) + ' n given a P-1 run' + (pm1Span ? ', ' + pm1Span : '')],
      ['Next prime', Math.round(pAll * 100) + '%', 'accent', 'chance of ≥ 1 prime in ' + S.M(frontier) + '–10M (' + M.expected(frontier, 1e7).toFixed(1) + ' expected)']
    ];
    document.getElementById('tiles').innerHTML = tiles.map(function (t) {
      return '<div class="tile"><div class="eyebrow">' + t[0] + '</div><div class="v ' + t[2] + '">' + t[1] + '</div><div class="s">' + t[3] + '</div></div>';
    }).join('');

    renderNow(ranges, site, M, act, frontier);
    renderOutlook(site, M, act, frontier, median);
    renderSince(sum, site, act);
    renderLatest(sum, site);
    renderTop(primes, primesDoc);
  }

  /* ---------- the big chart ---------- */
  // viewBox 1160 × 600: guide labels, prime labels, panel A (factor size), panel B (n left after the sieve), n axis
  var G = { w: 1160, h: 600, L: 64, R: 1136, AT: 96, AB: 426, BT: 448, BB: 538, DEC: 33 };
  var LOG2 = Math.log10(2);
  var HEAT = [1, 2, 4, 8, 16];             // lower bounds of the five colour classes, P-1 factors per cell

  function heatClass(c) { for (var k = HEAT.length - 1; k > 0; k--) if (c >= HEAT[k]) return k; return 0; }
  function heatLabel(k) { return k === HEAT.length - 1 ? HEAT[k] + '+' : HEAT[k + 1] - HEAT[k] === 1 ? String(HEAT[k]) : HEAT[k] + '–' + (HEAT[k + 1] - 1); }
  function sci(x) {
    var e = Math.floor(Math.log10(x) + 1e-9), m = x / Math.pow(10, e);
    var ms = m.toFixed(1);
    if (ms === '10.0') { e += 1; ms = '1.0'; }
    return (ms === '1.0' ? '' : ms + '×') + '10' + S.sup(e);
  }

  function bigChart(p, sum, primesDoc, site) {
    var M = S.model(site);
    var B = p.bucket, cols = p.state.length, nmax = B * cols;
    var act = site.active || {};
    var primes = primesDoc.primes.map(function (q) { return q.n; }).sort(function (a, b) { return a - b; });
    var plan = (site.sieve_plan || []).filter(function (s) { return s.p_to; });
    var next = plan.filter(function (s) { return /next/i.test(s.status || ''); })[0] || plan[0];
    var nextDepth = next ? next.p_to : (site.prp_from_depth || 1e12);
    var X = function (n) { return G.L + n / nmax * (G.R - G.L); };
    var YA = function (dec) { return G.AB - dec / G.DEC * (G.AB - G.AT); };
    var left = function (i) { return p.pm1[i] + p.comp[i] + p.prime[i] + p.open[i]; };
    var est = function (i) { return M.survivors(p.odd[i], nextDepth); };
    var maxB = 0;
    for (var i = 0; i < cols; i++) maxB = Math.max(maxB, p.depth[i] ? left(i) : p.state[i] === 's' ? est(i) : 0);
    var topB = Math.max(500, Math.ceil(maxB / 500) * 500);
    var YB = function (v) { return G.BB - v / topB * (G.BB - G.BT); };
    var colX = function (i) { return X(i * B); };

    var o = ['<svg class="chart big" viewBox="0 0 ' + G.w + ' ' + G.h + '" tabindex="0" role="img" aria-label="' + esc(ariaText(p, sum, primes, site)) + '">'];

    // not started: a quiet band
    var firstTodo = p.state.indexOf('t');
    if (firstTodo >= 0) {
      o.push('<rect class="band" x="' + r1(colX(firstTodo)) + '" y="' + G.AT + '" width="' + r1(G.R - colX(firstTodo)) + '" height="' + (G.AB - G.AT) + '"></rect>');
      o.push('<rect class="band" x="' + r1(colX(firstTodo)) + '" y="' + G.BT + '" width="' + r1(G.R - colX(firstTodo)) + '" height="' + (G.BB - G.BT) + '"></rect>');
    }
    // grid
    var g = [];
    for (var m = 1; m < 10; m++) {
      var gx = r1(X(m * 1e6));
      g.push('<line x1="' + gx + '" y1="' + G.AT + '" x2="' + gx + '" y2="' + G.AB + '"></line><line x1="' + gx + '" y1="' + G.BT + '" x2="' + gx + '" y2="' + G.BB + '"></line>');
    }
    for (var dec = 3; dec <= G.DEC; dec += 3) g.push('<line x1="' + G.L + '" y1="' + r1(YA(dec)) + '" x2="' + G.R + '" y2="' + r1(YA(dec)) + '"></line>');
    for (var v = 500; v <= topB; v += 500) g.push('<line x1="' + G.L + '" y1="' + r1(YB(v)) + '" x2="' + G.R + '" y2="' + r1(YB(v)) + '"></line>');
    o.push('<g class="grid">' + g.join('') + '</g>');

    // the active range: planned sieve depths
    if (act.lo !== undefined && act.hi && plan.length) {
      var ax0 = X(act.lo), ax1 = X(act.hi), deepest = Math.max.apply(null, plan.map(function (s) { return s.p_to; }));
      o.push('<rect class="plan-wash" x="' + r1(ax0) + '" y="' + r1(YA(Math.log10(nextDepth))) + '" width="' + r1(ax1 - ax0) + '" height="' + r1(G.AB - YA(Math.log10(nextDepth))) + '"></rect>');
      o.push('<rect class="plan-wash soft" x="' + r1(ax0) + '" y="' + r1(YA(Math.log10(deepest))) + '" width="' + r1(ax1 - ax0) + '" height="' + r1(YA(Math.log10(nextDepth)) - YA(Math.log10(deepest))) + '"></rect>');
      plan.forEach(function (s) {
        var y = r1(YA(Math.log10(s.p_to)));
        o.push('<line class="plan-line" x1="' + r1(ax0) + '" y1="' + y + '" x2="' + r1(ax1) + '" y2="' + y + '"></line>');
      });
      // the lines sit a decade apart, so the labels go beside the box
      var later = plan.filter(function (s) { return s !== next; }).map(function (s) { return S.depth(s.p_to); });
      o.push('<text class="accent" x="' + r1(ax1 + 8) + '" y="' + r1(YA(Math.log10(nextDepth)) + 4) + '">← sieve next: p < ' + S.depth(nextDepth) + '</text>');
      if (later.length) o.push('<text class="accent" x="' + r1(ax1 + 8) + '" y="' + r1(YA(Math.log10(deepest)) + 0) + '">← then ' + later.join(', ') + '</text>');
      // n left after the next sieve stage, estimated
      var e0 = -1, e1 = -1;
      for (i = 0; i < cols; i++) if (p.state[i] === 's') { if (e0 < 0) e0 = i; e1 = i; }
      if (e0 >= 0) {
        var ey = YB(est(e0)), ex0 = colX(e0), ex1 = colX(e1 + 1);
        var total = 0;
        for (i = e0; i <= e1; i++) total += est(i);
        o.push('<rect class="plan-wash" x="' + r1(ex0) + '" y="' + r1(ey) + '" width="' + r1(ex1 - ex0) + '" height="' + r1(G.BB - ey) + '"></rect>');
        o.push('<path class="plan-line" d="M' + r1(ex0) + ' ' + G.BB + 'V' + r1(ey) + 'H' + r1(ex1) + 'V' + G.BB + '"></path>');
        o.push('<text class="accent" x="' + r1(ex1 + 8) + '" y="' + r1(ey + 4) + '">≈ ' + fmt(Math.round(total / 100) * 100) + ' expected to survive p < ' + S.depth(nextDepth) + '</text>');
      }
    }

    // the sieve: every factor below the edge is known
    var fill = '', edge = '', lastEnd = null;
    i = 0;
    while (i < cols) {
      if (!p.depth[i]) { i++; lastEnd = null; continue; }
      var j = i;
      while (j + 1 < cols && p.depth[j + 1] === p.depth[i]) j++;
      var xa = r1(colX(i)), xb = r1(colX(j + 1)), y = r1(YA(Math.log10(p.depth[i])));
      fill += 'M' + xa + ' ' + G.AB + 'V' + y + 'H' + xb + 'V' + G.AB + 'Z';
      edge += (lastEnd === xa ? 'V' + y : 'M' + xa + ' ' + y) + 'H' + xb;
      lastEnd = xb;
      i = j + 1;
    }
    o.push('<path class="sieved crisp" d="' + fill + '"></path><path class="depth-edge" d="' + edge + '"></path>');

    // P-1 factors by size
    var heat = HEAT.map(function () { return ''; });
    p.heat.forEach(function (h) {
      var xa = r1(colX(h[0])), xb = r1(colX(h[0] + 1));
      for (var k = 2; k < h.length; k++) {
        if (!h[k]) continue;
        var bits = h[1] + k - 2;
        heat[heatClass(h[k])] += 'M' + xa + ' ' + r1(YA(bits * LOG2)) + 'H' + xb + 'V' + r1(YA((bits - 1) * LOG2)) + 'H' + xa + 'Z';
      }
    });
    o.push('<g class="crisp">' + heat.map(function (d, k) { return d ? '<path class="heat-' + k + '" d="' + d + '"></path>' : ''; }).join('') + '</g>');

    // panel B: what became of the n the sieve left
    var parts = { comp: '', pm1: '', prime: '', open: '' };
    for (i = 0; i < cols; i++) {
      if (!left(i)) continue;
      var x0 = r1(colX(i)), x1 = r1(colX(i + 1)), base = 0;
      ['comp', 'pm1', 'prime', 'open'].forEach(function (k) {
        var cnt = p[k][i];
        if (!cnt) return;
        parts[k] += 'M' + x0 + ' ' + r1(YB(base)) + 'V' + r1(YB(base + cnt)) + 'H' + x1 + 'V' + r1(YB(base)) + 'Z';
        base += cnt;
      });
    }
    o.push('<g class="crisp">' + Object.keys(parts).map(function (k) { return parts[k] ? '<path class="st-' + k + '" d="' + parts[k] + '"></path>' : ''; }).join('') + '</g>');

    // axes
    var ax = ['<line class="axis" x1="' + G.L + '" y1="' + G.AB + '" x2="' + G.R + '" y2="' + G.AB + '"></line>',
      '<line class="axis" x1="' + G.L + '" y1="' + G.BB + '" x2="' + G.R + '" y2="' + G.BB + '"></line>'];
    for (dec = 3; dec <= G.DEC; dec += 3) ax.push('<text class="end" x="' + (G.L - 8) + '" y="' + r1(YA(dec) + 4) + '">10' + S.sup(dec) + '</text>');
    for (v = 0; v <= topB; v += 1000) ax.push('<text class="end" x="' + (G.L - 8) + '" y="' + r1(YB(v) + 4) + '">' + (v ? fmt(v) : '0') + '</text>');
    for (m = 0; m <= 10; m++) {
      var tx = r1(X(m * 1e6));
      ax.push('<line class="ticks" x1="' + tx + '" y1="' + G.BB + '" x2="' + tx + '" y2="' + (G.BB + 5) + '"></line>');
      ax.push('<text class="mid" x="' + tx + '" y="' + (G.BB + 18) + '">' + (m ? m + 'M' : '0') + '</text>');
    }
    ax.push('<text class="axis-title mid" transform="rotate(-90 14 ' + ((G.AT + G.AB) / 2) + ')" x="14" y="' + ((G.AT + G.AB) / 2) + '">FACTOR SIZE p</text>');
    ax.push('<text class="axis-title mid" transform="rotate(-90 14 ' + ((G.BT + G.BB) / 2) + ')" x="14" y="' + ((G.BT + G.BB) / 2) + '">SURVIVORS</text>');
    o.push(ax.join(''));

    // labels in the plot
    var sievedCols = p.depth.filter(Boolean).length;
    if (sievedCols) {
      var removed = p.removed.reduce(function (s, x) { return s + x; }, 0);
      o.push('<text class="strong sans" x="' + (G.L + 10) + '" y="' + r1(YA(3.4)) + '">Sieve: every factor below the edge is known</text>');
      o.push('<text x="' + (G.L + 10) + '" y="' + r1(YA(3.4) + 15) + '">' + fmt(removed) + ' n removed · p up to ' + S.depth(Math.max.apply(null, p.depth.filter(Boolean))) + '</text>');
    }
    var heatCols = p.heat.map(function (h) { return h[0]; });
    if (heatCols.length) {
      var hx = (colX(Math.min.apply(null, heatCols)) + colX(Math.max.apply(null, heatCols) + 1)) / 2;
      var hTop = Math.max.apply(null, p.heat.map(function (h) { return h[1] + h.length - 3; }));
      o.push('<text class="strong sans mid" x="' + r1(hx) + '" y="' + r1(YA(hTop * LOG2) - 10) + '">P-1: ' + fmt(p.heat_factors) + ' prime factors</text>');
    }
    if (firstTodo >= 0) {
      var todoOdd = 0;
      for (i = firstTodo; i < cols; i++) if (p.state[i] === 't') todoOdd += p.odd[i];
      o.push('<text class="sans mid" x="' + r1((colX(firstTodo) + G.R) / 2) + '" y="' + r1(YA(4)) + '">Not started · ' + fmt(todoOdd) + ' odd n</text>');
    }
    o.push(legendBox(p, sum, colX(firstTodo >= 0 ? firstTodo : cols) + 0));

    // guides: our record, the median next prime, two million digits
    var M2 = M.median(sum.frontier), guides = [];
    if (site.record && site.record.beats_from_n) {
      guides.push({ n: site.record.beats_from_n, cls: '', side: 'end', text: 'n ≥ ' + fmt(site.record.beats_from_n) + ' beats our record ' + site.record.label.replace(/\^(\d+)/g, function (mm, e) { return S.sup(e); }) });
    }
    guides.push({ n: M2, cls: 'accent', side: 'start', text: 'median next prime ≈ ' + (M2 / 1e6).toFixed(2) + 'M' });
    if (site.goal) guides.push({ n: site.goal.from_n, cls: 'muted', side: 'start', text: fmt(site.goal.digits) + ' digits (n ≥ ' + fmt(site.goal.from_n) + ')' });
    guides.forEach(function (gd) {
      var x = r1(X(gd.n));
      o.push('<line class="guide ' + gd.cls + '" x1="' + x + '" y1="18" x2="' + x + '" y2="' + G.BB + '"></line>');
      o.push('<text class="' + (gd.side === 'end' ? 'end ' : '') + (gd.cls === 'accent' ? 'accent' : gd.cls === '' ? 'strong' : '') +
        '" x="' + (gd.side === 'end' ? x - 6 : x + 6) + '" y="12">' + esc(gd.text) + '</text>');
    });

    // known primes along the top
    o.push(primeMarks(primes, X));

    // frontier
    var xf = r1(X(sum.frontier));
    o.push('<path class="marker" d="M' + xf + ' ' + (G.BB + 25) + ' L' + r1(xf - 4) + ' ' + (G.BB + 33) + ' L' + r1(+xf + 4) + ' ' + (G.BB + 33) + ' Z"></path>');
    o.push('<text class="strong" x="' + r1(+xf + 10) + '" y="' + (G.BB + 42) + '">frontier n = ' + fmt(sum.frontier) + '</text>');

    // hover layer
    o.push('<line class="xhair" x1="0" y1="' + G.AT + '" x2="0" y2="' + G.BB + '" visibility="hidden"></line>');
    o.push('</svg>');

    var host = document.getElementById('bigchart');
    host.innerHTML = o.join('');
    renderBigLegend();
    bindHover(host.querySelector('svg'), p, sum, primes, site, { X: X, colX: colX, YA: YA, est: est, nextDepth: nextDepth });
  }

  function legendBox(p, sum, xStart) {
    var w = 292, x = Math.max(xStart + 220, G.R - 10 - w), y = G.AT + 12;
    var date = new Date(S.dayNumber(sum.generated) * 864e5);
    var names = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
    var day = date.getUTCDate() + ' ' + names[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
    var o = ['<g class="legend-box">', '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="114" rx="4"></rect>'];
    o.push('<text class="strong sans" x="' + (x + 12) + '" y="' + (y + 20) + '">P-1 factors per cell</text>');
    o.push('<text class="end" x="' + (x + w - 12) + '" y="' + (y + 20) + '">' + day + '</text>');
    HEAT.forEach(function (lo, k) {
      var sx = x + 12 + k * 54;
      o.push('<rect class="heat-' + k + '" x="' + sx + '" y="' + (y + 30) + '" width="50" height="10"></rect>');
      o.push('<text class="mid" x="' + (sx + 25) + '" y="' + (y + 54) + '">' + heatLabel(k) + '</text>');
    });
    o.push('<text x="' + (x + 12) + '" y="' + (y + 74) + '">one cell: ' + fmt(p.bucket) + ' n × 1 bit of p</text>');
    o.push('<text x="' + (x + 12) + '" y="' + (y + 90) + '">' + fmt(p.heat_factors) + ' primes from ' + fmt(sum.counts.pm1_runs) + ' runs,</text>');
    o.push('<text x="' + (x + 12) + '" y="' + (y + 104) + '">' + fmt(sum.counts.pm1_factors) + ' n factored</text>');
    o.push('</g>');
    return o.join('');
  }

  function primeMarks(primes, X) {
    var o = [], rows = [68, 54, 40, 26], taken = { 68: [], 54: [], 40: [], 26: [] };
    var big = primes.filter(function (n) { return n >= 400000; });
    var small = primes.filter(function (n) { return n < 400000; });
    function fits(y, a, b) { return taken[y].every(function (s) { return b < s[0] - 6 || a > s[1] + 6; }); }
    var labels = [], leaders = [];
    if (small.length) {
      var t = small.length + ' primes with n ≤ ' + fmt(small[small.length - 1]);
      var w = t.length * 6.6;
      taken[26].push([G.L - 2, G.L - 2 + w]);
      labels.push('<text class="prime" x="' + (G.L - 2) + '" y="26">' + t + '</text>');
      leaders.push('<line x1="' + r1(X(small[small.length - 1])) + '" y1="30" x2="' + r1(X(small[small.length - 1])) + '" y2="74"></line>');
    }
    big.slice().reverse().forEach(function (n, idx) {
      var x = X(n), w2 = fmt(n).length * 6.7 / 2 + 2;
      for (var r = 0; r < rows.length; r++) {
        var y = rows[r];
        if (fits(y, x - w2, x + w2)) {
          taken[y].push([x - w2, x + w2]);
          labels.push('<text class="mid prime"' + (idx === 0 ? ' style="font-weight:600"' : '') + ' x="' + r1(x) + '" y="' + y + '">' + fmt(n) + '</text>');
          if (y < 68) leaders.push('<line x1="' + r1(x) + '" y1="' + (y + 4) + '" x2="' + r1(x) + '" y2="74"></line>');
          break;
        }
      }
    });
    o.push('<g class="pticks-thin">' + leaders.join('') + '</g>', labels.join(''));
    o.push('<g class="pticks">' + primes.map(function (n) {
      var x = r1(X(n) + (n < 25000 ? 0.6 : 0));
      return '<line x1="' + x + '" y1="74" x2="' + x + '" y2="' + (G.AT - 2) + '"></line>';
    }).join('') + '</g>');
    return o.join('');
  }

  function ariaText(p, sum, primes, site) {
    var done = p.state.split('').filter(function (s) { return s === 'd'; }).length * p.bucket;
    var depths = p.depth.filter(Boolean), cols = p.heat.map(function (h) { return h[0]; });
    var sieveText = depths.length ? 'The sieve has found every factor below ' + S.depth(Math.min.apply(null, depths)) + ' to ' + S.depth(Math.max.apply(null, depths)) +
      ', depending on the range, for n below ' + fmt(done) + '. ' : 'Nothing is sieved yet. ';
    var pm1Text = cols.length ? 'P-1 found ' + fmt(p.heat_factors) + ' larger prime factors for n from ' + S.M(Math.min.apply(null, cols) * p.bucket) + ' to ' +
      S.M((Math.max.apply(null, cols) + 1) * p.bucket) + '. ' : '';
    return 'Every odd n below 10 million in columns of ' + fmt(p.bucket) + '. Top: factor sizes. ' + sieveText + pm1Text +
      'Bottom: the n each column has left after the sieve, all PRP-tested or factored below ' +
      fmt(sum.frontier) + '. ' + primes.length + ' known primes, the largest n = ' + fmt(primes[primes.length - 1]) + '. ' +
      (site.active ? 'Next: sieve ' + S.M(site.active.lo) + ' to ' + S.M(site.active.hi) + '.' : '');
  }

  function renderBigLegend() {
    var keys = [
      ['sieved', 'Sieved'],
      ['plan', 'Sieve planned'],
      ['st-comp', 'PRP-tested composite'],
      ['st-pm1', 'Factored by P-1'],
      ['st-open', 'Not tested yet'],
      ['tick', 'Known prime']
    ];
    document.getElementById('big-legend').innerHTML = keys.map(function (k) {
      return '<span><i class="key ' + k[0] + '" aria-hidden="true"></i>' + k[1] + '</span>';
    }).join('') + '<span class="muted">Hover or tap a column for its numbers · <a href="ranges.html">table view</a></span>';
  }

  /* ---------- hover and keyboard readout ---------- */
  function bindHover(svg, p, sum, primes, site, geo) {
    var wrap = document.getElementById('big-wrap'), tip = document.getElementById('big-tip');
    var xh = svg.querySelector('.xhair'), cols = p.state.length, cur = -1;
    var heatBy = {};
    p.heat.forEach(function (h) { heatBy[h[0]] = h; });

    function locate(e) {
      var r = svg.getBoundingClientRect();
      var sx = (e.clientX - r.left) / r.width * G.w, sy = (e.clientY - r.top) / r.height * G.h;
      return { col: Math.floor((sx - G.L) / (G.R - G.L) * cols), y: sy };
    }
    function show(col, sy, cx, cy) {
      if (col < 0 || col >= cols) { hide(); return; }
      cur = col;
      var x = r1(geo.colX(col + 0.5));
      xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
      fillTip(col, sy);
      tip.hidden = false;
      var wr = wrap.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      var lx = cx - wr.left + 16;
      if (lx + tw > wr.width) lx = cx - wr.left - 16 - tw;
      lx = Math.max(0, Math.min(lx, wr.width - tw));
      var ty = Math.max(0, Math.min(cy - wr.top - th / 2, wr.height - th));
      tip.style.left = Math.round(lx) + 'px';
      tip.style.top = Math.round(ty) + 'px';
    }
    function hide() {
      tip.hidden = true;
      xh.setAttribute('visibility', 'hidden');
    }
    function showAtColumn(col) {
      var r = svg.getBoundingClientRect();
      var cx = r.left + (geo.colX(col + 0.5) / G.w) * r.width;
      show(col, null, cx, r.top + r.height * 0.3);
    }
    svg.addEventListener('pointermove', function (e) { var a = locate(e); show(a.col, a.y, e.clientX, e.clientY); });
    svg.addEventListener('pointerdown', function (e) { var a = locate(e); show(a.col, a.y, e.clientX, e.clientY); });
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('focus', function () { showAtColumn(cur >= 0 ? cur : Math.min(cols - 1, Math.floor(sum.frontier / p.bucket))); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 10 : 1, to = cur < 0 ? 0 : cur;
      if (e.key === 'ArrowRight') to = Math.min(cols - 1, to + step);
      else if (e.key === 'ArrowLeft') to = Math.max(0, to - step);
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = cols - 1;
      else if (e.key === 'Escape') { hide(); return; }
      else return;
      e.preventDefault();
      showAtColumn(to);
    });

    function row(tbody, value, label, key) {
      var tr = document.createElement('tr');
      var a = document.createElement('td'), b = document.createElement('td');
      a.className = 'v'; b.className = 'l';
      a.textContent = value;
      if (key) { var i = document.createElement('i'); i.className = 'lk ' + key; b.appendChild(i); }
      b.appendChild(document.createTextNode(label));
      tr.appendChild(a); tr.appendChild(b);
      tbody.appendChild(tr);
    }
    function fillTip(col, sy) {
      var lo = col * p.bucket, hi = lo + p.bucket, st = p.state[col];
      tip.textContent = '';
      var h = document.createElement('div');
      h.className = 'tip-head';
      h.textContent = fmt(lo) + ' ≤ n < ' + fmt(hi);
      tip.appendChild(h);
      var table = document.createElement('table'), tb = document.createElement('tbody');
      table.appendChild(tb);
      tip.appendChild(table);
      row(tb, fmt(p.odd[col]), 'odd n');
      var here = primes.filter(function (n) { return n >= lo && n < hi; });
      if (st === 'd' || st === 'p') {
        row(tb, fmt(p.removed[col]), 'removed by the sieve, p < ' + S.depth(p.depth[col]), 'sieved');
        row(tb, fmt(p.comp[col]), 'PRP-tested composite', 'st-comp');
        if (p.pm1[col]) row(tb, fmt(p.pm1[col]), 'factored by P-1', 'st-pm1');
        if (p.open[col]) row(tb, fmt(p.open[col]), 'not tested yet', 'st-open');
      } else if (st === 's') {
        row(tb, '≈ ' + fmt(Math.round(geo.est(col))), 'expected to survive p < ' + S.depth(geo.nextDepth), 'plan');
        var note = document.createElement('p');
        note.textContent = 'Not sieved yet. Sieving ' + S.M(site.active.lo) + '–' + S.M(site.active.hi) + ' comes next, then PRP tests from the smallest n.';
        tip.appendChild(note);
      } else {
        var none = document.createElement('p');
        none.textContent = 'Not started: no sieve and no tests yet.';
        tip.appendChild(none);
      }
      if (here.length) row(tb, fmt(here.length), here.length === 1 ? 'prime: n = ' + fmt(here[0]) : 'primes, n = ' + fmt(here[0]) + ' … ' + fmt(here[here.length - 1]), 'tick');
      var hrow = heatBy[col];
      if (hrow) {
        var tot = 0, k0 = hrow[1], k1 = k0 + hrow.length - 3;
        for (var k = 2; k < hrow.length; k++) tot += hrow[k];
        row(tb, fmt(tot), 'P-1 prime factors, ' + k0 + '–' + k1 + ' bits', 'heat-2');
        if (sy !== null && sy >= G.AT && sy <= G.AB) {
          var bits = Math.floor((G.AB - sy) / (G.AB - G.AT) * G.DEC / LOG2) + 1;
          var cnt = bits >= k0 && bits <= k1 ? hrow[bits - k0 + 2] : 0;
          if (cnt || (bits >= k0 && bits <= k1)) {
            var f = document.createElement('p');
            f.className = 'tip-cell';
            f.textContent = (cnt ? fmt(cnt) + (cnt === 1 ? ' factor' : ' factors') : 'No factor') + ' of ' + bits + ' bits here (p ≈ ' + sci(Math.pow(2, bits - 1)) + ' – ' + sci(Math.pow(2, bits)) + ')';
            tip.appendChild(f);
          }
        }
      }
    }
  }

  /* ---------- the rest of the page ---------- */
  function renderNow(ranges, site, M, act, frontier) {
    var rows = ranges.rows.filter(function (r) { return r.lo >= act.lo && r.lo < act.hi; });
    var odd = rows.reduce(function (s, r) { return s + r.odd; }, 0);
    var sieved = rows.length && rows.every(function (r) { return r.sieved; });
    var depth = sieved ? Math.min.apply(null, rows.map(function (r) { return r.sieve.depth || 0; })) : 0;
    var tested = rows.reduce(function (s, r) { return s + r.prp.tests; }, 0);
    var cands = sieved ? rows.reduce(function (s, r) { return s + (r.survivors || 0) - r.pm1.factors; }, 0) : 0;
    var target = site.sieve_target || 1e14;
    var tLog = Math.log10(target);
    var lowEst = Math.round(M.survivors(odd, target) / 100) * 100, highEst = Math.round(M.survivors(odd, 1e12) / 100) * 100;
    var badge = site.active && site.active.badge ? '<span class="pill accent">' + esc(site.active.badge) + '</span>' : '';
    var h = [];
    h.push('<div class="card-head"><h2>Now: <span class="mono">' + fmt(act.lo) + ' ≤ n &lt; ' + fmt(act.hi) + '</span></h2>' + badge + '</div>');
    if (site.active && site.active.note) h.push('<p>' + S.supHTML(esc(site.active.note)) + '</p>');
    h.push('<div class="stages">' + (site.stages || []).map(function (st) {
      return '<div class="stage ' + (st.state === 'next' ? 'next' : '') + '"><div class="tag">' + S.supHTML(esc(st.tag)) + '</div><div class="t">' +
        S.supHTML(esc(st.title)) + '</div><div class="w">' + esc(st.where) + '</div><div class="f">' + esc(st.figure) + '</div></div>';
    }).join('') + '</div>');
    var depthPct = depth ? Math.min(100, Math.log10(depth) / tLog * 100) : 0;
    var tk = [12, 13].filter(function (e) { return e < tLog; });
    h.push('<div class="meters"><div><div class="meter-label"><span>Sieve depth (log scale)</span><span class="mono">' +
      (depth ? 'p &lt; ' + S.depth(depth) : 'not started') + ' · target ' + S.depth(target) + '</span></div>' +
      '<div class="meter">' + (depthPct ? '<i style="width:' + depthPct.toFixed(1) + '%"></i>' : '') +
      tk.map(function (e) { return '<b style="left:' + (e / tLog * 100).toFixed(1) + '%"></b>'; }).join('') + '</div>' +
      '<div class="meter-ticks"><span style="left:0">1</span>' + tk.map(function (e) {
        return '<span style="left:' + (e / tLog * 100).toFixed(1) + '%">' + S.tenTo(e) + '</span>';
      }).join('') + '<span>' + S.tenTo(Math.round(tLog)) + '</span></div></div>');
    var prpPct = cands ? tested / cands * 100 : 0;
    h.push('<div><div class="meter-label"><span>PRP tests in range</span><span class="mono">' +
      (cands ? fmt(tested) + ' of ' + fmt(cands) : fmt(tested) + ' of ≈ ' + fmt(lowEst) + '–' + fmt(highEst)) + '</span></div>' +
      '<div class="meter">' + (prpPct ? '<i style="width:' + prpPct.toFixed(1) + '%"></i>' : '') + '</div></div></div>');
    document.getElementById('now').innerHTML = h.join('');
  }

  function renderOutlook(site, M, act, frontier, median) {
    var a = Math.max(frontier, act.lo), b = act.hi;
    var lines = [[a, b], [b, 1e7], [frontier, 1e7]].filter(function (r) { return r[1] > r[0]; });
    var h = ['<h2>Outlook</h2><p>Expected primes in [a, b) ≈ C · ln(b/a), with C ≈ ' + M.C + ' fitted to the primes found so far.</p>'];
    h.push('<div class="table-wrap"><table class="data"><thead><tr><th>Range</th><th class="r">Expected</th><th class="r">P(≥ 1)</th></tr></thead><tbody>' +
      lines.map(function (r, i) {
        var last = i === lines.length - 1;
        return '<tr><td>' + S.M(r[0]) + '–' + S.M(r[1]) + '</td><td class="r">' + M.expected(r[0], r[1]).toFixed(2) + '</td><td class="r' +
          (last ? ' accent-text' : '') + '" style="font-weight:600">' + Math.round(M.pAny(r[0], r[1]) * 100) + '%</td></tr>';
      }).join('') + '</tbody></table></div>');
    h.push('<div class="kv"><div><span>Median next prime</span><span>n ≈ ' + fmt(Math.round(median / 1000) * 1000) + '</span></div>' +
      '<div><span>Its size</span><span>≈ ' + fmt(Math.round(S.digits(Math.round(median)) / 1000) * 1000) + ' digits</span></div>' +
      (site.goal ? '<div><span>Goal: ' + fmt(site.goal.digits) + ' digits</span><span>n ≥ ' + fmt(site.goal.from_n) + '</span></div>' : '') + '</div>');
    document.getElementById('outlook').innerHTML = h.join('');
  }

  /* The frontier and the PRP results per day since site.status_since; the full story is on the History page. */
  function renderSince(sum, site, act) {
    var since = site.status_since || '2026-11-01';
    var d0 = S.dayNumber(since), today = S.dayNumber(sum.generated);
    var d1 = Math.max(today + 4, d0 + 60);
    var series = sum.frontier_series || [];
    var v0 = 0, moved = false;
    series.forEach(function (pt) {
      if (S.dayNumber(pt[0]) <= d0) v0 = pt[1];
      else moved = true;
    });
    var y0 = Math.max(0, Math.floor((v0 - 1e5) / 2e5) * 2e5);
    var y1 = Math.max(act.hi || 0, Math.ceil((sum.frontier + 1e5) / 2e5) * 2e5);
    var badge = site.active && site.active.badge ? site.active.badge.toLowerCase() : '';
    document.getElementById('since-label').textContent = 'since ' + since;
    document.getElementById('frontier-chart').innerHTML = S.frontierChart(series, {
      d0: d0, d1: d1, y0: y0, y1: y1, yStep: 2e5, today: today, frontier: sum.frontier, frontierDate: sum.frontier_date,
      todayLabel: 'today' + (badge ? ' · ' + badge : ''),
      note: moved ? '' : 'Unchanged since ' + sum.frontier_date + ': PRP tests resume once ' + S.M(act.lo) + '–' + S.M(act.hi) + ' is sieved to ' + S.depth(site.prp_from_depth || 1e12),
      aria: 'Search frontier since ' + since + ': ' + fmt(sum.frontier) + (moved ? '' : ', unchanged since ' + sum.frontier_date) + '.'
    });
    var days = sum.daily_prp || [];
    var recent = days.filter(function (d) { return S.dayNumber(d[0]) >= d0; });
    var total = recent.reduce(function (s, d) { return s + d[1]; }, 0);
    document.getElementById('daily-chart').innerHTML = S.dailyChart(days, {
      d0: d0, d1: d1, log: false, empty: 'No PRP results since ' + since + ' yet.',
      aria: 'PRP results per day since ' + since + ': ' + fmt(total) + ' in all.'
    });
    document.getElementById('daily-note').textContent = recent.length
      ? fmt(total) + ' results on ' + recent.length + ' day' + (recent.length === 1 ? '' : 's') + ' · ' + fmt(Math.round(total / recent.length)) + ' / active day'
      : 'none yet · the last was on ' + S.day(sum.last_result);
  }

  function renderLatest(sum, site) {
    var rows = (sum.latest || []).slice(0, 8);
    var showWho = rows.some(function (r) { return r.who && r.who !== site.credit; });
    var h = '<table class="data"><thead><tr><th>Time (UTC)</th><th class="r">n</th><th class="text">Result</th><th>Res64</th><th class="r">FFT</th>' +
      (showWho ? '<th class="text">By</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        var prime = r.s === 'P' || r.s === 'R';
        return '<tr><td>' + esc(S.minute(r.t)) + '</td><td class="r"><a href="exponent.html?n=' + r.n + '">' + fmt(r.n) + '</a></td><td class="text ' +
          (prime ? 'prime-text' : 'muted') + '">' + (r.s === 'R' ? 'Probable prime (being verified)' : prime ? 'Probable prime' : 'Composite') + '</td><td class="muted">' + esc(r.res64 || '—') +
          '</td><td class="r">' + S.fft(r.fft) + '</td>' + (showWho ? '<td class="text">' + esc(r.who) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
    document.getElementById('latest').innerHTML = rows.length ? h : '<p class="small">No results yet.</p>';
  }

  function renderTop(primes, doc) {
    var top = primes.slice(-5).reverse();
    document.getElementById('toplist').innerHTML = top.map(function (p) {
      return '<li><a class="pn" href="exponent.html?n=' + p.n + '">2<sup>' + fmt(p.n) + '</sup> − 25</a><span class="pd">' + fmt(p.digits) + ' digits</span>' +
        '<span class="pm">' + esc(S.day(p.found)) + (p.rank ? ' · Top PRP ' + esc(p.rank) : '') + '</span><span></span></li>';
    }).join('');
    document.getElementById('all-primes-link').textContent = 'All ' + primes.length + ' →';
    document.getElementById('rank-note').textContent = doc.rank_date ? 'Top PRP rank as listed on ' + doc.rank_date + '.' : '';
  }
})();
