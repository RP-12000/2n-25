#!/usr/bin/env python3
"""Read the progress of the Prime95 PRP run on this PC for the website.

Prime95 adds one JSON line to results.json.txt in its folder for every test it finishes (here
<home>\\Desktop\\WMC\\results.json.txt). This script only reads that file: it writes, moves, renames or
locks nothing in that folder, and copies nothing to the archive drive or to archive/. Of each 2^n - 25
PRP result it keeps what the pages show (n, result, Res64, FFT length, proof power, program and time;
not the user or computer name, nor the full residue) in live/prp_progress.json in this folder, which git
ignores and tools/build.py reads. The last line is left for the next read while Prime95 is still writing
it (no line end yet). A result kept once stays kept, even if the Prime95 file is cleared later, so the
site never loses a test; once the range's own results.json.txt is in the archive, build.py counts each
test once. The file is rewritten only when there is something new.

tools/auto_update.py runs this once an hour.

Usage:
  python tools/live_prp.py                           # the Prime95 folder on this PC
  python tools/live_prp.py --source PATH --out PATH

Exit code 0 when the results were read (new or not), 1 when the Prime95 file could not be read.
Only the Python standard library is used.
"""

import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.environ.get("USERPROFILE") or os.path.expanduser("~")
DEFAULT_SOURCE = os.path.join(HOME, "Desktop", "WMC", "results.json.txt")
DEFAULT_OUT = os.path.join(REPO, "live", "prp_progress.json")
FIELDS = ("k", "b", "n", "c", "worktype", "status", "res64", "fft-length", "timestamp")


def reduce(j):
    """What the site uses of one result line, or None when it is not a finished PRP test of 2^n - 25."""
    if not isinstance(j, dict) or j.get("k") != 1 or j.get("b") != 2 or j.get("c") != -25:
        return None
    n = j.get("n")
    if not isinstance(n, int) or isinstance(n, bool) or n < 5 or n % 2 == 0:
        return None
    if not str(j.get("worktype", "")).startswith("PRP") or j.get("status") not in ("C", "P"):
        return None
    out = {k: j[k] for k in FIELDS if k in j}
    if j["status"] == "P" and j.get("security-code"):
        out["security-code"] = j["security-code"]
    if isinstance(j.get("program"), dict):
        out["program"] = {k: j["program"][k] for k in ("name", "version", "build") if k in j["program"]}
    if isinstance(j.get("proof"), dict):
        out["proof"] = {k: j["proof"][k] for k in ("power", "md5") if k in j["proof"]}
    return out


def key(r):
    """The same test, as tools/build.py tells duplicates apart."""
    return (r.get("n"), r.get("worktype"), r.get("timestamp"), r.get("status"), r.get("res64"))


def read_source(path):
    """The finished results in Prime95's file: (results, lines that are not JSON)."""
    with open(path, "rb") as f:                  # read only; Prime95 may add a line meanwhile
        data = f.read()
    end = data.rfind(b"\n")
    found, bad = [], 0
    for line in data[:end + 1].split(b"\n"):     # a last line without its line end is not finished yet
        line = line.strip()
        if not line:
            continue
        try:
            j = json.loads(line.decode("utf-8", "replace"))
        except ValueError:
            bad += 1
            continue
        r = reduce(j)
        if r:
            found.append(r)
    return found, bad


def read_kept(path):
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return []
    return [r for r in doc.get("results", []) if isinstance(r, dict)]


def main():
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", default=DEFAULT_SOURCE, help="Prime95's results.json.txt (only read)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="where the site's copy of the progress is kept")
    args = ap.parse_args()
    try:
        found, bad = read_source(args.source)
    except OSError as e:
        print(f"could not read {args.source}: {type(e).__name__}: {e}")
        sys.exit(1)
    kept = read_kept(args.out)
    seen = {key(r) for r in kept}
    new = []
    for r in found:
        if key(r) not in seen:
            seen.add(key(r))
            new.append(r)
    results = kept + new
    if new:
        doc = {"about": "PRP results of 2^n - 25 read from the Prime95 run on this PC by tools/live_prp.py; "
                        "tools/build.py reads this file. Not published.",
               "results": results}
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        tmp = args.out + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(doc, f, separators=(",", ":"))
            f.write("\n")
        os.replace(tmp, args.out)
    ns = [r["n"] for r in results]
    last = max((str(r.get("timestamp") or "") for r in results), default="")
    primes = sorted(r["n"] for r in new if r.get("status") == "P")
    line = f"live PRP results: {len(results):,} kept, {len(new):,} new" if new else f"live PRP results: {len(results):,} kept, none new"
    if ns:
        line += f"; n {min(ns):,} - {max(ns):,}; last {last}"
    if primes:
        line += "; probable prime: n = " + ", ".join(f"{n:,}" for n in primes)
    if bad:
        line += f"; {bad} line(s) that are not JSON skipped"
    print(line)


if __name__ == "__main__":
    main()
