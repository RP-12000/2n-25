/* Status page: the big chart of every odd n below 10^7 by the size of its smallest factor, key numbers, active range, outlook,
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
    renderSince(sum, site, act, ranges);
    renderLatest(sum, site);
    renderTop(primes, primesDoc);
  }

  /* ---------- the big chart: every odd n below 10^7, by the size of its smallest factor ---------- */
  // viewBox 1160 × 668: guide labels, prime labels, one panel, n axis, and the layer names on the right.
  // A column stacks the odd n of 25,000 n. At the bottom: the n the sieve left, PRP-tested composites lowest,
  // then the n not tested yet and the n P-1 factored. Above them: the n the sieve removed, one layer per power
  // of ten of their smallest factor p, the largest factors lowest, so a column reads like the search itself:
  // all odd n at the top, then the sieve, P-1 and PRP on the way down.
  // Factors below 10^7 take any program seconds, so those layers are known in every column; in a column not
  // sieved yet the n without such a factor sit at the bottom. The chart shows the lowest 2,000 n of each
  // column, where the sieve works; the rest of a column holds small factors and is cut off at the top.
  // The P-1 factor sizes of the earlier work are drawn on the History page.
  var G = { w: 1160, h: 668, L: 64, R: 1100, T: 96, B: 616 };
  var SHOWN = 2000, LY_MAX = 14;   // ly-0 … ly-14 in site.css; larger factors take the last colour

  function bigChart(p, sum, primesDoc, site) {
    var M = S.model(site);
    var B = p.bucket, cols = p.state.length, i;
    var act = site.active || {};
    var c = {
      p: p, sum: sum, site: site, B: B, cols: cols, nmax: B * cols,
      primes: primesDoc.primes.map(function (q) { return q.n; }).sort(function (a, b) { return a - b; }),
      median: M.median(sum.frontier), actCols: []
    };
    // the columns of the active range
    for (i = 0; i < cols; i++) if (act.hi && i * B >= act.lo && i * B < act.hi) c.actCols.push(i);

    c.cutK = cutDecade(p);
    renderBigScale();
    renderBigNote(c);
    renderBigLegend(c);
    drawBig(c);
  }

  function leftOf(p, col) { return p.pm1[col] + p.comp[col] + p.prime[col] + p.open[col]; }
  function layersOf(p, col) { return (p.layers && p.layers[col]) || []; }
  function sumOf(a) { return a.reduce(function (s, x) { return s + x; }, 0); }
  /* The n of a column with no factor below its layers' limit and no result: a column not sieved yet. */
  function restOf(p, col) { return Math.max(0, p.odd[col] - leftOf(p, col) - sumOf(layersOf(p, col))); }

  /* One column from the bottom up: [class, count]. P-1 sits on top of what the sieve left, right under its layers. */
  function stackOf(p, col) {
    var out = [['st-comp', p.comp[col]], ['st-prime', p.prime[col]], ['st-open', p.open[col]], ['st-pm1', p.pm1[col]]];
    var rest = restOf(p, col), ly = layersOf(p, col);
    if (rest) out.push([p.state[col] === 's' ? 'plan-wash' : 'todo', rest]);
    for (var k = ly.length - 1; k >= 0; k--) out.push(['ly-' + Math.min(k, LY_MAX), ly[k]]);
    return out;
  }

  /* The factors of layer k: "p = 7", "10 – 10²", "10⁹ – 10¹⁰". A power of ten the sieve has only partly covered
     still counts as a whole layer; the exponent page shows exactly how far it went. */
  function layerName(k) {
    if (k === 0) return 'p = 7';
    return (k === 1 ? '10' : S.tenTo(k)) + ' – ' + S.tenTo(k + 1);
  }

  /* The smallest k such that every column fits within SHOWN once the n with a factor below 10^k are left out:
     the n cut off at the top of the chart all have such a factor. */
  function cutDecade(p) {
    for (var k = 1; k <= LY_MAX + 1; k++) {
      var fits = true;
      for (var col = 0; col < p.odd.length && fits; col++) {
        var ly = layersOf(p, col);
        fits = p.odd[col] - sumOf(ly.slice(0, k)) <= SHOWN;
      }
      if (fits) return k;
    }
    return 0;
  }

  function drawBig(c) {
    var p = c.p, B = c.B, cols = c.cols, i, v, m;
    var X = function (n) { return G.L + n / c.nmax * (G.R - G.L); };
    var colX = function (col) { return X(col * B); };
    var top = SHOWN;
    var Y = function (n) { return G.B - Math.min(n, top) / top * (G.B - G.T); };
    var o = ['<svg class="chart big" viewBox="0 0 ' + G.w + ' ' + G.h + '" tabindex="0" role="img" aria-label="' + esc(ariaText(c)) + '">'];

    // the columns, one path per layer
    var parts = {}, order = [];
    for (i = 0; i < cols; i++) {
      var x0 = r1(colX(i)), x1 = r1(colX(i + 1)), base = 0;
      stackOf(p, i).forEach(function (s) {
        if (s[1] && base < top) {
          if (!(s[0] in parts)) { parts[s[0]] = ''; order.push(s[0]); }
          parts[s[0]] += 'M' + x0 + ' ' + r1(Y(base)) + 'V' + r1(Y(base + s[1])) + 'H' + x1 + 'V' + r1(Y(base)) + 'Z';
        }
        base += s[1];
      });
    }
    o.push('<g class="crisp">' + order.map(function (cls) { return '<path class="' + cls + '" d="' + parts[cls] + '"></path>'; }).join('') + '</g>');

    // grid, drawn over the layers in the colour of the page
    var g = [], gStep = 250;
    for (m = 1; m < 10; m++) { var gx = r1(X(m * 1e6)); g.push('<line x1="' + gx + '" y1="' + G.T + '" x2="' + gx + '" y2="' + G.B + '"></line>'); }
    for (v = gStep; v < top; v += gStep) g.push('<line x1="' + G.L + '" y1="' + r1(Y(v)) + '" x2="' + G.R + '" y2="' + r1(Y(v)) + '"></line>');
    o.push('<g class="grid over">' + g.join('') + '</g>');

    // the layers of the last column, named on the right
    var lastCol = cols - 1, base2 = 0, names = [];
    stackOf(p, lastCol).forEach(function (s) {
      var lo2 = base2, hi2 = Math.min(base2 + s[1], top);
      base2 += s[1];
      if (!s[1] || lo2 >= top || Y(lo2) - Y(hi2) < 9) return;
      var name = s[0].indexOf('ly-') === 0 ? layerName(+s[0].slice(3)) :
        (s[0] === 'todo' || s[0] === 'plan-wash') ? '≥ 10⁷' : '';
      if (name) names.push('<text x="' + (G.R + 6) + '" y="' + r1((Y(lo2) + Y(hi2)) / 2 + 4) + '">' + name.replace(' – ', '–') + '</text>');
    });
    o.push('<text class="axis-title end" x="' + (G.w - 2) + '" y="' + (G.T - 8) + '">SMALLEST p</text>', names.join(''));

    // axes
    var ax = ['<line class="axis" x1="' + G.L + '" y1="' + G.B + '" x2="' + G.R + '" y2="' + G.B + '"></line>'];
    var lStep = 500;
    for (v = 0; v <= top; v += lStep) ax.push('<text class="end" x="' + (G.L - 8) + '" y="' + r1(Y(v) + 4) + '">' + (v ? fmt(v) : '0') + '</text>');
    for (m = 0; m <= 10; m++) {
      var tx = r1(X(m * 1e6));
      ax.push('<line class="ticks" x1="' + tx + '" y1="' + G.B + '" x2="' + tx + '" y2="' + (G.B + 5) + '"></line>');
      ax.push('<text class="mid" x="' + tx + '" y="' + (G.B + 18) + '">' + (m ? m + 'M' : '0') + '</text>');
    }
    var midY = (G.T + G.B) / 2;
    ax.push('<text class="axis-title mid" transform="rotate(-90 14 ' + midY + ')" x="14" y="' + midY + '">ODD n PER ' + fmt(B) + '</text>');
    o.push(ax.join(''));

    // guides: our record, the median next prime, two million digits
    var site = c.site, guides = [];
    if (site.record && site.record.beats_from_n) {
      guides.push({ n: site.record.beats_from_n, cls: '', side: 'end', text: 'n ≥ ' + fmt(site.record.beats_from_n) + ' beats our record ' + site.record.label.replace(/\^(\d+)/g, function (mm, e) { return S.sup(e); }) });
    }
    guides.push({ n: c.median, cls: 'accent', side: 'start', text: 'median next prime ≈ ' + (c.median / 1e6).toFixed(2) + 'M' });
    if (site.goal) guides.push({ n: site.goal.from_n, cls: 'muted', side: 'start', text: fmt(site.goal.digits) + ' digits (n ≥ ' + fmt(site.goal.from_n) + ')' });
    guides.forEach(function (gd) {
      var x = r1(X(gd.n));
      o.push('<line class="guide ' + gd.cls + '" x1="' + x + '" y1="18" x2="' + x + '" y2="' + G.B + '"></line>');
      o.push('<text class="' + (gd.side === 'end' ? 'end ' : '') + (gd.cls === 'accent' ? 'accent' : gd.cls === '' ? 'strong' : '') +
        '" x="' + (gd.side === 'end' ? x - 6 : x + 6) + '" y="12">' + esc(gd.text) + '</text>');
    });

    // known primes along the top
    o.push(primeMarks(c.primes, X));

    // frontier
    var xf = r1(X(c.sum.frontier));
    o.push('<path class="marker" d="M' + xf + ' ' + (G.B + 25) + ' L' + r1(xf - 4) + ' ' + (G.B + 33) + ' L' + r1(+xf + 4) + ' ' + (G.B + 33) + ' Z"></path>');
    o.push('<text class="strong" x="' + r1(+xf + 10) + '" y="' + (G.B + 42) + '">frontier n = ' + fmt(c.sum.frontier) + '</text>');

    // hover layer
    o.push('<line class="xhair" x1="0" y1="' + G.T + '" x2="0" y2="' + G.B + '" visibility="hidden"></line>');
    o.push('</svg>');

    var host = document.getElementById('bigchart');
    host.innerHTML = o.join('');
    S.columnHover(host.querySelector('svg'), {
      wrap: document.getElementById('big-wrap'), tip: document.getElementById('big-tip'),
      w: G.w, h: G.h, L: G.L, R: G.R, cols: cols, colX: colX, start: Math.floor(c.sum.frontier / B),
      fill: function (col) { fillTip(c, col); }
    });
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
      return '<line x1="' + x + '" y1="74" x2="' + x + '" y2="' + (G.T - 2) + '"></line>';
    }).join('') + '</g>');
    return o.join('');
  }

  function ariaText(c) {
    var p = c.p, act = c.site.active, depths = [], actDepths = c.actCols.map(function (k) { return p.depth[k]; });
    for (var k = 0; k < c.cols && (k + 1) * p.bucket <= c.sum.frontier; k++) if (p.depth[k]) depths.push(p.depth[k]);
    var t = 'Every odd n below 10 million in columns of ' + fmt(p.bucket) + ', the lowest ' + fmt(SHOWN) + ' of each column' +
      (c.cutK ? ' (the n above that all have a factor below 10 to the ' + c.cutK + ')' : '') +
      '. At the bottom the n the sieve left: PRP-tested composites, then the n factored by P-1; above them the n the sieve removed, layered by the power of ten of the smallest factor of 2^n − 25. ';
    var dMin = Math.min.apply(null, depths), dMax = Math.max.apply(null, depths);
    t += depths.length ? 'Below ' + fmt(c.sum.frontier) + ' the sieve went to p ' + (dMin === dMax ? '< ' + S.depth(dMin) : 'between ' + S.depth(dMin) + ' and ' + S.depth(dMax)) +
      ', and every n it left is PRP-tested or factored. ' : 'Nothing is sieved yet. ';
    if (act && actDepths.length && actDepths.every(Boolean)) {
      t += 'From ' + S.M(act.lo) + ' to ' + S.M(act.hi) + ' the sieve went to p < ' + S.depth(Math.min.apply(null, actDepths)) + ', and the n it left wait for PRP tests. ';
    }
    t += 'Above that, only the factors below 10 million are known. ';
    return t + c.primes.length + ' known primes, the largest n = ' + fmt(c.primes[c.primes.length - 1]) + '.';
  }

  /* The colour scale above the chart: one swatch per power of ten of p. */
  function renderBigScale() {
    var h = ['<div class="scale-title">Removed by the sieve: the smallest factor p of 2<sup>n</sup> − 25</div><div class="scale-bar" aria-hidden="true">'];
    for (var k = 0; k <= LY_MAX; k++) h.push('<i class="ly-' + k + '"></i>');
    h.push('</div><div class="scale-ticks" aria-hidden="true">');
    [0, 3, 6, 9, 12, 15].forEach(function (e) { h.push('<span style="left:' + (e / 15 * 100).toFixed(2) + '%">' + S.tenTo(e) + '</span>'); });
    h.push('</div>');
    var el = document.getElementById('big-scale');
    el.innerHTML = h.join('');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Colour scale: grey for smallest factors below 10 million, from light (p = 7) to dark; teal from 10 million up to 10 to the 15, from light to dark.');
  }

  /* Beside the colour scale: how much of each column the chart shows. */
  function renderBigNote(c) {
    var odd = Math.max.apply(null, c.p.odd);
    document.getElementById('big-note').innerHTML = 'The lowest ' + fmt(SHOWN) + ' of the ' + fmt(odd) + ' odd n in each column' +
      (c.cutK ? '. The n cut off at the top all have a factor below ' + S.tenTo(c.cutK) + '.' : '.');
  }

  function renderBigLegend(c) {
    var p = c.p, has = function (key) { return p[key].some(function (x) { return x > 0; }); };
    var keys = [['st-pm1', 'Factored by P-1']];
    if (has('open')) keys.push(['st-open', 'Left by the sieve, not tested yet']);
    keys.push(['st-comp', 'PRP-tested composite']);
    var part = c.actCols.some(function (col) { return layersOf(p, col).slice(7).some(Boolean); });
    var wash = p.state.split('').some(function (s, col) { return s === 's' && restOf(p, col) > 0; });
    if (wash) keys.push(['wash', part ? 'No factor known yet, being sieved' : 'Not sieved yet']);
    if (p.state.indexOf('t') >= 0) keys.push(['todo', 'Not started']);
    keys.push(['tick', 'Known prime']);
    document.getElementById('big-legend').innerHTML = keys.map(function (k) {
      return '<span><i class="key ' + k[0] + '" aria-hidden="true"></i>' + k[1] + '</span>';
    }).join('') + '<span class="muted">Hover or tap a column for its numbers · <a href="ranges.html">table view</a> · <a href="history.html#sieve-pm1">P-1 factor sizes</a></span>';
  }

  /* One column of the big chart, for the hover and keyboard readout. */
  function fillTip(c, col) {
    var p = c.p, lo = col * p.bucket, hi = lo + p.bucket, st = p.state[col];
    var t = S.tipTable(document.getElementById('big-tip'), fmt(lo) + ' ≤ n < ' + fmt(hi));
    var ly = layersOf(p, col), k, part = st === 's' && ly.slice(7).some(Boolean);
    t.add(fmt(p.odd[col]), 'odd n');
    for (k = 0; k < ly.length; k++) if (ly[k]) t.add(fmt(ly[k]), layerName(k), 'sq ly-' + Math.min(k, LY_MAX));
    if (p.depth[col]) {
      t.add(fmt(leftOf(p, col)), 'left by the sieve, p < ' + S.depth(p.depth[col]));
      if (p.pm1[col]) t.add(fmt(p.pm1[col]), 'factored by P-1', 'sq st-pm1');
      if (p.open[col]) t.add(fmt(p.open[col]), 'not tested yet', 'sq st-open');
      if (p.comp[col]) t.add(fmt(p.comp[col]), 'PRP-tested composite', 'sq st-comp');
    } else {
      var rest = restOf(p, col);
      if (rest) t.add(fmt(rest), part ? 'no factor known yet' : 'no factor below 10⁷, not sieved', 'sq ' + (st === 's' ? 'plan-wash' : 'todo'));
    }
    var here = c.primes.filter(function (n) { return n >= lo && n < hi; });
    if (here.length) t.add(fmt(here.length), here.length === 1 ? 'prime: n = ' + fmt(here[0]) : 'primes, n = ' + fmt(here[0]) + ' … ' + fmt(here[here.length - 1]), 'tick');
    if (st === 's') t.note(part ? 'Being sieved: the layers from 10⁷ up hold the factors found so far, by their power of ten; the sieve of the smaller p is still running. PRP tests follow, smallest n first.'
      : 'Not sieved yet. Sieving ' + S.M(c.site.active.lo) + '–' + S.M(c.site.active.hi) + ' comes next, then PRP tests from the smallest n.');
    else if (st === 't') t.note('Not started: no sieve and no tests yet.');
  }

  /* ---------- the rest of the page ---------- */
  function renderNow(ranges, site, M, act, frontier) {
    var rows = ranges.rows.filter(function (r) { return r.lo >= act.lo && r.lo < act.hi; });
    var odd = rows.reduce(function (s, r) { return s + r.odd; }, 0);
    var sieved = rows.length && rows.every(function (r) { return r.sieved; });
    var depth = sieved ? Math.min.apply(null, rows.map(function (r) { return r.sieve.depth || 0; })) : 0;
    var tests = rows.reduce(function (s, r) { return s + r.prp.tests; }, 0);
    // the candidates: what the sieve left, less the n P-1 factored (in a range sieved twice, those the second sieve left)
    var cands = sieved ? rows.reduce(function (s, r) {
      return s + (r.survivors || 0) - (r.pm1.after_sieve !== undefined ? r.pm1.after_sieve : r.pm1.factors || 0);
    }, 0) : 0;
    // the PRP-tested candidates: a sieve run after the PRP tests may have found a factor for some tested n, which
    // then count under the sieve and are no candidates any more
    var tested = sieved ? Math.max(0, cands - rows.reduce(function (s, r) { return s + (r.untested || 0); }, 0)) : tests;
    var refound = Math.max(0, tests - tested);
    var target = S.sieveTarget(site, act.lo).target;
    var lowEst = Math.round(M.survivors(odd, target) / 100) * 100, highEst = Math.round(M.survivors(odd, 1e12) / 100) * 100;
    var badge = site.active && site.active.badge ? '<span class="pill accent">' + esc(site.active.badge) + '</span>' : '';
    var h = [];
    h.push('<div class="card-head"><h2>Now: <span class="mono">' + fmt(act.lo) + ' ≤ n &lt; ' + fmt(act.hi) + '</span></h2>' + badge + '</div>');
    if (site.active && site.active.note) h.push('<p>' + S.supHTML(esc(site.active.note)) + '</p>');
    // a sieve that has not reached the small primes yet: the p ranges done in every row, drawn where they lie
    var spans = !sieved && rows.length && rows.every(function (r) { return r.sieve_part; }) ? rows[0].sieve_part.p.filter(function (sp) {
      return rows.every(function (r) { return r.sieve_part.p.some(function (q) { return q[0] <= sp[0] && q[1] >= sp[1]; }); });
    }) : [];
    // a plain (linear) scale from 0 to 10^15, one cell per 10^14
    var MAX = 1e15, STEP = 1e14, cells = Math.round(MAX / STEP);
    var pos = function (p) { return Math.min(100, Math.max(0, p / MAX * 100)); };
    var depthPct = depth ? pos(depth) : 0;
    var partLabel = spans.length ? S.tenTo(Math.floor(Math.log10(spans[0][0]) + 1e-9)) + ' and up in part' : '';
    var marks = [], k;
    for (k = 1; k < cells; k++) marks.push(k);
    h.push('<div class="meters"><div><div class="meter-label"><span>Sieve depth</span><span class="mono">' +
      (depth ? 'p &lt; ' + S.depth(depth) : partLabel || 'not started') + ' · target ' + S.depth(target) + '</span></div>' +
      '<div class="meter meter-lg" role="img" aria-label="' + esc('Sieve depth ' + (depth ? 'p < ' + S.depth(depth) : partLabel || 'not started') + ', target ' + S.depth(target) + ', on a plain scale from 0 to 10¹⁵') + '">' +
      (depthPct ? '<i style="width:' + Math.max(0.3, depthPct).toFixed(2) + '%"></i>' : '') +
      spans.map(function (sp) { return '<i style="left:' + pos(sp[0]).toFixed(2) + '%;width:' + Math.max(0.3, pos(sp[1]) - pos(sp[0])).toFixed(2) + '%"></i>'; }).join('') +
      marks.map(function (k) { return '<b style="left:' + (k * 100 / cells).toFixed(2) + '%"></b>'; }).join('') +
      (target < MAX ? '<s style="left:' + pos(target).toFixed(2) + '%" title="target ' + S.depth(target) + '"></s>' : '') + '</div>' +
      '<div class="meter-ticks meter-ticks-lg"><span style="left:0">0</span>' + marks.map(function (k) {
        return '<span' + (k % 2 ? ' class="odd"' : '') + ' style="left:' + (k * 100 / cells).toFixed(2) + '%">' + S.depth(k * STEP) + '</span>';
      }).join('') + '<span>' + S.depth(MAX) + '</span></div></div>');
    var prpPct = cands ? tested / cands * 100 : 0;
    var prpTip = cands && refound ? ' title="' + esc(fmt(tests) + ' n in this range have a PRP result; a later sieve run found a factor for ' + fmt(refound) +
      ' of them, so they count under the sieve and are not among the ' + fmt(cands) + ' candidates.') + '"' : '';
    h.push('<div><div class="meter-label"><span>PRP-tested candidates</span><span class="mono"' + prpTip + '>' +
      (cands ? fmt(tested) + ' of ' + fmt(cands) : fmt(tested) + ' of ≈ ' + fmt(lowEst) + '–' + fmt(highEst)) + '</span></div>' +
      '<div class="meter">' + (prpPct ? '<i style="width:' + prpPct.toFixed(1) + '%"></i>' : '') + '</div></div></div>');
    document.getElementById('now').innerHTML = h.join('');
  }

  function renderOutlook(site, M, act, frontier, median) {
    var a = Math.max(frontier, act.lo), b = act.hi;
    var lines = [[a, b], [b, 1e7], [frontier, 1e7]].filter(function (r) { return r[1] > r[0]; });
    var h = ['<h2>Outlook</h2><p>Expected primes in [a, b) ≈ C · ln(b/a), with C ≈ ' + M.C + ' fitted to the primes found so far.</p>'];
    h.push('<div class="outlook-body"><div class="table-wrap"><table class="data"><thead><tr><th>Range</th><th class="r">Expected</th><th class="r">P(≥ 1)</th></tr></thead><tbody>' +
      lines.map(function (r, i) {
        var last = i === lines.length - 1;
        return '<tr><td>' + S.M(r[0]) + '–' + S.M(r[1]) + '</td><td class="r">' + M.expected(r[0], r[1]).toFixed(2) + '</td><td class="r' +
          (last ? ' accent-text' : '') + '" style="font-weight:600">' + Math.round(M.pAny(r[0], r[1]) * 100) + '%</td></tr>';
      }).join('') + '</tbody></table></div>');
    // the key numbers as a second table, so that its rows line up with the first one when the two sit side by side
    var kv = [['Median next prime', 'n ≈ ' + fmt(Math.round(median / 1000) * 1000)],
      ['Its size', '≈ ' + fmt(Math.round(S.digits(Math.round(median)) / 1000) * 1000) + ' digits']];
    if (site.goal) kv.push(['Goal: ' + fmt(site.goal.digits) + ' digits', 'n ≥ ' + fmt(site.goal.from_n)]);
    h.push('<div class="table-wrap"><table class="data kv-table"><thead><tr><th>&nbsp;</th><th></th></tr></thead><tbody>' +
      kv.map(function (r) { return '<tr><td class="text muted">' + r[0] + '</td><td class="r">' + r[1] + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>');
    document.getElementById('outlook').innerHTML = h.join('');
  }

  /* Why the frontier is not moving: PRP waits for the active range to reach site.prp_from_depth, or may resume once it has */
  function waitText(site, act, ranges) {
    var need = site.prp_from_depth || 1e12, span = S.M(act.lo) + '–' + S.M(act.hi);
    var rows = ((ranges && ranges.rows) || []).filter(function (r) { return r.lo >= act.lo && r.hi <= act.hi; });
    var depth = rows.length && rows.every(function (r) { return r.sieve && r.sieve.depth; }) ? Math.min.apply(null, rows.map(function (r) { return r.sieve.depth; })) : 0;
    return depth >= need ? span + ' is sieved to ' + S.depth(depth) + ', so PRP tests can resume' : 'PRP tests resume once ' + span + ' is sieved to ' + S.depth(need);
  }

  /* The frontier and the PRP results per day since site.status_since; the full story is on the History page. */
  function renderSince(sum, site, act, ranges) {
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
    // "Sieving" reads "sieving" after "today ·"; an acronym such as PRP keeps its capitals
    var badge = site.active && site.active.badge ? site.active.badge.replace(/^[A-Z](?=[a-z])/, function (c) { return c.toLowerCase(); }) : '';
    document.getElementById('since-label').textContent = 'since ' + since;
    document.getElementById('frontier-chart').innerHTML = S.frontierChart(series, {
      d0: d0, d1: d1, y0: y0, y1: y1, yStep: 2e5, today: today, frontier: sum.frontier, frontierDate: sum.frontier_date,
      todayLabel: 'today' + (badge ? ' · ' + badge : ''),
      note: moved ? '' : 'Unchanged since ' + sum.frontier_date + ': ' + waitText(site, act, ranges),
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
        '<span class="pm">' + esc(S.day(p.found)) + (p.rank ? ' · <span class="nw">Top PRP ' + esc(p.rank) + '</span>' : '') + '</span><span></span></li>';
    }).join('');
    document.getElementById('all-primes-link').textContent = 'All ' + primes.length + ' →';
    document.getElementById('rank-note').innerHTML = doc.rank_date ? 'Top PRP rank in PRP Records as of <span class="nw">' + esc(doc.rank_date) + '</span>' + (doc.rank_daily ? ', read once a day.' : '.') : '';
  }
})();
