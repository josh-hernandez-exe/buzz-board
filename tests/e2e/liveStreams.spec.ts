/**
 * T08/T11 (PR04): one live stream per page, so several app tabs fit within a
 * browser's six HTTP/1.1 connections per host.
 */
import { expect, test } from "@playwright/test";

import {
  createGameForHost,
  db,
  selectGameFromDashboard,
  signInAsNewHost,
  trackStreams,
} from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

test("each page opens exactly one live stream", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  const host = await signInAsNewHost(hostContext, baseURL!);
  const game = await createGameForHost(host.id, {
    name: `Streams ${Date.now()}`,
  });

  const admin = await hostContext.newPage();
  await selectGameFromDashboard(admin, {
    gameName: game.name,
    gameId: game.id,
  });
  const adminStreams = trackStreams(admin);
  await admin.reload();
  await expect(
    admin.getByRole("button", { name: "Start Buzzer" }),
  ).toBeVisible();

  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  const playerStreams = trackStreams(player);
  await player.goto(`/join?code=${game.code}`);
  await player.waitForURL(`**/game/${game.id}/user`);

  const displayContext = await browser.newContext();
  const display = await displayContext.newPage();
  const displayStreams = trackStreams(display);
  await display.goto(`/game/${game.id}/scoreboard/public`);
  await expect(display.getByText("Team 1: Team 1")).toBeVisible();

  // Let every component mount and any late subscriptions start.
  await admin.waitForTimeout(3_000);

  expect(adminStreams.open()).toEqual(["gameGeneral.gameState"]);
  expect(playerStreams.open()).toEqual(["gameGeneral.gameState"]);
  // The public display no longer calls the member-only stream.
  expect(displayStreams.open()).toEqual(["public.gameState"]);

  await Promise.all([
    hostContext.close(),
    playerContext.close(),
    displayContext.close(),
  ]);
});

test("two admin tabs for one game can both act", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  const host = await signInAsNewHost(context, baseURL!);
  const game = await createGameForHost(host.id, {
    name: `Two tabs ${Date.now()}`,
  });
  const tabs = [await context.newPage(), await context.newPage()];
  for (const tab of tabs) {
    await selectGameFromDashboard(tab, {
      gameName: game.name,
      gameId: game.id,
    });
  }
  const listening = async () =>
    (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
      .isBuzzerListening;

  await tabs[1]!.getByRole("button", { name: "Start Buzzer" }).click();
  await expect.poll(listening, { timeout: 10_000 }).toBe(true);
  // The other tab sees the change live and can act on it.
  await tabs[0]!.getByRole("button", { name: "Pause Buzzer" }).click();
  await expect.poll(listening, { timeout: 10_000 }).toBe(false);

  await context.close();
});
