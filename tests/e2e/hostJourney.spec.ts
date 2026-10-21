/**
 * W01/W05/W17 (PR05): a host runs a team game from creation to finish, and
 * guests join from a shared link on desktop and phone.
 */
import { devices, expect, test, type Page } from "@playwright/test";

import { db, joinFromLink, signInAsNewHost } from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

/** True when nothing on the page is wider than the viewport. */
async function fitsViewport(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
}

test("host creates, shares, closes joining, finishes and reopens a team game", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!);
  const host = await hostContext.newPage();
  const gameName = `Journey ${Date.now()}`;

  await host.goto("/dashboard");
  await host.getByLabel("Game name").fill(gameName);
  await host.getByRole("button", { name: "More teams" }).click();
  // A double click must not create two rooms.
  await host.getByRole("button", { name: "Create game" }).dblclick();
  await host.waitForURL("**/admin");
  expect(await db.game.count({ where: { name: gameName } })).toBe(1);
  const game = await db.game.findFirstOrThrow({
    where: { name: gameName },
    include: { gameTeams: true },
  });
  expect(game.gameTeams).toHaveLength(3);
  await expect(host.getByTestId("game-status")).toHaveText(
    "Lobby: not started",
  );
  await expect(host.getByTestId("join-code")).toHaveText(game.code);

  // Two guests are spread across teams automatically.
  const guests = await Promise.all(
    ["Ada", "Bo"].map(async (nickname) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await joinFromLink(page, { code: game.code, gameId: game.id, nickname });
      return { context, page, nickname };
    }),
  );
  for (const { page, nickname } of guests) {
    await expect(page.getByTestId("player-identity")).toContainText(
      `You are ${nickname} on Team`,
    );
  }
  const teamsOfGuests = await db.gameUser.findMany({
    where: { gameId: game.id },
    select: { gameTeamId: true },
  });
  expect(new Set(teamsOfGuests.map((u) => u.gameTeamId)).size).toBe(2);

  // Close joining: a newcomer is told why; the host sees the change.
  await host.getByRole("tab", { name: "Room" }).click();
  await host.getByLabel("Allow new players to join").click();
  await expect(
    host.getByText("Joining is closed; players already in can still return"),
  ).toBeVisible();
  const lateContext = await browser.newContext();
  const late = await lateContext.newPage();
  await late.goto(`/join?code=${game.code}`);
  await late.getByLabel("Nickname").fill("Late");
  await late.getByRole("button", { name: "Join game" }).click();
  await expect(
    late.getByText(
      "Joining is closed for this game. Ask your host to open it.",
    ),
  ).toBeVisible();

  // Starting the buzzer starts the game.
  await host.getByRole("tab", { name: "Play", exact: true }).click();
  await host.getByRole("button", { name: "Open buzzer" }).click();
  await expect(host.getByTestId("game-status")).toHaveText("Live");

  // Finish: players see it live and can no longer buzz.
  await host.getByRole("tab", { name: "Room" }).click();
  await host.getByRole("button", { name: "Finish game…" }).click();
  await host.getByRole("button", { name: "Finish game", exact: true }).click();
  await expect(host.getByTestId("game-status")).toHaveText("Finished");
  const ada = guests[0]!.page;
  await expect(
    ada.getByText(
      "This game has finished. Final scores are on the scoreboard.",
    ),
  ).toBeVisible();
  await expect(ada.getByRole("button", { name: "Buzz" })).toBeDisabled();

  // Reopen within 24 hours, with the buzzer closed.
  await host.getByRole("button", { name: "Reopen to correct results" }).click();
  await expect(host.getByTestId("game-status")).toHaveText("Live");
  await expect(
    ada.getByText("Buzzer closed. Wait for the host to open it."),
  ).toBeVisible();

  await Promise.all([
    hostContext.close(),
    lateContext.close(),
    ...guests.map((g) => g.context.close()),
  ]);
});

test("a guest can resume after reload, or leave the room on this device", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!);
  const host = await hostContext.newPage();
  await host.goto("/dashboard");
  const gameName = `Resume ${Date.now()}`;
  await host.getByLabel("Game name").fill(gameName);
  await host.getByRole("button", { name: "Create game" }).click();
  await host.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({ where: { name: gameName } });

  const context = await browser.newContext();
  const page = await context.newPage();
  await joinFromLink(page, {
    code: game.code,
    gameId: game.id,
    nickname: "Ada",
  });

  // Opening the link again offers to resume as the same player.
  await page.goto(`/join?code=${game.code}`);
  await page.getByRole("button", { name: "Resume as Ada" }).click();
  await page.waitForURL(`**/game/${game.id}/user`);
  expect(await db.gameUser.count({ where: { gameId: game.id } })).toBe(1);

  // Leaving forgets the credential on this device but keeps the player.
  await page.getByText("Leave this room on this device").click();
  await page.getByRole("button", { name: "Leave on this device" }).click();
  await page.waitForURL("**/join");
  await page.goto(`/join?code=${game.code}`);
  await expect(page.getByRole("button", { name: /Resume as/ })).toHaveCount(0);
  await page.goto(`/game/${game.id}/user`);
  await page.waitForURL("**/join");
  expect(await db.gameUser.count({ where: { gameId: game.id } })).toBe(1);

  await Promise.all([hostContext.close(), context.close()]);
});

test("a guest joins and buzzes on a 360px phone without sideways scrolling", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!);
  const host = await hostContext.newPage();
  await host.goto("/dashboard");
  const gameName = `Phone ${Date.now()}`;
  await host.getByLabel("Game name").fill(gameName);
  await host.getByRole("button", { name: "Create game" }).click();
  await host.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({ where: { name: gameName } });

  const phone = await browser.newContext({
    ...devices["Pixel 5"],
    viewport: { width: 360, height: 740 },
  });
  const page = await phone.newPage();
  await page.goto(`/join?code=${game.code}`);
  expect(await fitsViewport(page)).toBe(true);
  await page.getByLabel("Nickname").fill("Phone Player");
  await page.getByRole("button", { name: "Join game" }).click();
  await page.waitForURL(`**/game/${game.id}/user`);
  expect(await fitsViewport(page)).toBe(true);

  const buzzer = page.getByRole("button", { name: "Buzz" });
  await expect(buzzer).toBeDisabled();
  await host.getByRole("button", { name: "Open buzzer" }).click();
  await expect(buzzer).toBeEnabled();
  await buzzer.tap();
  await expect(page.getByText("You buzzed in first!")).toBeVisible();
  expect(await fitsViewport(page)).toBe(true);

  await Promise.all([hostContext.close(), phone.close()]);
});
