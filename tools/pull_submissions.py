#!/usr/bin/env python3
"""Copy uploaded results from the upload Worker into archive/Submissions in this folder.

Each Prime95 upload is stored by the Worker as one record (sub/<id>) and, for a reported probable
prime, a proof file (proof/<id>/<n>). Each sieve upload is a record (tf/<id>) plus its factor lines
(tfdata/<id>, one "n p p ..." line per odd n that has a factor). This script saves them as

  <archive>/Submissions/<id>/submission.json
  <archive>/Submissions/<id>/<n>.proof
  <archive>/Submissions/<id>/TF/results.json     Mass Prime Siever format; prp is every other odd n
  <archive>/Submissions/<id>/TF/upload.json      who, when, p and n range, run time from siever.log

checks each proof file against the MD5 in its result line and each sieve upload against its own
counts, and with --delete removes from the Worker only what was saved and checked (and sieve uploads
that were started more than three days ago but never finished). Run tools/build.py afterwards; it
checks every sieve factor again before an n is struck out. <archive> is archive/ in this folder (the
copy that tools/build.py reads), so the archive drive need not be attached; run
tools/sync_archive.py --back when it is, to copy the saved uploads there too.

The admin token is read from the UPLOAD_ADMIN_TOKEN environment variable or from a file
(default: upload_admin_token.txt in your home folder). Never commit it.

Usage:
  python tools/pull_submissions.py                 # list and save, keep everything on the Worker
  python tools/pull_submissions.py --new-only      # save only uploads that are not saved yet
  python tools/pull_submissions.py --delete        # also remove what was saved
  python tools/sync_archive.py --back              # later, with the archive drive attached

Only the Python standard library is used.
"""

import argparse
import datetime
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ARCHIVE = os.path.join(REPO, "archive")  # the copy tools/build.py reads


def read_token(path):
    token = os.environ.get("UPLOAD_ADMIN_TOKEN", "").strip()
    if token:
        return token
    if not os.path.exists(path):
        sys.exit(f"No admin token: set UPLOAD_ADMIN_TOKEN or put the token in {path}")
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "utf-16"):          # PowerShell may have written UTF-16
        try:
            token = raw.decode(enc).strip()
            if token and token.isprintable():
                return token
        except UnicodeDecodeError:
            pass
    sys.exit(f"Could not read the token in {path}")


class Worker:
    def __init__(self, endpoint, token):
        self.endpoint = endpoint.rstrip("/")
        self.token = token

    def call(self, method, path, **params):
        url = self.endpoint + path + ("?" + urllib.parse.urlencode(params) if params else "")
        req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None,
                                     headers={"Authorization": "Bearer " + self.token, "User-Agent": "2n25-pull/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            sys.exit(f"{method} {path} answered HTTP {e.code}: {body[:300]}")
        except urllib.error.URLError as e:
            sys.exit(f"Could not reach {self.endpoint}: {e.reason}")

    def keys(self, prefix):
        out, cursor = [], None
        while True:
            params = {"prefix": prefix}
            if cursor:
                params["cursor"] = cursor
            page = json.loads(self.call("GET", "/admin/list", **params))
            out += page.get("keys", [])
            cursor = page.get("cursor")
            if not cursor:
                return out

    def get(self, key):
        return self.call("GET", "/admin/get", key=key)

    def delete(self, key):
        json.loads(self.call("POST", "/admin/delete", key=key))


def proof_md5s(record):
    """n -> MD5 of the proof file, from the PRP result lines that reported a probable prime."""
    out = {}
    for line in record.get("lines", []):
        try:
            j = json.loads(line)
        except ValueError:
            continue
        if j.get("status") == "P" and isinstance(j.get("proof"), dict) and j["proof"].get("md5"):
            out[int(j["n"])] = str(j["proof"]["md5"]).lower()
    return out


def saved_already(folder):
    """True when an earlier run saved this upload and the proof of every probable prime it reports."""
    path = os.path.join(folder, "submission.json")
    if not os.path.exists(path):
        return False
    try:
        with open(path, encoding="utf-8") as f:
            primes = json.load(f).get("primes") or []
    except (OSError, ValueError):
        return False
    return all(os.path.exists(os.path.join(folder, f"{n}.proof")) for n in primes)


def odd_range(lo, hi):
    lo = max(lo, 5)
    return range(lo | 1, hi, 2)


def tf_entry(record, text):
    """The Mass Prime Siever entry for one sieve upload, or (None, reason) when it does not add up."""
    head = record.get("head") or {}
    try:
        p0, p1, n0, n1 = (int(head[k]) for k in ("P0", "P1", "N0", "N1"))
    except (KeyError, TypeError, ValueError):
        return None, "no p and n range"
    if len(text) != record.get("bytes"):
        return None, f"{len(text)} bytes of factor lines, the record says {record.get('bytes')}"
    factored, last, count = [], n0 - 1, 0
    for line in text.splitlines():
        parts = line.split(" ")
        try:
            n, fs = int(parts[0]), [int(x) for x in parts[1:]]
        except ValueError:
            return None, f"unreadable line {line[:60]!r}"
        if not fs or n <= last or n % 2 == 0 or not n0 <= n < n1:
            return None, f"line for n = {n} is out of order, even, outside [N0, N1) or has no factor"
        last = n
        count += len(fs)
        factored.append({"n": n, "factors": fs})
    if len(factored) != record.get("entries") or count != record.get("factors"):
        return None, f"{len(factored)} n and {count} factors, the record says {record.get('entries')} and {record.get('factors')}"
    listed = {x["n"] for x in factored}
    prp = [n for n in odd_range(n0, n1) if n not in listed]
    counts = record.get("counts") or {}
    if counts.get("odd") not in (None, len(odd_range(n0, n1))) or counts.get("prp") not in (None, len(prp)):
        return None, f"the uploader counted {counts.get('odd')} odd n and {counts.get('prp')} without a factor, not {len(odd_range(n0, n1))} and {len(prp)}"
    entry = {"Timestamp": record.get("timestamp") or record.get("received"), "b": 2, "c": -25,
             "P0": p0, "P1": p1, "N0": n0, "N1": n1, "prp": prp, "factored": factored}
    return entry, None


def sieve_saved(target, sid):
    folder = os.path.join(target, sid, "TF")
    return os.path.exists(os.path.join(folder, "results.json")) and os.path.exists(os.path.join(folder, "upload.json"))


def pull_sieve(w, target, delete, new_only=False):
    """Save sieve uploads (tf/<id> and tfdata/<id>); returns (saved, n with factors, factors, removed, problems)."""
    records = w.keys("tf/")
    done = set()
    if new_only:
        # skip what an earlier run saved; with nothing new, the factor lines are not even listed
        done = {sid for sid in (r["name"].split("/", 1)[1] for r in records) if sieve_saved(target, sid)}
        records = [r for r in records if r["name"].split("/", 1)[1] not in done]
        if not records:
            return 0, 0, 0, 0, 0
    datas = {k["name"].split("/", 1)[1] for k in w.keys("tfdata/")} - done
    if records or datas:
        print(f"{len(records)} {'new ' if new_only else ''}sieve upload(s) on the Worker")
    saved = entries = factors = removed = problems = 0
    for item in records:
        key = item["name"]
        sid = key.split("/", 1)[1]
        record = json.loads(w.get(key))
        if sid not in datas:
            problems += 1
            print(f"  {sid}: the factor lines (tfdata/{sid}) are missing; left on the Worker")
            continue
        datas.discard(sid)
        text = w.get("tfdata/" + sid).decode("ascii")
        entry, why = tf_entry(record, text)
        head = record.get("head") or {}
        label = f"p {head.get('P0')}-{head.get('P1')}, n {head.get('N0')}-{head.get('N1')}"
        if entry is None:
            problems += 1
            print(f"  {sid}  {record.get('handle', '?'):20s} {label}: does not add up ({why}); left on the Worker")
            continue
        folder = os.path.join(target, sid, "TF")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "results.json"), "w", encoding="utf-8") as f:
            json.dump([entry], f, separators=(",", ":"))
        with open(os.path.join(folder, "upload.json"), "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=1)
        saved += 1
        entries += len(entry["factored"])
        factors += record.get("factors", 0)
        print(f"  {sid}  {record.get('handle', '?'):20s} sieve {label}: {len(entry['factored']):,} n with {record.get('factors', 0):,} factor(s)")
        if delete:
            w.delete("tfdata/" + sid)
            w.delete(key)
            removed += 2
    # factor lines whose upload was never finished: the page's token lasts 48 hours
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=3)
    stale = []
    for sid in sorted(datas):
        try:
            started = datetime.datetime.strptime(sid[:16], "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            continue
        if started < cutoff:
            stale.append(sid)
    if stale:
        if delete:
            for sid in stale:
                w.delete("tfdata/" + sid)
                removed += 1
            print(f"  removed {len(stale)} sieve upload(s) that were started but never finished")
        else:
            print(f"  {len(stale)} sieve upload(s) were started but never finished; --delete removes them")
    return saved, entries, factors, removed, problems


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")         # a Windows code page cannot show every character
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--archive", default=DEFAULT_ARCHIVE, help="where to put Submissions/ (default archive/)")
    ap.add_argument("--endpoint", help="upload Worker URL (default: upload_endpoint in content/site.json)")
    ap.add_argument("--token-file", default=os.path.join(os.path.expanduser("~"), "upload_admin_token.txt"))
    ap.add_argument("--delete", action="store_true", help="remove saved and checked items from the Worker")
    ap.add_argument("--new-only", action="store_true", help="skip uploads saved by an earlier run (no download)")
    args = ap.parse_args()

    endpoint = args.endpoint
    if not endpoint:
        with open(os.path.join(REPO, "content", "site.json"), encoding="utf-8") as f:
            endpoint = json.load(f).get("upload_endpoint") or ""
    if not endpoint:
        sys.exit("No endpoint: pass --endpoint or set upload_endpoint in content/site.json")
    if args.archive == DEFAULT_ARCHIVE:
        os.makedirs(args.archive, exist_ok=True)
    elif not os.path.isdir(args.archive):
        sys.exit(f"Archive folder not found: {args.archive}")
    w = Worker(endpoint, read_token(args.token_file))
    target = os.path.join(args.archive, "Submissions")

    subs = w.keys("sub/")
    done = set()
    if args.new_only:
        # skip uploads an earlier run saved; with nothing new, the proof files are not even listed
        done = {sid for sid in (s["name"].split("/", 1)[1] for s in subs) if saved_already(os.path.join(target, sid))}
        subs = [s for s in subs if s["name"].split("/", 1)[1] not in done]
    proofs = w.keys("proof/") if subs or not args.new_only else []
    print(f"{len(subs)} {'new ' if args.new_only else ''}upload(s) and {len(proofs)} proof file(s) on the Worker")
    saved = lines = problems = removed = kept = 0
    by_sub = {}
    for p in proofs:
        parts = p["name"].split("/")
        if len(parts) == 3 and parts[1] not in done:
            by_sub.setdefault(parts[1], []).append(p)

    skipped = len(done)
    for item in subs:
        key = item["name"]
        sid = key.split("/", 1)[1]
        folder = os.path.join(target, sid)
        record = json.loads(w.get(key))
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "submission.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=1)
        n_lines = len(record.get("lines", []))
        lines += n_lines
        primes = record.get("primes") or []
        print(f"  {sid}  {record.get('handle', '?'):20s} {n_lines:5d} lines" + (f"  PRIME n = {primes}" if primes else ""))
        ok_keys = [key]

        md5s = proof_md5s(record)
        for p in by_sub.pop(sid, []):
            n = int(p["name"].rsplit("/", 1)[1])
            body = w.get(p["name"])
            want = md5s.get(n) or (p.get("metadata") or {}).get("md5", "")
            got = hashlib.md5(body).hexdigest()
            if want and got != want:
                problems += 1
                with open(os.path.join(folder, f"{n}.proof.md5-mismatch"), "wb") as f:
                    f.write(body)
                print(f"    n = {n}: proof MD5 {got} does not match the result line ({want}); "
                      f"saved as {n}.proof.md5-mismatch, upload and proof stay on the Worker")
                continue
            with open(os.path.join(folder, f"{n}.proof"), "wb") as f:
                f.write(body)
            print(f"    n = {n}: proof saved ({len(body):,} bytes" + (", MD5 matches)" if want else ", no MD5 to compare)"))
            ok_keys.append(p["name"])
        missing = [n for n in primes if not os.path.exists(os.path.join(folder, f"{n}.proof"))]
        if missing:
            print(f"    no checked proof file yet for n = {missing}; the upload stays on the Worker")
            ok_keys = [k for k in ok_keys if k != key]
        saved += 1
        if args.delete:
            for k in ok_keys:
                w.delete(k)
                removed += 1
            if key not in ok_keys:
                kept += 1

    for sid, left in by_sub.items():
        print(f"  proof file(s) without an upload record: {[p['name'] for p in left]} (left on the Worker)")
    tf_saved, tf_n, tf_factors, tf_removed, tf_problems = pull_sieve(w, target, args.delete, args.new_only)
    problems += tf_problems
    removed += tf_removed
    print(f"Saved {saved} upload(s), {lines:,} result lines, to {target}" + (f"; {skipped} saved before" if skipped else ""))
    if tf_saved:
        print(f"Saved {tf_saved} sieve upload(s): {tf_n:,} n with {tf_factors:,} factor(s)")
    if args.delete:
        print(f"Removed {removed} item(s) from the Worker" + (f"; {kept} upload(s) stay there until their proof arrives" if kept else ""))
    if problems:
        print(f"{problems} problem(s) above need a look.")
    print("Next: python tools/build.py")


if __name__ == "__main__":
    main()
