/**
 * Category Grid in the browser: created from the dashboard with the sample
 * grid, the desk opens on its tab, a team buzzes and answers, the screens
 * show the clue and then the answer, and the next pick goes to the winner.
 */
import { expect, test, type Page } from "@playwright/test";

import { db, joinFromLink, signInAsNewHost } from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

const acceptDialogs = (page: Page) =>
  page.on("dialog", (dialog) => void dialog.accept());

test("a host runs a Category Grid clue with the buzzer", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Grid ${Date.now()}`;
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!, "Grid Host");
  const desk = await hostContext.newPage();
  acceptDialogs(desk);

  await desk.goto("/dashboard");
  await desk.getByLabel("Game name").fill(gameName);
  await desk.getByRole("radio", { name: /^Category Grid/ }).check();
  await desk.getByRole("button", { name: "Create game" }).click();
  await desk.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({
    where: { name: gameName },
    include: { gameTeams: { orderBy: { index: "asc" } } },
  });
  await expect(
    desk.getByRole("tab", { name: "Category Grid" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(desk.getByRole("tab", { name: "Ranked Answers" })).toHaveCount(
    0,
  );
  await expect(desk.getByTestId("grid-editor-cell")).toHaveCount(25);

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

  await desk.getByRole("button", { name: "Start Category Grid" }).click();
  await expect(display.getByTestId("grid-board")).toBeVisible();
  await expect(display.getByTestId("grid-status")).toHaveText(
    "Team 1 picks next",
  );
  // Clues stay private until opened.
  await expect(display.getByText("snowflake")).toHaveCount(0);

  await desk.getByRole("gridcell", { name: "Winter Science for 100" }).click();
  for (const page of [display, ana]) {
    await expect(page.getByTestId("grid-prompt")).toHaveText(
      "How many sides does a typical snowflake have?",
    );
    await expect(page.getByTestId("grid-answer")).toHaveCount(0);
  }

  // Ben buzzes first; he answers wrongly and Team 2 is locked out.
  await desk.getByRole("button", { name: "Open buzzer" }).click();
  await ben.getByRole("button", { name: "Buzz", exact: true }).click();
  await expect(desk.getByLabel("Team answering")).toHaveValue(
    game.gameTeams[1]!.id,
  );
  await desk.getByRole("button", { name: "✕ Wrong: Team 2" }).click();
  await expect(display.getByLabel("Answers given")).toContainText("✕ Team 2");
  // The buzzer reopened for the others: Ana buzzes and is right.
  await ana.getByRole("button", { name: "Buzz", exact: true }).click();
  await expect(desk.getByLabel("Team answering")).toHaveValue(
    game.gameTeams[0]!.id,
  );
  await desk.getByRole("button", { name: /^✓ Correct: Team 1/ }).click();
  await expect(display.getByTestId("grid-answer")).toHaveText("Six");
  const team1 = display
    .getByTestId("display-team")
    .filter({ hasText: "Team 1" });
  await expect(team1.getByTestId("display-team-score")).toHaveText("100");

  await desk.getByRole("button", { name: "Back to the grid" }).click();
  await expect(display.getByTestId("grid-status")).toHaveText(
    "Team 1 picks next",
  );
  await expect(
    display.getByRole("gridcell", { name: "Winter Science for 100: played" }),
  ).toContainText("Team 1");

  await hostContext.close();
  for (const page of [...players, display]) await page.context().close();
});

test("Ranked Answers open answering: any team, any time, several at once", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Open ${Date.now()}`;
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!, "Open Host");
  const desk = await hostContext.newPage();
  acceptDialogs(desk);

  await desk.goto("/dashboard");
  await desk.getByLabel("Game name").fill(gameName);
  await desk.getByRole("button", { name: "More teams" }).click();
  await desk.getByRole("radio", { name: /^Ranked Answers/ }).check();
  // Suggested for three teams.
  await expect(
    desk.getByRole("radio", { name: /^Open answering/ }),
  ).toBeChecked();
  await desk.getByRole("button", { name: "Create game" }).click();
  await desk.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({ where: { name: gameName } });

  const display = await browser.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);
  await desk.getByRole("button", { name: "Start Ranked Answers" }).click();
  await desk.getByLabel("Next board").selectOption({
    label: "Things people hang on a holiday tree",
  });
  await desk.getByRole("button", { name: "Show this board" }).click();
  await expect(display.getByTestId("ranked-status")).toHaveText(
    "Shout it out! Any team can answer",
  );

  // Team 1 and Team 3 both said "Lights" (35 points each).
  const who = desk.getByRole("group", { name: "Teams that got it" });
  await who.getByRole("button", { name: "Team 1" }).click();
  await who.getByRole("button", { name: "Team 3" }).click();
  await desk.getByRole("button", { name: "#1 Lights" }).click();
  await expect(display.getByTestId("ranked-board")).toContainText("Lights");
  for (const [team, score] of [
    ["Team 1", "35"],
    ["Team 2", "0"],
    ["Team 3", "35"],
  ] as const) {
    await expect(
      display
        .getByTestId("display-team")
        .filter({ hasText: team })
        .getByTestId("display-team-score"),
    ).toHaveText(score);
  }
  // The choice clears for the next answer.
  await expect(who.getByRole("button", { name: "Team 1" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await hostContext.close();
  await display.context().close();
});

test("grid media: added in the editor, loaded only when the clue opens, failures shown", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Media ${Date.now()}`;
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!, "Media Host");
  const desk = await hostContext.newPage();
  acceptDialogs(desk);
  await desk.goto("/dashboard");
  await desk.getByLabel("Game name").fill(gameName);
  await desk.getByRole("radio", { name: /^Category Grid/ }).check();
  await desk.getByRole("button", { name: "Create game" }).click();
  await desk.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({ where: { name: gameName } });

  // Add a picture and a video to the first clue.
  await desk
    .getByRole("button", { name: "Edit Winter Science for 100" })
    .click();
  const clueMedia = desk.getByRole("group", { name: /^Clue media/ });
  await clueMedia.getByRole("button", { name: "+ Picture" }).click();
  await desk.getByLabel("Media 1 link").fill("https://media.invalid/flake.png");
  await desk.getByLabel("Media 1 description").fill("A snowflake up close");
  await clueMedia.getByRole("button", { name: "+ YouTube" }).click();
  await desk.getByLabel("Media 2 link").fill("https://example.com/not-youtube");
  await expect(
    desk.getByTestId("media-row").getByText(/isn't a YouTube video link/),
  ).toBeVisible();
  await desk
    .getByLabel("Media 2 link")
    .fill("https://youtu.be/dQw4w9WgXcQ?si=tracking");
  await desk.getByLabel("Media 2 label").fill("Snow falling");
  await desk.getByRole("button", { name: "Save grid" }).click();
  await expect(desk.getByRole("button", { name: "Saved" })).toBeVisible();

  const display = await browser.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);
  await desk.getByRole("button", { name: "Start Category Grid" }).click();
  await expect(display.getByTestId("grid-board")).toBeVisible();
  // Nothing loads while the grid is showing.
  await expect(display.locator("img[src*='flake.png']")).toHaveCount(0);
  await expect(display.getByTestId("media-block")).toHaveCount(0);

  await desk.getByRole("gridcell", { name: "Winter Science for 100" }).click();
  const media = display.getByTestId("media-block");
  await expect(media).toBeVisible();
  // The address can't resolve: the failure is shown, with Retry.
  await expect(
    media.getByText('Couldn\'t load the picture "A snowflake up close".'),
  ).toBeVisible();
  await expect(media.getByRole("button", { name: "Retry" })).toBeVisible();
  // The video waits for a click, then embeds from the privacy domain.
  await media.getByRole("tab", { name: /Snow falling/ }).click();
  await expect(display.locator("iframe")).toHaveCount(0);
  await media.getByRole("button", { name: /Load video/ }).click();
  await expect(display.locator("iframe")).toHaveAttribute(
    "src",
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/,
  );

  await hostContext.close();
  await display.context().close();
});
