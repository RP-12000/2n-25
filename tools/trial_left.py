#!/usr/bin/env python3
"""Write content/trial_left.json: the odd n in [lo, hi) for which no prime below 10^7 divides 2^n - 25.

tools/build.py needs it for a range whose sieve has started above the small primes, such as the Kaggle
slices p 10T-24T of 3.6M-5.0M before the laptop's slice from p = 2 is in: a factor such a slice found
makes a layer of its own on the Status chart only for the n that no prime below 10^7 removes already.

It is made from the list that tools/sieve_layers.c writes with a fourth argument, run with a limits file
whose only line is "10000000 25000 10000000" (every n searched to 10^7; a few seconds on 4 cores):

  gcc -O3 -march=native -pthread -o sieve_layers tools/sieve_layers.c -lm
  printf "10000000 25000 10000000\\n" > trial_limits.txt
  ./sieve_layers trial_limits.txt layers_1e7.json 4 left_1e7.txt
  python tools/trial_left.py left_1e7.txt 3600000 5000000

The bitmap has one bit per odd n from lo + 1 (bit 0 of the first byte), zlib-compressed and base64-encoded.
Only the Python standard library is used.
"""

import base64
import json
import os
import sys
import zlib

LIMIT = 10_000_000
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    if len(sys.argv) != 4:
        sys.exit("usage: python tools/trial_left.py <left list from sieve_layers> <lo> <hi>")
    src, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    if lo % 2 or hi % 2:
        sys.exit("lo and hi must be even")
    bits = bytearray((hi - lo) // 2 // 8 + 1)
    count = 0
    with open(src, encoding="ascii") as f:
        for line in f:
            n = int(line)
            if lo <= n < hi and n % 2:
                i = (n - lo) // 2
                bits[i >> 3] |= 1 << (i & 7)
                count += 1
    doc = {
        "_about": "Made by tools/trial_left.py from tools/sieve_layers.c run to 10^7: one bit per odd n from lo + 1, "
                  "set when no prime below limit divides 2^n - 25 (zlib, then base64).",
        "lo": lo, "hi": hi, "limit": LIMIT, "count": count,
        "bits": base64.b64encode(zlib.compress(bytes(bits), 9)).decode("ascii"),
    }
    out = os.path.join(REPO, "content", "trial_left.json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    print(f"{count:,} odd n in [{lo:,}, {hi:,}) with no factor below {LIMIT:,}; wrote {out} ({os.path.getsize(out):,} bytes)")


if __name__ == "__main__":
    main()
