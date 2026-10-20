/**
 * T11/T05 browser smoke (PR01): the basic buzzer-and-scoreboard loop across
 * three separate browser contexts (host, guest phone, anonymous display).
 */
import { expect, test } from "@playwright/test";

import { db, signInAsNewHost } from "./support";

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

  // Create an individual game from the dashboard.
  await host.goto("/dashboard");
  await host.getByRole("combobox").click();
  await host.getByRole("option", { name: "individual" }).click();
  await host.getByPlaceholder("Game Name").fill(gameName);
  await host.getByRole("button", { name: "Submit" }).click();

  const row = host.getByRole("row").filter({ hasText: gameName });
  await expect(row).toBeVisible();
  const game = await db.game.findFirstOrThrow({ where: { name: gameName } });
  expect(game.format).toBe("individual");

  await row.getByRole("link", { name: "Select" }).click();
  await host.waitForURL(`**/game/${game.id}/admin`);
  await expect(
    host.getByRole("button", { name: "Start Buzzer" }),
  ).toBeVisible();

  // A guest joins from a shared link without an account.
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await player.goto(`/join?code=${game.code}`);
  await player.waitForURL(`**/game/${game.id}/user`);
  const buzzer = player.getByRole("button", { name: "Buzzer", exact: true });
  await expect(buzzer).toBeVisible();

  // An anonymous display shows the public scoreboard.
  const displayContext = await browser.newContext();
  const display = await displayContext.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);
  const card = display
    .locator("div")
    .filter({ has: display.getByText("Team 1: Player 1", { exact: true }) })
    .filter({ hasText: "Score:" })
    .last();
  await expect(card).toContainText("Score: 0");

  // Host opens the buzzer; the guest buzzes; the display marks them selected.
  await host.getByRole("button", { name: "Start Buzzer" }).click();
  await expect
    .poll(
      async () =>
        (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
          .isBuzzerListening,
    )
    .toBe(true);
  await buzzer.click();
  await expect(card).toHaveClass(/bg-green-500/);

  // Host awards points to the selected player; the display updates live.
  await host.getByRole("button", { name: "Buzzer Selected" }).click();
  await host.getByPlaceholder("Enter Score").fill("5");
  await host.getByRole("button", { name: "Add", exact: true }).click();
  await expect(card).toContainText("Score: 5");

  await Promise.all([
    hostContext.close(),
    playerContext.close(),
    displayContext.close(),
  ]);
});
