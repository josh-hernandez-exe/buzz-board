/**
 * T03/T11 (PR02): explicit game scope across tabs. Tabs share cookies and
 * localStorage, so a tab must act on the game in its URL, not the game most
 * recently opened elsewhere.
 */
import { expect, test } from "@playwright/test";

import {
  createGameForHost,
  db,
  selectGameFromDashboard,
  signInAsNewHost,
} from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

test("a reloaded host tab keeps controlling its own game", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  const host = await signInAsNewHost(context, baseURL!);
  const stamp = Date.now();
  const alpha = await createGameForHost(host.id, { name: `Alpha ${stamp}` });
  const bravo = await createGameForHost(host.id, { name: `Bravo ${stamp}` });

  async function selectFromDashboard(gameName: string, gameId: string) {
    const page = await context.newPage();
    await selectGameFromDashboard(page, { gameName, gameId });
    await page.close();
  }

  // Only one app tab is open at a time: several open tabs exceed the HTTP/1.1
  // connection budget (see docs/pr02-baseline.md), which is a separate defect.
  await selectFromDashboard(alpha.name, alpha.id);
  // Selecting Bravo last makes it the shared cookie/localStorage game.
  await selectFromDashboard(bravo.name, bravo.id);

  // Reopen Alpha from its URL, as a reload or bookmark would.
  const alphaTab = await context.newPage();
  await alphaTab.goto(`/game/${alpha.id}/admin`);
  await expect(alphaTab).toHaveURL(new RegExp(`/game/${alpha.id}/admin$`));

  await alphaTab.getByRole("button", { name: "Start Buzzer" }).click();
  await expect
    .poll(async () =>
      (
        await db.game.findMany({
          where: { id: { in: [alpha.id, bravo.id] } },
          orderBy: { name: "asc" },
        })
      ).map((g) => [g.name, g.isBuzzerListening]),
    )
    .toEqual([
      [alpha.name, true],
      [bravo.name, false],
    ]);

  await context.close();
});
