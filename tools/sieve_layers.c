/* sieve_layers.c - the smallest prime factor of 2^n - 25 for every odd n below NMAX, up to a limit per range of n.

   For each prime p (7 <= p < the largest limit) it finds every n in a window with 2^n = 25 (mod p) by
   baby-step giant-step, and keeps the smallest such p for each n. Ranges of n take their own limit (the depth
   the old sievers reached there); every other n is searched to the default limit.

   Output (JSON, read by tools/build.py as content/sieve_layers.json): per column of BUCKET n, the number of
   odd n >= 5 whose smallest factor lies in each power of ten [10^k, 10^(k+1)), the number left without a
   factor below the limit, and the limit itself. With a fourth argument it also writes every odd n left
   without a factor (one per line), to check against the sievers' own survivor lists.

   2026-11-13, with tools/sieve_layers_limits.txt: about 15 minutes on 4 cores (203,280,218 primes); the n
   left below 3.6M equal the survivor lists of the old sievers exactly, apart from n = 5, 7, 9 and 13, where
   2^n - 25 is itself a small prime.

   Build: gcc -O3 -march=native -pthread -o sieve_layers sieve_layers.c -lm   (GCC or Clang: needs __int128)
   Run:   sieve_layers tools/sieve_layers_limits.txt content/sieve_layers.json <threads> [survivors.txt]
   Limits file: first line "NMAX BUCKET DEFAULT_LIMIT", then lines "lo hi limit" (n in [lo, hi) use primes
   below limit, at most 2^32). */
#include <inttypes.h>
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef unsigned __int128 u128;
static uint64_t NMAX, BUCKET, DEFLIM, MAXLIM;
static uint64_t *lim;            /* per column */
static uint64_t ncols;
static uint32_t *spf;            /* smallest factor found, 0 = none yet */
static uint32_t *base;           /* primes below 2^16 */
static size_t nbase;
#define SEG (1u << 21)           /* odd numbers per segment */
static uint64_t nseg, nextseg = 0;
static pthread_mutex_t segmu = PTHREAD_MUTEX_INITIALIZER;
static uint64_t done_primes = 0;

static inline uint64_t mulm(uint64_t x, uint64_t y, uint64_t p, uint64_t bar) {
  uint64_t z = x * y;                                    /* < 2^64 as p < 2^32 */
  uint64_t q = (uint64_t)(((u128)z * bar) >> 64);
  uint64_t r = z - q * p;
  return r >= p ? r - p : r;
}
static uint64_t powm(uint64_t b, uint64_t e, uint64_t p, uint64_t bar) {
  uint64_t r = 1 % p; b %= p;
  while (e) { if (e & 1) r = mulm(r, b, p, bar); b = mulm(b, b, p, bar); e >>= 1; }
  return r;
}
static inline void record(uint64_t n, uint32_t p) {
  if (n < 5 || !(n & 1) || n >= NMAX) return;
  if (p >= lim[n / BUCKET]) return;
  if (n < 33 && ((1ull << n) - 25) == p) return;         /* 2^n - 25 is p itself (n = 5, 7, 9, 13) */
  uint32_t cur = __atomic_load_n(&spf[n], __ATOMIC_RELAXED);
  while (cur == 0 || p < cur) {
    if (__atomic_compare_exchange_n(&spf[n], &cur, p, 1, __ATOMIC_RELAXED, __ATOMIC_RELAXED)) break;
  }
}

typedef struct { uint32_t *key, *val, *gen; uint32_t g, mask, bits; } table_t;
static inline uint32_t h32(uint32_t v, uint32_t bits) { return (uint32_t)(v * 2654435761u) >> (32 - bits); }
static inline void tput(table_t *t, uint32_t k, uint32_t v) {
  uint32_t i = h32(k, t->bits);
  while (t->gen[i] == t->g) { if (t->key[i] == k) return; i = (i + 1) & t->mask; }
  t->gen[i] = t->g; t->key[i] = k; t->val[i] = v;
}
static inline int tget(table_t *t, uint32_t k, uint32_t *v) {
  uint32_t i = h32(k, t->bits);
  while (t->gen[i] == t->g) { if (t->key[i] == k) { *v = t->val[i]; return 1; } i = (i + 1) & t->mask; }
  return 0;
}

/* every n in [a, b) with 2^n = 25 (mod p) */
static void solve(uint64_t p, uint64_t a, uint64_t b, table_t *t) {
  uint64_t bar = (uint64_t)(((u128)1 << 64) / p);
  uint64_t L = b - a, m = (uint64_t)ceil(sqrt((double)L));
  if (m < 1) m = 1;
  if (m >= p) m = p - 1;                                 /* the order of 2 is below p */
  t->g++;
  uint64_t v = 1, d = 0;
  for (uint64_t j = 0; j < m; j++) {
    if (j && v == 1) { d = j; break; }
    tput(t, (uint32_t)v, (uint32_t)j);
    v = mulm(v, 2, p, bar);
  }
  if (!d && m == p - 1 && v == 1) d = m;
  uint64_t target = 25 % p;
  if (d) {                                                /* small order: 2^0 .. 2^(d-1) are all in the table */
    uint32_t j0;
    if (!tget(t, (uint32_t)target, &j0)) return;
    uint64_t n = a + ((j0 + d - a % d) % d);
    for (; n < b; n += d) record(n, (uint32_t)p);
    return;
  }
  uint64_t inv2 = (p + 1) / 2;
  uint64_t g = powm(inv2, m, p, bar);
  uint64_t tt = mulm(target, powm(inv2, a, p, bar), p, bar);
  uint64_t steps = (L + m - 1) / m;
  for (uint64_t i = 0; i < steps; i++) {
    uint32_t j;
    if (tget(t, (uint32_t)tt, &j)) { uint64_t n = a + i * m + j; if (n < b) record(n, (uint32_t)p); }
    tt = mulm(tt, g, p, bar);
  }
}

static void *worker(void *arg) {
  (void)arg;
  table_t t; t.bits = 14; t.mask = (1u << t.bits) - 1; t.g = 0;
  t.key = calloc(1u << t.bits, 4); t.val = calloc(1u << t.bits, 4); t.gen = calloc(1u << t.bits, 4);
  uint8_t *mark = malloc(SEG);
  for (;;) {
    pthread_mutex_lock(&segmu); uint64_t s = nextseg++; pthread_mutex_unlock(&segmu);
    if (s >= nseg) break;
    uint64_t lo = 2 * (uint64_t)SEG * s + 1;              /* odd numbers lo, lo+2, ... */
    uint64_t hi = lo + 2 * (uint64_t)SEG;                 /* exclusive */
    if (hi > MAXLIM) hi = MAXLIM;
    memset(mark, 1, SEG);
    for (size_t i = 1; i < nbase; i++) {                  /* base[0] = 2 */
      uint64_t q = base[i];
      if (q * q >= hi) break;
      uint64_t st = q * q;
      if (st < lo) { st = ((lo + q - 1) / q) * q; if (!(st & 1)) st += q; }
      for (uint64_t x = st; x < hi; x += 2 * q) mark[(x - lo) / 2] = 0;
    }
    /* the window of n: columns whose limit is above lo */
    uint64_t c0 = ncols, c1 = 0;
    for (uint64_t c = 0; c < ncols; c++) if (lim[c] > lo) { if (c < c0) c0 = c; c1 = c; }
    if (c0 == ncols) continue;
    uint64_t a = c0 * BUCKET, b = (c1 + 1) * BUCKET;
    if (b > NMAX) b = NMAX;
    uint64_t cnt = 0;
    for (uint64_t x = lo; x < hi; x += 2) {
      if (!mark[(x - lo) / 2] || x < 7) continue;
      solve(x, a, b, &t);
      cnt++;
    }
    __atomic_add_fetch(&done_primes, cnt, __ATOMIC_RELAXED);
  }
  free(mark); free(t.key); free(t.val); free(t.gen);
  return NULL;
}

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: %s limits.txt out.json threads [survivors.txt]\n", argv[0]); return 2; }
  FILE *f = fopen(argv[1], "r");
  if (!f || fscanf(f, "%" SCNu64 " %" SCNu64 " %" SCNu64, &NMAX, &BUCKET, &DEFLIM) != 3) { fprintf(stderr, "bad limits file\n"); return 2; }
  ncols = (NMAX + BUCKET - 1) / BUCKET;
  lim = malloc(ncols * 8);
  for (uint64_t c = 0; c < ncols; c++) lim[c] = DEFLIM;
  uint64_t lo, hi, l;
  while (fscanf(f, "%" SCNu64 " %" SCNu64 " %" SCNu64, &lo, &hi, &l) == 3)
    for (uint64_t c = lo / BUCKET; c * BUCKET < hi && c < ncols; c++) lim[c] = l;
  fclose(f);
  MAXLIM = 0;
  for (uint64_t c = 0; c < ncols; c++) if (lim[c] > MAXLIM) MAXLIM = lim[c];
  if (MAXLIM > 4294967296ull) { fprintf(stderr, "limits above 2^32 are not supported\n"); return 2; }
  spf = calloc(NMAX, 4);
  /* base primes below 2^16 */
  uint8_t *sv = calloc(65537, 1); base = malloc(7000 * 4); nbase = 0;
  for (uint32_t i = 2; i <= 65536; i++) { if (sv[i]) continue; base[nbase++] = i; for (uint32_t j = i * i; j <= 65536; j += i) sv[j] = 1; }
  free(sv);
  nseg = (MAXLIM / 2 + SEG - 1) / SEG + 1;
  int nt = atoi(argv[3]); if (nt < 1) nt = 1;
  pthread_t th[64];
  for (int i = 0; i < nt && i < 64; i++) pthread_create(&th[i], NULL, worker, NULL);
  for (int i = 0; i < nt && i < 64; i++) pthread_join(th[i], NULL);
  fprintf(stderr, "primes used: %" PRIu64 "\n", done_primes);

  FILE *o = fopen(argv[2], "w");
  fprintf(o, "{\"_about\": \"Made by tools/sieve_layers.c. Per column of bucket n: odd = odd n >= 5; "
             "by_decade[k] = odd n whose smallest prime factor p of 2^n - 25 has 10^k <= p < 10^(k+1), for p below "
             "limit; left = odd n with no factor below limit. The limits are the depths the old sievers reached "
             "(10^7 where nothing was sieved).\",\n");
  fprintf(o, " \"nmax\": %" PRIu64 ", \"bucket\": %" PRIu64 ", \"columns\": [\n", NMAX, BUCKET);
  for (uint64_t c = 0; c < ncols; c++) {
    uint64_t cnt[11] = {0}, left = 0, odd = 0;
    for (uint64_t n = c * BUCKET; n < (c + 1) * BUCKET && n < NMAX; n++) {
      if (n < 5 || !(n & 1)) continue;
      odd++;
      if (!spf[n]) { left++; continue; }
      int k = 0;
      for (uint64_t t = 10; spf[n] >= t; t *= 10) k++;
      cnt[k]++;
    }
    fprintf(o, "  {\"limit\": %" PRIu64 ", \"odd\": %" PRIu64 ", \"left\": %" PRIu64 ", \"by_decade\": [", lim[c], odd, left);
    int top = 10; while (top > 0 && !cnt[top]) top--;
    for (int k = 0; k <= top; k++) fprintf(o, "%s%" PRIu64, k ? ", " : "", cnt[k]);
    fprintf(o, "]}%s\n", c + 1 < ncols ? "," : "");
  }
  fprintf(o, "]}\n");
  fclose(o);
  if (argc > 4) {
    FILE *s = fopen(argv[4], "w");
    for (uint64_t n = 5; n < NMAX; n += 2) if (!spf[n]) fprintf(s, "%" PRIu64 "\n", n);
    fclose(s);
  }
  return 0;
}
