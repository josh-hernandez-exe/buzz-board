/**
 * W03 (PR07): add helpers by invitation link, with the right desk per role,
 * and remove them.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createGameForHost, db, signInAsNewHost } from "./support";

test.afterAll(async () => {
  await db.$disconnect();
});

async function createInviteLink(desk: Page, role: "Co-host" | "Moderator") {
  await desk.getByRole("tab", { name: "Helpers" }).click();
  await desk.getByRole("radio", { name: role }).check();
  await desk.getByRole("button", { name: "Create invitation link" }).click();
  const input = desk.locator("#invite-url");
  await expect(input).toHaveValue(/\/invite\//);
  return new URL(await input.inputValue()).pathname;
}

async function acceptAs(
  context: BrowserContext,
  baseURL: string,
  name: string,
  path: string,
) {
  await signInAsNewHost(context, baseURL, name);
  const page = await context.newPage();
  await page.goto(path);
  await page.getByRole("button", { name: `Accept as ${name}` }).click();
  await page.waitForURL("**/admin");
  return page;
}

test("owner invites a co-host and a moderator, then removes the co-host", async ({
  browser,
  baseURL,
}) => {
  const ownerContext = await browser.newContext();
  const owner = await signInAsNewHost(ownerContext, baseURL!, "Owner Olu");
  const game = await createGameForHost(owner.id, {
    name: `Helpers ${Date.now()}`,
  });
  const desk = await ownerContext.newPage();
  await desk.goto(`/game/${game.id}/admin`);

  // A co-host invitation, opened first by someone who isn't signed in.
  const cohostPath = await createInviteLink(desk, "Co-host");
  const visitor = await browser.newContext();
  const preview = await visitor.newPage();
  await preview.goto(cohostPath);
  await expect(preview.getByText("You're invited as a Co-host.")).toBeVisible();
  await expect(
    preview.getByRole("link", { name: "Sign in to accept" }),
  ).toBeVisible();
  await visitor.close();

  const cohostContext = await browser.newContext();
  const cohostDesk = await acceptAs(
    cohostContext,
    baseURL!,
    "Cohost Cam",
    cohostPath,
  );
  await expect(cohostDesk.getByTestId("my-role")).toContainText(
    "You're the Co-host",
  );
  await cohostDesk.getByRole("button", { name: "Start Buzzer" }).click();
  await expect
    .poll(
      async () =>
        (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
          .isBuzzerListening,
    )
    .toBe(true);

  // The used link can't be used by anyone else.
  const lateContext = await browser.newContext();
  await signInAsNewHost(lateContext, baseURL!, "Late Lee");
  const late = await lateContext.newPage();
  await late.goto(cohostPath);
  await expect(
    late.getByText("This invitation has already been used."),
  ).toBeVisible();

  // A moderator gets a desk without game controls.
  const moderatorPath = await createInviteLink(desk, "Moderator");
  const moderatorContext = await browser.newContext();
  const moderatorDesk = await acceptAs(
    moderatorContext,
    baseURL!,
    "Mod Mia",
    moderatorPath,
  );
  await expect(moderatorDesk.getByTestId("my-role")).toContainText(
    "You're the Moderator",
  );
  await expect(
    moderatorDesk.getByRole("tab", { name: "Player Management" }),
  ).toBeVisible();
  await expect(
    moderatorDesk.getByRole("tab", { name: "Game Controls" }),
  ).toHaveCount(0);
  await expect(
    moderatorDesk.getByRole("button", { name: "Start Buzzer" }),
  ).toHaveCount(0);

  // The owner sees both helpers and removes the co-host.
  await desk.reload();
  await desk.getByRole("tab", { name: "Helpers" }).click();
  const cohostRow = desk
    .getByTestId("staff-helper")
    .filter({ hasText: "Cohost Cam" });
  await expect(cohostRow).toBeVisible();
  await expect(
    desk.getByTestId("staff-helper").filter({ hasText: "Mod Mia" }),
  ).toBeVisible();
  await cohostRow.getByRole("button", { name: "Remove" }).click();
  await expect(cohostRow).toHaveCount(0);

  // The removed co-host can no longer act, and reloading leaves the desk.
  await cohostDesk.getByRole("button", { name: "Pause Buzzer" }).click();
  await expect
    .poll(
      async () =>
        (await db.game.findUniqueOrThrow({ where: { id: game.id } }))
          .isBuzzerListening,
    )
    .toBe(true);
  await cohostDesk.reload();
  await cohostDesk.waitForURL("**/dashboard");

  await Promise.all(
    [ownerContext, cohostContext, moderatorContext, lateContext].map((c) =>
      c.close(),
    ),
  );
});
