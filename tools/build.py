#!/usr/bin/env python3
"""Rebuild the website data for the 2^n-25 prime search.

Reads archive/ in this folder, the copy of the project archive that tools/sync_archive.py keeps (or
another copy given with --archive), and writes the JSON files that the pages load:

  data/summary.json   totals, search frontier and the next n to test, latest results, daily counts
  data/ranges.json    one row per 0.2M of n below 10^7
  data/primes.json    every known n, with who first found it and its Top PRP rank (archive/prptop.json, read
                      once a day by tools/prptop_ranks.py; while that file is missing, the ranks in content/site.json)
  data/sieve.json     P-1 factor sizes and survivor constants
  data/site.json      content/site.json (plans, notes), copied as is
  data/n/<x.xx>.json  one file per 0.01M of n: sieve survivors and every P-1 / PRP record; in a range sieved
                      twice, also the survivors of the first sieve (s0)
  data/f/<x.xx>.json  one file per 0.01M of n sieved by Mass Prime Siever: each sieve slice over those n (p and n
                      range, when it ended to the second, who ran it, whether it was uploaded, whether it is the
                      first sieve of a range sieved twice) with every factor above 10^7 it found first; the
                      pages find the smaller factors themselves

Archive layout it expects (the folder of the 2^n-25 project; a range folder may be named <a>M~<b>M as
on the archive drive or <a>M-<b>M as in archive/):

  Ranges/<a>M~<b>M/TF/            sieve, either the old CPU sievers (origin.txt, override.txt, log.txt,
                                  worktodo_general*.txt, or Station N/ subfolders with the same files)
                                  or Mass Prime Siever 12.0 (results.json and siever.log, any number of
                                  subfolders, one per machine or p slice, e.g. TF/p 10T~12.5T/; every
                                  factor is checked). A run split over several range folders keeps its
                                  siever.log in each; its run time is shared out evenly between them.
                                  Slices that do not start at p <= 7 yet are shown as a partial sieve.
                                  A range sieved by the old sievers first and by Mass Prime Siever again
                                  later keeps both: the old files stay its first sieve (depth, run time and
                                  survivors, before its P-1 and PRP work), Mass Prime Siever its second.
                                  Each factor is credited to whoever found it first: a factor that divides
                                  a P-1 factor of the same n to P-1; one below the first sieve's depth, of an
                                  n the first sieve removed, to the first sieve (its Factor Files list
                                  exactly these; content/site.json sieve_factors_not_kept names the ranges
                                  whose first sieve kept no such list, where they count as new); the rest
                                  to the second sieve.
  Ranges/<a>M~<b>M/Candidates/    *.txt work lines; the 3rd comma field is n
  Ranges/<a>M~<b>M/Pm1/results.json.txt
  Ranges/<a>M~<b>M/PRP/results.json.txt
  Submissions/<id>/submission.json   uploads saved by tools/pull_submissions.py (optional); a probable
                                     prime reported in an upload is shown as "being verified" until n is in
                                     confirmed_primes (content/site.json) or has a P result under Ranges/
  Submissions/<id>/TF/               uploaded sieve output (results.json, upload.json). It is merged into
                                     the range folders that have Mass Prime Siever output of their own, and
                                     every factor is checked like the project's own. Its checked factors
                                     always strike n out; it counts toward the sieve depth only when it found
                                     at least 80% of the factors expected for its p range (from 10^6 up when
                                     it starts below 1000), or when its id is in accepted_sieve_uploads
                                     (content/site.json). An upload that the archive also holds counts once.

Also read: live/prp_progress.json in this folder (or --live), the PRP results of the Prime95 run on this
PC that tools/live_prp.py reads once an hour, for a range whose PRP/results.json.txt is not in the archive
yet. A test the archive has as well counts once. A probable prime among them is shown as "being verified"
until n is in confirmed_primes (content/site.json) or has a P result under Ranges/.

Usage:
  python tools/sync_archive.py      # when the archive drive is attached: refresh archive/
  python tools/build.py             # reads archive/
  python tools/build.py --archive "E:\\All Possible PRP Data\\05 2^n-25 (2024.12 ~ 2026.05)"

Only the Python standard library is used.
"""

import argparse
import base64
import bisect
import collections
import datetime
import glob
import itertools
import json
import math
import os
import re
import statistics
import sys
import time
import zlib

N_MAX = 10_000_000
ROW = 200_000          # one row of the Ranges table
SHARD = 10_000         # one data/n/<x.xx>.json and data/f/<x.xx>.json file; the exponent page loads one of each
BUCKET = 25_000        # one column of the big chart on the Status page
LOG10_2 = math.log10(2)
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ARCHIVE = os.path.join(REPO, "archive")  # filled by tools/sync_archive.py
DEFAULT_LIVE = os.path.join(REPO, "live", "prp_progress.json")  # the Prime95 run on this PC (tools/live_prp.py)
SPLIT_CACHE = os.path.join(REPO, "archive", "pm1_splits.json")  # composite P-1 factors split into primes
PRPTOP = os.path.join(REPO, "archive", "prptop.json")  # Top PRP ranks, read once a day by tools/prptop_ranks.py
MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
RANGE_DIR = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*M\s*[~-]\s*(\d+(?:\.\d+)?)\s*M\s*$", re.I)


class Notes:
    """Collects problems found in the archive; prints a summary and writes every case to a report file."""

    def __init__(self):
        self.counts = collections.Counter()
        self.places = collections.defaultdict(list)

    def add(self, kind, where):
        self.counts[kind] += 1
        self.places[kind].append(where)

    def report(self, path=None):
        if path and os.path.exists(path):
            os.remove(path)
        if not self.counts:
            print("No problems found in the archive.")
            return
        print("Notes about the archive:")
        for kind, count in self.counts.most_common():
            print(f"  {count:7d} x {kind}  (first: {self.places[kind][0]})")
        if path:
            with open(path, "w", encoding="utf-8") as f:
                f.write(f"build.py report, {datetime.datetime.now():%Y-%m-%d %H:%M}\n")
                for kind, count in self.counts.most_common():
                    f.write(f"\n{count} x {kind}\n")
                    f.writelines(f"  {where}\n" for where in self.places[kind])
            print(f"Every case is listed in {path}")


def read_text(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def read_layers(path, notes):
    """content/sieve_layers.json (made by tools/sieve_layers.c): per column of BUCKET n, how many odd n have
    their smallest factor in each power of ten, up to a limit. Returns {column: (limit, [count, ...])}."""
    if not os.path.exists(path):
        notes.add("no sieve_layers.json: the Status chart shows no factor sizes outside Mass Prime Siever ranges", path)
        return {}
    try:
        doc = json.loads(read_text(path))
        if doc.get("bucket") != BUCKET:
            notes.add("sieve_layers.json has another column width (not used)", f"{doc.get('bucket')} != {BUCKET}")
            return {}
        return {c: (int(col["limit"]), [int(x) for x in col["by_decade"]]) for c, col in enumerate(doc["columns"])}
    except (ValueError, KeyError, TypeError):
        notes.add("unreadable sieve_layers.json (not used)", path)
        return {}


def decade(p):
    """k with 10^k <= p < 10^(k+1)."""
    return len(str(p)) - 1


def merge_spans(spans):
    """[[a, b], ...] for the union of half-open intervals."""
    out = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def read_trial_left(path, notes):
    """content/trial_left.json (made by tools/trial_left.py): the odd n in [lo, hi) with no prime factor below
    `limit`, as a bitmap. Lets the Status chart place the factors of a sieve that has not reached the small
    primes yet. Returns (lo, hi, limit, bytes) or None."""
    if not os.path.exists(path):
        return None
    try:
        doc = json.loads(read_text(path))
        bits = zlib.decompress(base64.b64decode(doc["bits"]))
        lo, hi, limit = int(doc["lo"]), int(doc["hi"]), int(doc["limit"])
        if len(bits) * 8 < (hi - lo) // 2:
            raise ValueError
        return lo, hi, limit, bits
    except (ValueError, KeyError, TypeError, zlib.error):
        notes.add("unreadable trial_left.json (not used)", path)
        return None


def trial_left_n(tl, lo, hi):
    """The odd n in [lo, hi) with no factor below tl's limit, or None when tl does not cover [lo, hi)."""
    if not tl or lo < tl[0] or hi > tl[1]:
        return None
    t_lo, bits = tl[0], tl[3]
    out = []
    for n in range(max(lo, 5) | 1, hi, 2):
        i = (n - t_lo) // 2
        if bits[i >> 3] >> (i & 7) & 1:
            out.append(n)
    return out


def read_lines(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if line:
                yield line


def log_time(line):
    """'Fri Dec 13 2024 16:42:02 -0500' anywhere in a siever log line -> ISO UTC."""
    m = re.search(r"\w{3} (\w{3}) +(\d{1,2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})", line)
    if not m or m.group(1) not in MONTHS:
        return None
    mo, d, y, hh, mm, ss, tz = m.groups()
    offset = datetime.timedelta(hours=int(tz[1:3]), minutes=int(tz[3:5])) * (1 if tz[0] == "+" else -1)
    t = datetime.datetime(int(y), MONTHS[mo], int(d), int(hh), int(mm), int(ss)) - offset
    return t.strftime("%Y-%m-%d %H:%M:%S")


def program_name(raw):
    """'2^n-25 Siever v1.1' -> '2^n-25 Siever 1.1'; a bare '2^n-25 Siever' was version 1.0."""
    s = re.sub(r"\s*\(.*\)\s*$", "", raw.strip())
    s = re.sub(r"\bv(\d)", r"\1", s)
    if re.fullmatch(r"2\^n-25 Siever", s):
        s += " 1.0"
    return s


def n_from_work_lines(path):
    """n from lines such as '1,2,3400017,-25,330000,6600000', 'PRP=1,2,3600025,-25' or a bare '3600025'
    (candidates.txt from merge_results.py)."""
    found = set()
    for line in read_lines(path):
        if line.isdigit():
            found.add(int(line))
            continue
        parts = line.split(",")
        if len(parts) >= 3:
            p = parts[2].strip()
            if p.isdigit():
                found.add(int(p))
    return found


def origin_span(origin):
    """The n range an old siever's origin.txt names, as (n0, n1) with n1 left out: '3200000 3266666 25 ...' and
    '0 200000' include both ends; 'Min exponent=2400000|Field size=200000' or '...|Max exponent=3200000'."""
    m = re.search(r"Min exponent=(\d+)", origin)
    if m:
        n0 = int(m.group(1))
        top, size = re.search(r"Max exponent=(\d+)", origin), re.search(r"Field size=(\d+)", origin)
        return (n0, int(top.group(1)) + 1) if top else (n0, n0 + int(size.group(1))) if size else None
    nums = re.findall(r"\d+", origin)
    return (int(nums[0]), int(nums[1]) + 1) if len(nums) >= 2 else None


def old_log_seconds(lines):
    """Run time in seconds of an old siever's log.txt. Every launch appends to the log, and the "Total time elapsed"
    a launch prints counts that launch only, so a task stopped and started again is the sum of its launches: each
    one its own printed total, or else from its "Starting 2^n-25 Siever" line to its last time stamp."""
    launches = []          # [first stamp, last stamp, printed seconds]
    for line in lines:
        t = log_time(line)
        if re.search(r"\] Starting 2\^n-25 Siever", line):
            launches.append([t, t, None])
            continue
        if not launches:
            continue
        if t:
            launches[-1][0] = launches[-1][0] or t
            launches[-1][1] = t
        m = re.search(r"Total time elapsed (?:throughout|in) this task: (\d+)ms", line)
        if m:
            launches[-1][2] = int(m.group(1)) / 1000
    if not launches:
        totals = re.findall(r"Total time elapsed (?:throughout|in) this task: (\d+)ms", "\n".join(lines))
        return int(totals[-1]) / 1000 if totals else 0
    stamp = lambda x: datetime.datetime.strptime(x, "%Y-%m-%d %H:%M:%S")
    return sum(s if s is not None else (stamp(b) - stamp(a)).total_seconds() if a and b else 0 for a, b, s in launches)


def sieve_info(tf_dir, notes):
    """The old sievers' TF folder: depth, program, start, end and run time over all its stations, and each
    station's own run in "runs" (its n range from origin.txt, start, end, seconds and program)."""
    info = {"depth": None, "program": None, "start": None, "end": None, "cpu_s": 0, "stations": 0, "runs": []}
    if not os.path.isdir(tf_dir):
        return info
    if os.path.exists(os.path.join(tf_dir, "origin.txt")):
        stations = [tf_dir]
    else:
        stations = sorted(glob.glob(os.path.join(glob.escape(tf_dir), "Station *")))
    depths, programs, starts, ends = [], [], [], []
    cpu_ms = 0
    for st in stations:
        depth = None
        override = os.path.join(st, "override.txt")
        if os.path.exists(override):
            text = read_text(override).strip()
            if text:
                try:
                    depth = int(text.split()[0])
                except ValueError:
                    notes.add("unreadable override.txt", override)
        origin_path = os.path.join(st, "origin.txt")
        run = {"name": "" if st == tf_dir else os.path.basename(st), "span": None, "start": None, "end": None, "s": 0, "program": None}
        if os.path.exists(origin_path):
            run["span"] = origin_span(read_text(origin_path))
        if depth is None and os.path.exists(origin_path):
            origin = read_text(origin_path)
            m = re.search(r"Max sieve=(\d+)", origin)
            if m:
                depth = int(m.group(1))
            else:
                parts = origin.split()
                if len(parts) >= 4 and parts[2] == "25" and parts[3].isdigit():
                    depth = int(parts[3])
        if depth:
            depths.append(depth)
            run["depth"] = depth
        log_path = os.path.join(st, "log.txt")
        if os.path.exists(log_path):
            lines = read_text(log_path).splitlines()
            if lines:
                m = re.search(r"Starting (.*)$", lines[0])
                programs.append(m.group(1).strip() if m else lines[0].strip())
                run["program"] = program_name(programs[-1])
                first = log_time(lines[0])
                last = None
                for line in reversed(lines):
                    last = log_time(line)
                    if last:
                        break
                if first:
                    starts.append(first)
                if last:
                    ends.append(last)
                run["start"], run["end"] = first, last
                secs = old_log_seconds(lines)
                if secs:
                    cpu_ms += secs * 1000
                    run["s"] = round(secs)
        info["runs"].append(run)
    info["stations"] = len(stations)
    info["depth"] = max(depths) if depths else None
    info["program"] = program_name(programs[0]) if programs else None
    info["start"] = min(starts) if starts else None
    info["end"] = max(ends) if ends else None
    info["cpu_s"] = round(cpu_ms / 1000)
    return info


MPS_BASE_P = 7          # 2, 3 and 5 never divide 2^n - 25 for odd n > 4, so a sieve from p <= 7 is complete
TRIAL_LIMIT = 10_000_000  # the exponent page finds factors below this itself; larger sieve factors go in the shards
UPLOAD_MIN_RATIO = 0.8    # an uploaded sieve slice counts toward the depth if it found this share of the expected factors
UPLOAD_MIN_EXPECTED = 100  # ... and the expected number is large enough to judge
UPLOAD_JUDGE_FROM = 10**6  # a slice that starts below 1000 is judged by its factors from here up
SMALL_PRIMES = None       # bytearray, 1 at the primes below TRIAL_LIMIT (made on first use)
# Miller-Rabin with the first k prime bases is exact below each bound (Jaeschke; Sorenson and Webster)
MR_BASES = (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41)
MR_BOUNDS = ((2_047, 1), (1_373_653, 2), (25_326_001, 3), (3_215_031_751, 4), (2_152_302_898_747, 5),
             (3_474_749_660_383, 6), (341_550_071_728_321, 7), (3_825_123_056_546_413_051, 9),
             (318_665_857_834_031_151_167_461, 12), (3_317_044_064_679_887_385_961_981, 13))


def is_prime(p):
    """Exact for every p below 3.3e24, far beyond any sieve depth: a table below 10^7, Miller-Rabin above."""
    global SMALL_PRIMES
    if p < TRIAL_LIMIT:
        if SMALL_PRIMES is None:
            t = bytearray([1]) * TRIAL_LIMIT
            t[0] = t[1] = 0
            for q in range(2, math.isqrt(TRIAL_LIMIT - 1) + 1):
                if t[q]:
                    t[q * q::q] = bytes((TRIAL_LIMIT - 1 - q * q) // q + 1)
            SMALL_PRIMES = t
        return p >= 2 and SMALL_PRIMES[p] == 1
    if any(p % q == 0 for q in MR_BASES):
        return False
    k = next((k for bound, k in MR_BOUNDS if p < bound), None)
    if k is None:
        return False                      # never reached by a sieve; treat as unchecked
    d, s = p - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for a in MR_BASES[:k]:
        x = pow(a, d, p)
        if x == 1 or x == p - 1:
            continue
        for _ in range(s - 1):
            x = x * x % p
            if x == p - 1:
                break
        else:
            return False
    return True


def small_factor(n, limit=1_000_000):
    """Smallest prime p < limit that divides 2^n - 25 (and is not 2^n - 25 itself), or None."""
    is_prime(2)                           # makes the table
    for p in range(7, min(limit, TRIAL_LIMIT), 2):   # 2, 3 and 5 never divide 2^n - 25 for odd n > 4
        if SMALL_PRIMES[p] and pow(2, n, p) == 25 % p and (n >= 64 or p < (1 << n) - 25):
            return p
    return None


ITSELF = "is 2^n - 25 itself"   # a sieve from p = 2 meets the small n where 2^n - 25 is a prime below P1


def factor_problem(n, p, p0, p1):
    """Why the sieve factor p of 2^n - 25 is not accepted, or None when it checks out."""
    if not p0 <= p < p1:
        return "is outside the file's [P0, P1)"
    if p < 2 or pow(2, n, p) != 25 % p:
        return "does not divide 2^n - 25"
    if n < 64 and p >= (1 << n) - 25:
        return ITSELF
    if not is_prime(p):
        return "is not prime"
    return None


def probable_prime(n):
    """is_prime() where it is exact (below 3.3e24); above that a strong probable-prime test to 24 bases."""
    if n < MR_BOUNDS[-1][0]:
        return is_prime(n)
    if any(n % q == 0 for q in MR_BASES):
        return False
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for a in MR_BASES + (43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89):
        x = pow(a, d, n)
        if x == 1 or x == n - 1:
            continue
        for _ in range(s - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


PRIME_LIST = []           # every prime up to some limit, made on first use by primes_upto()
STAGE1 = {}               # B1 -> the prime powers of a P-1 stage 1


def primes_upto(limit):
    """PRIME_LIST, long enough to hold every prime <= limit."""
    global PRIME_LIST
    if not PRIME_LIST or PRIME_LIST[-1] < limit:
        top = max(limit, TRIAL_LIMIT - 1)
        if top < TRIAL_LIMIT:
            is_prime(2)                   # makes SMALL_PRIMES
            table = SMALL_PRIMES
        else:
            table = bytearray([1]) * (top + 1)
            table[0] = table[1] = 0
            for q in range(2, math.isqrt(top) + 1):
                if table[q]:
                    table[q * q::q] = bytes((top - q * q) // q + 1)
        PRIME_LIST = list(itertools.compress(range(len(table)), table))
    return PRIME_LIST


def pm1_divisor(f, b1, b2, base):
    """Replays P-1 with bounds b1, b2 on f alone, a few primes at a time, and returns the first proper
    divisor of f that shows up, or None (nothing found, or every prime factor appeared at the same step)."""
    if b1 not in STAGE1:
        powers = []
        for p in primes_upto(b1)[:bisect.bisect_right(primes_upto(b1), b1)]:
            q = p
            while q * p <= b1:
                q *= p
            powers.append(q * p if p < 1000 else q)   # a spare power of each small prime costs nothing
        STAGE1[b1] = powers
    powers = STAGE1[b1]
    x = base
    for i in range(0, len(powers), 64):
        part = powers[i:i + 64]
        y = pow(x, math.prod(part), f)
        g = math.gcd(y - 1, f)
        if g == 1:
            x = y
            continue
        if g < f:
            return g
        for q in part:                    # every factor appeared in these 64 primes: go one prime at a time
            y = pow(x, q, f)
            g = math.gcd(y - 1, f)
            if g == 1:
                x = y
                continue
            return g if g < f else None
        return None
    if b2 <= b1:
        return None
    ps = primes_upto(b2)
    first, last = bisect.bisect_right(ps, b1), bisect.bisect_right(ps, b2)
    if first >= last:
        return None
    gaps = {}                             # x^d for the gaps d between consecutive primes
    z = pow(x, ps[first], f)
    acc, start = 1, first
    for i in range(first, last):
        if i > first:
            d = ps[i] - ps[i - 1]
            t = gaps.get(d)
            if t is None:
                t = gaps[d] = pow(x, d, f)
            z = z * t % f
        acc = acc * (z - 1) % f
        if i - start < 1023 and i < last - 1:
            continue
        if math.gcd(acc, f) == 1:
            start, acc = i + 1, 1
            continue
        w = pow(x, ps[start], f)          # something showed up in this block: find the prime
        for j in range(start, i + 1):
            if j > start:
                w = w * gaps[ps[j] - ps[j - 1]] % f
            g = math.gcd(w - 1, f)
            if g > 1:
                return g if g < f else None
        return None
    return None


def pm1_split(f, b1, b2):
    """The prime factors of f, a factor that a P-1 run with bounds b1, b2 found, in increasing order.
    P-1 sometimes finds two or more prime factors at once and reports their product; replaying the run in
    small steps (with other bases if needed) separates them. None if f is composite and does not split."""
    if probable_prime(f):
        return [f]
    for base in (3, 5, 7, 11, 13, 17):
        d = pm1_divisor(f, b1, b2, base)
        if d:
            a, b = pm1_split(d, b1, b2), pm1_split(f // d, b1, b2)
            return sorted(a + b) if a is not None and b is not None else None
    return None


def split_factors(factors, notes, cache_path=SPLIT_CACHE):
    """{factor string: [prime factor strings]} for every composite P-1 factor; the splits are kept in
    cache_path, so each composite is worked on once."""
    cache = {}
    try:
        with open(cache_path, encoding="utf-8") as fh:
            cache = json.load(fh)
    except (OSError, ValueError):
        pass
    out, fresh = {}, 0
    for n, p, ts, b1, b2, who in factors:
        if p in out or not p.isdigit():
            continue
        f = int(p)
        if p in cache and (cache[p] is None or math.prod(int(q) for q in cache[p]) == f):
            parts = cache[p]
        elif probable_prime(f):
            continue
        else:
            got = pm1_split(f, int(b1 or 0), int(b2 or 0))
            parts = [str(q) for q in got] if got else None
            cache[p] = parts
            fresh += 1
        if parts is None:
            notes.add("composite P-1 factor that could not be split into primes", f"n = {n}: {p}")
        out[p] = parts
    if fresh:
        try:
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as fh:
                json.dump(cache, fh, indent=0, sort_keys=True)
        except OSError:
            pass
    return out


def mps_entries(tf_dir, notes):
    """Mass Prime Siever 12.0 output under TF/: every results.json (one per machine or p slice).
    Each entry: {Timestamp, b, c, P0, P1, N0, N1, prp: [n...], factored: [{n, factors: [p...]}]}."""
    out = []
    for path in sorted(glob.glob(os.path.join(glob.escape(tf_dir), "**", "results.json"), recursive=True)):
        out += read_mps_file(path, notes, mps_log(os.path.dirname(path)))
    return out


def read_mps_file(path, notes, log):
    try:
        data = json.loads(read_text(path))
    except ValueError:
        notes.add("unreadable Mass Prime Siever results.json", path)
        return []
    if not isinstance(data, list):
        notes.add("Mass Prime Siever results.json is not a list", path)
        return []
    out = []
    for e in data:
        try:
            b, c = int(e["b"]), int(e["c"])
            p0, p1, n0, n1 = int(e["P0"]), int(e["P1"]), int(e["N0"]), int(e["N1"])
        except (KeyError, TypeError, ValueError):
            notes.add("Mass Prime Siever entry without b, c, P0, P1, N0, N1", path)
            continue
        if (b, c) != (2, -25):
            notes.add("sieve output for another sequence", path)
            continue
        out.append({"path": path, "p0": p0, "p1": p1, "n0": n0, "n1": n1, "prp": e.get("prp") or [],
                    "factored": e.get("factored") or [], "time": str(e.get("Timestamp") or ""), "log": log})
    return out


def expected_factors(odd, p0, p1):
    """Sieve factors expected in [p0, p1) over `odd` odd n: about odd * ln(ln p1 / ln p0). Real runs of
    2^n - 25 come within about 10% of it for small p ranges, and closer for the wide ones above 10^9."""
    if p0 < 1000 or p1 <= p0:
        return None
    return odd * math.log(math.log(p1) / math.log(p0))


def uploaded_sieve(root, notes, accepted):
    """Sieve output uploaded through the Join page (Submissions/<id>/TF/, written by pull_submissions.py)."""
    out = []
    pattern = os.path.join(glob.escape(os.path.join(root, "Submissions")), "*", "TF", "results.json")
    for path in sorted(glob.glob(pattern)):
        folder = os.path.dirname(path)
        sid = os.path.basename(os.path.dirname(folder))
        try:
            up = json.loads(read_text(os.path.join(folder, "upload.json")))
        except (OSError, ValueError):
            notes.add("uploaded sieve output without a readable upload.json (not used)", path)
            continue
        run = up.get("run") or {}
        log = {"start": run.get("start") or None, "end": run.get("end") or None, "wall_s": float(run.get("wall_s") or 0),
               "program": run.get("program") or "Mass Prime Siever 12.0"}
        who = str(up.get("handle") or "anonymous")[:40]
        for e in read_mps_file(path, notes, log):
            odd = len(range(max(e["n0"], 5) | 1, min(e["n1"], N_MAX), 2))
            # small primes do not follow ln(ln p1 / ln p0) for this sequence (3 and 5 never divide 2^n - 25),
            # so a slice that starts below 1000 is judged by its factors from UPLOAD_JUDGE_FROM up
            low = e["p0"] if e["p0"] >= 1000 else UPLOAD_JUDGE_FROM
            found = sum(1 for x in e["factored"] if isinstance(x, dict) for f in (x.get("factors") or []) if int(f) >= low)
            want = expected_factors(odd, low, e["p1"])
            plausible = want is not None and want >= UPLOAD_MIN_EXPECTED and found >= UPLOAD_MIN_RATIO * want
            e.update({"who": who, "upload": sid, "depth_ok": sid in accepted or plausible})
            if not e["depth_ok"]:
                # noted only if the slice is used: an upload that the archive holds too counts once, from the archive
                e["depth_note"] = (f"{sid} by {who}: p {e['p0']}-{e['p1']}, n {e['n0']}-{e['n1']}, {found} factors" +
                                   (f" from {low:,}" if low != e["p0"] else "") + (f", about {round(want)} expected" if want else ""))
            out.append(e)
    return out


def mps_log(folder):
    """Start, end, wall-clock seconds and version from a Mass Prime Siever siever.log."""
    path = os.path.join(folder, "siever.log")
    if not os.path.exists(path):
        return None
    text = read_text(path)
    stamps = re.findall(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})", text, re.M)
    totals = re.findall(r"Total elapsed time:\s+([\d.]+)", text)
    version = re.search(r"Mass Prime Siever ([\d.]+) starting", text)
    return {"start": stamps[0] if stamps else None, "end": stamps[-1] if stamps else None,
            "wall_s": float(totals[-1]) if totals else 0.0,
            "program": "Mass Prime Siever " + (version.group(1) if version else "12.0")}


def run_key(e):
    """One sieve run, however many range folders or uploads hold a piece of it: its siever.log (program, start,
    end, seconds). None when there is no log."""
    g = e.get("log") or {}
    if not (g.get("start") or g.get("end") or g.get("wall_s")):
        return None
    return (g.get("program") or "Mass Prime Siever 12.0", g.get("start") or "", g.get("end") or "", round(float(g.get("wall_s") or 0)))


def check_mps(entries, lo, hi, notes):
    """Merge Mass Prime Siever slices for the odd n in [lo, hi).

    Every factor in "factored" is checked: P0 <= p < P1, p divides 2^n - 25, p is not 2^n - 25 itself, and
    p is prime. An n counts as removed only when at least one of its factors checks out. Survivors are the
    odd n covered by a slice that starts at p <= 7, minus the removed ones. Returns (survivors, smallest
    checked factor per removed n, per-row sieve info, partial rows: the rows sieved over some p ranges but not
    from p <= 7 yet, and every checked factor above TRIAL_LIMIT of each slice: {id(entry): {n: {p, ...}}}).

    The depth of a row is the largest P reached from p <= 7 by slices that join up, taken over every part of
    the row (slices may cover only part of a row's n). Uploaded slices count only when e["depth_ok"]."""
    removed, found = {}, {}
    for e in entries:
        a, b = max(e["n0"], lo, 5), min(e["n1"], hi)
        if a >= b:
            notes.add("sieve output for n outside its range folder", e["path"])
            continue
        listed = collections.Counter()
        mine = found.setdefault(id(e), {})   # n -> this slice's checked factors above TRIAL_LIMIT
        for item in e["factored"]:
            try:
                n = int(item["n"])
                fs = [int(f) for f in item.get("factors") or []]
            except (KeyError, TypeError, ValueError):
                notes.add("unreadable entry in Mass Prime Siever factored list", e["path"])
                continue
            listed[n] += 1
            if not (a <= n < b) or n % 2 == 0:
                continue
            if not fs:
                notes.add("sieve output lists n as factored but gives no factor (n kept as a candidate)", f"{e['path']}: n = {n}")
                continue
            good, itself = [], False
            for p in fs:
                why = factor_problem(n, p, e["p0"], e["p1"])
                if why is None:
                    good.append(p)
                elif why == ITSELF:
                    itself = True            # 2^n - 25 is prime: not a factor, and no problem either
                else:
                    notes.add(f"sieve factor that {why}", f"{e['path']}: n = {n}, p = {p}")
            if not good:
                if not itself:
                    notes.add("n kept as a candidate because none of its sieve factors checked out", f"{e['path']}: n = {n}")
                continue
            big = [p for p in good if p > TRIAL_LIMIT]   # the pages find the smaller ones themselves
            if big:
                mine.setdefault(n, set()).update(big)
            if n not in removed or min(good) < removed[n]:
                removed[n] = min(good)
        for x in e["prp"]:
            try:
                listed[int(x)] += 1
            except (TypeError, ValueError):
                notes.add("unreadable entry in Mass Prime Siever prp list", e["path"])
        twice = [n for n, k in listed.items() if k > 1]
        if twice:
            notes.add("n listed twice in one sieve output", f"{e['path']}: n = {min(twice)}")
        odd_listed = sum(1 for n in listed if a <= n < b and n % 2 == 1)
        odd_expected = len(range(a | 1, b, 2))
        if odd_listed != odd_expected:
            missing = [n for n in range(a | 1, b, 2) if n not in listed]
            notes.add("odd n missing from a sieve output (kept as candidates)", f"{e['path']}: {len(missing)} n, first {missing[0] if missing else '?'}")

    # base slices sieve from the smallest primes; only their n range counts as sieved
    base = [e for e in entries if e["p0"] <= MPS_BASE_P and e.get("depth_ok", True)]
    spans = sorted((max(e["n0"], lo, 5), min(e["n1"], hi)) for e in base if max(e["n0"], lo, 5) < min(e["n1"], hi))
    if entries and not base:
        notes.add("Mass Prime Siever output without a slice starting at p <= 7 (range not counted as sieved)", entries[0]["path"])
    survivors = set()
    for a, b in spans:
        survivors.update(n for n in range(a | 1, b, 2) if n not in removed)

    rows, part, gaps = [], [], set()
    depth_entries = [e for e in entries if e.get("depth_ok", True)]
    for r_lo in range(lo - lo % ROW, hi, ROW):
        a, b = max(r_lo, lo, 5), min(r_lo + ROW, hi)
        if a >= b:
            continue
        touching = [e for e in depth_entries if e["n0"] < b and e["n1"] > a]
        cuts = sorted({a, b} | {x for e in touching for x in (e["n0"], e["n1"]) if a < x < b})
        depth, used, whole = None, {}, True
        for s, t in zip(cuts, cuts[1:]):
            if not range(s | 1, t, 2):
                continue                     # no odd n in this piece
            cover = sorted((e["p0"], e["p1"], k) for k, e in enumerate(touching) if e["n0"] <= s and e["n1"] >= t)
            reach, piece = MPS_BASE_P, None
            for p0, p1, k in cover:
                if p0 > reach:
                    if base:                 # with no slice from p <= 7 at all, the note above says it already
                        gaps.add((touching[k]["path"], reach, p0))
                    break
                if piece is None or p1 > piece:
                    piece = reach = p1
                    used[id(touching[k])] = touching[k]
            if piece is None:
                whole = False                # part of the row was never sieved from the smallest primes
                break
            depth = piece if depth is None else min(depth, piece)
        if not whole or depth is None:
            # not sieved from the smallest primes yet: the p ranges done over the whole row so far
            over = [e for e in depth_entries if e["n0"] <= a and e["n1"] >= b]
            if over:
                part.append({"lo": max(r_lo, lo), "hi": min(r_lo + ROW, hi), "p": merge_spans((e["p0"], e["p1"]) for e in over),
                             "factored": sum(1 for n in range(a | 1, b, 2) if n in removed),
                             "end": max((e["time"][:19] for e in over if e["time"]), default=None)})
            continue
        # one run may be split over several entries or uploads: count its time once
        runs = {}
        for e in used.values():
            g = e["log"]
            if g:
                runs.setdefault((g["program"], g["start"], g["end"], g["wall_s"]), g)
        logs = list(runs.values())
        info = {"depth": depth, "program": logs[0]["program"] if logs else "Mass Prime Siever 12.0",
                "start": min((g["start"] for g in logs if g["start"]), default=None),
                # when it finished, to the second: the Timestamp in results.json, else the end of siever.log
                "end": max((e["time"][:19] for e in used.values() if e["time"]), default=None) or max((g["end"] for g in logs if g["end"]), default=None),
                "cpu_s": round(sum(g["wall_s"] for g in logs)), "stations": len({e["path"] for e in used.values()}),
                "_runs": list(runs)}           # Archive.scan shares a run's time between the rows it covers
        who = sorted({e["who"] for e in used.values() if e.get("who")})
        if who:
            info["by"] = who
        rows.append({"lo": max(r_lo, lo), "hi": min(r_lo + ROW, hi), "info": info})
    for path, reach, p0 in sorted(gaps):
        notes.add("gap in the sieved p range", f"{path}: nothing between {reach} and {p0}")
    return survivors, removed, rows, part, found


def read_results(path, notes):
    """Prime95 JSON result lines for 1*2^n-25."""
    out = []
    for line in read_lines(path):
        if not line.startswith("{"):
            continue
        try:
            j = json.loads(line)
        except ValueError:
            notes.add("broken JSON line", path)
            continue
        if not isinstance(j, dict) or j.get("k") != 1 or j.get("b") != 2 or j.get("c") != -25 or not isinstance(j.get("n"), int):
            notes.add("line for another number", path)
            continue
        out.append(j)
    return out


def read_ranks(site, notes, path=PRPTOP):
    """Top PRP ranks: archive/prptop.json when it is there, otherwise the ones written in content/site.json."""
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        values = {str(int(n)): f"#{int(r):,}" for n, r in doc["ranks"].items()}
        return {"date": str(doc["checked"])[:10], "values": values, "daily": True}
    except FileNotFoundError:
        pass
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
        notes.add("archive/prptop.json could not be read; the ranks in content/site.json are shown", f"{type(e).__name__}: {e}")
    r = site.get("ranks") or {}
    return {"date": r.get("date"), "values": r.get("values") or {}, "daily": False}


def digits_of(n):
    if n < 4000:
        return len(str(2 ** n - 25))
    return int(n * LOG10_2) + 1


def date_part(ts):
    return ts[:10] if ts else None


def shard_name(lo):
    """The data file of the SHARD n from lo on, named by lo in millions: 3.61 holds 3,610,000 to 3,619,999."""
    k = lo // SHARD
    return f"{k // 100}.{k % 100:02d}"


class Archive:
    def __init__(self, root, credit, notes):
        self.root = root
        self.credit = credit
        self.notes = notes
        self.dirs = []                       # [(lo, hi, name, sieve_info, has_survivor_list)]
        self.survivors = set()
        self.sieved_spans = []               # [(lo, hi)] with a finished sieve
        self.pm1 = collections.defaultdict(list)
        self.prp = collections.defaultdict(list)
        self.seen = set()
        self.programs = []
        self.users = [credit]
        self.factors = []                    # (n, p string, time, b1, b2, user)
        self.survivors_before = set()        # survivors of the first sieve, in the ranges sieved twice
        self.factors_not_kept = []           # [(lo, hi)] whose first sieve kept no list of its factors (content/site.json)
        self.small_n = set()                 # n where 2^n - 25 is a small prime (content/site.json small_primes)
        self.depth_overrides = {}            # range lo -> sieve depth for old sieve files without one (range_overrides)
        self.daily_prp = collections.Counter()
        self.daily_pm1 = collections.Counter()
        self.program_counts = collections.Counter()
        self.proofs = 0
        self.prime_records = {}
        self.sieve_sources = []              # sieve slices, each with every checked factor above TRIAL_LIMIT it found
        self.run_spans = {}                  # run_key -> (n0, n1): every n a sieve run covered, over all its pieces
        self.sieve_smallest = {}             # n -> smallest checked Mass Prime Siever factor, any size
        self.mps_spans = []                  # [(lo, hi)] rows sieved by Mass Prime Siever
        self.accepted_uploads = set()        # uploaded sieve slices to count toward the depth (content/site.json)
        self.uploads = []                    # uploaded sieve entries
        self.uploads_seen = set()            # id() of uploaded entries that met a range folder
        self.uploads_archived = set()        # uploads whose slices the archive keeps too (counted once)
        self.uploads_used = set()            # id() of uploaded entries merged into some range folder
        self.partial = []                    # rows sieved over some p ranges, not from p <= 7 yet
        self.confirmed = set()               # uploaded probable primes the project has re-tested (content/site.json)
        self.reported = {}                   # n -> who, uploaded probable primes not confirmed yet

    def index(self, table, value):
        if value not in table:
            table.append(value)
        return table.index(value)

    def scan(self):
        ranges_root = os.path.join(self.root, "Ranges")
        if not os.path.isdir(ranges_root):
            sys.exit(f"No Ranges folder in {self.root}\n"
                     "Run python tools/sync_archive.py with the archive drive attached, or pass --archive.")
        self.uploads = uploaded_sieve(self.root, self.notes, self.accepted_uploads)
        names = []
        for name in os.listdir(ranges_root):
            m = RANGE_DIR.match(name)
            if not m:
                continue
            lo, hi = round(float(m.group(1)) * 1e6), round(float(m.group(2)) * 1e6)
            names.append((lo, hi, name))
        for lo, hi, name in sorted(names):
            self.scan_range(lo, hi, os.path.join(ranges_root, name))
        # a run split over several range folders keeps its log in each: share its time out evenly
        uses = collections.Counter(k for d in self.dirs if d.get("sieve") for k in d["sieve"].get("_runs", ()))
        for d in self.dirs:
            s = d.get("sieve")
            if s and "_runs" in s:
                s["cpu_s"] = round(sum((k[3] or 0) / uses[k] for k in s.pop("_runs")))
        for e in self.uploads:
            if id(e) not in self.uploads_seen:
                self.notes.add("uploaded sieve output for n outside every range folder (not used)", f"{e['upload']}: n {e['n0']}-{e['n1']}")
            elif id(e) in self.uploads_used and not e["depth_ok"]:
                self.notes.add("uploaded sieve slice not counted toward the sieve depth (too few factors, or too small to judge); "
                               "add its id to accepted_sieve_uploads in content/site.json once you trust it", e["depth_note"])
        sub_root = os.path.join(self.root, "Submissions")
        if os.path.isdir(sub_root):
            for path in sorted(glob.glob(os.path.join(glob.escape(sub_root), "*", "submission.json"))):
                self.scan_submission(path)

    def scan_live(self, path):
        """The PRP results of the Prime95 run on this PC (tools/live_prp.py), after the archive and the uploads,
        so that a test the archive has too counts once, as the archive's."""
        if not path or not os.path.exists(path):
            return
        try:
            doc = json.loads(read_text(path))
        except ValueError:
            self.notes.add("live PRP results that cannot be read (not used)", path)
            return
        for j in doc.get("results") or []:
            if isinstance(j, dict) and j.get("k") == 1 and j.get("b") == 2 and j.get("c") == -25 and isinstance(j.get("n"), int):
                self.add_result(j, self.credit, path, live=True)

    def old_sieve(self, tf, candidates, pm1, lo):
        """The old sievers' output in TF/: (sieve info, survivors, whether there is a survivor list). The
        largest worktodo_general*.txt is the survivor list; without one, the Candidates/*.txt work lines and the
        n given a P-1 run stand in for it. A depth in content/site.json range_overrides replaces the files' one
        (origin.txt of 2.4M-2.6M names none)."""
        info = sieve_info(tf, self.notes)
        if lo in self.depth_overrides:
            info["depth"] = self.depth_overrides[lo]
        survivors = set()
        lists = sorted(glob.glob(os.path.join(glob.escape(tf), "worktodo_general*.txt"))) if os.path.isdir(tf) else []
        for path in lists:
            got = n_from_work_lines(path)
            if len(got) > len(survivors):
                survivors = got
        if not survivors and candidates:
            survivors = set(candidates) | {j["n"] for j in pm1}
        return info, survivors, bool(survivors)

    def scan_range(self, lo, hi, folder):
        tf = os.path.join(folder, "TF")
        name = os.path.basename(folder)
        mps = mps_entries(tf, self.notes) if os.path.isdir(tf) else []
        extra = [e for e in self.uploads if e["n0"] < hi and e["n1"] > lo]
        self.uploads_seen.update(id(e) for e in extra)
        kept = []
        if mps:
            # an upload whose p range over these n the archive keeps too (the project's own Kaggle runs) counts once
            kept = [e for e in extra if any(o["p0"] <= e["p0"] and o["p1"] >= e["p1"] and o["n0"] <= max(e["n0"], lo)
                                            and o["n1"] >= min(e["n1"], hi) for o in mps)]
            self.uploads_archived.update(e["upload"] for e in kept)
            kept_ids = {id(e) for e in kept}
            extra = [e for e in extra if id(e) not in kept_ids]
            self.uploads_used.update(id(e) for e in extra)
        candidates = set()
        for path in sorted(glob.glob(os.path.join(glob.escape(folder), "Candidates", "*.txt"))):
            candidates |= n_from_work_lines(path)
        pm1_path = os.path.join(folder, "Pm1", "results.json.txt")
        prp_path = os.path.join(folder, "PRP", "results.json.txt")
        pm1 = read_results(pm1_path, self.notes) if os.path.exists(pm1_path) else []
        prp = read_results(prp_path, self.notes) if os.path.exists(prp_path) else []
        everything = candidates | {j["n"] for j in pm1} | {j["n"] for j in prp}
        # the old sievers' files (origin.txt, Station N/): in a range Mass Prime Siever sieved again, its first sieve
        has_old = os.path.isdir(tf) and (os.path.exists(os.path.join(tf, "origin.txt")) or
                                         bool(glob.glob(os.path.join(glob.escape(tf), "Station *"))))
        if mps:
            # Mass Prime Siever 12.0: merge the slices (and uploaded ones), checking every factor
            survivors, removed, mps_rows, part, found = check_mps(mps + extra, lo, hi, self.notes)
            for r in part:
                self.partial.append({**r, "folder": name})
            self.sieve_smallest.update(removed)
            first = None
            if has_old:
                o_info, o_surv, o_list = self.old_sieve(tf, candidates, pm1, lo)
                if o_info["depth"] and o_list:
                    # a candidate missing from the survivor list was tested all the same: it counts as a survivor
                    first = {"info": o_info, "survivors": o_surv | candidates,
                             "kept": not any(a <= lo and hi <= b for a, b in self.factors_not_kept)}
                else:
                    self.notes.add("old sieve files without a depth or a survivor list next to Mass Prime Siever output "
                                   "(only the Mass Prime Siever output is used)", folder)
            # every factor P-1 reported, by n: a sieve factor that divides one of them was P-1's to find first
            pm1_found = collections.defaultdict(list)
            for j in pm1:
                if j.get("status") == "F":
                    for f in j.get("factors") or []:
                        if str(f).strip().isdigit():
                            pm1_found[j["n"]].append(int(str(f).strip()))
            self.add_sources(lo, hi, kept, mps, extra, found, first, pm1_found)
            everything |= survivors
            rows = mps_rows
            if not first:
                self.survivors |= survivors
            else:
                old = first["survivors"]
                everything |= old
                lost = sorted(n for n in survivors if n not in old and n not in self.small_n)
                if lost:
                    self.notes.add("n the second sieve kept although the first sieve removed it (no factor below the second "
                                   "sieve's depth; it has had no P-1 or PRP work)", f"{folder}: {len(lost)} n, first n = {lost[0]}")
                missed = sorted(n for n in old if n in removed and removed[n] < first["info"]["depth"])
                if missed:
                    self.notes.add("n the first sieve left although a prime below its depth divides it",
                                   f"{folder}: {len(missed)} n, first n = {missed[0]} (p = {removed[missed[0]]})")
                # a row the second sieve has not covered from p <= 7, or not as deep as the first: the first sieve counts
                deeper = [r for r in mps_rows if r["info"]["depth"] > first["info"]["depth"]]
                if len(deeper) < len(mps_rows):
                    self.notes.add("Mass Prime Siever output not deeper than the first sieve (the first sieve still counts)", folder)
                rows = deeper
            # candidates.txt may predate a deeper slice; the checked sieve output decides, but a survivor
            # missing from the candidate list would never get its PRP test
            unlisted = sorted(survivors - candidates - (first["survivors"] if first else set()) - self.small_n) if candidates else []
            for n in unlisted:
                self.notes.add("sieve survivor missing from Candidates/*.txt (needs a PRP test)", f"{folder}: n = {n}")
            covered = set()
            for r in rows:
                self.sieved_spans.append((r["lo"], r["hi"]))
                self.mps_spans.append((r["lo"], r["hi"]))
                entry = {"lo": r["lo"], "hi": r["hi"], "folder": name, "sieve": r["info"], "survivor_list": True}
                if first:
                    self.survivors |= {n for n in survivors if r["lo"] <= n < r["hi"]}
                    mine = {n for n in first["survivors"] if r["lo"] <= n < r["hi"]}
                    entry["before"] = {k: first["info"][k] for k in ("depth", "program", "start", "end", "cpu_s", "stations")}
                    entry["before"]["survivors"] = len(mine)
                    self.survivors_before |= mine
                self.dirs.append(entry)
                covered.add((r["lo"], r["hi"]))
            if first:
                for r_lo in range(lo - lo % ROW, hi, ROW):
                    a, b = max(r_lo, lo), min(r_lo + ROW, hi)
                    if a < b and (a, b) not in covered:
                        self.sieved_spans.append((a, b))
                        self.survivors |= {n for n in first["survivors"] if a <= n < b}
                        self.dirs.append({"lo": a, "hi": b, "folder": name, "sieve": first["info"], "survivor_list": True})
        else:
            for e in extra:
                self.notes.add("uploaded sieve output for a range without Mass Prime Siever output of its own (not used)",
                               f"{e['upload']}: {name}")
            info, survivors, has_list = self.old_sieve(tf, candidates, pm1, lo)
            everything |= survivors
            if has_list:
                self.sieved_spans.append((lo, hi))
                self.survivors |= survivors
            missing = candidates - survivors
            if missing:
                self.notes.add("candidate not in the sieve output", f"{folder}: n = {min(missing)}")
                self.survivors |= missing
            self.dirs.append({"lo": lo, "hi": hi, "folder": name, "sieve": info, "survivor_list": has_list})
        outside = [n for n in everything if not lo <= n < hi]
        if outside:
            self.notes.add("n outside its range folder", f"{folder}: n = {min(outside)}")
        for j in pm1:
            self.add_result(j, self.credit, pm1_path)
        for j in prp:
            self.add_result(j, self.credit, prp_path)

    def add_sources(self, lo, hi, kept, mps, extra, found, first=None, pm1_found=None):
        """Every checked sieve factor above TRIAL_LIMIT of the odd n in [lo, hi), under whoever found it first.
        A factor that divides a P-1 factor of the same n is P-1's: it is shown with that result and listed under
        no slice. In a range sieved twice (first), the first sieve comes first: every factor below its depth of
        an n it removed, unless content/site.json says it kept no list of them (first["kept"]). Then an upload
        that the archive keeps too, so its factors keep the name they were uploaded under; then the range
        folder's own slices; then the other uploads, earliest first. A factor that several slices list is kept
        once, under the first of them, and a run listed twice (an upload and the archive's copy of it: the same
        p and n range) is listed once, under the upload. The pages find every other slice that found a factor
        again from the slices' p ranges: a sieve finds every factor in its p range."""
        checked = collections.defaultdict(set)
        for by_n in found.values():
            for n, ps in by_n.items():
                checked[n] |= ps

        def when(e):
            # when the run finished, to the second: the Timestamp in its results.json, else the end of its siever.log
            g = e.get("log") or {}
            return str(e["time"][:19] if e["time"] else g.get("end") or "")

        claimed = set()
        for n, fs in (pm1_found or {}).items():
            claimed.update((n, p) for p in checked.get(n, ()) if any(F % p == 0 for F in fs))
        if first:
            depth, old = first["info"]["depth"], first["survivors"]
            src = {"p0": 2, "p1": depth, "n0": lo, "n1": hi, "end": first["info"]["end"] or None,
                   "by": self.index(self.users, self.credit), "upload": False, "before": True, "f": {},
                   "prog": first["info"]["program"], "st": first["info"]["start"], "s": first["info"]["cpu_s"], "span": (lo, hi),
                   "runs": [r for r in first["info"].get("runs", []) if r["span"]]}
            self.sieve_sources.append(src)
            if first["kept"]:
                for n in sorted(checked):
                    if n in old:
                        continue
                    mine = sorted(p for p in checked[n] if p < depth and (n, p) not in claimed)
                    if mine:
                        claimed.update((n, p) for p in mine)
                        src["f"][n] = mine
        listed_runs = {}                 # (p0, p1, n0, n1) -> its entry in sieve_sources
        order = (sorted(kept, key=lambda e: (when(e), e["upload"])) + mps +
                 sorted(extra, key=lambda e: (when(e), e["upload"])))
        for e in order:
            k = run_key(e)
            if k:
                span = self.run_spans.get(k)
                self.run_spans[k] = (min(span[0], e["n0"]), max(span[1], e["n1"])) if span else (e["n0"], e["n1"])
            if id(e) in found:
                listed = found[id(e)]
            else:
                # an upload the archive keeps too was not checked again: take the factors it lists that the
                # archive's copy of the run checked
                listed = collections.defaultdict(set)
                for item in e["factored"]:
                    try:
                        n = int(item["n"])
                        fs = [int(f) for f in item.get("factors") or []]
                    except (KeyError, TypeError, ValueError):
                        continue
                    if lo <= n < hi and n in checked:
                        listed[n].update(p for p in fs if e["p0"] <= p < e["p1"] and p in checked[n])
            key = (e["p0"], e["p1"], max(e["n0"], lo), min(e["n1"], hi))
            src = listed_runs.get(key)
            if src is None:
                g = e.get("log") or {}
                src = {"p0": key[0], "p1": key[1], "n0": key[2], "n1": key[3], "end": when(e) or None,
                       "by": self.index(self.users, e.get("who") or self.credit), "upload": "upload" in e, "f": {},
                       "prog": g.get("program") or "Mass Prime Siever 12.0", "st": g.get("start") or None,
                       "s": round(float(g.get("wall_s") or 0)), "key": k}
                listed_runs[key] = src
                self.sieve_sources.append(src)
            for n, ps in listed.items():
                new = sorted(p for p in ps if (n, p) not in claimed)
                if new:
                    claimed.update((n, p) for p in new)
                    src["f"][n] = sorted(src["f"].get(n, []) + new)

    def scan_submission(self, path):
        try:
            sub = json.loads(read_text(path))
        except ValueError:
            self.notes.add("unreadable submission.json", path)
            return
        user = str(sub.get("handle") or "anonymous")[:40]
        for line in sub.get("lines", []):
            try:
                j = json.loads(line)
            except ValueError:
                self.notes.add("broken JSON line", path)
                continue
            if isinstance(j, dict) and j.get("k") == 1 and j.get("b") == 2 and j.get("c") == -25 and isinstance(j.get("n"), int):
                self.add_result(j, user, path, uploaded=True)

    def add_result(self, j, user, where, uploaded=False, live=False):
        n = j["n"]
        wt = str(j.get("worktype", ""))
        ts = str(j.get("timestamp", ""))
        key = (n, wt, ts, j.get("status"), j.get("res64"), tuple(j.get("factors") or ()))
        if key in self.seen:
            if not live:                  # a live result that reached the archive since is no news
                self.notes.add("duplicate result line", f"{where}: n = {n}")
            return
        self.seen.add(key)
        if n % 2 == 0 or n >= N_MAX:
            self.notes.add("result for an even n or n >= 10^7", f"{where}: n = {n}")
            return
        prog = j.get("program") or {}
        prog_label = " ".join(str(x) for x in (prog.get("name", "?"), prog.get("version", ""))).strip()
        if prog.get("build"):
            prog_label += f" b{prog['build']}"
        pid = self.index(self.programs, prog_label)
        uid = self.index(self.users, user)
        if wt == "P-1":
            factor = ""
            if j.get("status") == "F":
                # every factor the line reports, comma-separated (Prime95 reports one; when P-1 finds several
                # primes in the same run it reports their product)
                fs = [str(f).strip() for f in j.get("factors") or [] if str(f).strip()]
                factor = ",".join(fs)
                for f in fs:
                    self.factors.append((n, f, ts, j.get("b1") or 0, j.get("b2") or 0, user))
            rec = [ts, j.get("b1") or 0, j.get("b2") or 0, factor, pid]
            if uid:
                rec.append(uid)
            self.pm1[n].append(rec)
            if ts:
                self.daily_pm1[ts[:10]] += 1
        elif wt.startswith("PRP"):
            status = j.get("status")
            proof = j.get("proof") or {}
            if status == "P" and (uploaded or live) and (p := small_factor(n)):
                self.notes.add("a probable prime reported although a small prime divides 2^n - 25 (line ignored)",
                               f"{where}: n = {n}, p = {p}, by {user}")
                return
            if status == "P" and (uploaded or live) and n not in self.confirmed and n not in self.prime_records:
                # a probable prime from an upload or from the live Prime95 run is listed once the project confirms it
                status = "R"
                self.reported[n] = user
                self.notes.add("probable prime reported in an upload: re-test it, then add n to confirmed_primes in content/site.json"
                               if uploaded else "probable prime in the live Prime95 results: check it, then put its result in the "
                               "range's PRP/results.json.txt or add n to confirmed_primes in content/site.json",
                               f"{where}: n = {n}, by {user}")
            if proof:
                self.proofs += 1
            rec = [ts, status, j.get("res64", "") if status == "C" else "", j.get("fft-length") or 0,
                   proof.get("power") or 0, str(proof.get("md5") or "")[:8], pid]
            if uid:
                rec.append(uid)
            self.prp[n].append(rec)
            self.program_counts[prog_label] += 1
            if ts:
                self.daily_prp[ts[:10]] += 1
            if status == "P":
                old = self.prime_records.get(n)
                if old is None or ts < old["found"]:
                    self.prime_records[n] = {"found": ts, "fft": j.get("fft-length") or 0, "proof_power": proof.get("power") or 0,
                                             "program": prog_label, "who": user, "security_code": j.get("security-code", "")}
        else:
            self.notes.add(f"worktype {wt} ignored", f"{where}: n = {n}")

    def is_sieved(self, n):
        return any(lo <= n < hi for lo, hi in self.sieved_spans)


def resolution_time(arc, n):
    """When n stopped needing work: first PRP result, or the P-1 run that found a factor."""
    times = [r[0] for r in arc.prp.get(n, []) if r[0]]
    times += [r[0] for r in arc.pm1.get(n, []) if r[3] and r[0]]
    return min(times) if times else None


def between(sorted_list, lo, hi):
    """Items x of a sorted list with lo <= x < hi."""
    return sorted_list[bisect.bisect_left(sorted_list, lo):bisect.bisect_left(sorted_list, hi)]


def build(archive_root, out_dir, content_path, live_path=None):
    t0 = time.time()
    notes = Notes()
    with open(content_path, encoding="utf-8") as f:
        site = json.load(f)
    site.pop("_about", None)
    content_dir = os.path.dirname(os.path.abspath(content_path))
    static_layers = read_layers(os.path.join(content_dir, "sieve_layers.json"), notes)
    trial_left = read_trial_left(os.path.join(content_dir, "trial_left.json"), notes)
    credit = site.get("credit", "RP-12000")
    arc = Archive(archive_root, credit, notes)
    arc.confirmed = {int(n) for n in site.get("confirmed_primes", [])}
    arc.accepted_uploads = {str(x) for x in site.get("accepted_sieve_uploads", [])}
    arc.factors_not_kept = [(int(x["lo"]), int(x["hi"])) for x in site.get("sieve_factors_not_kept", [])]
    arc.small_n = {int(p["n"]) for p in site.get("small_primes", [])}
    overrides = {int(k): v for k, v in site.get("range_overrides", {}).items()}
    arc.depth_overrides = {lo: int(v["sieve_depth"]) for lo, v in overrides.items() if v.get("sieve_depth")}
    arc.scan()
    arc.scan_live(live_path)
    splits = split_factors(arc.factors, notes)

    small_primes = {p["n"]: p for p in site.get("small_primes", [])}
    active = site.get("active", {})
    model = site.get("model", {})
    versions = site.get("siever_versions", [])

    def version_for(n):
        for v in versions:
            if v["lo"] <= n and (v["hi"] is None or n < v["hi"]):
                return v["program"]
        return None

    surv_sorted = sorted(arc.survivors)
    pm1_sorted = sorted(arc.pm1)
    prp_sorted = sorted(arc.prp)

    # ---- rows of 0.2M ----
    rows = []
    for lo in range(0, N_MAX, ROW):
        hi = lo + ROW
        first_odd = max(lo, 5) | 1
        odd = len(range(first_odd, hi, 2))
        src = [d for d in arc.dirs if d["lo"] < hi and lo < d["hi"]]
        sieved = arc.is_sieved(lo) and arc.is_sieved(hi - 1)
        surv = between(surv_sorted, lo, hi)
        surv_set = set(surv)
        smalls = [p for p in small_primes if lo <= p < hi]
        pm1_n = between(pm1_sorted, lo, hi)
        fac_n = {n for n in pm1_n if any(r[3] for r in arc.pm1[n])}
        prp_n = set(between(prp_sorted, lo, hi))
        prime_n = {n for n in prp_n if any(r[1] == "P" for r in arc.prp[n])} | set(smalls)
        untested = [n for n in surv if n not in fac_n and n not in prp_n and n not in small_primes] if sieved else None
        sieve, before = {}, None
        for d in src:
            if d["survivor_list"]:
                sieve = dict(d["sieve"])
                before = d.get("before")
                break
        program = sieve.get("program") or (version_for(lo) if sieved else None)
        pm1_recs = [r for n in pm1_n for r in arc.pm1[n]]
        prp_recs = [r for n in prp_n for r in arc.prp[n]]
        pm1_times = sorted(r[0] for r in pm1_recs if r[0])
        prp_times = sorted(r[0] for r in prp_recs if r[0])
        b1s = collections.Counter(r[1] for r in pm1_recs if r[1])
        b2s = [r[2] for r in pm1_recs if r[2]]
        ffts = [r[3] for r in prp_recs if r[3]]
        removed = odd - len(surv) - len([p for p in smalls if p not in surv_set]) if sieved else 0
        resolved = (removed + len(fac_n & surv_set) + len(prp_n & surv_set) + len(smalls)) if sieved else len(prp_n | fac_n)
        if sieved and not untested:
            status = "done"
        elif sieved:
            status = "prp"
        elif active and active.get("lo", 0) <= lo < active.get("hi", 0):
            status = "sieve"
        else:
            status = "todo"
        k_const = None
        if sieved and sieve.get("depth") and surv:
            k_const = round(len(surv) / odd * math.log(sieve["depth"]), 4)
        # the day the range was done: its last result, or its sieve; a second sieve, run after the range was done,
        # does not move it (the first sieve counts)
        sieve_end = (before or {}).get("end") or sieve.get("end")
        last = max([t for t in (pm1_times[-1:] + prp_times[-1:]) if t] + ([sieve_end] if sieve_end else []), default=None)
        part = None if sieved else next((x for x in arc.partial if x["lo"] == lo and x["hi"] == hi), None)
        if sieved and before:
            # sieved twice: the first sieve (old sievers, before P-1 and PRP) and its survivors; P-1 counts once
            # more for the n the second sieve left, which is what it adds to the second sieve
            before = {**before, "program": before.get("program") or version_for(lo),
                      "survivor_K": round(before["survivors"] / odd * math.log(before["depth"]), 4) if before["survivors"] else None}
        else:
            before = None
        rows.append({
            "lo": lo, "hi": hi, "odd": odd, "status": status, "sieved": sieved,
            "sieve": {"depth": sieve.get("depth"), "program": program, "start": sieve.get("start"), "end": sieve.get("end"),
                      "cpu_s": sieve.get("cpu_s"), "stations": sieve.get("stations"),
                      **({"by": sieve["by"]} if sieve.get("by") else {})} if sieved else None,
            "survivors": len(surv) if sieved else None,
            "removed_by_sieve": removed,
            **({"sieve_before": before} if before else {}),
            "pm1": {"runs": len(pm1_n), "factors": len(fac_n), **({"after_sieve": len(fac_n & surv_set)} if before else {}),
                    "b1": (b1s.most_common(1)[0][0] if b1s else None),
                    "b1_values": sorted(b1s), "b2_median": (round(statistics.median(b2s)) if b2s else None),
                    "start": pm1_times[0] if pm1_times else None, "end": pm1_times[-1] if pm1_times else None},
            "prp": {"tests": len(prp_n), "primes": len(prime_n), "start": prp_times[0] if prp_times else None,
                    "end": prp_times[-1] if prp_times else None, "fft_min": min(ffts) if ffts else None,
                    "fft_max": max(ffts) if ffts else None, "proofs": sum(1 for r in prp_recs if r[4])},
            "untested": len(untested) if untested is not None else None,
            "resolved": resolved,
            "survivor_K": k_const,
            "done": date_part(last) if status == "done" else None,
            **({"sieve_part": {"p": part["p"], "factored": part["factored"], "end": part["end"], "program": version_for(lo)}} if part else {}),
        })

    # ---- frontier: largest X with every odd n < X resolved ----
    frontier = None
    for row in rows:
        if not row["sieved"]:
            frontier = row["lo"]
            break
        open_n = [n for n in between(surv_sorted, row["lo"], row["hi"])
                  if not any(r[3] for r in arc.pm1.get(n, [])) and n not in arc.prp and n not in small_primes]
        if open_n:
            frontier = min(open_n)
            break
    if frontier is None:
        frontier = N_MAX
    # the first n with no known factor and no result, smallest first: the lookup box and the Join page's work lines
    next_open = []
    for row in rows:
        if row["hi"] <= frontier:
            continue
        if not row["sieved"] or len(next_open) == 3:
            break
        for n in between(surv_sorted, max(row["lo"], frontier), row["hi"]):
            if not any(r[3] for r in arc.pm1.get(n, [])) and n not in arc.prp and n not in small_primes:
                next_open.append(n)
                if len(next_open) == 3:
                    break
    # the frontier as it moved: in a range sieved twice, the n its first sieve left (the second sieve came after
    # all its P-1 and PRP work, so the history stays as it was)
    twice = [(r["lo"], r["hi"]) for r in rows if r.get("sieve_before")]
    in_twice = lambda n: any(a <= n < b for a, b in twice)
    below = sorted([n for n in between(surv_sorted, 0, frontier) if not in_twice(n)] +
                   [n for n in arc.survivors_before if n < frontier])
    milestones = {}
    latest_t = ""
    for n in below:
        if n in small_primes:
            continue                     # 2^n - 25 itself is a small prime: nothing to test
        t = resolution_time(arc, n)
        if t is None:
            break
        latest_t = max(latest_t, t)
        d = latest_t[:10]
        milestones[d] = max(milestones.get(d, 0), n)
    series = []
    best = 0
    for d in sorted(milestones):
        best = max(best, milestones[d])
        series.append([d, best])
    if series and frontier > series[-1][1]:
        series.append([series[-1][0], frontier])
    frontier_date = series[-1][0] if series else None

    # ---- totals ----
    def total(key):
        return sum(r[key] or 0 for r in rows)
    all_times = [r[0] for v in arc.prp.values() for r in v if r[0]] + [r[0] for v in arc.pm1.values() for r in v if r[0]]
    latest = sorted(((r[0], n, r) for n, v in arc.prp.items() for r in v if r[0]), reverse=True)[:12]
    primes_all = sorted(set(arc.prime_records) | set(small_primes))
    odd_total = total("odd")
    resolved_total = total("resolved")
    counts = {
        "odd": odd_total,
        "removed_by_sieve": total("removed_by_sieve"),
        "pm1_runs": len(arc.pm1),
        "pm1_factors": len({n for n, v in arc.pm1.items() if any(r[3] for r in v)}),
        # the n P-1 factored that no sieve removed: where a range was sieved again after P-1, the n P-1 factored
        # below the second sieve's depth count as sieve factors in the shares
        "pm1_after_sieve": sum(r["pm1"].get("after_sieve", r["pm1"]["factors"]) for r in rows),
        "prp_tests": len(arc.prp),
        "prp_results": sum(len(v) for v in arc.prp.values()),
        "prp_with_proof": arc.proofs,
        "primes": len(primes_all),
        "resolved": resolved_total,
        "unresolved": odd_total - resolved_total,
        "survivors": len(arc.survivors),
    }
    summary = {
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "n_max": N_MAX,
        "frontier": frontier,
        "frontier_date": frontier_date,
        "next_open": next_open,
        "last_result": max(all_times) if all_times else None,
        "counts": counts,
        "largest_prime": max(primes_all) if primes_all else None,
        "largest_prime_digits": digits_of(max(primes_all)) if primes_all else None,
        "latest": [{"t": t, "n": n, "s": r[1], "res64": r[2], "fft": r[3], "who": arc.users[r[7]] if len(r) > 7 else credit} for t, n, r in latest],
        "daily_prp": sorted([d, c] for d, c in arc.daily_prp.items()),
        "daily_pm1": sorted([d, c] for d, c in arc.daily_pm1.items()),
        "frontier_series": series,
        "programs": arc.program_counts.most_common(),
    }

    # ---- primes ----
    ranks = read_ranks(site, notes)
    for k in ranks["values"]:
        if int(k) not in arc.prime_records and int(k) not in small_primes:
            notes.add("PRPTop lists an n that is not a known prime here", f"n = {k}")
    for n in primes_all:
        if digits_of(n) >= 10_000 and str(n) not in ranks["values"] and n not in arc.reported:
            notes.add("known prime of 10,000 digits or more with no Top PRP rank (not on PRPTop yet?)", f"n = {n}")
    prime_notes = site.get("prime_notes", {})
    # who first found each prime: below `below`, someone before this project (PRPTop, or `unknown`)
    disc = site.get("discoverers", {})
    disc_below, disc_unknown, disc_n = disc.get("below", 0), disc.get("unknown", "anonymous"), disc.get("n", {})
    for k in disc_n:
        if int(k) not in arc.prime_records and int(k) not in small_primes:
            notes.add("discoverers in content/site.json lists an n that is not a known prime", f"n = {k}")
    primes = []
    for n in primes_all:
        rec = arc.prime_records.get(n, {})
        if n < disc_below:
            by, when = (disc_n.get(str(n)) or [disc_unknown, ""])[:2]
        else:
            by, when = rec.get("who", credit), rec.get("found", "")
        primes.append({
            "n": n, "digits": digits_of(n), "found": rec.get("found", ""), "fft": rec.get("fft", 0),
            "proof_power": rec.get("proof_power", 0), "program": rec.get("program", ""),
            "who": rec.get("who", credit if rec else ""),
            "how": "PRP-3" if rec else "trial division",
            "discoverer": by, "discovered": when,     # first found by, and when (year-month before this project)
            "rank": ranks["values"].get(str(n), ""),
            "note": prime_notes.get(str(n)) or small_primes.get(n, {}).get("note", ""),
        })

    # ---- P-1 factors and the sieve ----
    # P-1 sometimes reports the product of two or more primes it found at once; the statistics count primes
    bits = collections.Counter()
    found = []                           # (prime, n, time, b1, b2, who, primes in the result it came from)
    results = []                         # (factor as reported, n, time, b1, b2, who, its prime factors)
    smallest = {}                        # n -> its smallest prime factor found by P-1
    unsplit = {p for p, v in splits.items() if v is None}
    seen = set()
    for n, p, t, b1, b2, who in arc.factors:
        if not str(p).isdigit():
            notes.add("factor is not a number", f"n = {n}")
            continue
        if (n, p) in seen:
            continue
        seen.add((n, p))
        if int(p) < 2 or pow(2, n, int(p)) != 25 % int(p):
            notes.add("P-1 factor that does not divide 2^n - 25 (left out of the statistics)", f"n = {n}: {p}")
            continue
        parts = [int(q) for q in splits[p]] if splits.get(p) else [int(p)]
        results.append((int(p), n, t, b1, b2, who, parts))
        for q in parts:
            bits[q.bit_length()] += 1
            if p not in unsplit:
                found.append((q, n, t, b1, b2, who, len(parts)))
        smallest[n] = min(parts + ([smallest[n]] if n in smallest else []))
    biggest = sorted(found, key=lambda f: f[0], reverse=True)[:10]
    several = sorted((r for r in results if len(r[6]) > 1), key=lambda r: r[0], reverse=True)
    together = several[:10]
    if several:
        most = max(several, key=lambda r: (len(r[6]), r[0]))
        if most not in together:
            together.append(most)            # the run that found the most primes at once
    # for how many of the n P-1 factored a sieve to each planned depth would have found a factor anyway
    thresholds = {2 ** 32, 10 ** 12, 10 ** 13, 10 ** 14, int(site.get("sieve_target") or 10 ** 14)}
    thresholds |= {int(s["p_to"]) for s in site.get("sieve_plan", []) if s.get("p_to")}
    first = sorted(smallest.values())
    below = [[t, bisect.bisect_left(first, t)] for t in sorted(thresholds)]
    k_values = [r["survivor_K"] for r in rows if r["survivor_K"] and not r["pm1"]["runs"]]

    def factor_doc(q, n, t, b1, b2, who):
        return {"n": n, "p": str(q), "digits": len(str(q)), "bits": q.bit_length(), "found": t, "b1": b1, "b2": b2, "who": who}

    per_result = collections.Counter(len(r[6]) for r in results)
    stage2 = sum(1 for r in results if r[4])
    sizes = sorted(q.bit_length() for q, *_ in found)
    pm1_stats = {
        "runs": sum(len(v) for v in arc.pm1.values()),
        "n_tested": len(arc.pm1),
        "with_factor": len(results),
        "stage1": len(results) - stage2,     # Prime95 reports no B2 when stage 1 found the factor
        "stage2": stage2,
        "primes": len(found),
        "median_bits": statistics.median(sizes) if sizes else None,
        "per_result": {str(k): per_result[k] for k in sorted(per_result)},
    }
    row_lo = [r["lo"] for r in rows]

    def depth_of(n, at_pm1=False):
        """How far the sieve had gone for n's range, or None; with at_pm1, when P-1 ran there (the first sieve
        of a range sieved twice)."""
        i = bisect.bisect_right(row_lo, n) - 1
        r = rows[i] if i >= 0 else None
        if not (r and r["lo"] <= n < r["hi"] and r["sieve"]):
            return None
        return ((at_pm1 and r.get("sieve_before")) or r["sieve"]).get("depth")

    # P-1 runs on sieve survivors, so every factor it finds should be above the sieve depth of its range
    under = 0
    for f, n, t, b1, b2, who, parts in results:
        d = depth_of(n, at_pm1=True)
        if d and min(parts) <= d:
            under += 1
            notes.add("P-1 factor at or below the sieve depth of its range", f"n = {n}: {min(parts)} <= {d}")
    pm1_stats["below_sieve_depth"] = under
    if found:
        q, n, t, b1, b2, who, k = min(found)
        pm1_stats["smallest"] = {**factor_doc(q, n, t, b1, b2, who), "sieve_depth": depth_of(n, at_pm1=True)}
        first_stage = [f for f in found if not f[4]]
        if first_stage:
            pm1_stats["largest_stage1"] = factor_doc(*max(first_stage)[:6])
    sieve = {
        "pm1_factor_bits": {str(k): bits[k] for k in sorted(bits)},
        "pm1_factor_count": len(found),
        "pm1_n_factored": len(smallest),
        "pm1_composite": len(several),
        "pm1_factors_below": below,
        "pm1_stats": pm1_stats,
        "largest_pm1": [{**factor_doc(q, n, t, b1, b2, who), **({"together": k} if k > 1 else {})}
                        for q, n, t, b1, b2, who, k in biggest],
        "pm1_together": [{**factor_doc(f, n, t, b1, b2, who), "parts": [str(q) for q in parts]}
                         for f, n, t, b1, b2, who, parts in together],
        "survivor_K_by_row": {str(r["lo"]): r["survivor_K"] for r in rows if r["survivor_K"]},
        "survivor_K_mean": round(statistics.mean(k_values), 4) if k_values else model.get("survivor_K"),
    }

    # ---- the big chart on the Status page: every odd n below 10^7 in columns of 25,000 ----
    prime_set = {n for n, v in arc.prp.items() if any(r[1] in ("P", "R") for r in v)} | set(small_primes)
    for n in sorted(prime_set & arc.sieve_smallest.keys()):
        notes.add("known or reported prime with a sieve factor", f"n = {n}: p = {arc.sieve_smallest[n]}")
    factored = {n for n, v in arc.pm1.items() if any(r[3] for r in v)}
    composite = {n for n, v in arc.prp.items() if any(r[1] == "C" for r in v)}
    act_lo, act_hi = active.get("lo", 0), active.get("hi", 0)
    progress = {"bucket": BUCKET, "state": "", "depth": [], "depth_before": [], "odd": [], "removed": [], "pm1": [], "comp": [],
                "prime": [], "open": [], "layers": [], "layer_limit": []}
    # layers[c][k]: odd n of column c whose smallest factor p has 10^k <= p < 10^(k+1), for p below layer_limit[c]
    # (the sieve depth; 10^7 where nothing is sieved, since any program finds factors that small by itself).
    # Mass Prime Siever ranges count from its checked factors; the rest come from content/sieve_layers.json.
    # Whatever a column has beyond its layers and results: n with no factor below 10^7, not sieved yet.
    # In a Mass Prime Siever range every n with a sieve factor is in the layers, also one that P-1 or a PRP test
    # resolved before a later, deeper sieve found its factor; only the n the sieve left count by their results.
    # depth_before: the first sieve of a column sieved twice (the depth when P-1 and PRP ran there).
    row_of = {r["lo"]: r for r in rows}
    for lo in range(0, N_MAX, BUCKET):
        hi = lo + BUCKET
        sieved = arc.is_sieved(lo) and arc.is_sieved(hi - 1)
        odd = len(range(max(lo, 5) | 1, hi, 2))
        known = set(between(pm1_sorted, lo, hi)) | set(between(prp_sorted, lo, hi)) | {p for p in small_primes if lo <= p < hi}
        if sieved:
            known |= set(between(surv_sorted, lo, hi))
        mps_col = sieved and any(a <= lo and hi <= b for a, b in arc.mps_spans)
        if mps_col:
            known = {n for n in known if n not in arc.sieve_smallest}
        tally = collections.Counter()
        for n in known:
            if n in prime_set:
                tally["prime"] += 1
            elif n in factored:
                tally["pm1"] += 1
            elif n in composite:
                tally["comp"] += 1
            else:
                tally["open"] += 1        # a sieve survivor without a result yet
        if sieved:
            state = "p" if tally["open"] else "d"
        else:
            state = "s" if act_lo <= lo < act_hi else "t"
        progress["state"] += state
        progress["depth"].append(depth_of(lo) if sieved else None)
        first = (row_of.get(lo - lo % ROW) or {}).get("sieve_before") if sieved else None
        progress["depth_before"].append(first["depth"] if first else None)
        progress["odd"].append(odd)
        progress["removed"].append(odd - len(known) if sieved else 0)
        for k in ("pm1", "comp", "prime", "open"):
            progress[k].append(tally[k])
        col, limit, ly = lo // BUCKET, None, []
        if mps_col:
            limit = depth_of(lo)
            tal = collections.Counter(decade(arc.sieve_smallest[n]) for n in range(max(lo, 5) | 1, hi, 2) if n in arc.sieve_smallest)
            ly = [tal[k] for k in range(max(tal) + 1)] if tal else []
        elif col in static_layers:
            want = depth_of(lo) if sieved else TRIAL_LIMIT
            if static_layers[col][0] == want:
                limit, ly = static_layers[col]
                if not sieved and any(n in arc.sieve_smallest for n in range(max(lo, 5) | 1, hi, 2)):
                    # a sieve that has not reached the small primes yet: its factors of the n with none below
                    # 10^7 form layers of their own, by the power of ten of the factor found
                    left = trial_left_n(trial_left, lo, hi) if trial_left and trial_left[2] == TRIAL_LIMIT else None
                    if left is None:
                        notes.add("sieve factors in a column not sieved from p <= 7, without trial_left.json data for it "
                                  "(run tools/trial_left.py for this range)", f"n = {lo}")
                    elif len(left) != odd - sum(ly) - len(known):
                        notes.add("trial_left.json does not match sieve_layers.json (not used)", f"n = {lo}: {len(left)} n")
                    else:
                        tal = collections.Counter(decade(arc.sieve_smallest[n]) for n in left if n in arc.sieve_smallest)
                        ly = list(ly) + [0] * max(0, max(tal, default=0) + 1 - len(ly))
                        for k, v in tal.items():
                            ly[k] += v
            else:
                notes.add("sieve_layers.json was made for another sieve depth (re-run tools/sieve_layers.c)",
                          f"n = {lo}: {static_layers[col][0]} != {want}")
        rest = odd - sum(ly) - len(known)
        if (sieved and ly and rest) or rest < 0:
            notes.add("sieve layers and results do not add up to the odd n of a column", f"n = {lo}: {rest:+d}")
        progress["layers"].append(ly)
        progress["layer_limit"].append(limit)
    cells = collections.Counter((n // BUCKET, q.bit_length()) for q, n, *_ in found)
    heat = []                            # [column, smallest bit length, P-1 factors with that many bits, the next, ...]
    for b in sorted({b for b, _ in cells}):
        have = [k for c, k in cells if c == b]
        lo_bits, hi_bits = min(have), max(have)
        heat.append([b, lo_bits] + [cells.get((b, k), 0) for k in range(lo_bits, hi_bits + 1)])
    progress["heat"] = heat
    progress["heat_factors"] = len(found)

    # ---- shards ----
    for sub in ("n", "f"):
        os.makedirs(os.path.join(out_dir, sub), exist_ok=True)
        for old in glob.glob(os.path.join(glob.escape(os.path.join(out_dir, sub)), "*.json")):
            os.remove(old)
    shard_count = 0
    shard_bytes = 0
    sieve_factor_count = 0
    factor_bytes = 0

    def exact(p):
        return p if p < 2 ** 53 else str(p)   # JSON numbers above 2^53 lose digits in a browser
    before_sorted = sorted(arc.survivors_before)
    factored_n = {}                      # each slice's n with factors, sorted once: a slice spans many files
    summary["shard_size"] = SHARD        # the n in each data/n/ and data/f/ file
    summary["shards"] = []               # the pages fetch only shards that exist
    summary["factor_files"] = []         # ... and only factor files that exist
    for lo in range(0, N_MAX, SHARD):
        hi = lo + SHARD
        surv = between(surv_sorted, lo, hi)
        pm1 = {str(n): arc.pm1[n] for n in between(pm1_sorted, lo, hi)}
        prp = {str(n): arc.prp[n] for n in between(prp_sorted, lo, hi)}
        # the sieve slices over these n: p and n range, when the run ended, who ran it (index in users), whether
        # it was uploaded, and every checked factor above 10^7 it found (the pages find the smaller ones themselves)
        slices = []
        for src in arc.sieve_sources:
            a, b = max(src["n0"], lo), min(src["n1"], hi)
            if a >= b:
                continue
            x = {"p": [exact(src["p0"]), exact(src["p1"])], "n": [a, b], "end": src["end"], "by": src["by"]}
            # the run: program, start, seconds, and the n it covered in all (rn; Per n on the page shares the time out)
            if src.get("prog"):
                x["prog"] = src["prog"]
            if src.get("st"):
                x["st"] = src["st"]
            if src.get("s"):
                x["s"] = src["s"]
            span = src.get("span") or arc.run_spans.get(src.get("key"))
            if span:
                x["rn"] = [span[0], span[1]]
            runs = [r for r in src.get("runs") or [] if r["span"][0] < b and r["span"][1] > a]
            if runs:
                # the old sievers' stations over these n, each with its own n range and run
                x["runs"] = [{k: v for k, v in (("name", r["name"]), ("n", list(r["span"])), ("st", r["start"]), ("end", r["end"]),
                                                ("s", r["s"]), ("prog", r["program"]), ("depth", r.get("depth"))) if v}
                             for r in runs]
            if src["upload"]:
                x["upload"] = 1
            if src.get("before"):
                x["before"] = 1          # the first sieve of a range sieved twice (the old sievers)
            keys = factored_n.get(id(src))
            if keys is None:
                keys = factored_n[id(src)] = sorted(src["f"])
            f = {str(n): [exact(p) for p in src["f"][n]] for n in between(keys, a, b)}
            if f:
                x["f"] = f
                sieve_factor_count += sum(len(v) for v in f.values())
            same = None
            if src.get("key"):
                # the same run listed twice here (an upload split by n, and the range folder's copy of the run):
                # one entry over all its n
                same = next((y for y in slices if y.get("_run") == (src["key"], x["p"][0], x["p"][1]) and
                             a <= y["n"][1] and y["n"][0] <= b), None)
            if same is None:
                if src.get("key"):
                    x["_run"] = (src["key"], x["p"][0], x["p"][1])
                slices.append(x)
                continue
            same["n"] = [min(same["n"][0], a), max(same["n"][1], b)]
            if f:
                both = same.setdefault("f", {})
                for k, ps in f.items():
                    both[k] = sorted(set(both.get(k, [])) | set(ps), key=int)
                same["f"] = dict(sorted(both.items(), key=lambda kv: int(kv[0])))
            if x.get("upload"):
                same["upload"] = 1
        for x in slices:
            x.pop("_run", None)
        pm1f = {}                        # n -> {P-1 factor: its prime factors}, for a factor that is their product
        for k, recs in pm1.items():
            parts = {f: splits[f] for r in recs if r[3] for f in str(r[3]).split(",") if splits.get(f)}
            if parts:
                pm1f[k] = parts
        if slices:
            # a file of its own: it changes only when a sieve slice comes in, the shard with every PRP result
            path = os.path.join(out_dir, "f", shard_name(lo) + ".json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"lo": lo, "hi": hi, "users": arc.users, "slices": slices}, f, ensure_ascii=False, separators=(",", ":"))
            summary["factor_files"].append(shard_name(lo))
            factor_bytes += os.path.getsize(path)
        if not surv and not pm1 and not prp:
            continue
        doc = {"lo": lo, "hi": hi, "sieved": arc.is_sieved(lo) and arc.is_sieved(hi - 1), "s": surv,
               "pm1": pm1, "prp": prp, "programs": arc.programs, "users": arc.users}
        s0 = between(before_sorted, lo, hi)
        if s0:
            doc["s0"] = s0               # sieved twice: the survivors of the first sieve
        if pm1f:
            doc["pm1f"] = pm1f
        path = os.path.join(out_dir, "n", shard_name(lo) + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, separators=(",", ":"))
        shard_count += 1
        summary["shards"].append(shard_name(lo))
        shard_bytes += os.path.getsize(path)

    def write(name, obj, pretty=False):
        path = os.path.join(out_dir, name)
        with open(path, "w", encoding="utf-8", newline="\n") as f:          # LF on Windows too
            if pretty:
                json.dump(obj, f, ensure_ascii=False, indent=1)
            else:
                json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        return os.path.getsize(path)

    sizes = {
        "summary.json": write("summary.json", summary),
        "ranges.json": write("ranges.json", {"row": ROW, "rows": rows}),
        "primes.json": write("primes.json", {"primes": primes, "rank_date": ranks["date"], "rank_daily": ranks["daily"]}),
        "sieve.json": write("sieve.json", sieve),
        "progress.json": write("progress.json", progress),
        "site.json": write("site.json", site, pretty=True),
    }

    print(f"Read {len(arc.dirs)} range folders in {time.time() - t0:.1f} s.")
    print(f"  survivors {len(arc.survivors):,} · P-1 runs {counts['pm1_runs']:,} ({counts['pm1_factors']:,} factors)"
          f" · PRP-tested n {counts['prp_tests']:,} · primes {counts['primes']} · proofs {arc.proofs:,}")
    if sieve["pm1_composite"]:
        print(f"  {sieve['pm1_composite']:,} P-1 factors were products of primes found at once, split into "
              f"{sum(len(r[6]) for r in several):,} primes")
    print(f"  frontier {frontier:,} (reached {frontier_date}) · last result {summary['last_result']}")
    if arc.uploads_archived:
        print(f"  {len(arc.uploads_archived)} uploaded sieve file(s) are also in the range folders; each slice counted once")
    for x in arc.partial:
        if not any(r["lo"] == x["lo"] and r["sieved"] for r in rows):
            spans = ", ".join(f"{a:.3g}-{b:.3g}" for a, b in x["p"])
            print(f"  {x['lo']/1e6:.1f}M-{x['hi']/1e6:.1f}M: sieved for p in {spans} so far ({x['factored']:,} n with a factor); "
                  "no slice from p <= 7 yet")
    for row in rows:
        if row["sieved"] and row["untested"]:
            print(f"  {row['lo']/1e6:.1f}M-{row['hi']/1e6:.1f}M: {row['untested']:,} sieve survivors still without a result")
    print(f"  sieve factors above 10^7: {sieve_factor_count:,} from {len(arc.sieve_sources):,} slice(s), "
          f"in {len(summary['factor_files'])} factor files ({factor_bytes/1024/1024:.1f} MB)")
    print(f"Wrote {len(sizes)} files ({sum(sizes.values())/1024:.0f} kB) and {shard_count} shards ({shard_bytes/1024/1024:.1f} MB) to {out_dir}")
    notes.report(os.path.join(os.path.dirname(os.path.abspath(out_dir)), "build_report.txt"))
    return summary


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")         # a Windows code page cannot show every character
    ap = argparse.ArgumentParser(description="Rebuild data/*.json for the 2^n-25 website.")
    ap.add_argument("--archive", default=DEFAULT_ARCHIVE, help="copy of the 2^n-25 project folder (contains Ranges); default archive/")
    ap.add_argument("--out", default=os.path.join(REPO, "data"), help="where to write the JSON files")
    ap.add_argument("--content", default=os.path.join(REPO, "content", "site.json"), help="hand-written facts and plans")
    ap.add_argument("--live", default=DEFAULT_LIVE, help="PRP results of the Prime95 run on this PC (tools/live_prp.py); default live/prp_progress.json")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    build(args.archive, args.out, args.content, args.live)


if __name__ == "__main__":
    main()
