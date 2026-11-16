/* Shared helpers for every page of the 2^n-25 Prime Search site. Plain JavaScript, no libraries. */
(function () {
  'use strict';
  var Site = (window.Site = {});
  var SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

  /* ---------- formatting ---------- */
  Site.fmt = function (x, decimals) {
    if (x === null || x === undefined || x === '' || Number.isNaN(Number(x))) return '—';
    var opts = decimals === undefined ? undefined : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
    return Number(x).toLocaleString('en-US', opts);
  };
  Site.sup = function (k) {
    return String(k).split('').map(function (c) { return c === '-' ? '⁻' : (SUP[Number(c)] || c); }).join('');
  };
  Site.tenTo = function (e) { return '10' + Site.sup(e); };
  /* The sieve target for exponent n: content/site.json sieve_targets [{lo, hi, target, note}], else sieve_target */
  Site.sieveTarget = function (site, n) {
    var t = ((site && site.sieve_targets) || []).filter(function (x) { return n >= x.lo && n < x.hi; })[0];
    return t || { target: (site && site.sieve_target) || 1e14 };
  };
  /* Sieve depths: 10⁷, 1.61×10⁹, 2³² (for 2^32 - 1) */
  Site.depth = function (d) {
    if (!d) return '—';
    var pw = Math.round(Math.log2(d + 1));
    if (pw >= 20 && Math.abs(d + 1 - Math.pow(2, pw)) <= 1) return '2' + Site.sup(pw);
    var e = Math.floor(Math.log10(d) + 1e-9), m = d / Math.pow(10, e);
    var r = Math.round(m * 100) / 100;
    var ms = Math.abs(m - r) < 1e-9 ? String(r) : m.toFixed(2);
    return (ms === '1' ? '' : ms + '×') + '10' + Site.sup(e);
  };
  /* Exponent label for HTML: 10<sup>12</sup> */
  Site.tenHTML = function (e) { return '10<sup>' + e + '</sup>'; };
  Site.supHTML = function (s) { return String(s).replace(/\^(\d+)/g, '<sup>$1</sup>'); };
  /* Program names as written in the logs: 2^n-25 Siever 3.0 -> 2ⁿ−25 Siever 3.0 */
  Site.prog = function (s) { return String(s || '').replace(/2\^n-25/g, '2ⁿ−25'); };
  Site.M = function (n) {
    if (!n) return '0';
    var v = n / 1e6;
    return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + 'M';
  };
  Site.rangeLabel = function (lo, hi) { return Site.M(lo) + ' – ' + Site.M(hi); };
  Site.fft = function (len) {
    if (!len) return '—';
    if (len >= 1048576) return trimNum(len / 1048576) + 'M';
    if (len >= 1024) return trimNum(len / 1024) + 'K';
    return String(len);
  };
  function trimNum(x) { return String(Math.round(x * 10) / 10); }
  Site.fmtBig = function (v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  Site.minute = function (ts) { return ts ? String(ts).slice(0, 16) : '—'; };
  Site.day = function (ts) { return ts ? String(ts).slice(0, 10) : '—'; };
  /* HTML: the day, with the time to the second on hover (UTC, as the result files have it) */
  Site.when = function (ts) {
    if (!ts) return '—';
    var s = String(ts), d = Site.esc(s.slice(0, 10));
    return s.length > 10 ? '<span title="' + Site.esc(s.slice(0, 19).replace('T', ' ')) + ' UTC">' + d + '</span>' : d;
  };
  Site.pct = function (x, d) { return (x * 100).toFixed(d === undefined ? 1 : d) + '%'; };
  Site.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  Site.digits = function (n) {
    if (n < 60) return String(BigInt(2) ** BigInt(n) - BigInt(25)).length;
    return Math.floor(n * Math.log10(2)) + 1;
  };
  Site.parseN = function (s) {
    var t = String(s === null || s === undefined ? '' : s).replace(/[,\s_]/g, '');
    if (!/^\d+$/.test(t)) return NaN;
    return parseInt(t, 10);
  };

  /* ---------- data ---------- */
  var cache = {};
  // data/n/ and data/f/ hold one file per SHARD n, named by its first n in millions: summary.json's shard_size is
  // 0.01M (3.61 holds 3,610,000 to 3,619,999); data built before it said so have 0.1M per file (3.6)
  var SHARD = 100000;
  Site.load = function (name) {
    if (!cache[name]) {
      cache[name] = fetch('data/' + name + '.json').then(function (r) {
        if (!r.ok) throw new Error('data/' + name + '.json answered HTTP ' + r.status);
        return r.json();
      });
      if (name === 'summary') cache[name] = cache[name].then(function (s) { if (s && s.shard_size) SHARD = s.shard_size; return s; });
    }
    return cache[name];
  };
  Site.shardSize = function () { return SHARD; };
  Site.shardName = function (n) {
    var d = Math.round(Math.log10(1e6 / SHARD)), u = Math.pow(10, d), k = Math.floor(n / SHARD);
    return Math.floor(k / u) + '.' + String(k % u).padStart(d, '0');
  };
  // have: the shard names listed in summary.json; a SHARD of n with nothing recorded has no file
  Site.shard = function (n, have) {
    var name = Site.shardName(n);
    if (have && have.indexOf(name) < 0) return Promise.resolve(null);
    return Site.load('n/' + name).catch(function () { return null; });
  };
  // the sieve factors above 10^7 for n's SHARD of n (data/f/<x.xx>.json), when summary.json lists that file
  Site.factorFile = function (n, have) {
    var name = Site.shardName(n);
    if (!have || have.indexOf(name) < 0) return Promise.resolve(null);
    return Site.load('f/' + name).catch(function () { return null; });
  };
  Site.all = function (names) { return Promise.all(names.map(Site.load)); };
  Site.fail = function (where, err) {
    var el = typeof where === 'string' ? document.getElementById(where) : where;
    var local = location.protocol === 'file:';
    var msg = local
      ? 'The data files cannot be read when the page is opened straight from disk. In the site folder run <code>python -m http.server</code> and open <code>http://localhost:8000</code>.'
      : 'Could not load the data: ' + Site.esc(err && err.message ? err.message : err) + '. Reload the page to try again.';
    if (el) el.innerHTML = '<div class="error-box">' + msg + '</div>';
    if (window.console) console.error(err);
  };

  /* ---------- the model ---------- */
  Site.model = function (site) {
    var m = (site && site.model) || {};
    var C = m.C || 2.72;
    return {
      C: C,
      intercept: m.intercept === undefined ? -4.29 : m.intercept,
      K: m.survivor_K || 2.12,
      expected: function (a, b) { return C * Math.log(b / a); },
      pAny: function (a, b) { return 1 - Math.exp(-C * Math.log(b / a)); },
      median: function (a) { return a * Math.exp(Math.LN2 / C); },
      survivors: function (oddCount, p) { return oddCount * (m.survivor_K || 2.12) / Math.log(p); },
      prpMinutes: function (n) {
        return (m.prp_core_minutes_at_3600000 || 50) * Math.pow(n / 3600000, m.prp_cost_exponent || 2.1);
      }
    };
  };
  Site.cost = function (minutes) {
    if (minutes < 1 / 60) return 'under a core-second';
    if (minutes < 1) { var s = Math.round(minutes * 60); return '≈ ' + s + ' core-second' + (s === 1 ? '' : 's'); }
    if (minutes < 90) { var mm = Math.round(minutes); return '≈ ' + mm + ' core-minute' + (mm === 1 ? '' : 's'); }
    return '≈ ' + (minutes / 60).toFixed(1) + ' core-hours';
  };

  /* ---------- number theory ---------- */
  var SAFE = 94906265; // below this, a*b of residues fits in a double exactly
  Site.powmod = function (b, e, m) {
    if (m < SAFE) {
      var r = 1;
      b %= m;
      while (e > 0) {
        if (e % 2 === 1) r = (r * b) % m;
        b = (b * b) % m;
        e = Math.floor(e / 2);
      }
      return r;
    }
    return Number(Site.powmodBig(BigInt(b), BigInt(e), BigInt(m)));
  };
  Site.powmodBig = function (b, e, m) {
    var r = BigInt(1), zero = BigInt(0), one = BigInt(1);
    b %= m;
    while (e > zero) {
      if ((e & one) === one) r = (r * b) % m;
      b = (b * b) % m;
      e >>= one;
    }
    return r;
  };
  var sieveCache = null;
  Site.primesUpTo = function (limit) {
    if (sieveCache && sieveCache.limit >= limit) {
      if (sieveCache.limit === limit) return sieveCache.primes;
      var out = [];
      for (var k = 0; k < sieveCache.primes.length && sieveCache.primes[k] <= limit; k++) out.push(sieveCache.primes[k]);
      return out;
    }
    var s = new Uint8Array(limit + 1), primes = [];
    for (var i = 2; i <= limit; i++) {
      if (!s[i]) {
        primes.push(i);
        if (i * i <= limit) for (var j = i * i; j <= limit; j += i) s[j] = 1;
      }
    }
    sieveCache = { limit: limit, primes: primes };
    return primes;
  };
  /* Smallest prime p <= limit dividing 2^n - 25 (p itself excluded when 2^n - 25 is that small). */
  Site.smallestFactor = function (n, limit) {
    var P = Site.primesUpTo(limit);
    var value = n < 53 ? Math.pow(2, n) - 25 : Infinity;
    for (var k = 0; k < P.length; k++) {
      var p = P[k];
      if (p >= value) break;
      if (p === 2 || p === 5) continue;
      if (Site.powmod(2, n, p) === 25 % p) return p;
    }
    return 0;
  };
  /* Every prime p <= limit dividing 2^n - 25, smallest first (p itself excluded when 2^n - 25 is that small).
     Left to right over the bits of n with base 2: one squaring per bit and a doubling per 1 bit, the top bits
     at once as 2^t with t < 32; the squaring is reduced with 1/p instead of %, then corrected (exact below 2^53). */
  Site.factorsBelow = function (n, limit) {
    var P = Site.primesUpTo(limit), out = [];
    var value = n < 53 ? Math.pow(2, n) - 25 : Infinity;
    var bits = n.toString(2), head = 0, i = 0;
    while (i < bits.length && head * 2 + (bits.charCodeAt(i) - 48) < 32) { head = head * 2 + (bits.charCodeAt(i) - 48); i++; }
    var L = bits.length - i, one = new Uint8Array(L), start = Math.pow(2, head);
    for (var j = 0; j < L; j++) one[j] = bits.charCodeAt(i + j) === 49 ? 1 : 0;
    for (var k = 0; k < P.length; k++) {
      var p = P[k];
      if (p >= value) break;
      if (p === 2 || p === 5) continue;
      var r = start % p, inv = 1 / p;
      for (j = 0; j < L; j++) {
        var rr = r * r;
        r = rr - Math.floor(rr * inv) * p;
        if (r < 0) r += p; else if (r >= p) r -= p;
        if (one[j]) { r += r; if (r >= p) r -= p; }
      }
      if (r === 25 % p) out.push(p);
    }
    return out;
  };
  Site.dividesBig = function (pStr, n) {
    var p = BigInt(pStr);
    if (p < BigInt(2)) return false;
    return Site.powmodBig(BigInt(2), BigInt(n), p) === BigInt(25) % p;
  };
  Site.isProbablePrime = function (n) {
    n = BigInt(n);
    var two = BigInt(2), one = BigInt(1), zero = BigInt(0);
    if (n < two) return false;
    var small = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];
    for (var i = 0; i < small.length; i++) {
      var q = BigInt(small[i]);
      if (n === q) return true;
      if (n % q === zero) return false;
    }
    var d = n - one, r = 0;
    while ((d & one) === zero) { d >>= one; r++; }
    outer: for (var a = 0; a < small.length; a++) {
      var x = Site.powmodBig(BigInt(small[a]), d, n);
      if (x === one || x === n - one) continue;
      for (var t = 1; t < r; t++) {
        x = (x * x) % n;
        if (x === n - one) continue outer;
      }
      return false;
    }
    return true;
  };
  /* Exact arithmetic with doubles for moduli below 2^50 (the same code runs in the upload Worker). */
  var T26 = 67108864, I26 = 1 / 67108864, T52 = 4503599627370496, I52 = 1 / 4503599627370496;
  function mulmodInv(a, b, m, inv) {
    if (m <= SAFE) return (a * b) % m;
    var q = Math.floor(a * b * inv); // off by at most one
    var a1 = Math.floor(a * I26), a0 = a - a1 * T26;
    var b1 = Math.floor(b * I26), b0 = b - b1 * T26;
    var q1 = Math.floor(q * I26), q0 = q - q1 * T26;
    var m1 = Math.floor(m * I26), m0 = m - m1 * T26;
    var t = a1 * b0 + a0 * b1;
    t -= Math.floor(t * I26) * T26;
    var u = q1 * m0 + q0 * m1;
    u -= Math.floor(u * I26) * T26;
    var r = a0 * b0 + t * T26 - (q0 * m0 + u * T26); // a*b - q*m modulo 2^52
    r -= Math.round(r * I52) * T52;
    if (r < 0) r += m;
    else if (r >= m) r -= m;
    return r;
  }
  Site.mulmod50 = function (a, b, m) { return mulmodInv(a, b, m, 1 / m); };
  Site.powmod50 = function (a, e, m) {
    var inv = 1 / m, r = 1 % m, x = a % m;
    while (e > 0) {
      if (e % 2 === 1) r = mulmodInv(r, x, m, inv);
      e = Math.floor(e / 2);
      if (e > 0) x = mulmodInv(x, x, m, inv);
    }
    return r;
  };
  var MR_BASES = [2, 3, 5, 7, 11, 13, 17, 19, 23];
  var MR_BOUNDS = [[2047, 1], [1373653, 2], [25326001, 3], [3215031751, 4], [2152302898747, 5], [3474749660383, 6], [341550071728321, 7]];
  /* Deterministic Miller-Rabin for p < 2^50 (the bases 2..23 are exact below 3.8e18). */
  Site.isPrime50 = function (p) {
    if (p < 2) return false;
    var i, k = 9;
    for (i = 0; i < MR_BASES.length; i++) if (p % MR_BASES[i] === 0) return p === MR_BASES[i];
    for (i = 0; i < MR_BOUNDS.length; i++) if (p < MR_BOUNDS[i][0]) { k = MR_BOUNDS[i][1]; break; }
    var d = p - 1, s = 0, inv = 1 / p;
    while (d % 2 === 0) { d /= 2; s++; }
    for (i = 0; i < k; i++) {
      var x = Site.powmod50(MR_BASES[i], d, p);
      if (x === 1 || x === p - 1) continue;
      var ok = false;
      for (var t = 1; t < s && !ok; t++) { x = mulmodInv(x, x, p, inv); ok = x === p - 1; }
      if (!ok) return false;
    }
    return true;
  };
  /* Why p is not an acceptable sieve factor of 2^n - 25 (p < 2^50), or '' when it checks out. */
  Site.factorProblem = function (n, p, P0, P1) {
    if (!(p >= P0 && p < P1)) return "outside the file's [P0, P1)";
    if (p < 2 || Site.powmod50(2, n, p) !== 25 % p) return 'does not divide 2^n - 25';
    if (n < 53 && p === Math.pow(2, n) - 25) return 'is 2^n - 25 itself';
    if (!Site.isPrime50(p)) return 'is not prime';
    return '';
  };
  /* Steps Pollard's rho may take for one number: a fraction of a second, enough to split off any prime factor
     up to about 10^10 (every p - 1 of a sieve factor below 2^50 splits in a few thousand steps). */
  var RHO_STEPS = 300000;
  function gcdBig(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  /* A proper factor of the odd composite m (BigInt) by Pollard's rho with Brent's cycle search and one gcd per
     128 steps, or null when st.steps runs out first. */
  function rhoFactor(m, st) {
    var one = BigInt(1);
    for (var c = 1; c <= 20 && st.steps > 0; c++) {
      var C = BigInt(c), y = BigInt(2), x = y, ys = y, q = one, g = one, r = 1, i, k, lim;
      while (g === one && st.steps > 0) {
        x = y;
        for (i = 0; i < r; i++) y = (y * y + C) % m;
        st.steps -= r;
        for (k = 0; k < r && g === one; k += 128) {
          ys = y;
          lim = Math.min(128, r - k);
          for (i = 0; i < lim; i++) { y = (y * y + C) % m; q = q * (x > y ? x - y : y - x) % m; }
          st.steps -= lim;
          g = gcdBig(q, m);
        }
        r *= 2;
      }
      if (g === m) {
        // the last batch went past the factor: redo it one step at a time
        g = one;
        for (i = 0; i < 128 && g === one; i++) { ys = (ys * ys + C) % m; g = gcdBig(x > ys ? x - ys : ys - x, m); }
      }
      if (g !== one && g !== m) return g;
    }
    return null;
  }
  /* Factor m (BigInt or Number): trial division up to `bound`, then Pollard's rho for a composite part that is
     left. Returns {factors: [[prime, exp], ...] smallest first, with BigInt primes; rest: the product of any part
     rho could not split within RHO_STEPS, or null}. */
  Site.factorize = function (m, bound) {
    m = BigInt(m);
    var out = [], zero = BigInt(0), one = BigInt(1);
    var P = Site.primesUpTo(bound);
    for (var k = 0; k < P.length; k++) {
      var p = BigInt(P[k]);
      if (p * p > m) break;
      if (m % p === zero) {
        var a = 0;
        while (m % p === zero) { m /= p; a++; }
        out.push([p, a]);
      }
    }
    var rest = null;
    if (m > one) {
      // no prime up to the last one tried divides what is left, so any part of it below that prime squared is prime
      var top = BigInt(P[P.length - 1]), sq = top * top, todo = [m], big = {}, st = { steps: RHO_STEPS };
      while (todo.length) {
        var c = todo.pop();
        if (c <= sq || Site.isProbablePrime(c)) { big[String(c)] = (big[String(c)] || 0) + 1; continue; }
        var d = rhoFactor(c, st);
        if (d) todo.push(d, c / d);
        else rest = rest ? rest * c : c;
      }
      Object.keys(big).forEach(function (s) { out.push([BigInt(s), big[s]]); });
      out.sort(function (u, v) { return u[0] < v[0] ? -1 : u[0] > v[0] ? 1 : 0; });
    }
    return { factors: out, rest: rest };
  };
  /* Smallest B1, B2 for which P-1 finds p: B2 covers the largest prime of p-1, B1 everything else. */
  Site.minB = function (fs) {
    var Q = BigInt(0), aQ = 0, b1 = BigInt(1);
    fs.forEach(function (x) { if (x[0] > Q) { Q = x[0]; aQ = x[1]; } });
    fs.forEach(function (x) { if (x[0] !== Q) { var v = x[0] ** BigInt(x[1]); if (v > b1) b1 = v; } });
    if (aQ > 1) { var v2 = Q ** BigInt(aQ); return [v2 > b1 ? v2 : b1, null]; }
    if (b1 >= Q) return [b1, null];
    return [b1, Q];
  };

  /* ---------- charts ---------- */
  Site.dayNumber = function (d) {
    var p = String(d).slice(0, 10).split('-');
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])) / 864e5;
  };
  Site.monthTicks = function (d0, d1, everyMonths) {
    var a = new Date(d0 * 864e5), b = new Date(d1 * 864e5), out = [];
    var y = a.getUTCFullYear(), m = a.getUTCMonth();
    m = Math.ceil(m / everyMonths) * everyMonths;
    var names = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
    for (;;) {
      if (m >= 12) { y += Math.floor(m / 12); m %= 12; }
      var t = Date.UTC(y, m, 1) / 864e5;
      if (t > d1) break;
      if (t >= d0) out.push({ d: t, label: names[m] + ' ' + y });
      m += everyMonths;
    }
    return out;
  };
  Site.r1 = function (x) { return Math.round(x * 10) / 10; };
  Site.dayString = function (d) { return new Date(d * 864e5).toISOString().slice(0, 10); };
  /* Ticks for a time axis from day d0 to day d1: weekly for a short span, else every 3 or 6 months. */
  Site.timeTicks = function (d0, d1) {
    var span = d1 - d0;
    if (span > 100) return Site.monthTicks(d0, d1, span > 800 ? 6 : 3);
    var names = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' '), out = [];
    for (var d = d0; d <= d1; d += span > 50 ? 14 : 7) {
      var t = new Date(d * 864e5);
      out.push({ d: d, label: names[t.getUTCMonth()] + ' ' + t.getUTCDate() });
    }
    return out;
  };
  /* Frontier over time. o: d0, d1 (day numbers), y0, y1, yStep, frontier, frontierDate, today (day number),
     pause {from, to, label}, primes [{n, found, label, known, by}] to mark on the line (known: first found by someone else), note (shown when nothing changed), label for "today" */
  Site.frontierChart = function (series, o) {
    var top = 22, bottom = 226, left = 64, right = 1140;
    var X = function (d) { return left + (d - o.d0) / (o.d1 - o.d0) * (right - left); };
    var Y = function (n) { return bottom - (n - o.y0) / (o.y1 - o.y0) * (bottom - top); };
    var r1 = Site.r1, esc = Site.esc, fmt = Site.fmt;
    var out = ['<svg class="chart" viewBox="0 0 1160 250" role="img" aria-label="' + esc(o.aria || 'Search frontier over time') + '">'];
    if (o.pause && o.pause.from) {
      var a = Math.max(X(Site.dayNumber(o.pause.from)), left), b = Math.min(X(Site.dayNumber(o.pause.to || Site.dayString(o.today))), right);
      if (b - a > 40) {
        out.push('<rect class="band" x="' + r1(a) + '" y="' + top + '" width="' + r1(b - a) + '" height="' + (bottom - top) + '"></rect>');
        out.push('<text class="sans mid" x="' + r1((a + b) / 2) + '" y="120">' + esc(o.pause.label || 'paused') + '</text>');
        out.push('<text class="mid" x="' + r1((a + b) / 2) + '" y="136">' + esc(o.pause.from) + ' → ' + esc(o.pause.to || '') + '</text>');
      }
    }
    var g = [], yl = [];
    for (var v = o.y0; v <= o.y1 + 1; v += o.yStep) {
      if (v > o.y0) g.push('<line x1="' + left + '" y1="' + r1(Y(v)) + '" x2="' + right + '" y2="' + r1(Y(v)) + '"></line>');
      yl.push('<text class="end" x="' + (left - 8) + '" y="' + r1(Y(v) + 3) + '">' + (v ? Site.M(v) : '0') + '</text>');
    }
    out.push('<g class="grid">' + g.join('') + '</g><line class="axis" x1="' + left + '" y1="' + bottom + '" x2="' + right + '" y2="' + bottom + '"></line>' + yl.join(''));
    out.push(Site.timeTicks(o.d0, o.d1).map(function (t) { return '<text class="mid" x="' + r1(X(t.d)) + '" y="244">' + t.label + '</text>'; }).join(''));
    // the value at d0, then every change after it
    var v0 = o.y0, pts = [];
    series.forEach(function (p) { if (Site.dayNumber(p[0]) <= o.d0) v0 = p[1]; });
    pts.push([X(o.d0), Y(Math.max(v0, o.y0))]);
    series.forEach(function (p) {
      var d = Site.dayNumber(p[0]);
      if (d > o.d0) pts.push([X(d), Y(p[1])]);
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); }).join(' ');
    var last = pts[pts.length - 1];
    if (pts.length > 1) out.push('<path class="area" d="' + line + ' L' + r1(last[0]) + ' ' + bottom + ' L' + r1(pts[0][0]) + ' ' + bottom + ' Z"></path>');
    if (pts.length > 1) out.push('<path class="line" d="' + line + '"></path>');
    var xt = X(o.today);
    out.push('<line class="line dash" x1="' + r1(last[0]) + '" y1="' + r1(last[1]) + '" x2="' + r1(xt) + '" y2="' + r1(last[1]) + '"></line>');
    (o.primes || []).forEach(function (p) {
      var d = Site.dayNumber(p.found);
      if (d < o.d0 || d > o.d1 || p.n < o.y0) return;
      var x = X(d), y = Y(Math.min(p.n, o.y1));
      out.push('<circle class="dot prime ring' + (p.known ? ' known' : '') + '" cx="' + r1(x) + '" cy="' + r1(y) + '" r="4.5"><title>' + fmt(p.n) + ' · ' + esc(Site.day(p.found)) +
        (p.known ? ' · known before: ' + esc(p.by) : '') + '</title></circle>');
      if (p.label) out.push('<text class="prime" x="' + r1(x + 8) + '" y="' + r1(y + 15) + '">' + fmt(p.n) + '</text>');
    });
    out.push('<circle class="dot" cx="' + r1(last[0]) + '" cy="' + r1(last[1]) + '" r="4"></circle>');
    var lab = fmt(o.frontier) + (o.frontierDate ? ' · reached ' + esc(o.frontierDate) : '');
    var labRight = last[0] < left + 260;
    out.push('<text class="strong' + (labRight ? '' : ' end') + '" x="' + r1(labRight ? last[0] + 10 : last[0] - 8) + '" y="' + r1(last[1] - 8) + '">' + lab + '</text>');
    out.push('<line class="guide" x1="' + r1(xt) + '" y1="' + top + '" x2="' + r1(xt) + '" y2="' + bottom + '"></line>');
    var todayLeft = xt > right - 200;
    var ty = last[1] > (top + bottom) / 2 ? top + 14 : Math.min(last[1] + 22, bottom - 12);
    out.push('<text class="strong' + (todayLeft ? ' end' : '') + '" x="' + r1(todayLeft ? xt - 6 : xt + 6) + '" y="' + r1(ty) + '">' + esc(o.todayLabel || 'today') + '</text>');
    if (o.startLabel) out.push('<text x="' + r1(pts[0][0] + 6) + '" y="' + (bottom - 7) + '">' + esc(o.startLabel) + '</text>');
    if (o.note) out.push('<text class="sans mid" x="' + r1((left + right) / 2) + '" y="' + r1((top + bottom) / 2 - 10) + '">' + esc(o.note) + '</text>');
    out.push('</svg>');
    return out.join('');
  };
  /* Results per day as thin bars. o: d0, d1, log (log scale), empty (text when there is nothing to draw), aria */
  Site.dailyChart = function (days, o) {
    var top = 12, bottom = 110, left = 64, right = 1140;
    var r1 = Site.r1, esc = Site.esc;
    var X = function (d) { return left + (d - o.d0) / (o.d1 - o.d0) * (right - left); };
    var shown = days.filter(function (d) { var t = Site.dayNumber(d[0]); return t >= o.d0 && t <= o.d1 && d[1] > 0; });
    var max = shown.reduce(function (m, d) { return Math.max(m, d[1]); }, 0);
    var out = ['<svg class="chart" viewBox="0 0 1160 128" role="img" aria-label="' + esc(o.aria || 'Results per day') + '">'];
    var g = [], yl = [], Y;
    if (o.log) {
      var topE = Math.max(2, Math.ceil(Math.log10(Math.max(max, 10))));
      Y = function (v) { return bottom - (Math.log10(Math.max(v, 1)) - 1) / (topE - 1) * (bottom - top); };
      for (var e = 1; e <= topE; e++) {
        if (e > 1) g.push('<line x1="' + left + '" y1="' + r1(Y(Math.pow(10, e))) + '" x2="' + right + '" y2="' + r1(Y(Math.pow(10, e))) + '"></line>');
        yl.push('<text class="end" x="' + (left - 8) + '" y="' + r1(Y(Math.pow(10, e)) + 3) + '">' + (e < 3 ? Math.pow(10, e) : Math.pow(10, e - 3) + 'k') + '</text>');
      }
    } else {
      var step = max > 1000 ? 500 : max > 400 ? 200 : max > 100 ? 100 : 50, topV = Math.max(step, Math.ceil(max / step) * step);
      Y = function (v) { return bottom - v / topV * (bottom - top); };
      for (var w = 0; w <= topV; w += step) {
        if (w) g.push('<line x1="' + left + '" y1="' + r1(Y(w)) + '" x2="' + right + '" y2="' + r1(Y(w)) + '"></line>');
        yl.push('<text class="end" x="' + (left - 8) + '" y="' + r1(Y(w) + 3) + '">' + Site.fmt(w) + '</text>');
      }
    }
    out.push('<g class="grid">' + g.join('') + '</g><line class="axis" x1="' + left + '" y1="' + bottom + '" x2="' + right + '" y2="' + bottom + '"></line>' + yl.join(''));
    var perDay = (right - left) / Math.max(1, o.d1 - o.d0);
    if (perDay >= 4) {
      var bw = Math.min(14, perDay - 2);
      out.push('<g class="bar-days">' + shown.map(function (d) {
        var x = X(Site.dayNumber(d[0]) + 0.5) - bw / 2, y = Y(d[1]);
        return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(bw) + '" height="' + r1(bottom - y) + '"><title>' + esc(d[0]) + ': ' + Site.fmt(d[1]) + '</title></rect>';
      }).join('') + '</g>');
    } else {
      out.push('<path class="bars' + (o.cls ? ' ' + o.cls : '') + '" d="' + shown.filter(function (d) { return !o.log || d[1] > 1; }).map(function (d) {
        return 'M' + r1(X(Site.dayNumber(d[0]))) + ' ' + bottom + 'V' + r1(Y(d[1]));
      }).join('') + '"></path>');
    }
    if (!shown.length && o.empty) out.push('<text class="sans mid" x="' + r1((left + right) / 2) + '" y="' + r1((top + bottom) / 2 + 4) + '">' + esc(o.empty) + '</text>');
    out.push(Site.timeTicks(o.d0, o.d1).map(function (t) { return '<text class="mid" x="' + r1(X(t.d)) + '" y="125">' + t.label + '</text>'; }).join(''));
    out.push('</svg>');
    return out.join('');
  };

  /* ---------- hover, tap and keyboard readout for the column charts (Status, History) ----------
     o: wrap and tip (elements), w and h (viewBox size), L and R (plot edges), cols, colX(column) -> x,
     start (column shown when the chart gets keyboard focus), fill(column, y in viewBox units or null) fills o.tip */
  Site.columnHover = function (svg, o) {
    var xh = svg.querySelector('.xhair'), cur = -1;
    function locate(e) {
      var r = svg.getBoundingClientRect();
      var sx = (e.clientX - r.left) / r.width * o.w, sy = (e.clientY - r.top) / r.height * o.h;
      return { col: Math.floor((sx - o.L) / (o.R - o.L) * o.cols), y: sy };
    }
    function show(col, sy, cx, cy) {
      if (col < 0 || col >= o.cols) { hide(); return; }
      cur = col;
      var x = Site.r1(o.colX(col + 0.5));
      xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible');
      o.tip.textContent = '';
      o.fill(col, sy);
      o.tip.hidden = false;
      var wr = o.wrap.getBoundingClientRect(), tw = o.tip.offsetWidth, th = o.tip.offsetHeight;
      var lx = cx - wr.left + 16;
      if (lx + tw > wr.width) lx = cx - wr.left - 16 - tw;
      lx = Math.max(0, Math.min(lx, wr.width - tw));
      var ty = Math.max(0, Math.min(cy - wr.top - th / 2, wr.height - th));
      o.tip.style.left = Math.round(lx) + 'px';
      o.tip.style.top = Math.round(ty) + 'px';
    }
    function hide() {
      o.tip.hidden = true;
      xh.setAttribute('visibility', 'hidden');
    }
    function showAtColumn(col) {
      var r = svg.getBoundingClientRect();
      show(col, null, r.left + (o.colX(col + 0.5) / o.w) * r.width, r.top + r.height * 0.3);
    }
    svg.addEventListener('pointermove', function (e) { var a = locate(e); show(a.col, a.y, e.clientX, e.clientY); });
    svg.addEventListener('pointerdown', function (e) { var a = locate(e); show(a.col, a.y, e.clientX, e.clientY); });
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('focus', function () { showAtColumn(cur >= 0 ? cur : Math.max(0, Math.min(o.cols - 1, o.start || 0))); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 10 : 1, to = cur < 0 ? 0 : cur;
      if (e.key === 'ArrowRight') to = Math.min(o.cols - 1, to + step);
      else if (e.key === 'ArrowLeft') to = Math.max(0, to - step);
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = o.cols - 1;
      else if (e.key === 'Escape') { hide(); return; }
      else return;
      e.preventDefault();
      showAtColumn(to);
    });
  };
  /* The readout's heading and table; returns add(value, label, key) for its rows and note(text, cls) for a line below. */
  Site.tipTable = function (tip, head) {
    var h = document.createElement('div');
    h.className = 'tip-head';
    h.textContent = head;
    tip.appendChild(h);
    var table = document.createElement('table'), tb = document.createElement('tbody');
    table.appendChild(tb);
    tip.appendChild(table);
    return {
      add: function (value, label, key) {
        var tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td');
        a.className = 'v'; b.className = 'l';
        a.textContent = value;
        if (key) { var i = document.createElement('i'); i.className = 'lk ' + key; b.appendChild(i); }
        b.appendChild(document.createTextNode(label));
        tr.appendChild(a); tr.appendChild(b);
        tb.appendChild(tr);
      },
      note: function (text, cls) {
        var p = document.createElement('p');
        if (cls) p.className = cls;
        p.textContent = text;
        tip.appendChild(p);
      }
    };
  };

  /* ---------- page chrome ---------- */
  function initLookup() {
    var forms = document.querySelectorAll('form.lookup');
    Array.prototype.forEach.call(forms, function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = form.querySelector('input');
        var n = Site.parseN(input.value);
        var target = 'exponent.html?n=' + (Number.isFinite(n) ? n : encodeURIComponent(input.value.trim()));
        if (Site.onLookup && Number.isFinite(n)) Site.onLookup(n);
        else location.href = target;
      });
    });
    // the "?" by the box: the page of a random odd n, from 5 up to the last range with data. On the exponent page,
    // which shows another n in place, the next one is picked ahead and its data files fetched as soon as the pointer
    // or focus reaches "?", and again once the n it opened has its files, so a click shows the next n at once
    var below = function (hi) { return 5 + 2 * Math.floor(Math.random() * Math.floor((hi - 5) / 2)); };
    var pick = function () {
      return Site.load('summary').then(function (s) {
        var tops = (s.shards || []).map(function (x) { return Math.round(parseFloat(x) * 1e6) + SHARD; });
        var n = below(tops.length ? Math.max.apply(null, tops) : 5000000);
        return { n: n, ready: Site.onLookup ? Promise.all([Site.shard(n, s.shards), Site.factorFile(n, s.factor_files)]) : null };
      }).catch(function () { return { n: below(5000000), ready: null }; });
    };
    var ahead = null;
    var prepare = function () { if (Site.onLookup && !ahead) ahead = pick(); };
    Array.prototype.forEach.call(document.querySelectorAll('[data-surprise]'), function (b) {
      ['pointerenter', 'focus', 'touchstart'].forEach(function (ev) { b.addEventListener(ev, prepare, { passive: true }); });
      b.addEventListener('click', function () {
        var next = ahead || pick();
        ahead = null;
        next.then(function (x) {
          if (!Site.onLookup) { location.href = 'exponent.html?n=' + x.n; return; }
          Site.onLookup(x.n);
          if (x.ready) x.ready.then(prepare, prepare);
        });
      });
    });
  }
  function initFromSummary() {
    Site.load('summary').then(function (s) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-generated]'), function (e) { e.textContent = s.generated; });
      // the lookup box suggests the smallest n with no known factor and no PRP test
      var next = (s.next_open && s.next_open[0]) || (s.frontier < s.n_max ? s.frontier : 0);
      if (next) Array.prototype.forEach.call(document.querySelectorAll('form.lookup input'), function (e) { e.placeholder = String(next); });
    }).catch(function () {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initLookup(); initFromSummary(); });
  } else {
    initLookup();
    initFromSummary();
  }
})();
