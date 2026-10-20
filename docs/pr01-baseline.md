# PR01 baseline: inventory, toolchain and characterization

This is the recorded evidence for **PR01** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It describes the existing application. Nothing here is a behavior change, except the toolchain repairs and the one fix in [Intentional changes](#intentional-changes).

| Item | Value |
|---|---|
| Base | `development` at `ffa2cf1` (same snapshot the plan inspected) |
| Branch | `feature/game-kit-pr01-rebaseline` |
| Environment | Linux dev container, Node 22.16.0, Bun 1.4.3, Docker 29.9 · PostgreSQL 16-alpine and Redis 7-alpine via [docker-compose.test.yml](../docker-compose.test.yml) · Playwright Chromium (build 1248) |
| Schema impact | None. No Prisma schema or data changes. |
| Rollback | Revert the branch. No data or deployment is affected. |

## PR01 contract

- **Scope:** reproducible lint/typecheck/build on the installed Next.js 16, Vitest and Playwright foundations, disposable test services, characterization of existing flows, and a recorded baseline.
- **Dependency:** none (first PR).
- **Workflows/tests:** T05 (scores, history, buzzer) and T08 baseline (live state) in integration tests, T03/T06/T01 baselines (join, roster, scope), T09/T11 smoke in component and browser tests.
- **Non-goals:** fixing the characterized score/history/buzzer/stream defects (PR03/PR04), migration baseline or topology spike (PR02), UI or copy changes, dependency upgrades beyond what the toolchain needs, and deployment.

## Baseline before this PR

| Command | Result on `ffa2cf1` |
|---|---|
| `bun run lint` (`next lint`) | **Fails:** `Invalid project directory provided, no such directory: .../lint`. Next.js 16 removed `next lint`. |
| `bun run check` | **Fails** for the same reason. |
| `npx eslint .` | 0 errors, 5 warnings. This used the Next 15 `eslint-config-next` through `FlatCompat`. |
| `bun run typecheck` | Passes. |
| `bun run build` without Redis | **Never finishes** (stopped after 600 s). Prerendering awaits the module-level Redis `connect()`, which retries forever. |
| `bun run build` with Redis | Passes (compile 12.9 s). |
| Tests | None existed. There was no CI workflow. |

## Toolchain changes

- `eslint-config-next` changed from `^15.3.1` to `16.0.10`, matching the installed `next`. [eslint.config.js](../eslint.config.js) now uses its native flat config, and `@eslint/eslintrc`/`FlatCompat` are gone. `lint`, `lint:fix` and `check` now call `eslint .`.
- `typescript-eslint` and `@typescript-eslint/parser` went to `^8.46.0`, which `eslint-config-next@16` requires; a second copy caused "Cannot redefine plugin". `zod` went from 3.24.3 to `^3.25.76` because `eslint-plugin-react-hooks@7` imports `zod/v4/core`. This stays in the same Zod 3 line, and the app API is unchanged.
- The new React Compiler lint rules reported real issues, now fixed (see below). Five unnecessary type assertions were removed, and two checks were rewritten as optional chains.
- `tsconfig.json` now has `jsx: "react-jsx"` and includes `.next/dev/types`. Next 16 otherwise rewrites the file on every build. `allowImportingTsExtensions` was added for the explicit `.ts` imports in test configs.
- In development, tRPC adds 100–500 ms of artificial latency. That latency now applies only when `NODE_ENV=development`; before, `NODE_ENV=test` also triggered it, because tRPC's `isDev` is true for any non-production environment.
- New dev dependencies: Vitest 4, `@vitejs/plugin-react`, jsdom, React Testing Library (plus `user-event` and `jest-dom`), and `@playwright/test`. Storybook and Jest were deliberately not added.

## Baseline after this PR

| Command | Result |
|---|---|
| `bun run check` | Passes: 0 errors and 9 warnings. Warnings: 3 pre-existing `import/no-anonymous-default-export` in config files, 2 pre-existing unused imports, and 4 new advisory `react-hooks/incompatible-library` notes on TanStack Table usage. |
| `bun run test` | 3 files: 9 passed, 1 expected fail (~3 s). |
| `bun run test:integration` | 4 files: 33 passed, 3 expected fail (~18 s). |
| `bun run test:e2e` | 1 passed. The test itself takes ~22 s, ~31 s including `next dev` start-up. |
| `bun run build` (Redis up) | Passes (compile 11.6 s). |

The [CI workflow](../.github/workflows/ci.yml) runs the same commands against service containers. **It has not run yet**; it needs a push, which this PR did not make.

## Known defects (pinned with `it.fails`)

Each test is written with the correct expectation. Each was run as a normal `it` to confirm it fails for the stated reason.

| Defect | Evidence | Test | Planned fix |
|---|---|---|---|
| Concurrent score changes deadlock or are lost | 20 parallel `addScore(+1)` calls: 1 succeeded, 19 failed with PostgreSQL `40P01 deadlock detected` or Prisma transaction timeouts, and the final score was 1. Scores are read outside the transaction, and each insert takes an FK share lock on the scoreboard row before updating it. Errors reach the client as raw `PrismaClientUnknownRequestError`. | [scoreboard.test.ts](../tests/integration/scoreboard.test.ts) | PR03 |
| Redo after multiple undos jumps to the newest state | After 0 → 10 → 30, then undo and undo, the first redo returns 30, not 10. `undoScore` prepends to `futureStateIds`, but `redoScore` reads the last entry and drops the first, leaving the current state as a redo entry. | scoreboard.test.ts | PR03 |
| A score of 0 cannot be submitted | Add, Subtract and Set stay disabled when the value is 0, because `isScoreReady = numAffectedTeams > 0 && score`. "Set to 0" is impossible from the UI. | [GameAdminScoreboardAdvancedControl.test.tsx](../src/app/_components/client/GameAdminScoreboardAdvancedControl/GameAdminScoreboardAdvancedControl.test.tsx) | PR03 |
| Each closed subscription leaks a Redis connection | Redis client count went from 3 to 4 after a public `gameState` subscription was aborted. Every subscription duplicates the client and never quits it. | [liveState.test.ts](../tests/integration/liveState.test.ts) | PR04 |

## Characterized current behavior (may change on purpose later)

- **Silent account linking:** a signed-in user who presents a guest token is linked to that participant with no prompt ([roster.test.ts](../tests/integration/roster.test.ts)). Plan invariant 5 and PR08 require explicit linking.
- **Anonymous display has no sound cues:** the public scoreboard mounts `GameSoundEffects`, which subscribes to the member-only `gameGeneral.gameState` and is rejected (`UNAUTHORIZED`) for anonymous viewers. This is covered at the API level in liveState.test.ts. PR04.
- **Buzzer arbitration holds under a race:** six teams buzzing at once produce exactly one winner. Re-opening the buzzer rejects the previous winner, and reset clears everything. This is backed only by PostgreSQL, so there is no Redis dependency for the winner.
- **Joining and scoping:** join codes are case-insensitive, and guests are numbered by join order. An individual game creates one backing team per player and keeps its name in sync on rename. Admin and participant credentials are scoped to their own game.
- **Short codes allow one more repeat than configured:** the guard is `count > maxRepeat`, so `maxRepeat: 3` permits 4 ([codeGeneration.test.ts](../src/server/utils/codeGeneration.test.ts)).

## Static observations not yet covered by tests

- **Pages block without Redis:** with Redis unavailable, every page render blocks (a `/join` request took 55 s in `next dev`), because [events.ts](../src/server/utils/events.ts) top-level-awaits `redisClient.connect()`, which retries forever. PR04 should bound this.
- **Create-game format default mismatch:** `DropDownSelection` keeps the `defaultValue` (`team`) in internal state but never passes it to the Radix `Select`. `CreateGame` starts with `individual`, so submitting without choosing a format creates an **individual** game while the control shows the placeholder "Game Format". `checkIsReady` always ends with `setIsDataReady(false)`, so it does nothing. This belongs in the PR05 quick-create work.
- **Dashboard game list will hide multi-admin games:** `user.game.getAll` uses `gameAdmins: { every: { userId } }`. Once co-hosts exist (PR07), a game with two admins would only appear for its creator, and `every` also matches games with no admins. Today every game gets exactly one admin, so the current UI is unaffected.
- **README:** the production section told operators to run `prisma migrate reset`, which deletes all data. That instruction is replaced with a backup-then-`db push` warning. A reviewed migration baseline is PR02.
- **Test services:** in this environment the disposable containers were stopped externally once (exit 255) during the session. The integration global setup fails fast with a `bun test:services:up` hint, instead of hanging.

## Intentional changes

- **Join-by-link no longer retries forever:** an invalid code in `/join?code=` used to reset the "attempted" flag on error, which re-ran the auto-join effect in a loop. It was also flagged by `react-hooks/set-state-in-effect`. A ref now guards the auto-join, the user can retry with **Join Game**, and the redundant `setGameCode` is gone ([JoinGame.test.tsx](../src/app/_components/client/JoinGame/JoinGame.test.tsx)). The test fails on the old component and passes on the new one.
- **Dropdown no longer reassigns a prop:** `DropDownSelection` stopped reassigning its `options` prop (`react-hooks/immutability`). Rendering is unchanged.

## Not done in PR01 (explicitly)

- No fixes to the pinned defects; those belong to PR03 and PR04 with their own tests.
- No browser/proxy/two-instance SSE topology spike and no migration baseline; both are PR02.
- No 360-pixel, mobile or real-device evidence, and no load runs.
- No push, PR, deployment or provider change.
