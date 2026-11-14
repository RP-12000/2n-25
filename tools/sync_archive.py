#!/usr/bin/env python3
"""Copy the files the website needs from the 2^n-25 project archive into archive/ in this folder.

The project archive sits on a drive that is not always attached, so tools/build.py reads this copy
instead. For every Ranges/<a>M~<b>M folder it copies:

  TF/          origin.txt, override.txt, log.txt (also in Station N/ subfolders), worktodo_general*.txt,
               and Mass Prime Siever results.json and siever.log in any subfolder
  Candidates/  *.txt
  Pm1/         results.json.txt
  PRP/         results.json.txt

and Submissions/ (uploads saved by tools/pull_submissions.py). No proof file is copied: the PRP proofs
and everything else stay on the archive drive. The range folders are named <a>M-<b>M here, and a "~"
followed by a digit in a folder below them becomes "-" too (TF/p 10T~12.5T -> TF/p 10T-12.5T), because
some tools cannot open such a path; file names stay as they are.

A file is copied when it is new or its size or modification time changed. Nothing is ever deleted, on
either side. If the copy in archive/ is newer than the one on the drive, it is left alone and listed, so
that results added here first are never overwritten. Upload folders are only ever added, never replaced.
With --back, uploads that tools/pull_submissions.py saved in archive/Submissions (proof files included)
and that the archive drive does not have yet are copied there too.

Every copy is written to <name>.part first and renamed only when it is complete, so pulling the drive out
in the middle never leaves half a file under the real name; the next run copies that file again. A file
on the drive that changed in the last two minutes, or that changes while it is copied, may still be being
written, so it is left for a later run. A file that cannot be copied is listed and the exit code is 1.

Usage:
  python tools/sync_archive.py              # archive drive -> archive/
  python tools/sync_archive.py --dry-run    # only count what would be copied
  python tools/sync_archive.py --back       # also archive/Submissions -> archive drive
  python tools/sync_archive.py --source "E:\\All Possible PRP Data\\05 2^n-25 (2024.12 ~ 2026.05)"

Only the Python standard library is used.
"""

import argparse
import os
import re
import shutil
import sys
import time

DEFAULT_SOURCE = r"E:\All Possible PRP Data\05 2^n-25 (2024.12 ~ 2026.05)"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RANGE_DIR = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*M\s*[~-]\s*(\d+(?:\.\d+)?)\s*M\s*$", re.I)
SIEVE_TEXT = {"origin.txt", "override.txt", "log.txt"}
SLACK = 2.0  # seconds; FAT and exFAT drives keep modification times to 2 s
SETTLE_S = 120  # a file on the drive changed this recently may still be being written: left for a later run
PART = ".part"  # a copy is written as <name>.part and renamed when complete


def local_name(name):
    """3.4M~3.6M -> 3.4M-3.6M"""
    m = RANGE_DIR.match(name)
    return f"{m.group(1)}M-{m.group(2)}M"


def local_parts(parts):
    """Folders below a range folder: "~" before a digit becomes "-" (p 10T~12.5T -> p 10T-12.5T)."""
    return [re.sub(r"~(?=\d)", "-", p) for p in parts[:-1]] + parts[-1:]


def wanted(parts):
    """True for a file under one range folder that tools/build.py reads; parts = path pieces below it."""
    top, name = parts[0], parts[-1]
    if top == "Candidates":
        return len(parts) == 2 and name.lower().endswith(".txt")
    if top in ("Pm1", "PRP"):
        return len(parts) == 2 and name == "results.json.txt"
    if top == "TF":
        if name in ("results.json", "siever.log"):
            return True                                   # Mass Prime Siever, one subfolder per slice
        if len(parts) == 2 and name.startswith("worktodo_general") and name.endswith(".txt"):
            return True
        return name in SIEVE_TEXT and (len(parts) == 2 or (len(parts) == 3 and parts[1].startswith("Station ")))
    return False


def is_proof(name):
    return name.lower().endswith(".proof")


class Counts:
    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        self.copied = self.same = self.bytes = 0
        self.kept = []                                    # files left alone because the copy here is newer
        self.busy = []                                    # files that may still be being written
        self.failed = []                                  # (file, error) for copies that went wrong

    def copy(self, src, dst, overwrite=True, settle=True):
        """Copy src to dst through dst.part. settle=False for files this program's own tools wrote."""
        try:
            s = os.stat(src)
            if os.path.exists(dst):
                if not overwrite:
                    self.same += 1
                    return
                d = os.stat(dst)
                if d.st_size == s.st_size and abs(d.st_mtime - s.st_mtime) <= SLACK:
                    self.same += 1
                    return
                if d.st_mtime > s.st_mtime + SLACK:
                    self.kept.append(dst)
                    return
            if settle and s.st_mtime > time.time() - SETTLE_S:
                self.busy.append(src)
                return
            if not self.dry_run:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                part = dst + PART
                shutil.copy2(src, part)
                t = os.stat(src)
                if (t.st_size, t.st_mtime_ns) != (s.st_size, s.st_mtime_ns):
                    os.remove(part)                       # changed while it was copied: next run
                    self.busy.append(src)
                    return
                os.replace(part, dst)
        except OSError as e:                              # drive pulled out, file in use, ...
            self.failed.append((src, e))
            return
        self.copied += 1
        self.bytes += s.st_size

    def report(self):
        for path in self.busy:
            print(f"  changed in the last {SETTLE_S // 60} minutes or while it was copied, left for a later run: {path}")
        for path, e in self.failed:
            print(f"  could not copy {path}: {e}")


def walk_files(root):
    for folder, dirs, files in os.walk(root):
        dirs.sort()
        for name in sorted(files):
            if name.endswith(PART):
                continue                                  # a copy that was cut short
            path = os.path.join(folder, name)
            yield path, os.path.relpath(path, root).replace(os.sep, "/").split("/")


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")         # a Windows code page cannot show every character
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--source", default=DEFAULT_SOURCE, help="the 2^n-25 project folder on the archive drive")
    ap.add_argument("--dest", default=os.path.join(REPO, "archive"), help="where tools/build.py reads from")
    ap.add_argument("--back", action="store_true", help="also copy new uploads from archive/Submissions to the drive")
    ap.add_argument("--dry-run", action="store_true", help="count what would be copied, copy nothing")
    args = ap.parse_args()

    ranges = os.path.join(args.source, "Ranges")
    if not os.path.isdir(ranges):
        sys.exit(f"Archive not found: {ranges}\nIs the drive attached? Pass --source if the folder moved.")
    verb = "Would copy" if args.dry_run else "Copied"
    t0 = time.time()
    c = Counts(args.dry_run)
    names = sorted(n for n in os.listdir(ranges) if RANGE_DIR.match(n) and os.path.isdir(os.path.join(ranges, n)))
    for name in names:
        for path, parts in walk_files(os.path.join(ranges, name)):
            if wanted(parts):
                c.copy(path, os.path.join(args.dest, "Ranges", local_name(name), *local_parts(parts)))
    subs = os.path.join(args.source, "Submissions")
    proofs = 0
    if os.path.isdir(subs):
        for path, parts in walk_files(subs):
            if is_proof(parts[-1]):
                proofs += 1
                continue
            c.copy(path, os.path.join(args.dest, "Submissions", *parts), overwrite=False)
    print(f"{len(names)} range folders in {args.source}")
    print(f"{verb} {c.copied:,} file(s), {c.bytes / 1048576:,.1f} MB; {c.same:,} unchanged; into {args.dest} "
          f"in {time.time() - t0:.1f} s")
    if proofs:
        print(f"  {proofs:,} proof file(s) in Submissions left on the drive")
    for path in c.kept:
        print(f"  newer here than on the drive, left as is: {path}")
    if c.kept:
        print("  Copy those to the archive drive yourself if they belong there.")
    c.report()
    failed = len(c.failed)

    if args.back:
        back = Counts(args.dry_run)
        here = os.path.join(args.dest, "Submissions")
        if os.path.isdir(here):
            for path, parts in walk_files(here):
                back.copy(path, os.path.join(subs, *parts), overwrite=False, settle=False)
        print(f"{verb} {back.copied:,} upload file(s), {back.bytes / 1048576:,.1f} MB, to {subs}")
        back.report()
        failed += len(back.failed)
    if failed:
        sys.exit(f"{failed:,} file(s) could not be copied; the next run tries them again")
    if not args.dry_run:
        print("Next: python tools/build.py")


if __name__ == "__main__":
    main()
