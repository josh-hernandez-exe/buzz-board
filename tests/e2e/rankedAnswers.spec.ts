/**
 * Ranked Answers in the browser: a host loads sample boards, starts, and
 * runs a classic face-off board. Players and the audience display see each
 * answer only when it's revealed, and points land on the scoreboard.
 */
import { expect, test, type Page } from "@playwright/test";

import {
  createGameForHost,
  db,
  joinFromLink,
  signInAsNewHost,
} from "./support";

const acceptDialogs = (page: Page) =>
  page.on("dialog", (dialog) => void dialog.accept());

test("a host runs a Ranked Answers board; screens reveal answers only when found", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  const host = await signInAsNewHost(hostContext, baseURL!, "Host Kim");
  const game = await createGameForHost(host.id, {
    name: `Feud ${Date.now()}`,
  });
  const teams = await db.gameTeam.findMany({
    where: { gameId: game.id },
    orderBy: { index: "asc" },
  });

  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await joinFromLink(player, {
    code: game.code,
    gameId: game.id,
    nickname: "Rae",
  });

  const desk = await hostContext.newPage();
  acceptDialogs(desk);
  await desk.goto(`/game/${game.id}/admin`);
  await desk.getByRole("tab", { name: "Ranked Answers" }).click();
  await desk.getByRole("button", { name: "Load sample boards" }).click();
  await expect(desk.getByTestId("board-editor")).toHaveCount(5);
  await desk.getByRole("button", { name: "Save boards" }).click();
  await expect(desk.getByRole("button", { name: "Saved" })).toBeVisible();
  await desk.getByRole("button", { name: "Start Ranked Answers" }).click();

  const display = await browser.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);

  await desk.getByLabel("Next board").selectOption({
    label: "Things people hang on a holiday tree",
  });
  await desk.getByRole("button", { name: "Show this board" }).click();

  for (const page of [player, display]) {
    await expect(page.getByTestId("ranked-prompt")).toHaveText(
      "Things people hang on a holiday tree",
    );
    await expect(page.getByTestId("ranked-row")).toHaveCount(6);
    await expect(page.getByText("Lights")).toHaveCount(0);
  }
  // The host sees the hidden answers to judge them.
  await expect(desk.getByTestId("ranked-board")).toContainText("Lights");

  // Face-off: Team 1 buzzes first with "Ornaments"; Team 2 says something wrong.
  await desk
    .getByLabel("Team 1's answer")
    .selectOption({ label: "#2 Ornaments" });
  await desk
    .getByLabel("Team 2's answer")
    .selectOption({ label: "✕ Wrong / no answer" });
  await desk.getByRole("button", { name: "Record face-off" }).click();
  await desk.getByRole("button", { name: "Team 1 plays" }).click();
  await desk.getByRole("button", { name: "#1 Lights" }).click();

  for (const page of [player, display]) {
    await expect(page.getByTestId("ranked-board")).toContainText("Lights");
    await expect(page.getByTestId("ranked-board")).toContainText("Ornaments");
    await expect(page.getByTestId("ranked-bank")).toHaveText("62");
    await expect(page.getByText("Tinsel")).toHaveCount(0);
  }

  // Three strikes, then Team 2's steal misses: Team 1 takes the bank.
  for (let i = 1; i <= 3; i++) {
    await desk.getByRole("button", { name: "✕ Strike" }).click();
    await expect(display.getByLabel(`${i} of 3 strikes`)).toBeVisible();
  }
  await desk
    .getByLabel("Team 2's steal")
    .selectOption({ label: "✕ Wrong / no answer" });
  await desk.getByRole("button", { name: "Record steal" }).click();
  await expect(display.getByTestId("ranked-status")).toHaveText(
    "Team 1 takes the bank: 62 points",
  );

  await expect
    .poll(async () => {
      const state = await db.scoreboardState.findMany({
        where: { gameId: game.id },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      return (state[0]?.state as Record<string, number> | undefined)?.[
        teams[0]!.id
      ];
    })
    .toBe(62);

  await Promise.all([
    hostContext.close(),
    playerContext.close(),
    display.close(),
  ]);
});
