/**
 * W07-W09, W06 (PR08): a moderator renames and locks a player; a host
 * removes a player and recovers a guest who lost their device.
 */
import { expect, test } from "@playwright/test";

import {
  createGameForHost,
  db,
  joinFromLink,
  signInAsNewHost,
} from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

test("staff rename and lock a name, remove a player, and recover a guest", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  const host = await signInAsNewHost(hostContext, baseURL!, "Host Hana");
  const game = await createGameForHost(host.id, {
    name: `Roster ${Date.now()}`,
  });
  const moderatorContext = await browser.newContext();
  const moderator = await signInAsNewHost(
    moderatorContext,
    baseURL!,
    "Mod Mia",
  );
  await db.gameAdmin.create({
    data: { userId: moderator.id, gameId: game.id, role: "moderator" },
  });

  const players = await Promise.all(
    ["Rude Name", "Bo"].map(async (nickname) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await joinFromLink(page, {
        code: game.code,
        gameId: game.id,
        nickname,
      });
      return { context, page };
    }),
  );
  const [rude, bo] = players as [
    (typeof players)[number],
    (typeof players)[number],
  ];

  // The host keeps the Players tab open while the moderator works.
  const hostDesk = await hostContext.newPage();
  await hostDesk.goto(`/game/${game.id}/admin`);
  await hostDesk.getByRole("tab", { name: "Players", exact: true }).click();
  await expect(
    hostDesk.getByTestId("roster-player").filter({ hasText: "Rude Name" }),
  ).toBeVisible();

  // Moderator renames and locks in one save.
  const modDesk = await moderatorContext.newPage();
  await modDesk.goto(`/game/${game.id}/admin`);
  await modDesk.getByRole("tab", { name: "Players", exact: true }).click();
  await modDesk.getByLabel("Find a player").fill("rude");
  await expect(modDesk.getByTestId("roster-player")).toHaveCount(1);
  await modDesk.getByRole("button", { name: "Rename Rude Name" }).click();
  await modDesk.getByLabel("New name").fill("Player One");
  await modDesk.getByLabel("Stop this player renaming themselves").check();
  await modDesk.getByRole("button", { name: "Save" }).click();
  // The dialog closes once the save lands; typing before that is lost.
  await expect(modDesk.getByRole("dialog")).toBeHidden();
  await modDesk.getByLabel("Find a player").fill("");
  await expect(modDesk.getByLabel("Find a player")).toHaveValue("");
  await expect(
    modDesk.getByTestId("roster-player").filter({ hasText: "Player One" }),
  ).toContainText("Name locked");

  // The player sees the new name live, and the lock with its reason.
  await expect(rude.page.getByTestId("player-identity")).toContainText(
    "You are Player One",
  );
  await rude.page.getByRole("tab", { name: "Info" }).click();
  await rude.page.getByRole("button", { name: "Edit my game profile" }).click();
  await expect(rude.page.getByLabel("Your name")).toBeDisabled();
  await expect(
    rude.page.getByText(
      "Your host has locked name changes for you. Ask them if it needs changing.",
    ),
  ).toBeVisible();
  await rude.page.keyboard.press("Escape");

  // The host's open desk shows the moderator's change without reloading.
  await expect(
    hostDesk.getByTestId("roster-player").filter({ hasText: "Player One" }),
  ).toContainText("Name locked");

  // The host gives Bo a recovery link; Bo uses it on a new device.
  await hostDesk
    .getByTestId("roster-player")
    .filter({ hasText: "Bo" })
    .getByRole("button", { name: "Recovery link" })
    .click();
  const link = await hostDesk.locator("#recovery-url").inputValue();
  const newDeviceContext = await browser.newContext();
  const newDevice = await newDeviceContext.newPage();
  await newDevice.goto(new URL(link).pathname);
  await expect(newDevice.getByText("You'll continue as Bo")).toBeVisible();
  await newDevice.getByRole("button", { name: "Continue as Bo" }).click();
  await newDevice.waitForURL(`**/game/${game.id}/user`);
  await expect(newDevice.getByTestId("player-identity")).toContainText(
    "You are Bo",
  );
  // The old device is signed out of the game.
  await bo.page.reload();
  await bo.page.waitForURL("**/join");
  // The link works only once.
  const again = await newDeviceContext.newPage();
  await again.goto(new URL(link).pathname);
  await expect(
    again.getByText("This link has already been used."),
  ).toBeVisible();

  // The moderator removes a player; their buzzer stops working at once.
  await modDesk.getByRole("button", { name: "Remove Player One" }).click();
  await modDesk.getByRole("button", { name: "Remove player" }).click();
  await expect(
    modDesk.getByTestId("roster-player").filter({ hasText: "Player One" }),
  ).toHaveCount(0);
  await rude.page.reload();
  await rude.page.waitForURL("**/join");

  await Promise.all(
    [
      hostContext,
      moderatorContext,
      newDeviceContext,
      ...players.map((p) => p.context),
    ].map((c) => c.close()),
  );
});
