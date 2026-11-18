/**
 * Safety interlocks for the load runner. Local loopback runs are the default
 * and the only kind this repository executes; anything else must pass every
 * check here first and is then still refused by the runner (see run.ts).
 */
import { err, ok, type Result } from "neverthrow";

import type { WorkloadEstimate } from "./profiles";

export type TargetOptions = {
  target: string;
  allowRemote: boolean;
  acknowledgeCosts: boolean;
  /** Exact origins approved for remote runs (LOAD_TARGET_ALLOWLIST). */
  allowlist: readonly string[];
  /** Who, as deployment operator, approved a remote run. */
  operatorApproval?: string;
};

export type Target = { origin: string; local: boolean };

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.test(hostname);
}

/** Parses and authorizes a target origin. Never follows redirects. */
export function checkTarget(options: TargetOptions): Result<Target, string> {
  let url: URL;
  try {
    url = new URL(options.target);
  } catch {
    return err(`Not a URL: ${options.target}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err("The target must be http or https.");
  }
  if (url.username || url.password) {
    return err("Don't put credentials in the target URL.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    return err("Give only an origin, for example http://localhost:3300.");
  }
  if (isLoopbackHost(url.hostname))
    return ok({ origin: url.origin, local: true });

  const missing = [
    !options.allowRemote && "--allow-remote",
    !options.acknowledgeCosts && "--acknowledge-costs",
    !options.allowlist.includes(url.origin) &&
      `${url.origin} in LOAD_TARGET_ALLOWLIST`,
    !options.operatorApproval?.trim() &&
      "--operator-approval (the deployment operator's recorded approval)",
  ].filter(Boolean);
  if (missing.length > 0) {
    return err(
      `Refusing non-local target ${url.origin}. Remote runs can cost real money and need: ${missing.join(", ")}.`,
    );
  }
  return ok({ origin: url.origin, local: false });
}

export type Ceilings = {
  maxSeconds: number;
  maxRequests: number;
  maxMessages: number;
  maxBytes: number;
  /** Unexpected errors allowed before stopping: absolute and fraction. */
  maxErrors: number;
  maxErrorRate: number;
  maxClients: number;
};

/** Hard limits: the estimate plus headroom, never raised automatically. */
export function ceilingsFor(estimate: WorkloadEstimate): Ceilings {
  return {
    maxSeconds: Math.ceil(estimate.durationSeconds * 1.25 + 120),
    maxRequests: Math.ceil(estimate.requests * 1.5 + 1_000),
    maxMessages: Math.ceil(estimate.messages * 1.5 + 100),
    maxBytes: Math.ceil(estimate.bytes * 2 + 50_000_000),
    maxErrors: Math.max(100, Math.ceil(estimate.requests * 0.01)),
    maxErrorRate: 0.05,
    maxClients: estimate.peakClients,
  };
}

export type Usage = {
  seconds: number;
  requests: number;
  messages: number;
  bytes: number;
  unexpectedErrors: number;
  clients: number;
};

/** The first ceiling a run has crossed, or null. */
export function exceededCeiling(usage: Usage, c: Ceilings): string | null {
  if (usage.seconds > c.maxSeconds) return `time over ${c.maxSeconds}s`;
  if (usage.requests > c.maxRequests) return `requests over ${c.maxRequests}`;
  if (usage.messages > c.maxMessages) return `messages over ${c.maxMessages}`;
  if (usage.bytes > c.maxBytes) return `bytes over ${c.maxBytes}`;
  if (usage.clients > c.maxClients) return `clients over ${c.maxClients}`;
  if (usage.unexpectedErrors > c.maxErrors) {
    return `unexpected errors over ${c.maxErrors}`;
  }
  if (
    usage.requests >= 200 &&
    usage.unexpectedErrors / usage.requests > c.maxErrorRate
  ) {
    return `unexpected error rate over ${c.maxErrorRate * 100}%`;
  }
  return null;
}
