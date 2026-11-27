/* Reports page: the progress of the search below n = 10^7, the PRP work of each range, and what each contributor has
   computed, all in T4-Hours (data/reports.json). */
(function () {
  'use strict';
  var S = window.Site, fmt = S.fmt, esc = S.esc;
  var state = { flat: false, open: {} }, blocks = [];

  // T4-Hours: exact in the mersenne.ca style (three decimals), or for an estimate whole and marked ≈
  function t4(v, est) { return est ? '≈\u00a0' + fmt(Math.round(v)) : S.t4num(v); }
  function pctLabel(x) { return x >= 0.9995 ? '100%' : x <= 0 ? '0%' : (x * 100).toFixed(x < 0.1 ? 2 : 1) + '%'; }
  function bar(x) {
    return '<span class="minibar" aria-hidden="true"><i style="width:' + (x * 100).toFixed(1) + '%;background:var(--accent)"></i></span>' + pctLabel(x);
  }
  function list(a) { return a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || ''; }

  S.all(['reports', 'site']).then(function (d) {
    var rep = d[0], site = d[1], tt = rep.totals, people = rep.people || [], pg = rep.progress;
    renderProgress(pg, tt);
    blocks = rep.blocks || [];
    var first = blocks.filter(function (b) { return b.left && !b.est; })[0];
    if (first) state.open[Math.floor(first.lo / 1e6)] = true;
    renderBlocks();
    document.getElementById('rep-blocks-note').innerHTML = blocks.length ? 'Done counts every PRP test, a second test of the same n too; to go is a test of each sieve survivor that no test has settled yet.' +
      (pg && pg.future ? ' ≈: not sieved yet, so the candidates are an estimate: the sieve to the TF cutoff of the range leaves about ' + pg.future.K +
        ' × (odd n) ÷ ln p of them, the rate seen in the ranges sieved so far. Hover a 0.2M row for its candidates and the T4-Hours of one test.' : ' Hover a 0.2M row for the T4-Hours of one test.') : '';

    var tile = function (label, value, sub) {
      return '<div class="tile"><div class="eyebrow">' + label + '</div><div class="v">' + value + '</div><div class="s">' + sub + '</div></div>';
    };
    document.getElementById('rep-tiles').innerHTML =
      tile('All work', S.t4num(tt.t4h), 'T4-Hours from ' + fmt(people.length) + ' contributor' + (people.length === 1 ? '' : 's')) +
      tile('PRP', S.t4num(tt.prp_t4h), fmt(tt.prp_tests) + ' tests · T4-Hours') +
      tile('Sieve', S.t4num(tt.tf_t4h), fmt(tt.tf_slices) + ' slices · T4-Hours') +
      tile('Primes found', fmt(tt.primes), 'first found by this project');

    var num = function (v) { return '<td class="r">' + (v ? S.t4num(v) : '—') + '</td>'; };
    var cnt = function (v) { return '<td class="r">' + (v ? fmt(v) : '—') + '</td>'; };
    var share = function (v) { return '<td class="r">' + (tt.t4h ? (100 * v / tt.t4h).toFixed(1) + '%' : '—') + '</td>'; };
    var head = '<tr><th class="r">#</th><th class="text">%NAME%</th><th class="r">T4-Hours</th><th class="r">Share</th><th class="r">PRP tests</th>' +
      '<th class="r">PRP T4-Hours</th><th class="r">Sieve slices</th><th class="r">Sieve T4-Hours</th><th class="r">Primes</th></tr>';
    var line = function (i, label, o) {
      return '<tr><td class="r">' + (i + 1) + '</td><td class="text">' + label + '</td>' + num(o.t4h) + share(o.t4h) + cnt(o.prp_tests) + num(o.prp_t4h) +
        cnt(o.tf_slices) + num(o.tf_t4h) + cnt(o.primes) + '</tr>';
    };
    document.getElementById('rep-people-meta').textContent = 'sorted by T4-Hours';
    document.getElementById('rep-people').innerHTML = '<table class="data"><thead>' + head.replace('%NAME%', 'Contributor') + '</thead><tbody>' +
      people.map(function (p, i) { return line(i, S.nameHTML(p.name || '—'), p); }).join('') + '</tbody></table>';

    var t4m = (site.model && site.model.t4) || {}, R = t4m.tf && t4m.tf.primes_per_hour;
    var act = pg && pg.active, fut = pg && pg.future;
    document.getElementById('rep-how').innerHTML =
      '<p><strong>PRP.</strong> A test of n is n squarings at the FFT length dfprp, the project’s GPU program, uses for n; it counts n × (T4 milliseconds per squaring at that length) ÷ 3,600,000 T4-Hours, from a benchmark on a Kaggle T4' +
      (t4m.measured ? ' (' + esc(t4m.measured) + ')' : '') + '. A test near n = 3.6M is ' + S.t4cost(S.t4Hours(t4m, 3600000)) + '. Tests run by Prime95 on a CPU count the same.</p>' +
      '<p><strong>Sieve.</strong> A slice over p from p₁ to p₂ counts (number of primes in that range) ÷ ' + (R ? S.depth(R) : '—') +
      ' T4-Hours: Mass Prime Siever 14.0 sieves about that many primes an hour on one T4 (measured on 3.6M ≤ n &lt; 5M). Slices by older sievers, other GPUs and CPUs count the same.</p>' +
      (pg ? '<p><strong>Progress.</strong> All the work below n = ' + fmt(pg.hi) + '. Done is all of the work counted here. To go is a PRP test of every candidate the sieve has left' +
        (act && act.tf_left > 0 ? ', the rest of the sieve of ' + S.rangeLabel(act.lo, act.hi) + ', to ' + S.depth(act.sieve_max) : '') +
        (fut ? ', and for ' + S.rangeLabel(fut.lo, fut.hi) + ', not sieved yet, an estimate: the sieve of each part to its TF cutoff, in windows as wide as ' +
          (act ? S.rangeLabel(act.lo, act.hi) : 'the active range') + ', and a PRP test of every candidate it would leave' : '') + '.</p>' : '') +
      '<p><strong>Primes</strong> are the ones this project found first. The smaller primes of the form it found again on the way had been found before (see the Primes page).</p>' +
      '<p><strong>P-1</strong> is not counted: the search now uses only sieving and PRP tests.</p>' +
      '<p class="small">Names are as the results and uploads gave them, without the computer after the hyphen: each contributor’s work on all their computers is added together.</p>';
  }).catch(function (e) { S.fail('rep-prog', e); });

  // the whole search: everything done and what is left, sieve and PRP
  function renderProgress(pg, tt) {
    var el = document.getElementById('rep-prog');
    if (!pg) { el.innerHTML = '<p class="small">No ranges yet.</p>'; return; }
    var act = pg.active, fut = pg.future, est = !!fut;
    var tfAll = pg.tf_done + pg.tf_left, prpAll = pg.prp_done + pg.prp_left, done = pg.tf_done + pg.prp_done, all = tfAll + prpAll;
    var meter = function (label, dn, total, sub) {
      var pct = total ? Math.min(100, 100 * dn / total) : 0;
      return '<div><div class="meter-label"><span>' + label + '</span><span class="mono">' + S.t4num(dn) + ' of ' + t4(total, est && total > dn) +
        ' T4-Hours · ' + pctLabel(pct / 100) + '</span></div><div class="meter meter-lg">' + (pct ? '<i style="width:' + pct.toFixed(2) + '%"></i>' : '') +
        '</div><p class="small" style="margin:6px 0 0">' + sub + '</p></div>';
    };
    var actL = act ? S.rangeLabel(act.lo, act.hi) : '', futL = fut ? S.rangeLabel(fut.lo, fut.hi) : '';
    var tfLeft = [], prpLeft = [];
    if (act && act.tf_left > 0) tfLeft.push(actL + ' from ' + S.depth(act.sieve_depth) + ' to ' + S.depth(act.sieve_max) + ' (' + S.t4cost(act.tf_left) + ')');
    if (fut) tfLeft.push(futL + ', not sieved yet, to its TF cutoff, ' + (fut.p_lo === fut.p_hi ? S.depth(fut.p_lo) : S.depth(fut.p_lo) + ' – ' + S.depth(fut.p_hi)) +
      ' (≈\u00a0' + fmt(Math.round(fut.tf_left)) + ' T4-Hours)');
    if (act && act.left) prpLeft.push(fmt(act.left) + ' candidates in ' + actL + ' (' + S.t4cost(act.prp_left) + ')');
    var other = pg.left - (act ? act.left : 0);
    if (other > 0) prpLeft.push(fmt(other) + ' sieved candidates outside ' + (actL || 'the active range'));
    if (fut) prpLeft.push('about ' + fmt(Math.round(fut.left / 100) * 100) + ' in ' + futL + ' once sieved (≈\u00a0' + fmt(Math.round(fut.prp_left)) + ' T4-Hours)');
    document.getElementById('rep-prog-title').innerHTML = 'Progress · n &lt; ' + fmt(pg.hi);
    document.getElementById('rep-prog-meta').textContent = (est ? '≈\u00a0' + fmt(Math.round(all - done)) : S.t4num(all - done).replace(/<[^>]+>/g, '')) + ' T4-Hours to go';
    el.innerHTML = '<div class="meters">' +
      meter('All work', done, all, 'Everything below n = ' + fmt(pg.hi) + ': all the sieving and PRP tests done so far, and what the ranges still need' +
        (est ? ', estimated where the sieve has not run yet' : '') + '.') +
      meter('Sieve', pg.tf_done, tfAll, 'Done: ' + fmt(tt.tf_slices) + ' slices. ' + (tfLeft.length ? 'To go: ' + list(tfLeft) + '.' : 'Nothing left to sieve.')) +
      meter('PRP', pg.prp_done, prpAll, 'Done: ' + fmt(pg.tests) + ' tests' + (pg.tests !== pg.tested ? ' of ' + fmt(pg.tested) + ' n' : '') + '. ' + (prpLeft.length ? 'To go: ' + list(prpLeft) + '.' : 'Nothing left to test.')) +
      '</div>';
  }

  // PRP work of each range: 1M groups that open into the 0.2M rows of data/ranges.json, as on the Ranges page
  function total(list) {
    var g = { tests: 0, tested: 0, left: 0, prp_done: 0, prp_left: 0, est: false };
    list.forEach(function (b) {
      g.tests += b.tests; g.tested += b.tested; g.left += b.left; g.prp_done += b.prp_done; g.prp_left += b.prp_left; g.est = g.est || !!b.est;
    });
    return g;
  }
  function groups() {
    var out = [], top = blocks.length ? Math.ceil(blocks[blocks.length - 1].hi / 1e6) : 0;
    for (var m = 0; m < top; m++) {
      var subs = blocks.filter(function (b) { return Math.floor(b.lo / 1e6) === m; });
      if (!subs.length) continue;
      var g = total(subs);
      g.lo = m * 1e6; g.hi = (m + 1) * 1e6; g.subs = subs;
      out.push(g);
    }
    return out;
  }
  function cells(label, b, tip, cls) {
    var all = b.prp_done + b.prp_left, est = !!b.est, left = est ? Math.round(b.left / 10) * 10 : b.left;
    var title = tip && b.left ? (est ? 'Not sieved yet: about ' + fmt(left) + ' candidates once sieved to its TF cutoff, ' + S.depth(b.p) : fmt(left) + ' candidates left') +
      '; one test about ' + (b.prp_left / b.left).toFixed(3) + ' T4-Hours' : '';
    return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + label + '</td>' +
      '<td class="r">' + (b.tests ? fmt(b.tests) : '—') + '</td>' +
      '<td class="r"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + (b.left ? (est ? '≈\u00a0' : '') + fmt(left) : b.tests ? '0' : '—') + '</td>' +
      '<td class="r">' + (b.prp_done ? S.t4num(b.prp_done) : '—') + '</td>' +
      '<td class="r"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + (b.prp_left ? t4(b.prp_left, est) : '—') + '</td>' +
      '<td class="r">' + (all ? t4(all, est && b.prp_left > 0) : '—') + '</td>' +
      '<td>' + bar(all ? b.prp_done / all : 0) + '</td>';
  }
  function renderBlocks() {
    var wrap = document.getElementById('rep-blocks');
    if (!blocks.length) { wrap.innerHTML = '<p class="small">No ranges yet.</p>'; return; }
    var head = '<table class="data"><thead><tr><th rowspan="2" style="vertical-align:bottom">Range of n</th><th class="r" rowspan="2" style="vertical-align:bottom">PRP tests</th>' +
      '<th class="r" rowspan="2" style="vertical-align:bottom">Candidates left</th><th class="group" colspan="3">PRP T4-Hours</th><th rowspan="2" style="vertical-align:bottom">Progress</th></tr>' +
      '<tr><th class="r">Done</th><th class="r">To go</th><th class="r">In all</th></tr></thead><tbody>';
    var body = [];
    if (state.flat) {
      blocks.forEach(function (b) { body.push('<tr>' + cells(S.rangeLabel(b.lo, b.hi), b, true) + '</tr>'); });
    } else {
      groups().forEach(function (g) {
        var key = g.lo / 1e6, open = !!state.open[key];
        var btn = '<button type="button" class="caret" data-g="' + key + '" aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse ' : 'Expand ') +
          S.rangeLabel(g.lo, g.hi) + '">' + (open ? '−' : '+') + '</button>';
        body.push('<tr>' + cells(btn + S.rangeLabel(g.lo, g.hi), g, false) + '</tr>');
        if (open) g.subs.forEach(function (b) { body.push('<tr class="sub">' + cells(S.rangeLabel(b.lo, b.hi), b, true) + '</tr>'); });
      });
    }
    var top = blocks[blocks.length - 1].hi, e = Math.round(Math.log10(top));
    var label = 'Total &lt; ' + (Math.pow(10, e) === top ? '10<sup>' + e + '</sup>' : fmt(top));
    wrap.innerHTML = head + body.join('') + '</tbody><tfoot><tr>' + cells(label, total(blocks), false, 'text') + '</tr></tfoot></table>';
    Array.prototype.forEach.call(wrap.querySelectorAll('button.caret'), function (b) {
      b.addEventListener('click', function () {
        var k = Number(b.getAttribute('data-g'));
        state.open[k] = !state.open[k];
        renderBlocks();
        var again = wrap.querySelector('button.caret[data-g="' + k + '"]');
        if (again) again.focus();
      });
    });
  }
  function setFlat(f) {
    state.flat = f;
    document.getElementById('rb-1m').setAttribute('aria-pressed', String(!f));
    document.getElementById('rb-02m').setAttribute('aria-pressed', String(f));
    renderBlocks();
  }
  document.getElementById('rb-1m').addEventListener('click', function () { setFlat(false); });
  document.getElementById('rb-02m').addEventListener('click', function () { setFlat(true); });
})();
