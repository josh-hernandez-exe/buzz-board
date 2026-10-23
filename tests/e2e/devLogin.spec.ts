/**
 * Development-only sign-in: "Host a game" leads to the test accounts, and
 * signing in as one lands on its dashboard; signing out works as usual.
 */
import { expect, test } from "@playwright/test";

test("sign in as a ready-made dev account, then sign out", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Host a game" }).click();
  await expect(page).toHaveURL(/\/dev-login\?callbackUrl=%2Fdashboard/);
  await expect(page.getByText("Development only.")).toBeVisible();

  await page.getByRole("button", { name: "Sign in as Dev Host 2" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Signed in as Dev Host 2")).toBeVisible();

  await page.goto("/api/auth/signout");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dev-login/);
});
