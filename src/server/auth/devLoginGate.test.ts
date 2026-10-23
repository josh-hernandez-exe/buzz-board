import { afterEach, describe, expect, it, vi } from "vitest";

import {
  devLoginEnabled,
  isLoopbackHost,
  safeCallbackPath,
  signInPath,
} from "./devLoginGate";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("devLoginEnabled", () => {
  it("is off unless DEV_LOGIN=1, in development and tests", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DEV_LOGIN", "");
    expect(devLoginEnabled()).toBe(false);
    vi.stubEnv("DEV_LOGIN", "0");
    expect(devLoginEnabled()).toBe(false);
    vi.stubEnv("DEV_LOGIN", "1");
    expect(devLoginEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    expect(devLoginEnabled()).toBe(true);
  });

  it("is never on in production or on Vercel, even with DEV_LOGIN=1", () => {
    vi.stubEnv("DEV_LOGIN", "1");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(devLoginEnabled()).toBe(false);
    expect(signInPath()).toBe("/api/auth/signin?callbackUrl=%2Fdashboard");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    expect(devLoginEnabled()).toBe(false);
  });
});

describe("signInPath", () => {
  it("points at the dev page only when it's on", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DEV_LOGIN", "1");
    expect(signInPath("/invite/abc")).toBe(
      "/dev-login?callbackUrl=%2Finvite%2Fabc",
    );
    vi.stubEnv("DEV_LOGIN", "");
    expect(signInPath("/invite/abc")).toBe(
      "/api/auth/signin?callbackUrl=%2Finvite%2Fabc",
    );
  });
});

describe("isLoopbackHost", () => {
  it("accepts only this machine", () => {
    for (const host of [
      "localhost",
      "localhost:3000",
      "127.0.0.1:3100",
      "[::1]:3000",
    ]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of [
      null,
      "",
      "172.19.0.1:3000",
      "buzzboard.example.com",
      "localhost.evil.com",
      "127.0.0.1.evil.com",
    ]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe("safeCallbackPath", () => {
  it("keeps same-site paths and refuses other sites", () => {
    expect(safeCallbackPath("/game/abc/admin")).toBe("/game/abc/admin");
    for (const bad of [
      null,
      "",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      expect(safeCallbackPath(bad)).toBe("/dashboard");
    }
  });
});
