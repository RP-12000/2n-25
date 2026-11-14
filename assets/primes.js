/* Primes page: summary tiles, found-vs-expected chart, the full list, residues, spacing and outlook. */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc;
  var state = { desc: true, big: false };
  var ctx = null;

  S.all(['primes', 'summary', 'site']).then(function (d) {
    var primes = d[0].primes.slice().sort(function (a, b) { return a.n - b.n; });
    primes.forEach(function (p, i) { p.k = i + 1; p.ratio = i ? p.n / primes[i - 1].n : null; });
    ctx = { primes: primes, doc: d[0], sum: d[1], site: d[2], M: S.model(d[2]) };
    render();
  }).catch(function (e) { S.fail('primes-tiles', e); });

  function bind(id, fn) { document.getElementById(id).addEventListener('click', fn); }
  bind('ord-desc', function () { state.desc = true; sync(); });
  bind('ord-asc', function () { state.desc = false; sync(); });
  bind('flt-all', function () { state.big = false; sync(); });
  bind('flt-big', function () { state.big = true; sync(); });
  function sync() {
    document.getElementById('ord-desc').setAttribute('aria-pressed', String(state.desc));
    document.getElementById('ord-asc').setAttribute('aria-pressed', String(!state.desc));
    document.getElementById('flt-all').setAttribute('aria-pressed', String(!state.big));
    document.getElementById('flt-big').setAttribute('aria-pressed', String(state.big));
    if (ctx) renderTable();
  }

  function render() {
    var P = ctx.primes, sum = ctx.sum, site = ctx.site, M = ctx.M;
    var frontier = sum.frontier, last = P[P.length - 1];
    var act = site.active || { lo: frontier, hi: 5000000 };
    var bigCount = P.filter(function (p) { return p.digits >= 10000; }).length;
    var own = P.filter(function (p) { return p.discoverer && p.discoverer === site.credit; }).length;
    document.getElementById('primes-lede').innerHTML = P.length + ' values of n make 2<sup>n</sup> − 25 prime or probable prime (OEIS <a href="' +
      esc(site.links && site.links.oeis || 'https://oeis.org/A379020') + '">' + esc(site.oeis || 'A379020') + '</a>). Every odd n below ' + fmt(frontier) +
      ' has been sieved and tested, so the list is complete up to there.';
    var tiles = [
      ['Known', fmt(P.length), 'prime', bigCount + ' with ≥ 10,000 digits' + (own ? ' · ' + own + ' first found by ' + esc(site.credit) : '')],
      ['Largest', last ? fmt(last.n) : '—', '', last ? fmt(last.digits) + ' digits' + (last.found ? ' · found ' + esc(S.day(last.found)) : '') : ''],
      ['Complete up to', fmt(frontier), '', last && frontier > last.n + 2 ? 'no prime in ' + fmt(last.n + 2) + ' – ' + fmt(frontier - 1) : 'every odd n below is resolved'],
      ['Next one below 10<sup>7</sup>', Math.round(M.pAny(frontier, 1e7) * 100) + '%', 'accent',
        Math.round(M.pAny(frontier, Math.max(act.hi, frontier + 1)) * 100) + '% chance within ' + S.rangeLabel(frontier, act.hi)]
    ];
    document.getElementById('primes-tiles').innerHTML = tiles.map(function (t) {
      return '<div class="tile"><div class="eyebrow">' + t[0] + '</div><div class="v ' + t[2] + '">' + t[1] + '</div><div class="s">' + t[3] + '</div></div>';
    }).join('');
    document.getElementById('flt-all').textContent = 'All ' + P.length;
    document.getElementById('count-meta').textContent = 'expected count ≈ ' + M.C + ' · ln n ' + (M.intercept < 0 ? '− ' : '+ ') + Math.abs(M.intercept);
    document.getElementById('count-chart').innerHTML = countChart(P, frontier, M);
    document.getElementById('count-legend').innerHTML =
      '<span><i class="key line" aria-hidden="true"></i>Found</span>' +
      '<span><i class="key dot" aria-hidden="true"></i>A prime</span>' +
      '<span><i class="key accent" style="height:2px" aria-hidden="true"></i>Expected, heuristic with C ≈ ' + M.C + '</span>' +
      (frontier < 1e7 ? '<span><i class="key pdash" aria-hidden="true"></i>Expected from ' + S.M(frontier) + ' to 10M: ≈ ' +
        M.expected(frontier, 1e7).toFixed(1) + ' more, ' + (P.length + M.expected(frontier, 1e7)).toFixed(1) + ' in all</span>' : '');
    renderTable();
    renderMod6(P);
    renderSpacing(P, frontier, M);
    renderPrp(P);
    renderNext(frontier, site, M, act);
  }

  function widest(P) {
    var best = null;
    P.forEach(function (p) { if (p.ratio && (!best || p.ratio > best.ratio)) best = p; });
    return best;
  }
  function closest(P) {
    var best = null;
    P.forEach(function (p) { if (p.ratio && (!best || p.ratio < best.ratio)) best = p; });
    return best;
  }

  /* The k-th known prime against its n on a log scale: the heuristic says the k-th prime sits near
     n = e^((k - b) / C), a straight line here. Vertical runs of the step are stretches searched without a prime. */
  function countChart(P, frontier, M) {
    var W = 600, H = 430, L = 56, R = W - 14, T = 14, B = H - 58, y0 = 0.5, y1 = 7;
    var N = P.length;
    var countAt = function (n) { return M.C * Math.log(n) + M.intercept; };   // primes expected up to n
    var nAt = function (k) { return Math.exp((k - M.intercept) / M.C); };     // where the k-th one is expected
    var projEnd = N + M.expected(frontier, 1e7);
    var top = Math.max(10, Math.ceil(Math.max(projEnd, countAt(1e7)) / 10) * 10);
    var X = function (k) { return L + k / top * (R - L); };
    var Y = function (n) { return B - (Math.log10(n) - y0) / (y1 - y0) * (B - T); };
    var o = ['<svg class="chart small" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="The n of each known prime in order, on a log scale: ' + N +
      ' primes up to n = ' + fmt(P[N - 1].n) + ', close to the expected line; the search reached n = ' + fmt(frontier) + ' and about ' +
      M.expected(frontier, 1e7).toFixed(1) + ' more primes are expected below 10 million.">'];
    var yf = Y(frontier);
    o.push('<rect class="band" x="' + L + '" y="' + T + '" width="' + (R - L) + '" height="' + S.r1(Math.max(0, yf - T)) + '"></rect>');
    var g = [], yl = [];
    for (var e = 1; e <= y1; e++) {
      g.push('<line x1="' + L + '" y1="' + S.r1(Y(Math.pow(10, e))) + '" x2="' + R + '" y2="' + S.r1(Y(Math.pow(10, e))) + '"></line>');
      yl.push('<text class="end" x="' + (L - 8) + '" y="' + S.r1(Y(Math.pow(10, e)) + 3) + '">' + S.tenTo(e) + '</text>');
    }
    o.push('<g class="grid">' + g.join('') + '</g><line class="axis" x1="' + L + '" y1="' + B + '" x2="' + R + '" y2="' + B + '"></line>' + yl.join(''));
    var tk = [], xl = [];
    for (var k = 0; k <= top; k += 5) {
      tk.push('<line x1="' + S.r1(X(k)) + '" y1="' + B + '" x2="' + S.r1(X(k)) + '" y2="' + (B + 4) + '"></line>');
      xl.push('<text class="mid" x="' + S.r1(X(k)) + '" y="' + (B + 20) + '">' + k + '</text>');
    }
    o.push('<g class="ticks">' + tk.join('') + '</g>' + xl.join(''));
    o.push('<line class="guide muted" x1="' + L + '" y1="' + S.r1(yf) + '" x2="' + R + '" y2="' + S.r1(yf) + '"></line>');
    o.push('<text x="' + (L + 6) + '" y="' + S.r1(yf + 14) + '">searched to ' + S.M(frontier) + '</text>');
    if (yf - T >= 14) o.push('<text x="' + (L + 6) + '" y="' + S.r1(yf - 4) + '">to 10⁷</text>');

    // expected line
    var k0 = Math.max(0, countAt(Math.pow(10, y0))), k1 = countAt(1e7);
    o.push('<path class="line" d="M' + S.r1(X(k0)) + ' ' + S.r1(Y(nAt(k0))) + ' L' + S.r1(X(k1)) + ' ' + S.r1(Y(1e7)) + '"></path>');
    // projection beyond the frontier
    if (frontier < 1e7) {
      var pr = [];
      for (var j = 0; j <= 30; j++) {
        var m = frontier * Math.pow(1e7 / frontier, j / 30);
        pr.push((j ? 'L' : 'M') + S.r1(X(N + M.expected(frontier, m))) + ' ' + S.r1(Y(m)));
      }
      o.push('<path class="proj" d="' + pr.join(' ') + '"></path>');
    }
    // found: up the n searched without a prime, one step right at each prime, up to the frontier
    var d = 'M' + S.r1(X(0)) + ' ' + S.r1(Y(Math.pow(10, y0)));
    P.forEach(function (p) { d += ' V' + S.r1(Y(p.n)) + ' H' + S.r1(X(p.k)); });
    d += ' V' + S.r1(yf);
    o.push('<path class="step" d="' + d + '"></path>');
    o.push('<g>' + P.map(function (p) {
      return '<circle class="dot prime" cx="' + S.r1(X(p.k)) + '" cy="' + S.r1(Y(p.n)) + '" r="3.6"><title>prime ' + p.k + ': n = ' + fmt(p.n) + ' · ' + fmt(p.digits) + ' digits</title></circle>';
    }).join('') + '</g>');
    var lastP = P[N - 1];
    // up and to the left of the last dot, clear of the dashed frontier line
    o.push('<text class="prime end" style="font-weight:600" x="' + S.r1(X(N) - 8) + '" y="' + S.r1(Math.min(Y(lastP.n) - 8, yf - 5)) + '">' + fmt(lastP.n) + '</text>');
    var w = widest(P);
    if (w && w.k > 1) {
      // left of the top of the longest vertical run: the expected line passes to the right there
      var a = P[w.k - 2];
      o.push('<text class="end" x="' + S.r1(X(a.k) - 8) + '" y="' + S.r1(Y(w.n) + 4) + '">' + fmt(a.n) + ' → ' + fmt(w.n) + ': widest gap</text>');
    }
    o.push('<text class="sans mid" x="16" y="' + ((T + B) / 2) + '" transform="rotate(-90 16 ' + ((T + B) / 2) + ')">n (log scale)</text>');
    o.push('<text class="sans mid" x="' + ((L + R) / 2) + '" y="' + (H - 6) + '">k: the k-th known prime, smallest n first</text>');
    o.push('</svg>');
    return o.join('');
  }

  function renderTable() {
    var P = ctx.primes.filter(function (p) { return !state.big || p.digits >= 10000; });
    if (state.desc) P = P.slice().reverse();
    var w = widest(ctx.primes), credit = ctx.site.credit, dash = '<span class="muted">—</span>';
    var rows = P.map(function (p) {
      var note = esc(p.note || '');
      var when = p.discovered ? esc(p.discovered.length > 7 ? S.minute(p.discovered) : p.discovered) : dash;
      return '<tr><td class="r muted">' + p.k + '</td><td class="r"><a href="exponent.html?n=' + p.n + '">' + fmt(p.n) + '</a></td><td class="r">' + fmt(p.digits) +
        '</td><td>' + when + '</td><td class="text' + (p.discoverer === credit ? ' prime-text' : '') + '">' + (p.discoverer ? esc(p.discoverer) : dash) +
        '</td><td class="r">' + (p.fft ? S.fft(p.fft) : '—') +
        '</td><td class="r">' + (p.proof_power ? 'power ' + p.proof_power : '—') + '</td><td class="r">' + (p.rank ? esc(p.rank) : '—') +
        '</td><td class="r' + (w && p.n === w.n ? ' prime-text" style="font-weight:600' : '') + '">' + (p.ratio ? '× ' + p.ratio.toFixed(p.ratio < 1.1 ? 3 : 2) : '—') +
        '</td><td class="text">' + (note || '<span class="muted">' + esc(p.how || '') + '</span>') + '</td></tr>';
    });
    document.getElementById('prime-table').innerHTML = '<table class="data"><thead><tr><th class="r">#</th><th class="r">n</th><th class="r">Digits</th>' +
      '<th>First found (UTC)</th><th class="text">Found by</th><th class="r">FFT</th><th class="r">Proof</th><th class="r">Top PRP</th><th class="r">× prev</th><th class="text">Note</th></tr></thead><tbody>' +
      rows.join('') + '</tbody></table>';
    var rd = ctx.doc.rank_date, below = ctx.site.discoverers && ctx.site.discoverers.below;
    var records = '<a href="' + esc(ctx.site.links && ctx.site.links.prp_records || '#') + '">PRP Records</a>';
    document.getElementById('prime-foot').innerHTML = '# is the term number in A379020. ' +
      (below ? 'Every prime below n = ' + fmt(below) + ' was known before this project: who found it first, and the month, are from Henri and Renaud Lifchitz’s ' +
        records + ' (anonymous where that list has no entry), while FFT and Proof describe this project’s own re-test. ' : '') +
      (rd ? 'Top PRP ranks are from Henri Lifchitz’s <a href="' + esc(ctx.site.links && ctx.site.links.prp_records || '#') + '">PRP Records</a> list as of ' + esc(rd) +
        '; that list starts at 10,000 digits. ' : '') +
      'Proof is the power of the Prime95 PRP proof file kept for the result; × prev is n divided by the n before it.';
  }

  function renderMod6(P) {
    var c = { 1: 0, 3: 0, 5: 0 };
    P.forEach(function (p) { c[p.n % 6] = (c[p.n % 6] || 0) + 1; });
    var max = Math.max(c[1], c[3], c[5], 1);
    document.getElementById('mod6').innerHTML = '<div class="bars-list">' + [1, 3, 5].map(function (r) {
      return '<span>n ≡ ' + r + ' (mod 6)</span><div class="meter"><i style="width:' + (c[r] / max * 100).toFixed(1) + '%' +
        (r === 5 ? ';background:var(--axis)' : '') + '"></i></div><span class="mono">' + c[r] + '</span>';
    }).join('') + '</div>';
  }

  function renderSpacing(P, frontier, M) {
    if (P.length < 3) return;
    var N = P.length, first = P[0], last = P[N - 1];
    var g = Math.exp(Math.log(last.n / first.n) / (N - 1)), e = Math.exp(1 / M.C);
    var w = widest(P), c = closest(P), wa = P[w.k - 2], ca = P[c.k - 2];
    var past = frontier / last.n, pGap = Math.exp(-M.C * Math.log(past));
    document.getElementById('spacing-text').innerHTML = 'On average each n is ' + g.toFixed(2) + ' × the one before; the heuristic predicts e<sup>1/' + M.C +
      '</sup> ≈ ' + e.toFixed(2) + '. The last prime was ' + fmt(last.n) + (past > 1.001 ? '; the search has now gone × ' + past.toFixed(2) +
      ' past it without another, which happens about ' + Math.round(pGap * 100) + '% of the time' : '') + '.';
    document.getElementById('spacing-kv').innerHTML =
      '<div><span>Mean ratio</span><span>' + g.toFixed(3) + ' (expected ' + e.toFixed(3) + ')</span></div>' +
      '<div><span>Widest</span><span>' + fmt(wa.n) + ' → ' + fmt(w.n) + ' · × ' + w.ratio.toFixed(2) + '</span></div>' +
      '<div><span>Closest</span><span>' + fmt(ca.n) + ' → ' + fmt(c.n) + ' · × ' + c.ratio.toFixed(3) + '</span></div>' +
      (past > 1.001 ? '<div><span>Since the last one</span><span>× ' + past.toFixed(2) + ' so far</span></div>' : '');
  }

  function renderPrp(P) {
    var tested = P.filter(function (p) { return p.how && p.how !== 'trial division'; });
    var proofs = P.filter(function (p) { return p.proof_power; });
    var h = '';
    if (tested.length) h += 'Each entry from n = ' + fmt(tested[0].n) + ' up passed a base-3 Fermat test (PRP-3) in Prime95 with Gerbicz error checking';
    if (proofs.length) h += (h ? ', and from n = ' + fmt(proofs[0].n) + ' up a proof file is kept, so the test can be checked without running it again' : '');
    if (h) h += '. ';
    h += '2<sup>n</sup> − 25 has no large factored part in N − 1 or N + 1, so the large ones cannot be proven prime with today’s methods; the small ones can be proven with ECPP.';
    var small = P.filter(function (p) { return p.how === 'trial division'; });
    if (small.length) h += ' The ' + (small.length === 1 ? 'value ' : small.length + ' values ') + small.map(function (p) { return fmt(p.n); }).join(', ') + ' were checked directly.';
    document.getElementById('prp-text').innerHTML = h;
  }

  function recordHTML(label) {
    var m = /^\s*(\d+)\^(\d+)\s*([+-])\s*(\d+)\s*$/.exec(label || '');
    return m ? m[1] + '<sup>' + fmt(Number(m[2])) + '</sup> ' + (m[3] === '-' ? '−' : '+') + ' ' + m[4] : esc(label);
  }
  function renderNext(frontier, site, M, act) {
    var median = M.median(frontier);
    var rec = site.record;
    var h = 'Any new prime here has n &gt; ' + fmt(frontier) + ', so at least ' + fmt(S.digits(frontier + 1)) + ' digits';
    if (rec && rec.beats_from_n && frontier >= rec.beats_from_n) {
      h += ': larger than ' + recordHTML(rec.label) + ' (' + fmt(rec.digits) + ' digits), our largest PRP so far';
    }
    h += '. The median guess for its position is n ≈ ' + (median / 1e6).toFixed(2) + 'M, about ' + (S.digits(Math.round(median)) / 1e6).toFixed(2) + ' million digits.';
    document.getElementById('next-text').innerHTML = h;
    var lines = [[frontier, act.hi], [act.hi, 1e7], [frontier, 1e7]].filter(function (r) { return r[1] > r[0]; });
    document.getElementById('next-kv').innerHTML = lines.map(function (r) {
      return '<div><span>' + S.rangeLabel(r[0], r[1]) + '</span><span>' + Math.round(M.pAny(r[0], r[1]) * 100) + '% · expected ' + M.expected(r[0], r[1]).toFixed(2) + '</span></div>';
    }).join('');
  }
})();
