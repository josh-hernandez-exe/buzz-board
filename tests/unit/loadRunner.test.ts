/**
 * T15 (PR12): load runner interlocks, workload arithmetic and statistics.
 * The runner itself is exercised by `bun run load` (see docs/operations.md).
 */
import { describe, expect, it } from "vitest";

import {
  ceilingsFor,
  checkTarget,
  exceededCeiling,
  isLoopbackHost,
} from "../../scripts/load/interlocks";
import {
  botsAt,
  durationSeconds,
  estimateWorkload,
  PROFILES,
  withHoldScale,
} from "../../scripts/load/profiles";
import {
  parseSyntheticTag,
  seededRandom,
  summarize,
  syntheticMessage,
} from "../../scripts/load/stats";

const remote = {
  target: "https://staging.example.org",
  allowRemote: true,
  acknowledgeCosts: true,
  allowlist: ["https://staging.example.org"],
  operatorApproval: "ops ticket 42",
};

describe("target interlocks", () => {
  it("allows loopback targets without any flags", () => {
    for (const target of [
      "http://localhost:3300",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(
        checkTarget({
          target,
          allowRemote: false,
          acknowledgeCosts: false,
          allowlist: [],
        })._unsafeUnwrap(),
      ).toMatchObject({ local: true });
    }
  });

  it("refuses a remote target unless every interlock is satisfied", () => {
    expect(checkTarget(remote)._unsafeUnwrap()).toEqual({
      origin: "https://staging.example.org",
      local: false,
    });
    for (const missing of [
      { allowRemote: false },
      { acknowledgeCosts: false },
      { allowlist: ["https://other.example.org"] },
      { operatorApproval: " " },
    ]) {
      const result = checkTarget({ ...remote, ...missing });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatch(/^Refusing non-local target/);
    }
  });

  it("refuses look-alike hosts, credentials, paths and other schemes", () => {
    expect(isLoopbackHost("localhost.example.org")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.nip.io")).toBe(false);
    const local = {
      allowRemote: false,
      acknowledgeCosts: false,
      allowlist: [],
    };
    for (const target of [
      "http://localhost.example.org",
      "http://user:pw@localhost:3000",
      "http://localhost:3000/api",
      "ftp://localhost",
      "not a url",
    ]) {
      expect(checkTarget({ ...local, target }).isErr()).toBe(true);
    }
  });
});

describe("profiles and workload", () => {
  it("follows the plan's mixed-100 shape", () => {
    const p = PROFILES["mixed-100"];
    expect(durationSeconds(p)).toBe(14 * 60);
    expect(botsAt(p, 0)).toBe(0);
    expect(botsAt(p, 60)).toBe(50);
    expect(botsAt(p, 120)).toBe(100);
    expect(botsAt(p, 700)).toBe(100);
    expect(botsAt(p, 780)).toBe(50);
    expect(botsAt(p, 840)).toBe(0);
  });

  it("steps the 1,000-bot capacity profile through each stage within 30 minutes", () => {
    const p = PROFILES["capacity-1000-local"];
    expect(durationSeconds(p)).toBeLessThanOrEqual(30 * 60);
    expect(botsAt(p, 120 + 179)).toBe(100);
    expect(botsAt(p, 300 + 120 + 1)).toBe(250);
    expect(botsAt(p, 600 + 120 + 1)).toBe(500);
    expect(botsAt(p, 900 + 120 + 1)).toBe(1_000);
  });

  it("estimates about 3.33 messages a second at 100 bots and 33.33 at 1,000", () => {
    expect(
      estimateWorkload(PROFILES["mixed-100"]).messagesPerSecondAtPeak,
    ).toBeCloseTo(3.33, 2);
    expect(
      estimateWorkload(PROFILES["capacity-1000-local"]).messagesPerSecondAtPeak,
    ).toBeCloseTo(33.33, 2);
    const e = estimateWorkload(PROFILES["mixed-100"]);
    // 600s hold at 100 bots plus two 120s ramps averaging 50.
    expect(e.botSeconds).toBeCloseTo(100 * 600 + 2 * 50 * 120, -2);
    expect(e.peakClients).toBe(104);
    expect(e.buzzWindows).toBe(84);
  });

  it("scales only the hold for short trials", () => {
    const short = withHoldScale(PROFILES["mixed-100"], 0.1);
    expect(short.stages[0]).toEqual({
      bots: 100,
      rampSeconds: 120,
      holdSeconds: 60,
    });
  });
});

describe("ceilings", () => {
  const c = ceilingsFor(estimateWorkload(PROFILES["smoke-10"]));
  const ok = {
    seconds: 10,
    requests: 500,
    messages: 5,
    bytes: 1_000,
    unexpectedErrors: 0,
    clients: 14,
  };

  it("passes normal usage and stops at the first ceiling crossed", () => {
    expect(exceededCeiling(ok, c)).toBeNull();
    expect(exceededCeiling({ ...ok, seconds: c.maxSeconds + 1 }, c)).toMatch(
      /^time/,
    );
    expect(exceededCeiling({ ...ok, clients: 15 }, c)).toMatch(/^clients/);
    expect(
      exceededCeiling({ ...ok, unexpectedErrors: c.maxErrors + 1 }, c),
    ).toMatch(/^unexpected errors/);
    expect(
      exceededCeiling({ ...ok, requests: 1_000, unexpectedErrors: 60 }, c),
    ).toMatch(/error rate/);
  });
});

describe("stats", () => {
  it("is deterministic for a seed", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const xs = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("summarizes nearest-rank percentiles", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(summarize(values)).toEqual({
      count: 100,
      p50: 50,
      p95: 95,
      p99: 99,
      max: 100,
    });
    expect(summarize([])).toMatchObject({ count: 0, p95: null });
  });

  it("builds 128-byte synthetic messages whose tag identifies the sender", () => {
    const body = syntheticMessage("ab12", 7, 31, 128);
    expect(Buffer.byteLength(body)).toBe(128);
    expect(parseSyntheticTag(body)).toBe("L|ab12|7|31|");
    expect(parseSyntheticTag("hello")).toBeNull();
  });
});
