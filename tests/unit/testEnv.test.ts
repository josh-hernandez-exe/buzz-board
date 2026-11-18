import { describe, expect, it } from "vitest";

import {
  assertDisposableDatabase,
  assertDisposableRedis,
} from "../support/testEnv";

describe("assertDisposableDatabase", () => {
  it("allows a local database whose name contains test", () => {
    expect(() =>
      assertDisposableDatabase(
        "postgresql://postgres:postgres@127.0.0.1:55432/buzz_board_test",
      ),
    ).not.toThrow();
  });

  it("refuses a non-local host even when the name contains test", () => {
    expect(() =>
      assertDisposableDatabase("postgresql://u:p@db.example.com:5432/app_test"),
    ).toThrow(/non-local/);
  });

  it("refuses a local database whose name lacks test", () => {
    expect(() =>
      assertDisposableDatabase("postgresql://u:p@localhost:5432/buzz_board"),
    ).toThrow(/must contain "test"/);
  });
});

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
