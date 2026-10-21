/**
 * T11/T05 browser smoke (PR01): the basic buzzer-and-scoreboard loop across
 * three separate browser contexts (host, guest phone, anonymous display).
 */
import { expect, test } from "@playwright/test";

import { db, joinFromLink, signInAsNewHost } from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

test("host creates a game, a guest buzzes in and the display updates", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Smoke ${Date.now()}`;

  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!);
  const host = await hostContext.newPage();

  // Create an individual game from the dashboard; it opens the host desk.
  await host.goto("/dashboard");
  await host.getByLabel("Individually").check();
  await host.getByLabel("Game name").fill(gameName);
  await host.getByRole("button", { name: "Create game" }).click();
  await host.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({ where: { name: gameName } });
  expect(game.format).toBe("individual");
  await expect(host.getByTestId("join-code")).toHaveText(game.code);
  await expect(host.getByRole("button", { name: "Open buzzer" })).toBeVisible();

  // A guest joins from a shared link without an account.
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await joinFromLink(player, {
    code: game.code,
    gameId: game.id,
    nickname: "Ada",
  });
  const buzzer = player.getByRole("button", { name: "Buzz", exact: true });
  await expect(buzzer).toBeVisible();

  // An anonymous display shows the public scoreboard.
  const displayContext = await browser.newContext();
  const display = await displayContext.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);
  const card = display.getByTestId("display-team").filter({ hasText: "Ada" });
  await expect(card.getByTestId("display-team-score")).toHaveText("0");

  // Host opens the buzzer; the guest buzzes; the display marks them selected.
  await host.getByRole("button", { name: "Open buzzer" }).click();
  await expect
    .poll(
      async () =>
        (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
          .isBuzzerListening,
    )
    .toBe(true);
  await expect(player.getByText("Buzzer open: press now!")).toBeVisible();
  await buzzer.click();
  await expect(card).toHaveAttribute("data-buzzer-state", "selected");
  await expect(player.getByText("You buzzed in first!")).toBeVisible();

  // Host awards points to the selected player; the display updates live.
  await host.getByLabel("Points", { exact: true }).fill("5");
  await host.getByRole("button", { name: "Award 5 to Ada" }).click();
  await expect(card.getByTestId("display-team-score")).toHaveText("5");

  await Promise.all([
    hostContext.close(),
    playerContext.close(),
    displayContext.close(),
  ]);
});
