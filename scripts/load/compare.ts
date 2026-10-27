/**
 * Compares load reports side by side as a Markdown table: steady-state
 * latency, where the CPU went, and cost per unit of work.
 *
 *   bun scripts/load/compare.ts load-results/final/scale-10-*.json ...
 *
 * Reading it (docs/load-scaling.md): flat per-unit costs as users grow mean
 * the application scales linearly and any slowdown is the machine; rising
 * per-unit costs mean the application does more work per user as the game
 * grows.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

type Report = Record<string, unknown>;
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: compare.ts <report.json>...");
  process.exit(2);
}
const reports = files.map(
  (f) => [basename(f), JSON.parse(readFileSync(f, "utf8")) as Report] as const,
);

function get(r: unknown, path: string[]): unknown {
  let v = r;
  for (const p of path) {
    if (v === null || typeof v !== "object") return null;
    v = (v as Record<string, unknown>)[p];
  }
  return v ?? null;
}
const pct = (v: unknown) => {
  if (v && typeof v === "object" && "p50" in v) {
    const l = v as { p50: number | null; p95: number | null };
    return `${l.p50 ?? "–"} / ${l.p95 ?? "–"}`;
  }
  if (typeof v === "string" || typeof v === "number") return String(v);
  return "–";
};

const rows: [string, (r: Report) => string][] = [
  ["topology", (r) => pct(get(r, ["environment", "topology"]))],
  ["chat every (s)", (r) => pct(get(r, ["plan", "chatEverySeconds"]) ?? "30")],
  ["peak streams", (r) => pct(get(r, ["counts", "peakStreamsOpen"]))],
  [
    "requests/s",
    (r) => pct(get(r, ["resources", "average", "requestsPerSecond"])),
  ],
  [
    "stream events/s",
    (r) => pct(get(r, ["resources", "average", "streamEventsPerSecond"])),
  ],
  [
    "received KB/s",
    (r) => pct(get(r, ["resources", "average", "receivedKbPerSecond"])),
  ],
  [
    "host CPU busy % avg / peak",
    (r) =>
      `${pct(get(r, ["resources", "average", "hostBusyPercent"]))} / ${pct(get(r, ["resources", "peak", "hostBusyPercent"]))}`,
  ],
  [
    "run queue avg / peak",
    (r) =>
      `${pct(get(r, ["resources", "average", "runQueue"]))} / ${pct(get(r, ["resources", "peak", "runQueue"]))}`,
  ],
  ["server cores", (r) => pct(get(r, ["resources", "average", "serverCores"]))],
  [
    "server main thread cores avg / peak",
    (r) =>
      `${pct(get(r, ["resources", "average", "serverMainThreadCores"]))} / ${pct(get(r, ["resources", "peak", "serverMainThreadCores"]))}`,
  ],
  ["runner cores", (r) => pct(get(r, ["resources", "average", "runnerCores"]))],
  [
    "postgres cores",
    (r) => pct(get(r, ["resources", "average", "postgresCores"])),
  ],
  [
    "runner timer lag p99 ms (peak)",
    (r) => pct(get(r, ["resources", "peak", "runnerLoopLagP99Ms"])),
  ],
  [
    "server RSS MB (peak)",
    (r) => pct(get(r, ["resources", "peak", "serverRssMb"])),
  ],
  [
    "server CPU ms / request",
    (r) => pct(get(r, ["resources", "perUnit", "serverCpuMsPerRequest"])),
  ],
  [
    "server CPU ms / stream event",
    (r) => pct(get(r, ["resources", "perUnit", "serverCpuMsPerStreamEvent"])),
  ],
  [
    "postgres CPU ms / request",
    (r) => pct(get(r, ["resources", "perUnit", "postgresCpuMsPerRequest"])),
  ],
  [
    "bytes / stream event",
    (r) => pct(get(r, ["resources", "perUnit", "receivedBytesPerStreamEvent"])),
  ],
  [
    "probe p50 / p95 ms (own process)",
    (r) => pct(get(r, ["holdLatency", "probeMs"])),
  ],
  ["buzz ack p50 / p95 ms", (r) => pct(get(r, ["holdLatency", "buzzAckMs"]))],
  [
    "chat send ack p50 / p95 ms",
    (r) => pct(get(r, ["holdLatency", "chatSendAckMs"])),
  ],
  [
    "chat delivery p50 / p95 ms",
    (r) => pct(get(r, ["holdLatency", "chatVisibleDeliveryMs"])),
  ],
  ["unexpected errors", (r) => pct(get(r, ["unexpectedErrors", "count"]))],
  [
    "all invariants hold",
    (r) => String(Object.values(get(r, ["invariants"]) ?? {}).every(Boolean)),
  ],
  ["stopped early", (r) => pct(get(r, ["stopReason"]) ?? "no")],
];

console.log(`| metric | ${reports.map(([n]) => n).join(" | ")} |`);
console.log(`|---|${reports.map(() => "---").join("|")}|`);
for (const [label, value] of rows) {
  console.log(`| ${label} | ${reports.map(([, r]) => value(r)).join(" | ")} |`);
}
