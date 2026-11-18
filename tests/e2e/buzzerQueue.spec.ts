/**
 * Queued buzzing: three teams buzz in order, the host marks answers wrong
 * and right, players and the audience display follow along, and an
 * accidental "Next question" is undone.
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

test("queued buzzing: wrong, next in line, correct, and undo", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  const host = await signInAsNewHost(hostContext, baseURL!, "Queue Host");
  const game = await createGameForHost(host.id, {
    name: `Queue ${Date.now()}`,
    teams: 3,
    buzzerMode: "queue",
  });
  const teams = await db.gameTeam.findMany({
    where: { gameId: game.id },
    orderBy: { index: "asc" },
  });

  const players = [];
  for (const [i, nickname] of ["Ana", "Ben", "Cat"].entries()) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await joinFromLink(page, { code: game.code, gameId: game.id, nickname });
    await db.gameUser.updateMany({
      where: { gameId: game.id, name: nickname },
      data: { gameTeamId: teams[i]!.id },
    });
    await page.reload();
    players.push({ context, page });
  }
  const [ana, ben, cat] = players.map((p) => p.page) as [
    (typeof players)[number]["page"],
    (typeof players)[number]["page"],
    (typeof players)[number]["page"],
  ];

  const displayContext = await browser.newContext();
  const display = await displayContext.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);

  const desk = await hostContext.newPage();
  await desk.goto(`/game/${game.id}/admin`);
  await expect(desk.getByLabel("Buzzing mode")).toHaveValue("queue");
  await desk.getByRole("button", { name: "Open buzzer" }).click();
  await expect(
    ana.getByText("Buzzer open: press to join the queue!"),
  ).toBeVisible();

  // Buzzes line up in the order they arrive.
  const entries = desk.getByTestId("queue-entry");
  for (const [n, page] of [ana, ben, cat].entries()) {
    await page.getByRole("button", { name: "Buzz", exact: true }).click();
    await expect(entries).toHaveCount(n + 1);
  }
  const headline = desk.getByTestId("buzzer-headline");
  await expect(headline).toHaveText("Ana (Team 1) is answering");
  await expect(ana.getByText("You're answering!")).toBeVisible();
  await expect(ben.getByText("You're next in line.")).toBeVisible();
  await expect(cat.getByText("You're 3rd in line.")).toBeVisible();
  await expect(display.getByTestId("display-status")).toHaveText(
    "Team 1 is answering",
  );

  // Wrong: Team 1 sits out and Ben answers next.
  await desk.getByRole("button", { name: "Wrong: Ana (Team 1)" }).click();
  await expect(headline).toHaveText("Ben (Team 2) is answering");
  await expect(
    ana.getByText("Not this time: your team sits out until the next question."),
  ).toBeVisible();
  await expect(ben.getByText("You're answering!")).toBeVisible();
  await expect(cat.getByText("You're next in line.")).toBeVisible();

  // Correct: the buzzer closes and the host awards points in one tap.
  await desk.getByRole("button", { name: "Correct: Ben (Team 2)" }).click();
  await expect(headline).toHaveText("Ben (Team 2) got it!");
  await expect(desk.getByTestId("buzzer-open-state")).toHaveText("Closed");
  await expect(display.getByTestId("display-status")).toHaveText(
    "Team 2 got it!",
  );
  await desk.getByRole("button", { name: "Award 1 to Team 2" }).click();
  const team2 = display
    .getByTestId("display-team")
    .filter({ hasText: "Team 2" });
  await expect(team2.getByTestId("display-team-score")).toHaveText("1");

  // An accidental Next question is undone, queue and all.
  await desk.getByRole("button", { name: "Next question" }).click();
  await expect(entries).toHaveCount(0);
  await desk.getByRole("button", { name: "Undo: Next question" }).click();
  await expect(entries).toHaveCount(3);
  await expect(headline).toHaveText("Ben (Team 2) got it!");
  await expect(
    desk.getByRole("button", { name: "Redo: Next question" }),
  ).toBeEnabled();

  // A fresh question: everyone can buzz again.
  await desk.getByRole("button", { name: "Redo: Next question" }).click();
  await expect(entries).toHaveCount(0);
  await desk.getByRole("button", { name: "Open buzzer" }).click();
  await expect(
    ana.getByRole("button", { name: "Buzz", exact: true }),
  ).toBeEnabled();

  await Promise.all([
    hostContext.close(),
    displayContext.close(),
    ...players.map((p) => p.context.close()),
  ]);
});
