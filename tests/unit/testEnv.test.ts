import { describe, expect, it } from "vitest";

import { assertDisposableRedis } from "../support/testEnv";

describe("assertDisposableRedis", () => {
  it.each([
    "redis://localhost:56379/0",
    "redis://127.0.0.1:56379/0",
    "redis://[::1]:56379/0",
  ])("allows local %s", (url) => {
    expect(() => assertDisposableRedis(url)).not.toThrow();
  });

  it.each(["redis://cache.example.com:6379/0", "rediss://10.0.0.5:6379"])(
    "refuses non-local %s",
    (url) => {
      expect(() => assertDisposableRedis(url)).toThrow(/non-local/);
    },
  );
});
