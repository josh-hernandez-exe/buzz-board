/**
 * W10-W11, W16-W18 (PR11): a host turns chat on; players talk in Everyone
 * and their team channel and see each other's messages live; team chat
 * stays private; the host removes a message and mutes a player.
 */
import { expect, test, type Page } from "@playwright/test";

import {
  createGameForHost,
  db,
  joinFromLink,
  signInAsNewHost,
  trackStreams,
} from "./support";

async function openChat(page: Page) {
  // Wide player screens show chat beside the tabs, without a Chat tab.
  const tab = page.getByRole("tab", { name: "Chat", exact: true });
  const region = page.getByRole("region", { name: "Chat" });
  // Wait for the page to render one or the other before deciding.
  await expect(tab.or(region).first()).toBeVisible();
  if (await tab.isVisible()) await tab.click();
  await expect(region).toBeVisible();
}

async function say(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
}

const messages = (page: Page) => page.getByTestId("chat-message");

test("players chat live, team chat stays private, and the host moderates", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  const host = await signInAsNewHost(hostContext, baseURL!, "Host Hana");
  const game = await createGameForHost(host.id, {
    name: `Chat ${Date.now()}`,
  });
  const teams = await db.gameTeam.findMany({
    where: { gameId: game.id },
    orderBy: { index: "asc" },
  });

  const desk = await hostContext.newPage();
  await desk.goto(`/game/${game.id}/admin`);
  await openChat(desk);
  await expect(desk.getByTestId("chat-off")).toBeVisible();
  await desk.getByLabel("Chat for this game").check();
  await expect(desk.getByRole("tab", { name: "Everyone" })).toBeVisible();

  const players = [];
  for (const [i, nickname] of ["Ana", "Ben"].entries()) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await joinFromLink(page, { code: game.code, gameId: game.id, nickname });
    await db.gameUser.updateMany({
      where: { gameId: game.id, name: nickname },
      data: { gameTeamId: teams[i]!.id },
    });
    const streams = trackStreams(page);
    await page.reload();
    await openChat(page);
    players.push({ context, page, streams });
  }
  const [ana, ben] = players as [
    (typeof players)[number],
    (typeof players)[number],
  ];

  // Everyone: Ben sees Ana's message without reloading.
  await say(ana.page, "Hello everyone");
  await expect(
    messages(ben.page).filter({ hasText: "Hello everyone" }),
  ).toContainText("Ana");

  // Team channel: only Ana's team and the organizers can read it.
  await expect(ben.page.getByRole("tab", { name: "Team: Team 1" })).toHaveCount(
    0,
  );
  await ana.page.getByRole("tab", { name: "Team: Team 1" }).click();
  await say(ana.page, "Our team plan");
  await desk.getByRole("tab", { name: "All channels" }).click();
  await expect(
    messages(desk).filter({ hasText: "Our team plan" }),
  ).toContainText("Team: Team 1");

  // Organizers post as "Organizer", never with their account name.
  await desk.getByRole("tab", { name: "Everyone" }).click();
  await say(desk, "Welcome to the quiz!");
  const welcome = messages(ben.page).filter({
    hasText: "Welcome to the quiz!",
  });
  await expect(welcome).toContainText("Organizer");
  await expect(welcome).toContainText("Owner");
  await expect(welcome).not.toContainText("Host Hana");

  // Remove: the text disappears for everyone.
  await desk
    .getByRole("button", { name: "Remove message from Ana" })
    .first()
    .click();
  await expect(
    ben.page.getByText("Message removed by an organizer."),
  ).toBeVisible();
  await expect(ben.page.getByText("Hello everyone")).toHaveCount(0);

  // Mute: Ana can't post, but the Buzzer tab still works for her.
  await ana.page.getByRole("tab", { name: "Everyone" }).click();
  await say(ana.page, "Sorry!");
  await desk
    .getByRole("button", { name: "Mute Ana for 10 minutes" })
    .first()
    .click();
  await expect(ana.page.getByTestId("chat-blocked")).toContainText(
    "You're muted in chat",
  );
  await expect(desk.getByTestId("chat-mute")).toContainText("Ana");
  await desk.getByRole("button", { name: "Unmute Ana" }).click();
  await expect(ana.page.getByLabel("Message", { exact: true })).toBeVisible();

  // The chat tab fits a 360px phone without sideways scrolling.
  await ben.page.setViewportSize({ width: 360, height: 740 });
  await openChat(ben.page);
  await expect(ben.page.getByLabel("Message", { exact: true })).toBeVisible();
  expect(
    await ben.page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  // One game stream plus one chat stream per page, no more.
  await expect
    .poll(() => ana.streams.open())
    .toEqual(["chat.live", "gameGeneral.gameState"]);

  for (const p of players) await p.context.close();
  await hostContext.close();
});
