#!/usr/bin/env python3
"""Keep the public site up to date by itself: save new uploads, rebuild data/ and push it.

A scheduled task on the PC that holds archive/ runs this every 15 minutes, at :00, :15, :30 and :45 (see
"Updating by itself" in README.md). Each run:

  1. saves the uploads that are new on the upload Worker (tools/pull_submissions.py --new-only);
  2. when the archive drive is attached, copies new archive files both ways (tools/sync_archive.py --back);
  3. once a day (UTC), reads the Top PRP ranks of the known primes from PRP Records into
     archive/prptop.json (tools/prptop_ranks.py); after a failed read it tries again a few hours later;
     once an hour, in the first run of the hour (on the hour), reads the progress of the Prime95 PRP run
     on this PC into live/prp_progress.json
     (tools/live_prp.py: it only reads Prime95's results.json.txt and copies nothing to the archive drive);
  4. stops here if nothing that tools/build.py reads has changed since the last published build;
  5. rebuilds data/ (tools/build.py);
  6. checks the new data against the published data: no known prime, PRP test, P-1 factor, resolved n,
     sieved range or partial sieve may go missing, no sieve depth may shrink and the frontier may not
     move back;
  7. commits data/ alone and pushes it.

It never commits anything outside data/ and never pushes a commit it did not make: it does nothing while
files outside data/ have uncommitted changes or while this copy has commits of someone else's that are
not on GitHub yet (work waiting for approval). It does not publish data that fails step 6, nor while
origin/main has commits this copy does not have: it puts data/ back as it was and waits for new input
or a new commit. When GitHub is out of reach it commits anyway, and a later run pushes. Each run that
does something adds a few lines to auto_update.log (not committed; a problem that repeats is written
once); auto_update_state.json keeps what the next run needs.

Usage:
  pyw -3 tools\\auto_update.py             # what the scheduled task runs (no window)
  py -3 tools\\auto_update.py --dry-run    # everything up to step 6, then stop; data/ is left rebuilt
  py -3 tools\\auto_update.py --force      # rebuild even if nothing changed

Only the Python standard library is used.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(REPO, "tools")
ARCHIVE = os.path.join(REPO, "archive")
LOG = os.path.join(REPO, "auto_update.log")
STATE = os.path.join(REPO, "auto_update_state.json")
LOCK = os.path.join(REPO, "auto_update.lock")
LOCK_STALE_S = 2 * 3600          # a lock older than this was left by a run that died
RANKS_RETRY_S = 3 * 3600         # after a failed read of the PRPTop ranks, wait this long before the next
LIVE = os.path.join(REPO, "live")  # the progress of the Prime95 run on this PC (tools/live_prp.py), not committed
LOG_MAX_BYTES = 1_000_000
NO_WINDOW = 0x08000000 if os.name == "nt" else 0   # CREATE_NO_WINDOW: no console flashing under pyw
MARK = "Made by tools/auto_update.py"                 # last line of every commit this script makes
# who the data commits are by: the account that owns the repository, with GitHub's no-reply address
AUTHOR = ("RP-12000", "157728189+RP-12000@users.noreply.github.com")


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class Log:
    def __init__(self, quiet, state):
        self.quiet = quiet
        self.state = state
        self.lines = []

    def __call__(self, msg):
        self.lines.append(f"{now()}  {msg}")
        if not self.quiet:
            print(msg, flush=True)

    def once(self, key, msg):
        """Log a problem only when it is new, so that a run every 15 minutes does not repeat it all day."""
        if self.state.get(key) != msg:
            self(msg)
            self.state[key] = msg

    def clear(self, key):
        self.state.pop(key, None)

    def save(self):
        if not self.lines:
            return
        try:
            if os.path.exists(LOG) and os.path.getsize(LOG) > LOG_MAX_BYTES:
                os.replace(LOG, LOG + ".1")
            with open(LOG, "a", encoding="utf-8", newline="\n") as f:
                f.write("\n".join(self.lines) + "\n")
        except OSError:
            pass


def run(cmd, timeout=600, raw=False):
    """Run a command in the repo; returns (exit code, output). Never raises for a failing command.
    raw=True returns stdout alone, exactly as written (for output whose leading spaces matter)."""
    # no prompts: an unattended run must fail and log rather than wait for someone to type a password
    env = dict(os.environ, PYTHONIOENCODING="utf-8", GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
    try:
        p = subprocess.run(cmd, cwd=REPO, capture_output=True, timeout=timeout, env=env,
                           creationflags=NO_WINDOW, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, f"{cmd[0]}: {e}"
    if raw and p.returncode == 0:
        return 0, (p.stdout or b"").decode("utf-8", "replace")
    out = (p.stdout or b"").decode("utf-8", "replace") + (p.stderr or b"").decode("utf-8", "replace")
    return p.returncode, out.strip()


def git(*args, timeout=180, raw=False):
    return run(["git", *args], timeout=timeout, raw=raw)


def tool(name, *args, timeout=1800):
    return run([sys.executable, os.path.join(TOOLS, name), *args], timeout=timeout)


def tail(text, lines=12):
    return "\n".join("    " + x for x in text.splitlines()[-lines:])


def take_lock():
    for _ in range(2):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {now()}\n".encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(LOCK) < LOCK_STALE_S:
                    return False                          # another run is still busy
                os.remove(LOCK)                           # left by a run that died
            except OSError:
                return False
    return False


def read_state():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def write_state(state):
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, STATE)


def inputs_fingerprint():
    """Everything tools/build.py reads: archive/ (not its own cache), content/, live/ and the build script."""
    h = hashlib.sha256()
    for root in (ARCHIVE, os.path.join(REPO, "content"), LIVE):
        for folder, dirs, files in os.walk(root, followlinks=True):
            dirs.sort()
            for name in sorted(files):
                path = os.path.join(folder, name)
                rel = os.path.relpath(path, REPO).replace(os.sep, "/")
                if rel == "archive/pm1_splits.json":
                    continue
                try:
                    st = os.stat(path)
                except OSError:
                    continue
                h.update(f"{rel}\0{st.st_size}\0{st.st_mtime_ns}\n".encode("utf-8", "replace"))
    with open(os.path.join(TOOLS, "build.py"), "rb") as f:
        h.update(hashlib.sha256(f.read()).digest())
    return h.hexdigest()


def archive_files():
    out = set()
    for folder, dirs, files in os.walk(ARCHIVE, followlinks=True):
        for name in files:
            path = os.path.join(folder, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            out.add((os.path.relpath(path, ARCHIVE).replace(os.sep, "/"), st.st_size, st.st_mtime_ns))
    return out


def changes():
    """Paths with uncommitted changes (`git status --porcelain -z`), split into data/ and everything else."""
    code, out = git("status", "--porcelain", "-z", "--untracked-files=all", raw=True)
    if code:
        raise RuntimeError("git status failed:\n" + tail(out))
    data, other = [], []
    items = out.split("\0")
    i = 0
    while i < len(items):
        item = items[i]
        i += 1
        if len(item) < 4:
            continue
        status, path = item[:2], item[3:]
        if "R" in status or "C" in status:
            i += 1                                        # -z puts the old path of a rename in the next item
        (data if path.startswith("data/") else other).append(path)
    return sorted(data), sorted(other)


def head_json(path):
    code, out = git("show", f"HEAD:{path}")
    if code:
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


def work_json(path):
    try:
        with open(os.path.join(REPO, path), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def real_change(data_paths):
    """False when the rebuilt data/ differs from HEAD only in summary.json's "generated" time."""
    if data_paths != ["data/summary.json"]:
        return bool(data_paths)
    old, new = head_json("data/summary.json"), work_json("data/summary.json")
    if old is None or new is None:
        return True
    old.pop("generated", None)
    new.pop("generated", None)
    return old != new


def problems_in_new_data():
    """What the rebuilt data/ lost compared with the published data (HEAD); empty when nothing."""
    out = []
    old_s, new_s = head_json("data/summary.json"), work_json("data/summary.json")
    if old_s is None:
        return out                                        # nothing published yet to compare with
    if new_s is None:
        return ["data/summary.json is missing or unreadable"]
    if (new_s.get("frontier") or 0) < (old_s.get("frontier") or 0):
        out.append(f"frontier moved back from {old_s.get('frontier'):,} to {new_s.get('frontier'):,}")
    oc, nc = old_s.get("counts") or {}, new_s.get("counts") or {}
    for key in ("primes", "prp_tests", "prp_with_proof", "pm1_runs", "pm1_factors", "removed_by_sieve", "resolved"):
        if (nc.get(key) or 0) < (oc.get(key) or 0):
            out.append(f"{key} fell from {oc.get(key):,} to {nc.get(key):,}")
    old_p, new_p = head_json("data/primes.json") or {}, work_json("data/primes.json") or {}
    lost = {p.get("n") for p in old_p.get("primes", [])} - {p.get("n") for p in new_p.get("primes", [])}
    if lost:
        out.append(f"known primes missing: {sorted(lost)}")
    old_r, new_r = head_json("data/ranges.json") or {}, work_json("data/ranges.json") or {}
    new_rows = {r["lo"]: r for r in new_r.get("rows", [])}
    for r in old_r.get("rows", []):
        n = new_rows.get(r["lo"])
        label = f"{r['lo'] / 1e6:.1f}M-{r['hi'] / 1e6:.1f}M"
        if n is None:
            out.append(f"range {label} is missing")
            continue
        if r.get("sieved") and not n.get("sieved"):
            out.append(f"range {label} is no longer sieved")
        elif r.get("sieved") and (n.get("sieve") or {}).get("depth", 0) < (r.get("sieve") or {}).get("depth", 0):
            out.append(f"range {label}: sieve depth fell from {r['sieve']['depth']:,} to {n['sieve']['depth']:,}")
        if (n.get("prp") or {}).get("tests", 0) < (r.get("prp") or {}).get("tests", 0):
            out.append(f"range {label}: PRP tests fell from {r['prp']['tests']:,} to {n['prp']['tests']:,}")
        if (n.get("resolved") or 0) < (r.get("resolved") or 0):
            out.append(f"range {label}: resolved n fell from {r['resolved']:,} to {n.get('resolved') or 0:,}")
        old_part, new_part = r.get("sieve_part"), n.get("sieve_part")
        if old_part and not n.get("sieved"):
            # sieved in part: the p spans done and the n they removed may only grow
            if not new_part:
                out.append(f"range {label}: the partial sieve is missing")
            else:
                if (new_part.get("factored") or 0) < (old_part.get("factored") or 0):
                    out.append(f"range {label}: n removed by the partial sieve fell from {old_part.get('factored'):,} "
                               f"to {new_part.get('factored') or 0:,}")
                for a, b in old_part.get("p") or []:
                    if not any(c <= a and d >= b for c, d in new_part.get("p") or []):
                        out.append(f"range {label}: the partial sieve no longer covers p {a:,}-{b:,}")
    return out


def put_data_back(log):
    code, out = git("checkout", "HEAD", "--", "data")
    if code:
        log("could not put data/ back:\n" + tail(out))


def origin_status(log):
    """'ok', 'offline' (GitHub out of reach) or 'behind' (origin/main has commits this copy does not have)."""
    code, out = git("fetch", "--quiet", "origin", "main", timeout=300)
    if code:
        log.once("fetch_problem", "git fetch failed (offline?); will try again on the next runs:\n" + tail(out, 4))
        return "offline"
    log.clear("fetch_problem")
    code, _ = git("merge-base", "--is-ancestor", "origin/main", "HEAD")
    if code:
        log.once("behind", "origin/main has commits this copy does not have; nothing is published until "
                           "someone runs git pull here")
        return "behind"
    log.clear("behind")
    return "ok"


def head_sha():
    code, out = git("rev-parse", "HEAD")
    return out.strip() if code == 0 else ""


def foreign_commits():
    """Commits here that are not on GitHub yet and that this script did not make (work waiting for approval)."""
    code, out = git("rev-list", "--reverse", "origin/main..HEAD")
    if code:
        return []
    foreign = []
    for sha in out.split():
        code, msg = git("show", "-s", "--format=%B", sha)
        code2, files = git("show", "--format=", "--name-only", sha)
        ours = MARK in msg and all(f.startswith("data/") for f in files.split())
        if not ours:
            foreign.append(sha[:7] + " " + (msg.splitlines() or [""])[0])
    return foreign


def ahead_of_origin():
    code, out = git("rev-list", "--count", "origin/main..HEAD")
    return code == 0 and out.strip().isdigit() and int(out) > 0


def push(log):
    code, out = git("push", "origin", "HEAD:main", timeout=600)
    if code:
        log.once("push_problem", "git push failed; will try again on the next runs:\n" + tail(out, 6))
        return False
    log.clear("push_problem")
    code, head = git("rev-parse", "--short", "HEAD")
    log(f"pushed {head.strip()} to GitHub; the site updates in a minute or two")
    return True


def main():
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")         # a Windows code page cannot show every character
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="rebuild and check, but do not commit or push")
    ap.add_argument("--force", action="store_true", help="rebuild even if no input changed")
    ap.add_argument("--quiet", action="store_true", help="write only to auto_update.log")
    args = ap.parse_args()
    if not take_lock():
        if sys.stdout is not None and not args.quiet:
            print("another run is busy (auto_update.lock); nothing done")
        return
    state = read_state()
    log = Log(args.quiet or sys.stdout is None, state)
    try:
        step(args, log, state)
        log.clear("error")
    except Exception as e:                                # keep a record of anything unexpected
        log.once("error", f"stopped by an error: {type(e).__name__}: {e}")
    finally:
        try:
            write_state(state)
        except OSError:
            pass
        log.save()
        try:
            os.remove(LOCK)
        except OSError:
            pass


def step(args, log, state):
    state["last_run"] = now()
    code, branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if code or branch.strip() != "main":
        log.once("branch", f"not on branch main ({branch.strip()}); nothing done")
        return
    log.clear("branch")
    data_dirty, other = changes()
    if other:
        log.once("waiting_for", "waiting: files outside data/ have uncommitted changes: " +
                 ", ".join(sorted(other)[:8]) + (" …" if len(other) > 8 else ""))
        return
    log.clear("waiting_for")
    foreign = foreign_commits()
    if foreign:
        # pushing data would push these too, and they wait for someone to approve them
        log.once("foreign", "waiting: commits not on GitHub yet that this script did not make: " + "; ".join(foreign[:4]))
        return
    log.clear("foreign")

    # a commit from an earlier run that could not be pushed
    if not args.dry_run and not data_dirty and ahead_of_origin():
        if origin_status(log) == "ok":
            push(log)
        return

    before = archive_files()
    code, out = tool("pull_submissions.py", "--new-only", timeout=900)
    if code:
        log.once("pull_problem", "pull_submissions.py failed; going on with what is here:\n" + tail(out, 6))
    else:
        log.clear("pull_problem")
    source = default_source()
    attached = os.path.isdir(os.path.join(source, "Ranges"))
    if attached:
        code, out = tool("sync_archive.py", "--back", "--source", source, timeout=3600)
        if code:
            log.once("sync_problem", "sync_archive.py failed; going on with what is here:\n" + tail(out, 6))
        else:
            log.clear("sync_problem")
    refresh_ranks(log, state)
    live_new = refresh_live(log, state)
    after = archive_files()
    new_files = sorted({x[0] for x in after - before})
    new_uploads = sorted({p.split("/")[1] for p in new_files if p.startswith("Submissions/")})

    fp = inputs_fingerprint()
    held = fp + " " + head_sha()          # a build held back is tried again after new input or a new commit
    if not args.force and not data_dirty and fp == state.get("published_inputs"):
        return                                            # nothing new
    if not args.force and held == state.get("blocked_inputs"):
        return                                            # same as a build that was held back
    log(f"new input: {len(new_files)} archive file(s) added or changed" +
        (f", uploads {', '.join(new_uploads)}" if new_uploads else "") +
        (f", {live_new} new PRP result(s) from Prime95" if live_new else "") +
        ("" if attached else " (archive drive not attached)") +
        (", data/ had changes" if data_dirty else ""))

    code, out = tool("build.py", timeout=3600)
    if code:
        log("build.py failed; data/ put back:\n" + tail(out))
        put_data_back(log)
        state["blocked_inputs"] = held
        return
    summary = [x.strip() for x in out.splitlines() if x.strip().startswith(("survivors", "frontier"))]
    notes = [x.strip() for x in out.splitlines() if " x " in x and "(first:" in x]
    data_dirty, other = changes()
    if other:
        log("build.py changed files outside data/; nothing committed: " + ", ".join(other[:8]))
        return
    if not real_change(data_dirty):
        log("rebuilt: nothing changed on the site")
        put_data_back(log)
        state["published_inputs"] = fp
        state.pop("blocked_inputs", None)
        return
    trouble = problems_in_new_data()
    if trouble:
        log("not published, the new data lost something (data/ put back; waiting for new input):\n" +
            "\n".join("    " + t for t in trouble) + ("\n  build notes:\n" + "\n".join("    " + n for n in notes) if notes else ""))
        put_data_back(log)
        state["blocked_inputs"] = held
        return
    if args.dry_run:
        log(f"dry run: {len(data_dirty)} data file(s) would be committed; " + "; ".join(summary))
        return
    origin = origin_status(log)
    if origin == "behind":
        put_data_back(log)                                # a clean copy lets `git pull` run
        state["blocked_inputs"] = held
        return
    code, out = git("add", "-A", "--", "data")
    if code:
        log("git add failed:\n" + tail(out))
        return
    title = "Update data"
    if new_uploads:
        title += f": {len(new_uploads)} new upload(s)"
    elif live_new:
        title += f": {live_new} new PRP result(s)"
    body = []
    if new_uploads:
        body.append("Uploads: " + ", ".join(new_uploads))
    if live_new:
        body.append(f"PRP results read from the Prime95 run: {live_new} new")
    if new_files:
        body.append(f"Archive files added or changed: {len(new_files)}")
    if "prptop.json" in new_files:
        body.append("Top PRP ranks read again from PRP Records")
    body += summary
    msg = title + "\n\n" + "\n".join(body) + "\n\n" + MARK + "\n"
    msg_path = os.path.join(REPO, ".git", "AUTO_UPDATE_MSG")
    with open(msg_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(msg)
    code, out = git("-c", f"user.name={AUTHOR[0]}", "-c", f"user.email={AUTHOR[1]}", "commit", "--quiet", "-F", msg_path)
    if code:
        log("git commit failed:\n" + tail(out))
        return
    state["published_inputs"] = fp
    state.pop("blocked_inputs", None)
    log(f"committed: {title}; " + "; ".join(summary))
    if origin == "ok":
        push(log)                                         # when offline, a later run pushes it


def refresh_ranks(log, state):
    """Read the Top PRP ranks once a (UTC) day; after a failure, try again a few hours later."""
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    if state.get("ranks_day") == today or time.time() - state.get("ranks_try", 0) < RANKS_RETRY_S:
        return
    state["ranks_try"] = time.time()
    code, out = tool("prptop_ranks.py", timeout=300)
    if code:
        log.once("ranks_problem", "prptop_ranks.py failed; will try again in a few hours:\n" + tail(out, 4))
        return
    log.clear("ranks_problem")
    state["ranks_day"] = today
    line = (out.strip().splitlines() or [""])[-1]
    if "ranks changed" in line or "first read" in line:
        log(line)


def refresh_live(log, state):
    """Once an hour, in the first run of each hour (the runs are at :00, :15, :30 and :45), the progress of the
    Prime95 run on this PC (tools/live_prp.py only reads its results file). Returns how many results were new."""
    hour = time.strftime("%Y-%m-%d %H", time.gmtime())   # a whole hour in UTC is a whole hour on this PC too
    if state.get("live_hour") == hour:
        return 0
    state["live_hour"] = hour
    code, out = tool("live_prp.py", timeout=300)
    if code:
        log.once("live_problem", "live_prp.py could not read the Prime95 results; will try again next hour:\n" + tail(out, 4))
        return 0
    log.clear("live_problem")
    line = (out.strip().splitlines() or [""])[-1]
    m = re.search(r"([\d,]+) new", line)
    new = int(m.group(1).replace(",", "")) if m else 0
    if new:
        log(line)
    return new


def default_source():
    sys.path.insert(0, TOOLS)
    import sync_archive
    return sync_archive.DEFAULT_SOURCE


if __name__ == "__main__":
    main()
