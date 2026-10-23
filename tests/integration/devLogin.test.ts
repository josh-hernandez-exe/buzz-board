/**
 * The development-only sign-in route: off by default, never in production,
 * localhost and same-origin only, and it creates a real database session.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/dev-login/route.dev";

import { db } from "../support/integration";

afterEach(() => {
  vi.unstubAllEnvs();
});

function post({
  host = "localhost:3000",
  origin = "http://localhost:3000",
  account = "host",
  callbackUrl = "/dashboard",
}: {
  host?: string;
  origin?: string | null;
  account?: string;
  callbackUrl?: string;
} = {}) {
  const headers = new Headers({ host });
  if (origin) headers.set("origin", origin);
  return POST(
    new Request(`http://${host}/api/dev-login`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ account, callbackUrl }),
    }),
  );
}

function enable() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DEV_LOGIN", "1");
}

describe("dev login route", () => {
  it("doesn't exist unless DEV_LOGIN=1, and never in production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_LOGIN", "");
    expect((await post()).status).toBe(404);
    vi.stubEnv("DEV_LOGIN", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect((await post()).status).toBe(404);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    expect((await post()).status).toBe(404);
  });

  it("answers only localhost, and only this site's own form", async () => {
    enable();
    expect(
      (
        await post({
          host: "172.19.0.1:3000",
          origin: "http://172.19.0.1:3000",
        })
      ).status,
    ).toBe(404);
    expect((await post({ origin: null })).status).toBe(403);
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ account: "root" })).status).toBe(400);
  });

  it("signs in as a ready-made account with a real database session", async () => {
    enable();
    const response = await post({ account: "cohost", callbackUrl: "/join" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/join");
    const cookie = response.headers.get("set-cookie") ?? "";
    const token = /authjs\.session-token=([0-9a-f]+)/.exec(cookie)?.[1];
    expect(token).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    const session = await db.session.findUniqueOrThrow({
      where: { sessionToken: token },
      include: { user: true },
    });
    expect(session.user).toMatchObject({
      name: "Dev Co-host",
      email: "cohost@dev-login.buzz-board.invalid",
    });

    // The same account again: same user, new session.
    const again = await post({ account: "cohost" });
    const second = /authjs\.session-token=([0-9a-f]+)/.exec(
      again.headers.get("set-cookie") ?? "",
    )?.[1];
    const user = await db.session.findUniqueOrThrow({
      where: { sessionToken: second },
    });
    expect(user.userId).toBe(session.userId);
  });

  it("never sends anyone to another site afterwards", async () => {
    enable();
    const response = await post({ callbackUrl: "https://evil.example/x" });
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });
});
