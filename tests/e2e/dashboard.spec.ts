/**
 * Host dashboard: games are listed with status and role, and the owner can
 * delete one (ending it for everyone if it's still in play). Players in a
 * deleted game are told, instead of their screen silently freezing.
 */
import { expect, test } from "@playwright/test";

import {
  createGameForHost,
  db,
  joinFromLink,
  signInAsNewHost,
} from "./support";

test("the owner deletes a game in play from the dashboard; its player is told", async ({
  browser,
  baseURL,
}) => {
  const hostContext = await browser.newContext();
  const host = await signInAsNewHost(hostContext, baseURL!, "Host Dana");
  const keep = await createGameForHost(host.id, { name: `Keep ${Date.now()}` });
  const doomed = await createGameForHost(host.id, {
    name: `Old quiz ${Date.now()}`,
  });

  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();
  await joinFromLink(player, {
    code: doomed.code,
    gameId: doomed.id,
    nickname: "Pat",
  });
  await db.game.update({
    where: { id: doomed.id },
    data: { status: "running" },
  });

  const dashboard = await hostContext.newPage();
  await dashboard.goto("/dashboard");
  const row = dashboard.getByRole("row").filter({ hasText: doomed.name });
  await expect(row).toContainText("Owner");
  await expect(row).toContainText("1 player");

  await row.getByRole("button", { name: `Delete ${doomed.name}` }).click();
  const dialog = dashboard.getByRole("dialog");
  await dialog.getByLabel("Game name to confirm deletion").fill(doomed.name);
  const confirm = dialog.getByRole("button", { name: "Delete forever" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /End it for everyone/ }).check();
  await confirm.click();

  await expect(
    dashboard.getByRole("row").filter({ hasText: doomed.name }),
  ).toHaveCount(0);
  await expect(
    dashboard.getByRole("row").filter({ hasText: keep.name }),
  ).toHaveCount(1);
  expect(await db.game.count({ where: { id: doomed.id } })).toBe(0);

  await expect(
    player.getByText("This game was deleted by its host."),
  ).toBeVisible();

  await Promise.all([hostContext.close(), playerContext.close()]);
});
