/* History page: records, the full frontier and daily work charts, the sieve depth and P-1 factor sizes,
   month-by-month table, milestones and the timeline. */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc;
  var MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

  S.all(['summary', 'primes', 'site']).then(function (d) {
    render(d[0], d[1], d[2]);
    S.load('progress').then(function (p) { sieveChart(p, d[0]); }).catch(function (e) { S.fail('pm1-chart', e); });
  }).catch(function (e) { S.fail('hist-tiles', e); });

  function el(id) { return document.getElementById(id); }
  function daysBetween(a, b) { return Math.round(S.dayNumber(b) - S.dayNumber(a)); }
  function plural(k, word) { return fmt(k) + ' ' + word + (k === 1 ? '' : 's'); }
  function monthName(key) { var p = key.split('-'); return MONTHS[Number(p[1]) - 1] + ' ' + p[0]; }

  function render(sum, primesDoc, site) {
    var series = sum.frontier_series || [], prp = sum.daily_prp || [], pm1 = sum.daily_pm1 || [];
    if (!series.length && !prp.length) {
      el('hist-tiles').innerHTML = '<p class="small">No results yet.</p>';
      return;
    }
    var start = (series[0] || prp[0])[0];
    var today = S.dayNumber(sum.generated);
    var primes = primesDoc.primes.filter(function (p) { return p.found; }).sort(function (a, b) { return a.found < b.found ? -1 : 1; });
    el('hist-lede').innerHTML = 'From the first evening on ' + esc(start) + ' to every odd n below ' + fmt(sum.frontier) +
      ': how far the search had got each day, the work done and the primes found along the way.';

    renderTiles(sum, primes, site, start);

    var d0 = S.dayNumber(start), d1 = today + 15;
    var top = Math.max(1, Math.ceil(sum.frontier / 1e6 + 0.15)) * 1e6;
    el('hist-frontier').innerHTML = S.frontierChart(series, {
      d0: d0, d1: d1, y0: 0, y1: top, yStep: 1e6, today: today, frontier: sum.frontier, frontierDate: sum.frontier_date,
      pause: site.pause, startLabel: 'start ' + start, todayLabel: 'today',
      primes: primes.filter(function (p) { return p.n >= 200000; }).map(function (p) {
        var known = p.discoverer && p.discoverer !== site.credit;
        return { n: p.n, found: p.found, label: p.n >= 1e6, known: known, by: known ? p.discoverer + (p.discovered ? ', ' + p.discovered : '') : '' };
      }),
      aria: 'Search frontier from ' + start + ' to ' + fmt(sum.frontier) + ' on ' + sum.frontier_date + ', with the primes found on the way.'
    });
    el('hist-pause-key').textContent = site.pause ? 'Pause, ' + site.pause.from + ' → ' + site.pause.to : 'Pause';

    el('hist-prp').innerHTML = S.dailyChart(prp, { d0: d0, d1: d1, log: true, aria: 'PRP results per day on a log scale.' });
    el('hist-pm1').innerHTML = S.dailyChart(pm1, { d0: d0, d1: d1, log: true, cls: 'pm1', aria: 'P-1 runs per day on a log scale.' });
    var busy = prp.reduce(function (m, d) { return d[1] > m[1] ? d : m; }, ['', 0]);
    var busyP = pm1.reduce(function (m, d) { return d[1] > m[1] ? d : m; }, ['', 0]);
    el('hist-prp-note').textContent = fmt(sum.counts.prp_results) + ' on ' + plural(prp.length, 'day') + ' · busiest ' + fmt(busy[1]) + ' on ' + busy[0];
    el('hist-pm1-note').textContent = pm1.length ? fmt(sum.counts.pm1_runs) + ' n on ' + plural(pm1.length, 'day') + ' · busiest ' + fmt(busyP[1]) + ' on ' + busyP[0] : 'none';

    renderMonths(series, prp, pm1, primes, site);
    renderMilestones(series, start);
    renderTimeline(site);
  }

  function renderTiles(sum, primes, site, start) {
    var prp = sum.daily_prp || [], pm1 = sum.daily_pm1 || [], series = sum.frontier_series || [];
    var tiles = [];
    var first = primes.filter(function (p) { return S.day(p.found) === start; });
    var firstDay = prp.length && prp[0][0] === start ? prp[0][1] : 0;
    if (first.length) {
      var ns = first.map(function (p) { return p.n; }).sort(function (a, b) { return a - b; });
      var allKnown = first.every(function (p) { return p.discoverer && p.discoverer !== site.credit; });
      tiles.push(['First evening', plural(first.length, allKnown ? 'known prime' : 'prime'), 'prime', esc(start) + ': ' + (allKnown ? 're-found ' : '') +
        'n = ' + fmt(ns[0]) + ' to ' + fmt(ns[ns.length - 1]) + (firstDay ? ' among ' + fmt(firstDay) + ' PRP tests' : '')]);
    }
    var busy = prp.reduce(function (m, d) { return d[1] > m[1] ? d : m; }, ['', 0]);
    if (busy[1]) tiles.push(['Busiest day', fmt(busy[1]), '', 'PRP results on ' + esc(busy[0])]);
    // longest run of days with PRP results, and the longest gap between them
    var best = [0, '', ''], run = [0, '', ''], gap = [0, '', ''];
    prp.forEach(function (d, i) {
      if (i && daysBetween(prp[i - 1][0], d[0]) === 1) { run[0]++; run[2] = d[0]; }
      else run = [1, d[0], d[0]];
      if (run[0] > best[0]) best = run.slice();
      if (i && daysBetween(prp[i - 1][0], d[0]) > gap[0]) gap = [daysBetween(prp[i - 1][0], d[0]), prp[i - 1][0], d[0]];
    });
    if (best[0] > 1) tiles.push(['Longest streak', plural(best[0], 'day'), '', 'with PRP results every day, ' + esc(best[1]) + ' → ' + esc(best[2])]);
    if (gap[0] > 30) {
      var why = site.pause && site.pause.from === gap[1] ? ' · ' + esc(site.pause.label.replace(/^paused · /, '')) : '';
      tiles.push(['Longest pause', plural(gap[0], 'day'), '', esc(gap[1]) + ' → ' + esc(gap[2]) + why]);
    }
    var at = function (m) {
      for (var i = 0; i < series.length; i++) if (series[i][1] >= m) return series[i][0];
      return null;
    };
    var oneM = at(1e6), twoM = at(2e6);
    if (oneM) tiles.push(['Frontier to 1M', plural(daysBetween(start, oneM), 'day'), 'accent',
      (twoM ? '2M after ' + plural(daysBetween(start, twoM), 'day') + ', ' : '') + S.M(sum.frontier) + ' after ' + plural(daysBetween(start, sum.frontier_date), 'day')]);
    var busyP = pm1.reduce(function (m, d) { return d[1] > m[1] ? d : m; }, ['', 0]);
    if (busyP[1]) tiles.push(['Biggest P-1 day', fmt(busyP[1]), '', 'P-1 runs on ' + esc(busyP[0])]);
    el('hist-tiles').innerHTML = tiles.map(function (t) {
      return '<div class="tile"><div class="eyebrow">' + t[0] + '</div><div class="v ' + t[2] + '">' + t[1] + '</div><div class="s">' + t[3] + '</div></div>';
    }).join('');
  }

  function renderMonths(series, prp, pm1, primes, site) {
    var by = {};
    function bump(key, field, v) { (by[key] = by[key] || { prp: 0, pm1: 0, primes: [] })[field] += v; }
    prp.forEach(function (d) { bump(d[0].slice(0, 7), 'prp', d[1]); });
    pm1.forEach(function (d) { bump(d[0].slice(0, 7), 'pm1', d[1]); });
    primes.forEach(function (p) { var k = S.day(p.found).slice(0, 7); bump(k, 'prp', 0); by[k].primes.push(p.n); });
    var keys = Object.keys(by).sort();
    if (!keys.length) { el('hist-months').innerHTML = '<p class="small">No results yet.</p>'; return; }
    // every month from the first to the last, so a quiet stretch shows up as one row
    var all = [], y = Number(keys[0].slice(0, 4)), m = Number(keys[0].slice(5, 7));
    var lastKey = keys[keys.length - 1];
    for (;;) {
      var k = y + '-' + (m < 10 ? '0' : '') + m;
      all.push(k);
      if (k >= lastKey) break;
      m++;
      if (m > 12) { m = 1; y++; }
    }
    var frontierAt = function (key) {
      var end = key + '-31', v = null;
      series.forEach(function (p) { if (p[0] <= end) v = p[1]; });
      return v;
    };
    var rows = [], i = 0;
    while (i < all.length) {
      var key = all[i];
      if (!by[key]) {
        var j = i;
        while (j + 1 < all.length && !by[all[j + 1]]) j++;
        var label = site.pause && site.pause.label ? site.pause.label : 'no results';
        rows.push('<tr class="alt"><td class="text">' + monthName(key) + (j > i ? ' – ' + monthName(all[j]) : '') + '</td><td class="r muted">—</td><td class="r muted">—</td><td class="r">' +
          fmt(frontierAt(all[j])) + '</td><td class="text muted">' + esc(label) + '</td></tr>');
        i = j + 1;
        continue;
      }
      var b = by[key], ps = b.primes.sort(function (p, q) { return p - q; });
      var primeText = !ps.length ? '' : ps.length === 1 ? fmt(ps[0]) : ps.length + ' · ' + fmt(ps[0]) + ' … ' + fmt(ps[ps.length - 1]);
      rows.push('<tr><td class="text">' + monthName(key) + '</td><td class="r">' + (b.prp ? fmt(b.prp) : '—') + '</td><td class="r">' + (b.pm1 ? fmt(b.pm1) : '—') +
        '</td><td class="r">' + fmt(frontierAt(key)) + '</td><td class="' + (ps.length ? 'prime-text' : 'muted') + '">' + (primeText || '—') + '</td></tr>');
      i++;
    }
    el('hist-months').innerHTML = '<table class="data"><thead><tr><th class="text">Month</th><th class="r">PRP results</th><th class="r">P-1 runs</th>' +
      '<th class="r">Frontier at end</th><th>Primes found</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }

  function renderMilestones(series, start) {
    if (!series.length) { el('hist-milestones').innerHTML = '<p class="small">No results yet.</p>'; return; }
    var last = series[series.length - 1][1], marks = [];
    for (var m = 5e5; m <= last; m += 5e5) marks.push(m);
    if (marks[marks.length - 1] !== last) marks.push(last);
    var rows = marks.map(function (mk) {
      var hit = null;
      for (var i = 0; i < series.length; i++) if (series[i][1] >= mk) { hit = series[i][0]; break; }
      var days = daysBetween(start, hit);
      return '<tr><td class="r">' + fmt(mk) + '</td><td>' + esc(hit) + '</td><td class="r">' + (days ? fmt(days) : 'first') + '</td></tr>';
    });
    el('hist-milestones').innerHTML = '<table class="data"><thead><tr><th class="r">Frontier</th><th>Reached</th><th class="r">Day</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
      '<p class="small">Day counts from the start on ' + esc(start) + '.</p>';
  }

  function renderTimeline(site) {
    el('timeline').innerHTML = (site.timeline || []).map(function (t) {
      var when = /^\d{4}-\d{2}(-\d{2})?$/.test(t[0]) ? '<time datetime="' + esc(t[0]) + '">' + esc(t[0]) + '</time>' : '<span class="when">' + esc(t[0]) + '</span>';
      return '<li>' + when + '<span>' + S.supHTML(esc(t[1])) + '</span></li>';
    }).join('');
  }
  /* ---------- the sieve depth and the P-1 factors by size, column by column ----------
     viewBox 1160 × 476: one panel (factor size p, log scale) over the n the search has covered, n axis */
  var H = { w: 1160, h: 476, L: 64, R: 1136, T: 30, B: 430 };
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

  function sieveChart(p, sum) {
    var r1 = S.r1, B = p.bucket, i, k, n, dec;
    var host = el('pm1-chart');
    var last = -1;
    for (i = 0; i < p.state.length; i++) if (p.depth[i]) last = i;
    p.heat.forEach(function (h) { if (h[0] > last) last = h[0]; });
    if (last < 0) { host.innerHTML = '<p class="small">Nothing sieved yet.</p>'; return; }
    var step = 200000, nmax = Math.ceil((last + 1) * B / step) * step, cols = Math.min(p.state.length, Math.round(nmax / B));
    var hTop = p.heat.length ? Math.max.apply(null, p.heat.map(function (h) { return h[1] + h.length - 3; })) : 0;
    var depths = p.depth.filter(Boolean);
    var dTop = depths.length ? Math.log10(Math.max.apply(null, depths)) : 0;
    var DEC = Math.max(12, Math.ceil(Math.max(hTop * LOG2, dTop) / 3) * 3);
    var X = function (x) { return H.L + x / nmax * (H.R - H.L); };
    var colX = function (c) { return X(c * B); };
    var Y = function (d) { return H.B - d / DEC * (H.B - H.T); };
    var heatCols = p.heat.map(function (h) { return h[0]; });
    var pm1Lo = heatCols.length ? Math.min.apply(null, heatCols) * B : 0, pm1Hi = heatCols.length ? (Math.max.apply(null, heatCols) + 1) * B : 0;
    var removed = 0;
    for (i = 0; i < cols; i++) if (p.depth[i]) removed += p.removed[i];
    var days = sum.daily_pm1 || [];

    // columns sieved twice: the old sievers first (before P-1 and PRP), then a second, deeper sieve
    var before = p.depth_before || [], twice = [];
    for (i = 0; i < cols; i++) if (p.depth[i] && before[i]) twice.push(i);
    var againText = twice.length ? 'Light grey: a second sieve over ' + S.M(twice[0] * B).replace(/^0M$/, '0') + ' ≤ n &lt; ' + S.M((twice[twice.length - 1] + 1) * B) +
      ', to ' + S.depth(p.depth[twice[0]]) + ', run after P-1 and the PRP tests; it found again the P-1 factors below its edge, and new ones. ' : '';
    el('hist-sieve-lede').innerHTML = 'Grey: the sieve, which found every factor below its edge; each siever version went a little deeper. ' + againText +
      (heatCols.length ? 'Violet: the ' + fmt(p.heat_factors) + ' prime factors P-1 found above the sieve for ' + S.M(pm1Lo) + ' ≤ n &lt; ' + S.M(pm1Hi) +
        (days.length ? ', ' + esc(days[0][0]) + ' to ' + esc(days[days.length - 1][0]) : '') + ', by size. ' : '') +
      'The search now sieves deeper instead of running P-1; the <a href="sieve.html">Sieve</a> page shows how far.';

    var aria = 'Factor size p, log scale, for every odd n below ' + S.M(nmax) + ' in columns of ' + fmt(B) + '. The sieve found every factor below ' +
      S.depth(Math.min.apply(null, depths)) + ' to ' + S.depth(Math.max.apply(null, depths)) + ', depending on the range, and removed ' + fmt(removed) + ' n. ' +
      (heatCols.length ? 'P-1 found ' + fmt(p.heat_factors) + ' larger prime factors for n from ' + S.M(pm1Lo) + ' to ' + S.M(pm1Hi) + ', up to ' + sci(Math.pow(2, hTop)) + '.' : '');
    var o = ['<svg class="chart big" viewBox="0 0 ' + H.w + ' ' + H.h + '" tabindex="0" role="img" aria-label="' + esc(aria) + '">'];

    // grid
    var g = [];
    for (n = step; n < nmax; n += step) g.push('<line x1="' + r1(X(n)) + '" y1="' + H.T + '" x2="' + r1(X(n)) + '" y2="' + H.B + '"></line>');
    for (dec = 3; dec <= DEC; dec += 3) g.push('<line x1="' + H.L + '" y1="' + r1(Y(dec)) + '" x2="' + H.R + '" y2="' + r1(Y(dec)) + '"></line>');
    o.push('<g class="grid">' + g.join('') + '</g>');

    // the sieve: every factor below the edge is known. In a column sieved twice, the first sieve is the grey and
    // the second the lighter band above it, up to the edge.
    var fill = '', again = '', edge = '', lastEnd = null;
    var firstOf = function (c) { return before[c] || p.depth[c]; };
    i = 0;
    while (i < cols) {
      if (!p.depth[i]) { i++; lastEnd = null; continue; }
      var j = i;
      while (j + 1 < cols && p.depth[j + 1] === p.depth[i] && firstOf(j + 1) === firstOf(i)) j++;
      var xa = r1(colX(i)), xb = r1(colX(j + 1)), y = r1(Y(Math.log10(p.depth[i]))), y0 = r1(Y(Math.log10(firstOf(i))));
      fill += 'M' + xa + ' ' + H.B + 'V' + y0 + 'H' + xb + 'V' + H.B + 'Z';
      if (y0 > y) again += 'M' + xa + ' ' + y0 + 'V' + y + 'H' + xb + 'V' + y0 + 'Z';
      edge += (lastEnd === xa ? 'V' + y : 'M' + xa + ' ' + y) + 'H' + xb;
      lastEnd = xb;
      i = j + 1;
    }
    o.push('<path class="sieved crisp" d="' + fill + '"></path>' + (again ? '<path class="sieved-again crisp" d="' + again + '"></path>' : ''));

    // P-1 factors by size: one cell is a column of n times one bit of p
    var heat = HEAT.map(function () { return ''; });
    p.heat.forEach(function (h) {
      if (h[0] >= cols) return;
      var x0 = r1(colX(h[0])), x1 = r1(colX(h[0] + 1));
      for (var c = 2; c < h.length; c++) {
        if (!h[c]) continue;
        var bits = h[1] + c - 2;
        heat[heatClass(h[c])] += 'M' + x0 + ' ' + r1(Y(bits * LOG2)) + 'H' + x1 + 'V' + r1(Y((bits - 1) * LOG2)) + 'H' + x0 + 'Z';
      }
    });
    o.push('<g class="crisp">' + heat.map(function (d, c) { return d ? '<path class="heat-' + c + '" d="' + d + '"></path>' : ''; }).join('') + '</g>');
    // the edge goes over the P-1 cells: where the second sieve went past them, the P-1 factors below it were found again
    o.push('<path class="depth-edge" d="' + edge + '"></path>');

    // axes
    var ax = ['<line class="axis" x1="' + H.L + '" y1="' + H.B + '" x2="' + H.R + '" y2="' + H.B + '"></line>'];
    for (dec = 3; dec <= DEC; dec += 3) ax.push('<text class="end" x="' + (H.L - 8) + '" y="' + r1(Y(dec) + 4) + '">10' + S.sup(dec) + '</text>');
    for (n = 0; n <= nmax; n += step) {
      var tx = r1(X(n));
      ax.push('<line class="ticks" x1="' + tx + '" y1="' + H.B + '" x2="' + tx + '" y2="' + (H.B + 5) + '"></line>');
      ax.push('<text class="mid" x="' + tx + '" y="' + (H.B + 18) + '">' + (n ? S.M(n) : '0') + '</text>');
    }
    var midY = (H.T + H.B) / 2;
    ax.push('<text class="axis-title mid" transform="rotate(-90 14 ' + midY + ')" x="14" y="' + midY + '">FACTOR SIZE p</text>');
    o.push(ax.join(''));

    // labels in the plot
    o.push('<text class="strong sans" x="' + (H.L + 10) + '" y="' + r1(Y(3.4)) + '">Sieve: every factor below the edge is known</text>');
    o.push('<text x="' + (H.L + 10) + '" y="' + r1(Y(3.4) + 15) + '">' + fmt(removed) + ' n removed · p up to ' + S.depth(Math.max.apply(null, depths)) + '</text>');
    if (heatCols.length) {
      o.push('<text class="strong sans mid" x="' + r1((X(pm1Lo) + X(pm1Hi)) / 2) + '" y="' + r1(Y(hTop * LOG2) - 10) + '">P-1: ' + fmt(p.heat_factors) + ' prime factors</text>');
    }
    o.push('<line class="xhair" x1="0" y1="' + H.T + '" x2="0" y2="' + H.B + '" visibility="hidden"></line>');
    o.push('</svg>');
    host.innerHTML = o.join('');

    el('pm1-legend').innerHTML = '<span><i class="key sieved" aria-hidden="true"></i>Sieved: every factor below the edge is known</span>' +
      (twice.length ? '<span><i class="key sieved-again" aria-hidden="true"></i>Sieved again, after P-1 and PRP</span>' : '') +
      '<span class="swatches">P-1 factors per cell' + HEAT.map(function (lo, c) {
        return ' <i class="key heat-' + c + '" aria-hidden="true"></i>' + heatLabel(c);
      }).join('') + '</span>' +
      '<span class="muted">one cell: ' + fmt(B) + ' n × 1 bit of p · hover or tap a column for its numbers</span>';

    var heatBy = {};
    p.heat.forEach(function (h) { heatBy[h[0]] = h; });
    S.columnHover(host.querySelector('svg'), {
      wrap: el('pm1-wrap'), tip: el('pm1-tip'), w: H.w, h: H.h, L: H.L, R: H.R, cols: cols, colX: colX, start: heatCols.length ? heatCols[0] : 0,
      fill: function (col, sy) {
        var lo = col * B, t = S.tipTable(el('pm1-tip'), fmt(lo) + ' ≤ n < ' + fmt(lo + B));
        t.add(fmt(p.odd[col]), 'odd n');
        if (p.depth[col]) {
          t.add(fmt(p.removed[col]), 'removed by the sieve, p < ' + S.depth(p.depth[col]), 'sieved');
          t.add(fmt(p.odd[col] - p.removed[col]), 'left after the sieve');
          if (before[col]) t.note('Sieved twice: to ' + S.depth(before[col]) + ' before P-1 and PRP, then to ' + S.depth(p.depth[col]) + '.');
        } else t.note('Not sieved yet.');
        var hrow = heatBy[col];
        if (!hrow) return;
        var tot = 0, k0 = hrow[1], k1 = k0 + hrow.length - 3;
        for (var c = 2; c < hrow.length; c++) tot += hrow[c];
        t.add(fmt(tot), 'P-1 prime factors, ' + k0 + '–' + k1 + ' bits', 'heat-2');
        if (p.pm1[col]) t.add(fmt(p.pm1[col]), 'n factored by P-1', 'st-pm1');
        if (sy !== null && sy >= H.T && sy <= H.B) {
          var bits = Math.floor((H.B - sy) / (H.B - H.T) * DEC / LOG2) + 1;
          var cnt = bits >= k0 && bits <= k1 ? hrow[bits - k0 + 2] : 0;
          if (bits >= k0 && bits <= k1) t.note((cnt ? fmt(cnt) + (cnt === 1 ? ' factor' : ' factors') : 'No factor') + ' of ' + bits + ' bits here (p ≈ ' + sci(Math.pow(2, bits - 1)) + ' – ' + sci(Math.pow(2, bits)) + ')', 'tip-cell');
        }
      }
    });
  }
})();
