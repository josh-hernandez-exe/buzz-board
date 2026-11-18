/**
 * PR02 topology spike: counts long-lived subscription requests per page.
 * Run on demand: `RUN_SPIKES=1 bunx playwright test tests/spike`. Writes a JSON report.
 */
import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import {
  createGameForHost,
  db,
  joinFromLink,
  selectGameFromDashboard,
  signInAsNewHost,
} from "../e2e/support";

test.setTimeout(180_000);

test.afterAll(async () => {
  await db.$disconnect();
});

function trackSubscriptions(page: Page) {
  const open = new Set<object>();
  const seen: string[] = [];
  let peak = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/trpc/")) return;
    const accept = request.headers().accept ?? "";
    if (!accept.includes("text/event-stream")) return;
    seen.push(url.pathname.replace("/api/trpc/", ""));
    open.add(request);
    peak = Math.max(peak, open.size);
  });
  const close = (request: object) => open.delete(request);
  page.on("requestfinished", close);
  page.on("requestfailed", close);
  return {
    seen,
    summary: () => ({
      requests: seen.length,
      openNow: open.size,
      peakOpen: peak,
      names: [...new Set(seen)],
    }),
  };
}

test("count subscription streams per page", async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const host = await signInAsNewHost(context, baseURL!);
  const game = await createGameForHost(host.id, {
    name: `Spike ${Date.now()}`,
  });

  const report: Record<string, unknown> = {};
  const measure = async (label: string, path: string, page?: Page) => {
    const p = page ?? (await context.newPage());
    const tracked = trackSubscriptions(p);
    await p.goto(path);
    await p.waitForTimeout(8_000);
    report[label] = tracked.summary();
    return p;
  };

  // Set the tab's scope via the dashboard like a real host would.
  const admin = await context.newPage();
  await selectGameFromDashboard(admin, {
    gameName: game.name,
    gameId: game.id,
  });
  await measure("host admin (reload)", `/game/${game.id}/admin`, admin);

  const display = await browser.newContext();
  await measure(
    "anonymous public scoreboard",
    `/game/${game.id}/scoreboard/public`,
    await display.newPage(),
  );

  const player = await browser.newContext();
  const playerPage = await player.newPage();
  const tracked = trackSubscriptions(playerPage);
  await joinFromLink(playerPage, {
    code: game.code,
    gameId: game.id,
    nickname: "Ada",
  });
  await playerPage.waitForTimeout(8_000);
  report["player (after join)"] = tracked.summary();

  // Connection budget: two admin tabs for one game in the same browser.
  const budget = await browser.newContext();
  const budgetHost = await signInAsNewHost(budget, baseURL!);
  const budgetGame = await createGameForHost(budgetHost.id, {
    name: `Budget ${Date.now()}`,
  });
  const tabs = [await budget.newPage(), await budget.newPage()];
  const loaded: boolean[] = [];
  for (const tab of tabs) {
    await tab.goto(`/game/${budgetGame.id}/admin`, { timeout: 20_000 }).then(
      () => loaded.push(true),
      () => loaded.push(false),
    );
    await tab.waitForTimeout(3_000);
  }
  const clickedAt = Date.now();
  await tabs[0]!
    .getByRole("button", { name: "Start Buzzer" })
    .click({ timeout: 5_000 })
    .catch(() => undefined);
  let mutationMs: number | null = null;
  while (Date.now() - clickedAt < 15_000) {
    const g = await db.game.findUniqueOrThrow({ where: { id: budgetGame.id } });
    if (g.isBuzzerListening) {
      mutationMs = Date.now() - clickedAt;
      break;
    }
    await tabs[0]!.waitForTimeout(250);
  }
  report["two admin tabs, same browser"] = {
    tabsLoaded: loaded,
    firstTabStartBuzzerCommittedMs: mutationMs,
  };
  await budget.close();

  writeFileSync(
    "test-results/spike-connections.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  expect(Object.keys(report)).toHaveLength(4);

  await Promise.all([context.close(), display.close(), player.close()]);
});
