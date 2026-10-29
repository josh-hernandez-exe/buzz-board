/**
 * The event's rehearsal script on the real host desk: four teams take
 * turns (round robin, 11 - rank points), the host presses the answer the
 * team gave or "Wrong / pass", and the player page and the display follow.
 * Set SCREENSHOT_DIR to save a screenshot after each stage.
 */
import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

import {
  createGameForHost,
  db,
  joinFromLink,
  signInAsNewHost,
} from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

const M39 = [
  "TikTok",
  "Instagram",
  "Discord",
  "Snapchat",
  "Teams",
  "Facebook",
  "Slack",
  "LinkedIn",
  "Zoom",
];
const answers = (list: string[]) =>
  list.map((text) => ({
    id: text.toLowerCase().replaceAll(" ", "-"),
    text,
    aliases: [],
  }));

const content = {
  rules: {
    playStyle: "roundRobin",
    pointValuesByRank: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    multiplier: 1,
    strikes: 3,
    turnCycles: 3,
    allPlayRounds: 1,
    faceOffMethod: "none",
    endOnEmptyCycle: true,
  },
  boards: [
    {
      id: "m39",
      role: "main",
      prompt: "how to set pronouns on",
      answers: answers(M39),
    },
    {
      id: "words",
      role: "main",
      prompt: "gender neutral word for",
      answers: answers([
        "aunt or uncle",
        "sportsmanship",
        "chairman",
        "mankind",
      ]),
    },
  ],
};

async function shot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR;
  if (dir)
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test("the event script on the host desk: turns, judging and scores", async ({
  browser,
  baseURL,
}) => {
  const consoleProblems: string[] = [];
  const watch = (
    target: {
      on: (e: "console", f: (m: ConsoleMessage) => void) => unknown;
    },
    who: string,
  ) =>
    target.on("console", (m) => {
      if (m.type() === "error") {
        consoleProblems.push(`${who}: ${m.text().slice(0, 400)}`);
      }
    });
  const hostContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  watch(hostContext, "desk");
  const host = await signInAsNewHost(hostContext, baseURL!, "Event Host");
  const game = await createGameForHost(host.id, {
    name: `Event ${Date.now()}`,
    teams: 4,
  });
  const teams = await db.gameTeam.findMany({
    where: { gameId: game.id },
    orderBy: { index: "asc" },
  });
  for (const [i, t] of teams.entries()) {
    await db.gameTeam.update({
      where: { id: t.id },
      data: { name: `Team ${"ABCD"[i]}` },
    });
  }
  await db.gameMode.create({
    data: {
      gameId: game.id,
      kind: "rankedAnswers",
      status: "draft",
      draft: content,
      draftRevision: 1,
    },
  });

  const playerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  watch(playerContext, "player");
  const player = await playerContext.newPage();
  await joinFromLink(player, {
    code: game.code,
    gameId: game.id,
    nickname: "Rae",
  });
  const display = await browser.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);

  watch(display, "display");
  const desk = await hostContext.newPage();
  desk.on("dialog", (d) => void d.accept());
  await desk.goto(`/game/${game.id}/admin`);
  await desk.getByRole("tab", { name: "Ranked Answers" }).click();
  await desk.getByRole("button", { name: "Start Ranked Answers" }).click();
  await desk
    .getByLabel("Next board")
    .selectOption({ label: "how to set pronouns on" });
  await desk.getByRole("button", { name: "Show this board" }).click();

  const turn = (team: string, n: number) =>
    expect(
      desk
        .getByTestId("ranked-controls")
        .getByText(`${team}'s turn (${n} of 12)`),
    ).toBeVisible();
  const wrong = () =>
    desk.getByRole("button", { name: "✕ Wrong / pass" }).click();
  const pick = (label: string) =>
    desk.getByRole("button", { name: label, exact: true }).click();

  await turn("Team A", 1);
  await expect(desk.getByTestId("ranked-board")).toContainText("Zoom");
  await expect(player.getByTestId("ranked-row")).toHaveCount(9);
  await expect(player.getByText("TikTok")).toHaveCount(0);
  await shot(desk, "01-desk-board-open");
  // No buzzer in this format: the phone shows whose turn it is instead.
  await expect(player.getByTestId("turn-card")).toHaveText(
    "Your team's turn! Say your answer.",
  );
  await expect(player.getByRole("button", { name: "Buzz" })).toHaveCount(0);
  await shot(player, "01b-player-your-turn");

  await pick("#1 TikTok"); // A +10
  await turn("Team B", 2);
  await expect(player.getByTestId("turn-card")).toHaveText(
    "Team B's turn. No buzzer: wait for your team's turn.",
  );
  // A repeat has no button any more: it's a miss.
  await expect(desk.getByRole("button", { name: "#1 TikTok" })).toHaveCount(0);
  await wrong(); // B: TikTok again
  await turn("Team C", 3);
  await wrong(); // C: Spotify
  await wrong(); // D: pass
  await turn("Team A", 5);
  await pick("#2 Instagram"); // A +9
  await pick("#9 Zoom"); // B +2
  await wrong(); // C: timeout
  // D answers with the keyboard: 5 is #5.
  await turn("Team D", 8);
  await desk.keyboard.press("5"); // D +6
  await turn("Team A", 9);

  for (const page of [player, display]) {
    const board = page.getByTestId("ranked-board");
    for (const seen of ["TikTok", "Instagram", "Teams", "Zoom"]) {
      await expect(board).toContainText(seen);
    }
    for (const hidden of [
      "Discord",
      "Snapchat",
      "Facebook",
      "Slack",
      "LinkedIn",
    ]) {
      await expect(board).not.toContainText(hidden);
    }
  }
  const scores = async () => {
    const [state] = await db.scoreboardState.findMany({
      where: { gameId: game.id },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    const s = (state?.state ?? {}) as Record<string, number>;
    return teams.map((t) => s[t.id] ?? 0);
  };
  await expect.poll(scores).toEqual([19, 2, 0, 6]);
  await shot(desk, "02-desk-after-eight-turns");
  await shot(display, "03-display-after-eight-turns");
  await shot(player, "04-player-after-eight-turns");

  // Close, reveal the rest for 0, and move on: scores stay, Team B starts.
  await desk.getByRole("button", { name: "Close board" }).click();
  await desk
    .getByRole("button", { name: "Reveal remaining answers (0 points)" })
    .click();
  await expect(display.getByTestId("ranked-board")).toContainText("LinkedIn");
  await expect.poll(scores).toEqual([19, 2, 0, 6]);
  await shot(display, "05-display-revealed");
  await desk
    .getByLabel("Next board")
    .selectOption({ label: "gender neutral word for" });
  await desk.getByRole("button", { name: "Show this board" }).click();
  await turn("Team B", 1);

  // A full cycle with nothing new closes the board.
  for (let i = 0; i < 4; i++) await wrong();
  await expect(display.getByTestId("ranked-status")).toHaveText(
    "Board over: a full round found nothing new",
  );
  await expect(
    desk.getByRole("button", { name: "Reveal remaining answers (0 points)" }),
  ).toBeVisible();
  await expect.poll(scores).toEqual([19, 2, 0, 6]);
  await shot(desk, "06-desk-empty-cycle-closed");
  // `next dev` can log a false hydration warning (see tests/README.md).
  expect(consoleProblems.filter((m) => !/hydrat/i.test(m))).toEqual([]);
});
