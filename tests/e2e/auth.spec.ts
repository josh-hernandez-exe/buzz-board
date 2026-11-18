import { expect, test } from "@playwright/test";

import { signInAsNewHost } from "./support";

test("dashboard redirects anonymous users to sign in", async ({ page }) => {
  await page.goto("/dashboard");

  // The e2e server runs with DEV_LOGIN=1, so sign-in starts at the dev page,
  // which links on to the real Discord/Google sign-in.
  await expect(page).toHaveURL(/\/dev-login\?callbackUrl=%2Fdashboard/);
  await page
    .getByRole("link", { name: "Use real sign-in (Discord or Google)" })
    .click();
  await expect(page).toHaveURL(/\/api\/auth\/signin\?callbackUrl=/);
});

test("a database-backed session can access the dashboard", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  await signInAsNewHost(context, baseURL!, "Auth Test Host");

  const page = await context.newPage();
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "My games" })).toBeVisible();
  // A new host with no games is pointed at the host guide, in place.
  await expect(page.getByTestId("no-games")).toContainText("New to hosting?");
  await expect(
    page.getByRole("link", { name: "Read the host guide" }),
  ).toHaveAttribute("href", "/help/host-quickstart");
  await context.close();
});
