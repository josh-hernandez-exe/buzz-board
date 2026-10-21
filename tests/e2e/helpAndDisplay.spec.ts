/**
 * W20/T19 (PR06): public Help works without signing in, and the app's
 * messages lead to it. W12 (PR06): the audience display is safe to share.
 */
import { expect, test } from "@playwright/test";

import { NAME_LIMITS } from "@/utils/displayName";
import { GAME_LIMITS } from "@/utils/gameRules";

import { createGameForHost, db, signInAsNewHost } from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

test("Help is public, searchable and shows facts from the app's rules", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Help" }).click();
  await expect(
    page.getByRole("heading", { name: "Help", level: 1 }),
  ).toBeVisible();

  // Search finds the article and the matching question.
  await page.getByLabel("Search Help").fill("closing page");
  const results = page.getByRole("list", { name: "Search results" });
  await expect(
    results.getByRole("link", { name: "Join a game and get back in" }),
  ).toBeVisible();
  await results
    .getByRole("link", { name: "How do I get back in after closing the page?" })
    .click();
  await expect(page).toHaveURL(
    /\/help\/join-and-resume#how-do-i-get-back-in-after-closing-the-page$/,
  );

  // Fact panels come from the same constants the server enforces.
  await expect(page.getByText("Rules at a glance")).toBeVisible();
  await expect(
    page.getByText(
      `Up to ${NAME_LIMITS.maxDisplayName} characters, including emoji`,
    ),
  ).toBeVisible();

  // Role landing pages list each article's questions.
  await page.goto("/help/for/host");
  await expect(
    page.getByRole("link", { name: "How do I finish the game?" }),
  ).toBeVisible();
  await page.goto("/help/host-quickstart");
  await expect(
    page.getByText(
      `${GAME_LIMITS.minTeams} to ${GAME_LIMITS.maxTeams} (default ${GAME_LIMITS.defaultTeams})`,
    ),
  ).toBeVisible();

  const missing = await page.goto("/help/not-an-article");
  expect(missing?.status()).toBe(404);
});

test("an error links to the Help that explains it", async ({ page }) => {
  await page.goto("/join?code=ZZZZZ9");
  await page.getByLabel("Nickname").fill("Ada");
  await page.getByRole("button", { name: "Join game" }).click();

  await expect(
    page.getByText("No game has that code. Check it with your host."),
  ).toBeVisible();
  const help = page.getByRole("link", { name: "What can I do?" });
  await expect(help).toHaveAttribute(
    "href",
    "/help/join-and-resume#why-cant-i-join",
  );
  await expect(help).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "Need help joining?" }),
  ).toHaveAttribute("href", "/help/join-and-resume");
});

test("the audience display shows the room safely, with sound off until turned on", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  const host = await signInAsNewHost(hostContext, baseURL!);
  const game = await createGameForHost(host.id, {
    name: `Display ${Date.now()}`,
  });
  const desk = await hostContext.newPage();
  await desk.goto(`/game/${game.id}/admin`);

  const displayContext = await browser.newContext();
  const display = await displayContext.newPage();
  await display.goto(`/game/${game.id}/scoreboard/public`);

  await expect(display.getByText("Audience display")).toBeVisible();
  await expect(display.getByTestId("display-status")).toHaveText(
    "Starting soon",
  );
  await expect(display.getByTestId("display-join-code")).toHaveText(game.code);
  await expect(
    display.getByRole("img", {
      name: `QR code to join with code ${game.code}`,
    }),
  ).toBeVisible();
  // No host controls or internal identifiers.
  for (const control of ["Open buzzer", "Finish game…", "Add", "Delete…"]) {
    await expect(display.getByRole("button", { name: control })).toHaveCount(0);
  }
  await expect(display.getByText(game.id)).toHaveCount(0);

  const sound = display.getByRole("button", { name: "Turn on sound" });
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(
    display.getByRole("button", { name: "Turn off sound" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Closing joining hides the code live.
  await desk.getByRole("tab", { name: "Room" }).click();
  await desk.getByLabel("Allow new players to join").click();
  await expect(display.getByTestId("display-join-code")).toHaveCount(0);

  await desk.getByRole("tab", { name: "Play", exact: true }).click();
  await desk.getByRole("button", { name: "Open buzzer" }).click();
  await expect(display.getByTestId("display-status")).toHaveText(
    "Buzzers are open!",
  );

  await desk.getByRole("tab", { name: "Room" }).click();
  await desk.getByRole("button", { name: "Finish game…" }).click();
  await desk.getByRole("button", { name: "Finish game", exact: true }).click();
  await expect(display.getByTestId("display-status")).toHaveText(
    "Final scores",
  );

  await Promise.all([hostContext.close(), displayContext.close()]);
});
