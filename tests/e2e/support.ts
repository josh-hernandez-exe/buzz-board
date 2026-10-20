import { randomBytes, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { expect, type BrowserContext, type Page } from "@playwright/test";

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

/** Creates a game owned by `hostId` in the same shape as `user.game.create`. */
export async function createGameForHost(
  hostId: string,
  {
    name,
    format = "team",
    teams = 2,
  }: { name: string; format?: "team" | "individual"; teams?: number },
) {
  const code = randomBytes(4)
    .toString("hex")
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z1-9]/g, "Z")
    .slice(0, 6);
  const game = await db.game.create({
    data: {
      name,
      code,
      format,
      createdById: hostId,
      gameAdmins: { create: { userId: hostId } },
      scoreboard: { create: {} },
      gameTeams: {
        create: Array.from({ length: teams }, (_, i) => ({
          index: i + 1,
          name: `Team ${i + 1}`,
        })),
      },
    },
    include: { scoreboard: true },
  });
  const state = await db.scoreboardState.create({
    data: { gameId: game.id, scoreboardId: game.scoreboard!.id },
  });
  await db.scoreboard.update({
    where: { id: game.scoreboard!.id },
    data: { currentStateId: state.id },
  });
  return game;
}

/**
 * Opens a game's admin page from the dashboard's Select link, the way a host
 * does. A click that lands while the table is still hydrating can be dropped,
 * so the click is retried until the navigation starts.
 */
export async function selectGameFromDashboard(
  page: Page,
  { gameName, gameId }: { gameName: string; gameId: string },
) {
  await page.goto("/dashboard");
  const link = page
    .getByRole("row")
    .filter({ hasText: gameName })
    .getByRole("link", { name: "Select" });
  await expect(async () => {
    await link.click({ timeout: 5_000 });
    await page.waitForURL(`**/game/${gameId}/admin`, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}
