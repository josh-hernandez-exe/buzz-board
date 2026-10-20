/** Seeded randomness and summary statistics for the load runner. */

/** mulberry32: small, fast, deterministic for a given seed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type Summary = {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
};

/** Nearest-rank percentiles, in whole milliseconds. */
export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) {
    return { count: 0, p50: null, p95: null, p99: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    Math.round(sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!);
  return {
    count: sorted.length,
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: Math.round(sorted.at(-1)!),
  };
}

/**
 * A 128-byte synthetic message carrying the run, sender and sequence, so a
 * receiver can match it to the sender's monotonic send time.
 */
export function syntheticMessage(
  runId: string,
  bot: number,
  sequence: number,
  bytes: number,
): string {
  const tag = `L|${runId}|${bot}|${sequence}|`;
  return tag.padEnd(bytes, "x");
}

export function parseSyntheticTag(body: string): string | null {
  const match = /^L\|[^|]+\|\d+\|\d+\|/.exec(body);
  return match ? match[0] : null;
}
