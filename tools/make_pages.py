#!/usr/bin/env python3
"""Write the seven HTML pages from pages/<name>.body.html plus the shared header and footer below.

Run it after changing a body file or the header/footer:  python tools/make_pages.py
"""
import os, sys
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(REPO, 'pages')
OUT = sys.argv[1] if len(sys.argv) > 1 else REPO
PAGES = [
    # file, nav key, title, description, script
    ('index.html', 'status', '2ⁿ−25 Prime Search', 'Live status of the search for primes of the form 2^n − 25 (OEIS A379020): every odd n below 10^7, sieve depth, PRP results and the next prime.', 'status'),
    ('ranges.html', 'ranges', 'Ranges · 2ⁿ−25 Prime Search', 'Status of every odd n below 10^7, per range of n: sieve, P-1 and PRP work.', 'ranges'),
    ('exponent.html', 'exponents', 'Exponent · 2ⁿ−25 Prime Search', 'Everything known about one value of n: factors, PRP residue, history.', 'exponent'),
    ('sieve.html', 'sieve', 'Sieve · 2ⁿ−25 Prime Search', 'Sieve depth by range, candidates left, P-1 factor sizes and the siever versions used.', 'sieve'),
    ('primes.html', 'primes', 'Known primes · 2ⁿ−25 Prime Search', 'Every n for which 2^n − 25 is prime or probable prime, with discovery dates and expected counts.', 'primes'),
    ('history.html', 'history', 'History · 2ⁿ−25 Prime Search', 'How the search got here: the frontier day by day, work per day and month, the sieve depth and P-1 factor sizes, milestones and the primes found along the way.', 'history'),
    ('join.html', 'join', 'Join · 2ⁿ−25 Prime Search', 'How to help: sieve on a GPU, run PRP tests with Prime95, upload results.', 'join'),
]
NAV = [('status', 'index.html', 'Status'), ('ranges', 'ranges.html', 'Ranges'), ('exponents', 'exponent.html', 'Exponents'),
       ('sieve', 'sieve.html', 'Sieve'), ('primes', 'primes.html', 'Primes'), ('history', 'history.html', 'History'), ('join', 'join.html', 'Join')]

def page(fname, key, title, desc, script):
    body = open(os.path.join(HERE, fname.replace('.html', '.body.html')), encoding='utf-8').read().strip('\n')
    nav = '\n'.join(
        f'        <a href="{href}"' + (' aria-current="page"' if k == key else '') + f'>{label}</a>' for k, href, label in NAV)
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=IBM+Plex+Sans:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="assets/site.css">
</head>
<body>
<header class="site-header">
  <div class="bar">
    <div class="brand-nav">
      <a class="brand" href="index.html"><span class="brand-mark">2<sup>n</sup>−25</span><span class="brand-sub">Prime Search</span></a>
      <nav class="nav" aria-label="Main">
{nav}
      </nav>
    </div>
    <form class="lookup" role="search" action="exponent.html">
      <label for="hdr-n">n =</label>
      <input id="hdr-n" class="input" name="n" type="text" inputmode="numeric" autocomplete="off">
      <button class="btn" type="submit">Look up</button>
    </form>
  </div>
</header>
<main class="page" id="main">
{body}
</main>
<footer class="site-footer">
  <div class="bar">
    <span>Built from Prime95 results.json, P-1 logs and sieve output · data <span data-generated>…</span></span>
    <span class="links"><a href="https://github.com/RP-12000/2n-25">Source and data</a><a href="https://oeis.org/A379020">OEIS A379020</a><a href="http://www.primenumbers.net/prptop/prptop.php">PRP Records</a></span>
  </div>
</footer>
<script src="assets/app.js"></script>
<script src="assets/{script}.js"></script>
</body>
</html>
'''

for p in PAGES:
    src = os.path.join(HERE, p[0].replace('.html', '.body.html'))
    if not os.path.exists(src):
        print('skip', p[0]); continue
    with open(os.path.join(OUT, p[0]), 'w', encoding='utf-8', newline='\n') as f:  # LF on Windows too
        f.write(page(*p))
    print('wrote', p[0])
