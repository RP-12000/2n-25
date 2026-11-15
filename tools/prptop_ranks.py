#!/usr/bin/env python3
"""Read the Top PRP rank of every known 2^n-25 probable prime from PRP Records and save it in archive/.

PRP Records (PRPTop, Henri and Renaud Lifchitz) ranks every known probable prime of 10,000 digits or
more by size. Its search page for the form 2^n-25 lists all of ours on one page, so a single request
gives every rank. tools/auto_update.py runs this about once a day; tools/build.py shows the ranks it
writes, and falls back to the ranks in content/site.json while the file is missing.

The page is checked before anything is saved: each row must be 2^n-25 with the right number of digits
(floor(n log10 2) + 1), no n may appear twice, a larger n may not rank below a smaller one, and the
number of rows must match the page's own "Total". If anything is off, nothing is written and the exit
code is 1. The file keeps only n and rank, not who found each number. It is rewritten only when the
ranks or the day changed:

  {"source": "<search page>", "checked": "YYYY-MM-DD" (UTC), "ranks": {"<n>": rank, ...}}

Usage:
  py -3 tools\\prptop_ranks.py                  # read the ranks now, write archive/prptop.json
  py -3 tools\\prptop_ranks.py --html page.html # read a saved copy of the search page instead
  py -3 tools\\prptop_ranks.py --out other.json

Only the Python standard library is used.
"""

import argparse
import datetime
import html
import json
import math
import os
import re
import sys
import urllib.request

URL = "http://www.primenumbers.net/prptop/searchform.php?form=2%5En-25&action=Search"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "archive", "prptop.json")
MAX_BYTES = 2_000_000
ROW = re.compile(r"<tr\s+class=['\"]?prp[12]['\"]?\s*>(.*?)</tr>", re.I | re.S)
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.I | re.S)
TAG = re.compile(r"<[^>]+>")
FORM = re.compile(r"^2\^(\d+)-25$")
TOTAL = re.compile(r"Total\s*:\s*(\d+)", re.I)
LOG10_2 = math.log10(2)


def text(s):
    return html.unescape(TAG.sub("", s)).strip()


def fetch(url, timeout=60):
    # no User-Agent of our own: the default urllib one names no person or project
    with urllib.request.urlopen(url, timeout=timeout) as r:
        if r.status != 200:
            raise RuntimeError(f"HTTP {r.status}")
        body = r.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise RuntimeError("the page is far larger than expected")
    return body.decode("utf-8", "replace")


def parse(page):
    """{n: rank} from the search page; raises ValueError when the page is not what it should be."""
    rows = ROW.findall(page)
    m = TOTAL.search(TAG.sub("", page))
    if not m:
        raise ValueError("no 'Total' count on the page")
    total = int(m.group(1))
    if len(rows) != total:
        raise ValueError(f"the page says Total {total} but has {len(rows)} rows")
    if not rows:
        raise ValueError("no rows")
    ranks = {}
    for row in rows:
        cells = [text(c) for c in CELL.findall(row)]
        if len(cells) < 3:
            raise ValueError(f"a row with {len(cells)} cells")
        rank, expr, digits = cells[0].lstrip("#"), cells[1].replace(" ", ""), cells[2].replace(",", "")
        f = FORM.match(expr)
        if not f or not rank.isdigit() or not digits.isdigit():
            raise ValueError(f"unexpected row: {cells[:3]}")
        n = int(f.group(1))
        if n < 6 or int(digits) != int(n * LOG10_2) + 1:
            raise ValueError(f"2^{n}-25 is listed with {digits} digits")
        if n in ranks:
            raise ValueError(f"2^{n}-25 is listed twice")
        ranks[n] = int(rank)
    order = sorted(ranks, reverse=True)                   # largest n first: it must rank first
    for a, b in zip(order, order[1:]):
        if ranks[a] > ranks[b]:
            raise ValueError(f"2^{a}-25 ranks below 2^{b}-25")
    return ranks


def read_old(path):
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        return doc, {int(n): int(r) for n, r in (doc.get("ranks") or {}).items()}
    except (OSError, ValueError, TypeError, AttributeError):
        return {}, {}


def describe(old, new):
    out = []
    for n in sorted(set(old) | set(new), reverse=True):
        if n not in new:
            out.append(f"n={n} no longer listed (was #{old[n]})")
        elif n not in old:
            out.append(f"n={n} new at #{new[n]}")
        elif old[n] != new[n]:
            out.append(f"n={n} #{old[n]} -> #{new[n]}")
    return out


def main():
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--html", help="a saved copy of the search page, read instead of the site")
    ap.add_argument("--out", default=OUT, help="where to write the ranks (default archive/prptop.json)")
    args = ap.parse_args()
    try:
        if args.html:
            with open(args.html, encoding="utf-8", errors="replace") as f:
                page = f.read()
        else:
            page = fetch(URL)
        ranks = parse(page)
    except Exception as e:                                # network, HTTP or a page that changed shape
        print(f"PRPTop ranks not read: {type(e).__name__}: {e}")
        sys.exit(1)
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    old_doc, old = read_old(args.out)
    changed = describe(old, ranks)
    doc = {"source": URL, "checked": today,
           "ranks": {str(n): ranks[n] for n in sorted(ranks, key=lambda n: ranks[n])}}
    if doc != old_doc:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        tmp = args.out + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(doc, f, indent=1)
            f.write("\n")
        os.replace(tmp, args.out)
    top = min(ranks, key=lambda n: ranks[n])
    msg = f"PRPTop: {len(ranks)} entries of 2^n-25, best 2^{top}-25 at #{ranks[top]}; "
    if not old_doc:
        msg += "first read"
    elif changed:
        msg += "ranks changed: " + "; ".join(changed)
    else:
        msg += "ranks unchanged"
    print(msg + f" (checked {today})")


if __name__ == "__main__":
    main()
