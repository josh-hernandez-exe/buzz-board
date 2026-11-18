/**
 * Team captains in the browser (captains-only buzzing, handing the role on,
 * the host's view), and the shared question library (reuse a question on a
 * tile, see its uses, never delete one in use).
 */
import { expect, test, type Page } from "@playwright/test";

import { db, joinFromLink, signInAsNewHost } from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

test("captains-only: only the captain buzzes, and can hand the role on", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Captains ${Date.now()}`;
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!, "Captain Host");
  const desk = await hostContext.newPage();
  desk.on("dialog", (dialog) => void dialog.accept());
  await desk.goto("/dashboard");
  await desk.getByLabel("Game name").fill(gameName);
  await desk
    .getByRole("checkbox", { name: /^Only team captains can buzz/ })
    .check();
  await desk.getByRole("button", { name: "Create game" }).click();
  await desk.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({
    where: { name: gameName },
    include: { gameTeams: { orderBy: { index: "asc" } } },
  });
  expect(game.captainsOnly).toBe(true);

  // Automatic assignment: Ana and Cal share Team 1; Ana joined first.
  const players: Page[] = [];
  for (const nickname of ["Ana", "Ben", "Cal"]) {
    const page = await (await browser.newContext()).newPage();
    page.on("dialog", (dialog) => void dialog.accept());
    await joinFromLink(page, { code: game.code, gameId: game.id, nickname });
    players.push(page);
  }
  const [ana, , cal] = players as [Page, Page, Page];
  await expect(ana.getByTestId("player-captain")).toContainText(
    "You're the team captain",
  );
  await expect(cal.getByTestId("player-captain")).toContainText(
    "Ana is your team captain",
  );

  await desk.getByRole("button", { name: "Open buzzer" }).click();
  await expect(
    cal.getByRole("status").filter({ hasText: "only your captain" }),
  ).toHaveText("Buzzer open: only your captain, Ana, can buzz.");
  await expect(
    cal.getByRole("button", { name: "Buzz", exact: true }),
  ).toBeDisabled();
  await expect(
    ana.getByRole("button", { name: "Buzz", exact: true }),
  ).toBeEnabled();

  // Ana hands the captaincy to Cal from the Team tab.
  await ana.getByRole("tab", { name: "Team", exact: true }).click();
  await ana
    .getByTestId("team-captain")
    .getByRole("button", { name: "Make captain" })
    .click();
  await expect(cal.getByTestId("player-captain")).toContainText(
    "You're the team captain",
  );
  await cal.getByRole("button", { name: "Buzz", exact: true }).click();
  await expect(cal.getByText("You buzzed in first!")).toBeVisible();

  // The host sees the captain on the Players tab, and can switch it off.
  await desk.getByRole("tab", { name: "Players" }).click();
  await expect(
    desk.getByTestId("roster-player").filter({ hasText: "Cal" }),
  ).toContainText("★ Captain");
  await desk.getByRole("tab", { name: "Room" }).click();
  await desk.getByRole("switch", { name: /^Only team captains/ }).click();
  await expect(ana.getByTestId("player-captain")).toHaveCount(0);

  await hostContext.close();
  for (const page of players) await page.context().close();
});

test("captains-only quiz: a new captain can answer at once, without reloading", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Captain quiz ${Date.now()}`;
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!, "Quiz Captain Host");
  const desk = await hostContext.newPage();
  desk.on("dialog", (dialog) => void dialog.accept());
  await desk.goto("/dashboard");
  await desk.getByLabel("Game name").fill(gameName);
  await desk
    .getByRole("checkbox", { name: /^Only team captains can buzz/ })
    .check();
  await desk.getByRole("radio", { name: /^Sequential Quiz/ }).check();
  await desk.getByRole("button", { name: "Create game" }).click();
  await desk.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({ where: { name: gameName } });

  const players: Page[] = [];
  for (const nickname of ["Ana", "Ben", "Cal"]) {
    const page = await (await browser.newContext()).newPage();
    await joinFromLink(page, { code: game.code, gameId: game.id, nickname });
    players.push(page);
  }
  const [ana, , cal] = players as [Page, Page, Page];
  await desk.getByRole("button", { name: "Start quiz" }).click();
  await desk.getByRole("button", { name: "Open first question" }).click();
  await expect(cal.getByTestId("quiz-captain-answers")).toContainText(
    "Your captain, Ana, answers for the team.",
  );
  await expect(ana.getByRole("textbox", { name: "Team answer" })).toBeVisible();

  // The host makes Cal captain mid-question: both phones switch over live.
  await desk.getByRole("tab", { name: "Players" }).click();
  await desk
    .getByRole("button", { name: "Make Cal captain of Team 1" })
    .click();
  await cal.getByRole("textbox", { name: "Team answer" }).fill("Six");
  await cal.getByRole("button", { name: "Save answer" }).click();
  await expect(cal.getByTestId("quiz-answer-state")).toContainText(
    "Saved by Cal",
  );
  await expect(ana.getByTestId("quiz-captain-answers")).toContainText(
    "Your captain, Cal, answers for the team.",
  );
  await expect(ana.getByText("Saved: “Six” (by Cal)")).toBeVisible();

  await hostContext.close();
  for (const page of players) await page.context().close();
});

test("question library: reuse a question on a tile, uses shown, in-use never deleted", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Library ${Date.now()}`;
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!, "Library Host");
  const desk = await hostContext.newPage();
  desk.on("dialog", (dialog) => void dialog.accept());
  await desk.goto("/dashboard");
  await desk.getByLabel("Game name").fill(gameName);
  await desk.getByRole("radio", { name: /^Category Grid/ }).check();
  await desk.getByRole("button", { name: "Create game" }).click();
  await desk.waitForURL("**/admin");

  // Remove the bottom row: its written clues stay in the library, unused.
  await desk.getByRole("button", { name: "Remove bottom row" }).click();
  await desk.getByRole("button", { name: "Question library" }).click();
  const library = desk.getByTestId("question-library");
  await expect(library.getByRole("heading")).toHaveText(
    "Question library (25, 5 unused)",
  );
  await library.getByLabel("Show").selectOption("unused");
  await expect(library.getByTestId("library-question")).toHaveCount(5);

  // In use: can't be deleted.
  await library.getByLabel("Show").selectOption("all");
  await library.getByLabel("Search questions").fill("snowflake");
  const snowflake = library.getByTestId("library-question");
  await expect(snowflake).toHaveCount(1);
  await expect(snowflake.getByTestId("library-use")).toHaveText(
    "Grid: Winter Science 100",
  );
  await expect(
    snowflake.getByRole("button", { name: /^Delete/ }),
  ).toBeDisabled();

  // Put an unused clue on a tile instead.
  await desk
    .getByRole("button", { name: "Edit Winter Science for 100" })
    .click();
  await library.getByLabel("Search questions").fill("");
  await library.getByLabel("Show").selectOption("unused");
  const spare = library.getByTestId("library-question").first();
  const spareText = (await spare.locator("button").first().innerText()).split(
    "\n",
  )[0]!;
  await spare.getByRole("button", { name: /^Use for this tile/ }).click();
  await expect(
    desk.getByRole("button", { name: "Edit Winter Science for 100" }),
  ).toContainText(spareText.slice(0, 20));
  // The snowflake clue is kept, now unused, and can be deleted.
  await library.getByLabel("Search questions").fill("snowflake");
  await expect(library.getByTestId("library-question")).toContainText("Unused");
  await library.getByRole("button", { name: /^Delete/ }).click();
  await expect(library.getByTestId("library-question")).toHaveCount(0);

  await desk.getByRole("button", { name: "Save grid" }).click();
  await expect(desk.getByRole("button", { name: "Saved" })).toBeVisible();

  await hostContext.close();
});

test("two hosts edit the same setup: the second chooses keep mine or use theirs", async ({
  browser,
  baseURL,
}) => {
  const gameName = `Conflict ${Date.now()}`;
  const hostContext = await browser.newContext();
  await signInAsNewHost(hostContext, baseURL!, "Conflict Host");
  const first = await hostContext.newPage();
  first.on("dialog", (dialog) => void dialog.accept());
  await first.goto("/dashboard");
  await first.getByLabel("Game name").fill(gameName);
  await first.getByRole("radio", { name: /^Category Grid/ }).check();
  await first.getByRole("button", { name: "Create game" }).click();
  await first.waitForURL("**/admin");
  const second = await hostContext.newPage();
  second.on("dialog", (dialog) => void dialog.accept());
  await second.goto(first.url());

  // Both start editing the title; the first saves.
  await first.getByLabel("Grid title").fill("First host's title");
  await second.getByLabel("Grid title").fill("Second host's title");
  await first.getByRole("button", { name: "Save grid" }).click();
  await expect(first.getByRole("button", { name: "Saved" })).toBeVisible();

  // The second save is refused, with the choice instead of an error.
  await second.getByRole("button", { name: "Save grid" }).click();
  const conflict = second.getByTestId("draft-conflict");
  await expect(conflict).toContainText("Another host saved this setup");
  await expect(second.getByLabel("Grid title")).toHaveValue(
    "Second host's title",
  );
  await conflict.getByRole("button", { name: "Keep mine" }).click();
  await expect(second.getByRole("button", { name: "Saved" })).toBeVisible();
  await expect(conflict).toHaveCount(0);

  // The first host now has an unsaved edit, and takes theirs instead.
  await first.getByLabel("Grid title").fill("First again");
  await first.getByRole("button", { name: "Save grid" }).click();
  await first
    .getByTestId("draft-conflict")
    .getByRole("button", { name: "Use theirs" })
    .click();
  await expect(first.getByLabel("Grid title")).toHaveValue(
    "Second host's title",
  );
  await expect(first.getByRole("button", { name: "Saved" })).toBeVisible();

  await hostContext.close();
});
