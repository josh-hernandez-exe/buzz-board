/**
 * Ranked Answers rules chosen at game creation: a host creates a 3-team
 * game with queued buzzing and the Buzz race rules, and the host desk opens
 * on Ranked Answers with sample boards. Players race for each answer: the
 * desk pre-selects whoever holds the buzz, and recording the answer marks
 * the buzzer too.
 */
import { expect, test, type Page } from "@playwright/test";

import { db, joinFromLink, signInAsNewHost } from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

const acceptDialogs = (page: Page) =>
  page.on("dialog", (dialog) => void dialog.accept());

test("rules chosen at creation: a buzz race with queued buzzing", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Race ${Date.now()}`;
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!, "Race Host");
  const desk = await hostContext.newPage();
  acceptDialogs(desk);

  await desk.goto("/dashboard");
  await desk.getByLabel("Game name").fill(gameName);
  await desk.getByRole("button", { name: "More teams" }).click();
  await desk.getByRole("radio", { name: /^Queue/ }).check();
  await desk.getByRole("radio", { name: /^Ranked Answers/ }).check();
  await desk.getByRole("radio", { name: /^Buzz race/ }).check();
  await desk.getByRole("button", { name: "Create game" }).click();
  await desk.waitForURL("**/admin");

  const game = await db.game.findFirstOrThrow({
    where: { name: gameName },
    include: { gameTeams: { orderBy: { index: "asc" } }, gameMode: true },
  });
  expect(game.buzzerMode).toBe("queue");
  expect(game.gameTeams).toHaveLength(3);
  expect(game.gameMode?.draft).toMatchObject({
    rules: { playStyle: "buzzRace", raceLockout: "untilNextFind" },
  });

  // The desk opens on Ranked Answers, with the rules and sample boards ready.
  await expect(
    desk.getByRole("tab", { name: "Ranked Answers" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(desk.getByRole("radio", { name: /^Buzz race/ })).toBeChecked();
  await expect(desk.getByTestId("board-editor")).toHaveCount(5);

  const players: Page[] = [];
  for (const [i, nickname] of ["Ana", "Ben"].entries()) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await joinFromLink(page, { code: game.code, gameId: game.id, nickname });
    await db.gameUser.updateMany({
      where: { gameId: game.id, name: nickname },
      data: { gameTeamId: game.gameTeams[i]!.id },
    });
    await page.reload();
    players.push(page);
  }
  const [ana, ben] = players as [Page, Page];
  const display = await browser.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);

  await desk.getByRole("button", { name: "Start Ranked Answers" }).click();
  await desk.getByLabel("Next board").selectOption({
    label: "Things people hang on a holiday tree",
  });
  await desk.getByRole("button", { name: "Show this board" }).click();
  await expect(display.getByTestId("ranked-status")).toHaveText(
    "Buzz in to answer!",
  );

  // Race for the first answer: Ana buzzes, the desk pre-selects her team.
  await desk.getByRole("button", { name: "Open buzzer" }).click();
  await ana.getByRole("button", { name: "Buzz", exact: true }).click();
  await expect(desk.getByLabel("Team answering")).toHaveValue(
    game.gameTeams[0]!.id,
  );
  await desk.getByRole("button", { name: "#1 Lights" }).click();
  await expect(display.getByTestId("ranked-board")).toContainText("Lights");
  const team1 = display
    .getByTestId("display-team")
    .filter({ hasText: "Team 1" });
  await expect(team1.getByTestId("display-team-score")).toHaveText("35");
  // The buzzer was marked too: Team 1's buzz is Correct.
  await expect
    .poll(
      async () =>
        (
          await db.buzzQueueEntry.findFirst({
            where: { gameId: game.id, gameTeamId: game.gameTeams[0]!.id },
          })
        )?.status,
    )
    .toBe("correct");

  // Next answer: opening starts a fresh question. Ben is wrong and sits out.
  await desk.getByRole("button", { name: "Open buzzer" }).click();
  await ben.getByRole("button", { name: "Buzz", exact: true }).click();
  await expect(desk.getByLabel("Team answering")).toHaveValue(
    game.gameTeams[1]!.id,
  );
  await desk.getByRole("button", { name: "✕ Wrong: Team 2" }).click();
  await expect(display.getByTestId("ranked-status")).toHaveText(
    "Buzz in to answer! Sitting out: Team 2",
  );
  await expect(
    ben.getByText("Not this time: your team sits out until the next question."),
  ).toBeVisible();

  await hostContext.close();
  for (const page of [...players, display]) await page.context().close();
});
