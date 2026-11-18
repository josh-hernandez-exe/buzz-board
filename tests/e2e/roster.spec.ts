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

test("a host confirms a balanced shuffle and can unlock player switching beside it", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  const host = await signInAsNewHost(hostContext, baseURL!);
  const game = await createGameForHost(host.id, {
    name: `Random teams ${Date.now()}`,
    teams: 2,
  });
  const teams = await db.gameTeam.findMany({
    where: { gameId: game.id },
    orderBy: { index: "asc" },
  });
  const players = [];
  for (const nickname of ["Ada", "Bo", "Cy"]) {
    const context = await browser.newContext();
    if (nickname === "Bo")
      await signInAsNewHost(context, baseURL!, "Bo's account");
    const page = await context.newPage();
    await joinFromLink(page, { code: game.code, gameId: game.id, nickname });
    const participant = await db.gameUser.findFirstOrThrow({
      where: { gameId: game.id, name: nickname },
    });
    await page.getByRole("tab", { name: "Team", exact: true }).click();
    if (participant.gameTeamId !== teams[0]!.id) {
      await page
        .getByRole("button", { name: "Join Team 1", exact: true })
        .click();
    }
    await expect(page.getByTestId("player-identity")).toContainText(
      `You are ${nickname} on Team 1`,
    );
    players.push({ context, page, nickname, id: participant.id });
  }
  const desk = await hostContext.newPage();
  await desk.goto(`/game/${game.id}/admin`);
  await desk.getByRole("tab", { name: "Players", exact: true }).click();
  await desk
    .getByRole("button", { name: "Randomly assign teams", exact: true })
    .click();
  const dialog = desk.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Assign randomly", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByLabel("Lock player team switching after assignment"),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await db.gameUser.count({
      where: { gameId: game.id, gameTeamId: teams[0]!.id },
    }),
  ).toBe(3);
  expect(
    await db.gameOperation.count({
      where: { gameId: game.id, action: "roster.randomizeTeams" },
    }),
  ).toBe(0);

  await desk
    .getByRole("button", { name: "Randomly assign teams", exact: true })
    .click();
  await dialog
    .getByLabel("I understand this replaces everyone's current team.")
    .check();
  await dialog
    .getByRole("button", { name: "Assign randomly", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    desk.getByText("Teams assigned randomly.", { exact: true }),
  ).toBeVisible();
  const memberships = await db.gameUser.findMany({
    where: { gameId: game.id },
  });
  expect(
    teams
      .map((team) => memberships.filter((p) => p.gameTeamId === team.id).length)
      .sort(),
  ).toEqual([1, 2]);
  const switching = desk.getByRole("switch", { name: "Toggle team switching" });
  await expect(switching).toHaveAttribute("aria-checked", "false");
  for (const { page, nickname, id } of players) {
    const team = teams.find(
      (team) => team.id === memberships.find((p) => p.id === id)?.gameTeamId,
    )!;
    await expect(page.getByTestId("player-identity")).toContainText(
      `You are ${nickname} on ${team.name}`,
    );
    await expect(page.getByText("Teams are locked for now.")).toBeVisible();
  }
  await switching.click();
  await expect(switching).toHaveAttribute("aria-checked", "true");
  const player = players[0]!;
  const other = teams.find(
    (team) =>
      team.id !== memberships.find((p) => p.id === player.id)?.gameTeamId,
  )!;
  await player.page
    .getByRole("button", { name: `Join ${other.name}`, exact: true })
    .click();
  await expect(player.page.getByTestId("player-identity")).toContainText(
    `You are Ada on ${other.name}`,
  );
  await player.page.getByRole("tab", { name: "Buzzer", exact: true }).click();
  await desk.getByRole("tab", { name: "Play", exact: true }).click();
  await desk.getByRole("button", { name: "Open buzzer", exact: true }).click();
  await expect(player.page.getByText("Buzzer open: press now!")).toBeVisible();
  await player.page.getByRole("button", { name: "Buzz", exact: true }).click();
  await expect(player.page.getByText("You buzzed in first!")).toBeVisible();
  await Promise.all([
    hostContext.close(),
    ...players.map(({ context }) => context.close()),
  ]);
});

test("players choose surviving teams after deletion, including after switching is unlocked", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  const host = await signInAsNewHost(hostContext, baseURL!);
  const game = await createGameForHost(host.id, {
    name: `Team removal ${Date.now()}`,
    teams: 3,
  });
  const desk = await hostContext.newPage();
  await desk.goto(`/game/${game.id}/admin`);
  await desk.getByRole("tab", { name: "Players", exact: true }).click();

  const players = [];
  for (const [nickname, signedIn, destination] of [
    ["Ada", false, "Team 1"],
    ["Bo", true, "Team 2"],
  ] as const) {
    const context = await browser.newContext();
    if (signedIn) await signInAsNewHost(context, baseURL!, "Bo's account");
    const page = await context.newPage();
    await joinFromLink(page, { code: game.code, gameId: game.id, nickname });
    await expect(
      page.getByRole("button", { name: "Save this player to my account" }),
    ).toHaveCount(signedIn ? 1 : 0);
    await page.getByRole("tab", { name: "Team", exact: true }).click();
    await page
      .getByRole("button", { name: "Join Team 3", exact: true })
      .click();
    await expect(page.getByTestId("player-identity")).toContainText(
      `You are ${nickname} on Team 3`,
    );
    const participant = await db.gameUser.findFirstOrThrow({
      where: { gameId: game.id, name: nickname },
    });
    players.push({ context, page, nickname, destination, participant });
  }

  await desk
    .getByRole("button", { name: "Delete Team 3", exact: true })
    .click();
  await desk.getByRole("button", { name: "Delete team", exact: true }).click();
  for (const { page, nickname, destination, participant } of players) {
    await expect(page.getByTestId("player-identity")).toContainText(
      `You are ${nickname} without a team yet`,
    );
    await expect(
      page.getByRole("button", { name: "Join Team 3", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: `Join ${destination}`, exact: true })
      .click();
    await expect(page.getByTestId("player-identity")).toContainText(
      `You are ${nickname} on ${destination}`,
    );
    expect(
      await db.gameUser.findUniqueOrThrow({ where: { id: participant.id } }),
    ).toMatchObject({ token: participant.token, removedAt: null });
    await page.getByRole("tab", { name: "Buzzer", exact: true }).click();
  }

  await desk.getByRole("tab", { name: "Play", exact: true }).click();
  for (const { page } of players) {
    await desk
      .getByRole("button", { name: "Open buzzer", exact: true })
      .click();
    await expect(page.getByText("Buzzer open: press now!")).toBeVisible();
    await page.getByRole("button", { name: "Buzz", exact: true }).click();
    await expect(page.getByText("You buzzed in first!")).toBeVisible();
    await desk
      .getByRole("button", { name: "Next question", exact: true })
      .click();
  }

  await desk.getByRole("tab", { name: "Players", exact: true }).click();
  const switching = desk.getByRole("switch", { name: "Toggle team switching" });
  await switching.click();
  await expect(switching).toHaveAttribute("aria-checked", "false");
  await desk
    .getByRole("button", { name: "Delete Team 1", exact: true })
    .click();
  await desk.getByRole("button", { name: "Delete team", exact: true }).click();
  const ada = players[0]!.page;
  await expect(ada.getByTestId("player-identity")).toContainText(
    "You are Ada without a team yet",
  );
  await ada.getByRole("tab", { name: "Team", exact: true }).click();
  await expect(ada.getByText("Teams are locked for now.")).toBeVisible();
  await expect(
    ada.getByRole("button", { name: "Join Team 2", exact: true }),
  ).toHaveCount(0);

  await switching.click();
  await expect(switching).toHaveAttribute("aria-checked", "true");
  await ada.getByRole("button", { name: "Join Team 2", exact: true }).click();
  await expect(ada.getByTestId("player-identity")).toContainText(
    "You are Ada on Team 2",
  );
  expect(await db.gameUser.count({ where: { gameId: game.id } })).toBe(2);
  await ada.getByRole("tab", { name: "Buzzer", exact: true }).click();
  await desk.getByRole("tab", { name: "Play", exact: true }).click();
  await desk.getByRole("button", { name: "Open buzzer", exact: true }).click();
  await expect(ada.getByText("Buzzer open: press now!")).toBeVisible();
  await ada.getByRole("button", { name: "Buzz", exact: true }).click();
  await expect(ada.getByText("You buzzed in first!")).toBeVisible();

  await Promise.all([
    hostContext.close(),
    ...players.map(({ context }) => context.close()),
  ]);
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
