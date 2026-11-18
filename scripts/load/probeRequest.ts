/**
 * Longest a probe request may take, headers and body together, before it
 * counts as failed: well above the slowest p95 measured under overload
 * (8.4 s, docs/load-scaling.md), so real latencies aren't cut off.
 */
export const PROBE_TIMEOUT_MS = 15_000;

/**
 * One timed probe request. The deadline also covers reading the body, so a
 * response that stalls mid-body is recorded as a slow failure instead of
 * hanging the probe until the runner kills it.
 */
export async function probeOnce(url: string, timeoutMs = PROBE_TIMEOUT_MS) {
  const start = performance.now();
  let ok: boolean;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer();
    ok = res.ok;
  } catch {
    ok = false;
  }
  return { ms: performance.now() - start, ok };
}
