/* History page: records, the full frontier and daily work charts, month-by-month table, milestones and the timeline. */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc;
  var MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

  S.all(['summary', 'primes', 'site']).then(function (d) {
    render(d[0], d[1], d[2]);
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
})();
