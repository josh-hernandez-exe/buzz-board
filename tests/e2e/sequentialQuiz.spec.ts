/**
 * Sequential Quiz in the browser: created from the dashboard with sample
 * questions, teams type answers on their phones (a teammate sees the saved
 * answer), the display shows only who answered, the host locks, marks and
 * reveals, and points land on the scoreboard.
 */
import { expect, test, type Page } from "@playwright/test";

import { db, joinFromLink, signInAsNewHost } from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

test("a host runs a quiz question with typed team answers", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Quiz ${Date.now()}`;
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!, "Quiz Host");
  const desk = await hostContext.newPage();
  desk.on("dialog", (dialog) => void dialog.accept());

  await desk.goto("/dashboard");
  await desk.getByLabel("Game name").fill(gameName);
  await desk.getByRole("radio", { name: /^Sequential Quiz/ }).check();
  await desk.getByRole("button", { name: "Create game" }).click();
  await desk.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({
    where: { name: gameName },
    include: { gameTeams: { orderBy: { index: "asc" } } },
  });
  await expect(desk.getByRole("tab", { name: "Quiz" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(desk.getByRole("tab", { name: "Category Grid" })).toHaveCount(0);
  await expect(desk.getByTestId("quiz-editor-question")).toHaveCount(10);

  const players: Page[] = [];
  for (const [nickname, team] of [
    ["Ana", 0],
    ["Ben", 1],
    ["Cal", 0],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await joinFromLink(page, { code: game.code, gameId: game.id, nickname });
    await db.gameUser.updateMany({
      where: { gameId: game.id, name: nickname },
      data: { gameTeamId: game.gameTeams[team]!.id },
    });
    await page.reload();
    players.push(page);
  }
  const [ana, ben, cal] = players as [Page, Page, Page];
  const display = await browser.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);

  await desk.getByRole("button", { name: "Start quiz" }).click();
  await expect(display.getByTestId("quiz-status")).toHaveText(
    "Get ready for the first question",
  );
  await desk.getByRole("button", { name: "Open first question" }).click();
  for (const page of [display, ana, ben]) {
    await expect(page.getByTestId("quiz-prompt")).toHaveText(
      "How many sides does a typical snowflake have?",
    );
  }
  await expect(display.getByTestId("quiz-status")).toHaveText(
    "Answer on your phones! 0 of 2 answered",
  );

  // Ana saves her team's answer; Cal, on the same team, sees it.
  await ana.getByRole("textbox", { name: "Team answer" }).fill("6 sides");
  await ana.getByRole("button", { name: "Save answer" }).click();
  await expect(ana.getByTestId("quiz-answer-state")).toContainText(
    "Saved by Ana",
  );
  await expect(cal.getByRole("textbox", { name: "Team answer" })).toHaveValue(
    "6 sides",
  );
  await expect(
    cal.getByRole("button", { name: "Replace answer" }),
  ).toBeVisible();
  await expect(display.getByTestId("quiz-status")).toHaveText(
    "Answer on your phones! 1 of 2 answered",
  );
  // Nobody else sees what a team typed.
  await expect(display.getByText("6 sides")).toHaveCount(0);
  await expect(ben.getByText("6 sides")).toHaveCount(0);

  await desk.getByRole("button", { name: "Lock answers" }).click();
  await expect(ben.getByText("Answers are locked.")).toBeVisible();
  const responses = desk.getByTestId("quiz-responses");
  await expect(responses).toContainText("6 sides");
  await responses.getByRole("button", { name: "Mark Team 1 correct" }).click();
  await responses.getByRole("button", { name: "Mark the rest wrong (1)" }).click();
  await desk
    .getByRole("button", { name: "Reveal answer", exact: true })
    .click();

  await expect(display.getByTestId("quiz-answer")).toHaveText("Six");
  await expect(display.getByTestId("quiz-status")).toHaveText("1 team got it!");
  await expect(
    display
      .getByTestId("display-team")
      .filter({ hasText: "Team 1" })
      .getByTestId("display-team-score"),
  ).toHaveText("1");
  await expect(ana.getByTestId("quiz-verdict")).toHaveText(
    "✓ Your team got it! +1",
  );
  await expect(ben.getByTestId("quiz-verdict")).toHaveText(
    "Your team didn't answer this one.",
  );
  await expect(
    desk.getByRole("button", { name: "Next question" }),
  ).toBeVisible();

  await hostContext.close();
  for (const page of [...players, display]) await page.context().close();
});
