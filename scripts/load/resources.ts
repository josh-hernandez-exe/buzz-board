/**
 * Resource sampling for load runs, from /proc (Linux): who uses the CPU
 * (server, its main thread, the runner itself, PostgreSQL, Redis), how busy
 * the whole machine is, and whether the generator is falling behind. Used to
 * tell an application scaling problem from the limits of the machine the
 * test runs on.
 */
import { readdirSync, readFileSync } from "node:fs";

const TICKS_PER_SECOND = 100;

function readStat(path: string): number[] | null {
  try {
    const text = readFileSync(path, "utf8");
    // Fields after the parenthesised command name (which may contain spaces).
    const rest = text.slice(text.lastIndexOf(")") + 2).split(" ");
    // utime is field 14, stime 15 (1-based, counting pid and comm).
    return [Number(rest[11]), Number(rest[12])];
  } catch {
    return null;
  }
}

function cpuTicks(pid: number): number | null {
  const s = readStat(`/proc/${pid}/stat`);
  return s ? s[0]! + s[1]! : null;
}

function threadTicks(pid: number, tid: number): number | null {
  const s = readStat(`/proc/${pid}/task/${tid}/stat`);
  return s ? s[0]! + s[1]! : null;
}

function comm(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  } catch {
    return "";
  }
}

function allPids(): { pid: number; ppid: number }[] {
  const out: { pid: number; ppid: number }[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const text = readFileSync(`/proc/${entry}/stat`, "utf8");
      const rest = text.slice(text.lastIndexOf(")") + 2).split(" ");
      out.push({ pid: Number(entry), ppid: Number(rest[1]) });
    } catch {
      // exited
    }
  }
  return out;
}

/** The process and all its descendants. */
export function processTree(root: number): number[] {
  const rows = allPids();
  const tree = new Set([root]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const { pid, ppid } of rows) {
      if (!tree.has(pid) && tree.has(ppid)) {
        tree.add(pid);
        changed = true;
      }
    }
  }
  return [...tree];
}

function pidsByComm(pattern: RegExp): number[] {
  return allPids()
    .map((r) => r.pid)
    .filter((pid) => pattern.test(comm(pid)));
}

type HostTicks = {
  busy: number;
  idle: number;
  iowait: number;
  steal: number;
  total: number;
};

function hostTicks(): HostTicks {
  const line = readFileSync("/proc/stat", "utf8").split("\n")[0]!;
  const [user, nice, system, idle, iowait, irq, softirq, steal] = line
    .split(/\s+/)
    .slice(1)
    .map(Number);
  const total =
    user! + nice! + system! + idle! + iowait! + irq! + softirq! + steal!;
  return {
    busy: user! + nice! + system! + irq! + softirq!,
    idle: idle!,
    iowait: iowait!,
    steal: steal!,
    total,
  };
}

function runQueue(): number {
  const m = /procs_running (\d+)/.exec(readFileSync("/proc/stat", "utf8"));
  return m ? Number(m[1]) : 0;
}

export type ResourceSample = {
  /** Whole machine, percent of all CPUs. */
  hostBusyPercent: number;
  hostStealPercent: number;
  hostIowaitPercent: number;
  /** Runnable threads right now (more than the CPU count means waiting). */
  runQueue: number;
  /** CPU cores in use (1.0 = one core fully busy) by each part. */
  serverCores: number;
  serverMainThreadCores: number | null;
  runnerCores: number;
  postgresCores: number;
  redisCores: number;
  /** Generator health: how late the runner's 50 ms timer fired, worst and p99. */
  runnerLoopLagMaxMs: number;
  runnerLoopLagP99Ms: number;
};

/**
 * Samples CPU use by part between calls. `serverRoots` are the spawned
 * server processes (their whole trees are counted).
 */
export class ResourceSampler {
  private lastHost = hostTicks();
  private lastTicks = new Map<string, number>();
  private lastAt = performance.now();
  private lags: number[] = [];
  private timer: ReturnType<typeof setInterval>;
  private expected = performance.now() + 50;

  constructor(private readonly serverRoots: number[]) {
    this.timer = setInterval(() => {
      const t = performance.now();
      this.lags.push(Math.max(0, t - this.expected));
      this.expected = t + 50;
    }, 50);
    this.timer.unref?.();
    // Prime the per-part counters.
    this.groupTicks();
  }

  stop() {
    clearInterval(this.timer);
  }

  private mainThreads(): { pid: number }[] {
    // The Next.js server process ("next-server (v…)") in each tree: its
    // main thread is where requests are handled.
    return this.serverRoots.flatMap((root) =>
      processTree(root)
        .filter((pid) => comm(pid).startsWith("next-server"))
        .map((pid) => ({ pid })),
    );
  }

  private groupTicks(): Record<string, number> {
    const sum = (pids: number[]) =>
      pids.reduce((s, pid) => s + (cpuTicks(pid) ?? 0), 0);
    const server = this.serverRoots.flatMap((r) => processTree(r));
    const main = this.mainThreads();
    const ticks: Record<string, number> = {
      server: sum(server),
      runner: cpuTicks(process.pid) ?? 0,
      postgres: sum(pidsByComm(/^postgres/)),
      redis: sum(pidsByComm(/^(redis|keydb)-server/)),
    };
    if (main.length > 0) {
      ticks.main = main.reduce(
        (s, { pid }) => s + (threadTicks(pid, pid) ?? 0),
        0,
      );
    }
    return ticks;
  }

  sample(): ResourceSample {
    const at = performance.now();
    const seconds = Math.max(0.001, (at - this.lastAt) / 1000);
    const host = hostTicks();
    const dTotal = Math.max(1, host.total - this.lastHost.total);
    const ticks = this.groupTicks();
    const cores = (key: string) => {
      const prev = this.lastTicks.get(key);
      const cur = ticks[key];
      if (cur === undefined || prev === undefined) return null;
      // A part that restarted (lower ticks) reads as zero, not negative.
      return Math.max(0, (cur - prev) / TICKS_PER_SECOND / seconds);
    };
    const lags = [...this.lags].sort((a, b) => a - b);
    const sample: ResourceSample = {
      hostBusyPercent: Math.round(
        ((host.busy - this.lastHost.busy) / dTotal) * 100,
      ),
      hostStealPercent:
        Math.round(((host.steal - this.lastHost.steal) / dTotal) * 1000) / 10,
      hostIowaitPercent:
        Math.round(((host.iowait - this.lastHost.iowait) / dTotal) * 1000) / 10,
      runQueue: runQueue(),
      serverCores: round2(cores("server") ?? 0),
      serverMainThreadCores:
        cores("main") === null ? null : round2(cores("main")!),
      runnerCores: round2(cores("runner") ?? 0),
      postgresCores: round2(cores("postgres") ?? 0),
      redisCores: round2(cores("redis") ?? 0),
      runnerLoopLagMaxMs: Math.round(lags.at(-1) ?? 0),
      runnerLoopLagP99Ms: Math.round(
        lags[Math.min(lags.length - 1, Math.floor(lags.length * 0.99))] ?? 0,
      ),
    };
    this.lastHost = host;
    this.lastAt = at;
    this.lags = [];
    for (const [k, v] of Object.entries(ticks)) this.lastTicks.set(k, v);
    return sample;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
