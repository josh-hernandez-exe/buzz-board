import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { type BrowserContext } from "@playwright/test";

import { testDatabaseUrl } from "../support/testEnv.ts";

export const db = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl() } },
});

/**
 * Signs a browser context in as a new account without an OAuth provider by
 * seeding a NextAuth database session (the app uses the Prisma adapter's
 * default database strategy).
 */
export async function signInAsNewHost(
  context: BrowserContext,
  baseURL: string,
  name = "E2E Host",
) {
  const sessionToken = randomBytes(32).toString("hex");
  const user = await db.user.create({
    data: {
      name,
      email: `${randomUUID()}@example.test`,
      sessions: {
        create: {
          sessionToken,
          expires: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
    },
  });

  await context.addCookies([
    {
      name: "authjs.session-token",
      value: sessionToken,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  return user;
}
