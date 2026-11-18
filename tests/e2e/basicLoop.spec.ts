/**
 * The buzzer-and-scoreboard loop for guest and signed-in players, including
 * reconnecting without losing identity or scores.
 */
import { expect, test } from "@playwright/test";

import { db, joinFromLink, signInAsNewHost } from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

for (const signedIn of [false, true]) {
  test(`a ${signedIn ? "signed-in player" : "guest"} can play and resume`, async ({
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
    await expect(
      host.getByRole("button", { name: "Open buzzer" }),
    ).toBeVisible();

    const playerContext = await browser.newContext();
    const account = signedIn
      ? await signInAsNewHost(playerContext, baseURL!, "Private Account Name")
      : undefined;
    const player = await playerContext.newPage();
    await joinFromLink(player, {
      code: game.code,
      gameId: game.id,
      nickname: "Ada",
    });
    const buzzer = player.getByRole("button", { name: "Buzz", exact: true });
    await expect(buzzer).toBeVisible();
    await expect(player.getByTestId("player-identity")).toContainText(
      "You are Ada",
    );
    await expect(
      player.getByRole("button", { name: "Save this player to my account" }),
    ).toHaveCount(signedIn ? 1 : 0);
    const participant = await db.gameUser.findFirstOrThrow({
      where: { gameId: game.id, name: "Ada" },
    });

    // An anonymous display shows the public scoreboard.
    const displayContext = await browser.newContext();
    const display = await displayContext.newPage();
    await display.goto(`/game/${game.id}/scoreboard/public`);
    const card = display.getByTestId("display-team").filter({ hasText: "Ada" });
    await expect(card.getByTestId("display-team-score")).toHaveText("0");

    // Host opens the buzzer; the player buzzes; the display marks them selected.
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

    if (account) {
      await db.session.updateMany({
        where: { userId: account.id },
        data: { expires: new Date(0) },
      });
    }
    await player.reload();
    await expect(player.getByTestId("player-identity")).toContainText(
      "You are Ada",
    );
    await expect(
      player.getByRole("button", { name: "Save this player to my account" }),
    ).toHaveCount(0);
    await player.goto(`/join?code=${game.code}`);
    await player.getByRole("button", { name: "Resume as Ada" }).click();
    await player.waitForURL(`**/game/${game.id}/user`);
    await expect(player.getByTestId("player-identity")).toContainText(
      "You are Ada",
    );
    expect(await db.gameUser.findMany({ where: { gameId: game.id } })).toEqual([
      expect.objectContaining({ id: participant.id }),
    ]);
    await expect(card.getByTestId("display-team-score")).toHaveText("5");

    await host
      .getByRole("button", { name: "Next question", exact: true })
      .click();
    await host.getByRole("button", { name: "Open buzzer" }).click();
    await expect(player.getByText("Buzzer open: press now!")).toBeVisible();
    await buzzer.click();
    await expect(player.getByText("You buzzed in first!")).toBeVisible();

    await Promise.all([
      hostContext.close(),
      playerContext.close(),
      displayContext.close(),
    ]);
  });
}
