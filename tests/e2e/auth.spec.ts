import { expect, test } from "@playwright/test";

import { signInAsNewHost } from "./support";

test("dashboard redirects anonymous users to sign in", async ({ page }) => {
  await page.goto("/dashboard");

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
  await context.close();
});