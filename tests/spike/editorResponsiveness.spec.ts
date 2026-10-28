/**
 * Editor responsiveness with the plan's reference bank: 200 questions near
 * the 1 MiB limit, the largest grid (8 × 10) and four media items per clue.
 * Measures, with the browser's Event Timing API, how long each keystroke and
 * each tile selection takes to reach the next paint.
 *
 * Measure a production build, not `next dev`:
 *   bun run build && bunx next start --port 3100   (with the test services' env)
 *   E2E_PORT=3100 RUN_SPIKES=1 bunx playwright test tests/spike/editorResponsiveness
 * Writes test-results/editor-responsiveness.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  bankSchema,
  GRID_LIMITS,
  type Bank,
} from "@/utils/categoryGrid/content";
import { MAX_DRAFT_BYTES } from "@/utils/modes";

import { db, signInAsNewHost } from "../e2e/support";

test.setTimeout(300_000);

test.afterAll(async () => {
  await db.$disconnect();
});

const words = (n: number, seed: number) =>
  Array.from({ length: n }, (_v, i) => `word${(seed * 31 + i) % 997}`).join(
    " ",
  );

/** 200 questions, an 8 × 10 grid, four images per clue, just under 1 MiB. */
function referenceBank(): Bank {
  const { maxColumns, maxRows, maxQuestions } = GRID_LIMITS;
  const questions = Array.from({ length: maxQuestions }, (_v, i) => ({
    id: `q${i}`,
    prompt: {
      text: words(400, i),
      media: Array.from({ length: 4 }, (_m, k) => ({
        type: "image" as const,
        url: `https://example.invalid/media/${i}/${k}.png`,
        alt: `Picture ${k + 1} for question ${i}`,
      })),
    },
    answer: { text: `Answer ${i}`, acceptedAnswers: [`alt ${i}`] },
    hostNotes: words(120, i + 7),
  }));
  const columns = Array.from({ length: maxColumns }, (_c, ci) => ({
    id: `c${ci}`,
    title: `Category ${ci + 1}`,
    cells: Array.from({ length: maxRows }, (_r, ri) => ({
      label: String((ri + 1) * 100),
      points: (ri + 1) * 100,
      questionId: `q${ci * maxRows + ri}`,
    })),
  }));
  return bankSchema.parse({
    schemaVersion: 1,
    kind: "questionBank",
    title: "Reference bank",
    questions,
    modes: { categoryGrid: { columns } },
  });
}

/** Collects Event Timing entries, grouped per user interaction. */
async function startRecording(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __durations: Map<number, number> };
    w.__durations = new Map();
    new PerformanceObserver((list) => {
      // `interactionId` and `durationThreshold` are newer than these DOM types.
      type Entry = PerformanceEventTiming & { interactionId?: number };
      for (const e of list.getEntries() as Entry[]) {
        if (!e.interactionId) continue;
        const prev = w.__durations.get(e.interactionId) ?? 0;
        w.__durations.set(e.interactionId, Math.max(prev, e.duration));
      }
    }).observe({
      type: "event",
      durationThreshold: 16,
      buffered: false,
    } as PerformanceObserverInit);
  });
}

async function stopRecording(page: Page, interactions: number) {
  // Let the last paint land before reading.
  await page.waitForTimeout(500);
  const recorded = await page.evaluate(() => [
    ...(
      window as unknown as { __durations: Map<number, number> }
    ).__durations.values(),
  ]);
  // Interactions faster than the 16 ms threshold aren't reported: count them as 16.
  const all = [
    ...recorded,
    ...Array<number>(Math.max(0, interactions - recorded.length)).fill(16),
  ].sort((a, b) => a - b);
  const pct = (p: number) =>
    all[Math.min(all.length - 1, Math.ceil((p / 100) * all.length) - 1)] ?? 0;
  return {
    interactions,
    p50: pct(50),
    p95: pct(95),
    max: all.at(-1) ?? 0,
    over50ms: all.filter((d) => d > 50).length,
  };
}

type Cdp = Awaited<ReturnType<BrowserContext["newCDPSession"]>>;

/** Main-thread time by kind (script, style, layout), from Chrome's metrics. */
async function mainThread(cdp: Cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const get = (name: string) =>
    (metrics.find((m) => m.name === name)?.value ?? 0) * 1000;
  return {
    script: get("ScriptDuration"),
    style: get("RecalcStyleDuration"),
    layout: get("LayoutDuration"),
    task: get("TaskDuration"),
  };
}

async function typeInClue(page: Page, cdp: Cdp, text: string) {
  const clue = page.getByLabel("Clue (what everyone sees)");
  await clue.click();
  await clue.press("End");
  await startRecording(page);
  const before = await mainThread(cdp);
  for (const ch of text) await page.keyboard.type(ch, { delay: 60 });
  const after = await mainThread(cdp);
  const perKey = (k: keyof typeof before) =>
    Math.round((after[k] - before[k]) / text.length);
  return {
    ...(await stopRecording(page, text.length)),
    perKeyMs: {
      script: perKey("script"),
      style: perKey("style"),
      layout: perKey("layout"),
      allTasks: perKey("task"),
    },
  };
}

async function selectTiles(page: Page, count: number) {
  const cells = page.getByTestId("grid-editor-cell");
  await startRecording(page);
  for (let i = 0; i < count; i++) {
    await cells.nth((i * 13) % 80).click();
    await expect(page.getByLabel("Clue (what everyone sees)")).toBeVisible();
  }
  return stopRecording(page, count);
}

test("Category Grid editor with the 200-question, 1 MiB reference bank", async ({
  browser,
  baseURL,
}) => {
  const bank = referenceBank();
  const bytes = Buffer.byteLength(JSON.stringify(bank));
  expect(bytes).toBeLessThan(MAX_DRAFT_BYTES);
  expect(bytes).toBeGreaterThan(0.85 * MAX_DRAFT_BYTES);

  const context = await browser.newContext();
  await signInAsNewHost(context, baseURL!, "Perf Host");
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  const name = `Editor perf ${Date.now()}`;
  await page.goto("/dashboard");
  await page.getByLabel("Game name").fill(name);
  await page.getByRole("radio", { name: /^Category Grid/ }).check();
  await page.getByRole("button", { name: "Create game" }).click();
  await page.waitForURL("**/admin");
  const game = await db.game.findFirstOrThrow({ where: { name } });
  await db.gameMode.update({
    where: { gameId: game.id },
    data: { draft: bank, draftRevision: { increment: 1 } },
  });

  const mediaRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("example.invalid")) mediaRequests.push(r.url());
  });
  const loadStart = Date.now();
  await page.reload();
  await expect(page.getByTestId("grid-editor-cell")).toHaveCount(80);
  const loadMs = Date.now() - loadStart;
  // Give the page time to fetch anything on its own (live streams stay
  // open, so the network never goes idle).
  await page.waitForTimeout(2_000);
  const mediaRequestsOnLoad = mediaRequests.length;

  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const results: Record<string, unknown> = {
    baseURL,
    bankBytes: bytes,
    questions: bank.questions.length,
    loadToEditableMs: loadMs,
    // Only the selected question's media should load (4 images per clue).
    mediaRequestsOnLoad,
    userAgent: await page.evaluate(() => navigator.userAgent),
    cpus: (await import("node:os")).cpus().length,
  };
  for (const rate of [1, 4]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const label = rate === 1 ? "unthrottled" : `cpu÷${rate}`;
    results[`${label}: select tile`] = await selectTiles(page, 12);
    results[`${label}: type in clue`] = await typeInClue(
      page,
      cdp,
      "abcdefghij klmnopqrst",
    );
    await page.getByRole("button", { name: "Question library" }).click();
    results[`${label}: type in clue, library open`] = await typeInClue(
      page,
      cdp,
      "abcdefghij klmnopqrst",
    );
    await page.getByRole("button", { name: "Hide question library" }).click();
    await page.getByRole("button", { name: "Import or export" }).click();
    results[`${label}: type in clue, import/export open`] = await typeInClue(
      page,
      cdp,
      "abcdefghij klmnopqrst",
    );
    await page.getByRole("button", { name: "Hide import/export" }).click();
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  results.mediaRequestsAfter24TileSelections = mediaRequests.length;

  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/editor-responsiveness.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
});
