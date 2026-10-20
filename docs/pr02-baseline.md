# PR02: migration baseline, explicit game scope and topology spike

This is the recorded evidence for **PR02** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR01](./pr01-baseline.md).

| Item          | Value                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Branch        | `feature/game-kit-pr02-migration-baseline` (from PR01)                                                                       |
| Environment   | Same dev container and disposable services as PR01                                                                           |
| Schema impact | None to tables. Adds `prisma/migrations/0_init`, which is exactly the existing schema.                                       |
| Rollback      | Revert the branch. A database that ran `db:baseline` keeps one extra row in `_prisma_migrations`, which the old app ignores. |

## PR02 contract

- **Scope:** a safe migration baseline and populated-upgrade rehearsal, explicit per-tab game scope, a per-game transaction primitive, and the browser, two-instance and SSE topology spike.
- **Workflows/tests:** T16 (migration/upgrade), T03/T01 (scope), T08 (topology evidence).
- **Non-goals:** score/history fixes (PR03); fixing the Redis leak, stream fan-out or the connection budget (PR04); proxy deployment; production changes.

## Migration baseline

- `prisma/migrations/0_init/migration.sql` was generated with `prisma migrate diff --from-empty --to-schema-datamodel`. It is exactly what `db push` created for the current schema.
- **Production must not use `migrate dev`.** The old `prod:db:migrate` script ran `prisma migrate dev`, which can prompt to reset a database. It now runs `prisma migrate deploy`. New scripts: `db:migrate:deploy`, `db:migrate:status` and `db:baseline`.
- **Existing deployments** (created with `db push`) run `db:baseline` once. It marks `0_init` as applied without changing tables. README has the backup-first steps.
- The devcontainer now runs `db:migrate:deploy` instead of `db:push`, and integration/browser tests reset with `migrate reset`, so every run exercises the checked-in migrations.

[migrations.test.ts](../tests/integration/migrations.test.ts) covers four things:

| Case              | Proof                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drift             | `migrate diff --from-migrations ... --to-schema-datamodel ... --exit-code` reports no difference. Adding a field to `schema.prisma` without a migration makes it fail; this was checked once by hand.                                                                |
| Fresh deploy      | `migrate deploy` on an empty database, then `migrate status` reports up to date.                                                                                                                                                                                     |
| Populated upgrade | A legacy database is seeded in the exact shape `ffa2cf1` writes, then baselined and deployed. Every legacy column (games, teams, players, admins, scoreboards, history) is identical before and after. The fixture includes a two-undo redo stack, which PR03 needs. |
| Ordering          | `0_init` is the first migration.                                                                                                                                                                                                                                     |

[legacyFixture.ts](../tests/support/legacyFixture.ts) inserts with raw SQL, so later schema changes cannot redefine "legacy". PR03 and later migrations reuse it to prove they preserve old games.

## Explicit game scope

**Defect (fixed):** tabs share cookies and `localStorage`. After a host opened game A and then game B, **reloading A's tab sent them to the dashboard**. Server pages scoped requests with the shared cookie (now B), and client requests reused B's ID from `localStorage`. Before a reload, A's client headers were correct, but any server-rendered call used B.

**Fix:**

- `gameAuth` scope precedence is now: an explicit route `gameId`, then the per-tab `x-buzz-board-*` headers, then cookies. Before this, cookies came first. It also stops treating a missing game as found (`findUnique` returns `null`, not `undefined`).
- Pages under `/game/[gameId]` pass their route ID and use a new `gameApi(gameId)` server caller.
- `useGameTokenData({ scopeGameId })` and the new `GameScope` component scope a tab's client requests and subscriptions to the page's game.

**Tests:**

- Four API cases in [roster.test.ts](../tests/integration/roster.test.ts): the tab's game wins over a stale cookie; another game's player cookie is ignored; cookie-only server renders still work; an unknown game ID is rejected.
- The browser test "a reloaded host tab keeps controlling its own game" in [multiTab.spec.ts](../tests/e2e/multiTab.spec.ts). The host selects A, then selects B, then reopens A from its URL and starts A's buzzer; B must be unaffected. Only one app tab is open at a time, so the connection-budget defect below cannot interfere.
- The API test and the browser test both fail on the PR01 code. The browser test shows the redirect to `/dashboard`.
- Browser tests open games through `selectGameFromDashboard`, which retries the **Select** click until navigation starts. A trace showed a click landing during hydration and being dropped, so the suite was intermittent without the retry. With the retry it passed 4 runs out of 4.

## Per-game transaction primitive

`withGameLock(gameId, work)` in [gameTransaction.ts](../src/server/db/gameTransaction.ts) runs `work` in one interactive transaction after `SELECT ... FOR UPDATE` on the game row, with a bounded `lock_timeout`, `maxWait` and `timeout`.

- **Return values:** neverthrow `Result`, with `gameNotFound` or `busy` (deadlock, serialization failure, lock timeout or transaction-start timeout).
- **Other errors:** errors thrown by `work` roll back and are rethrown unchanged. Unexpected database errors are rethrown rather than reported as success.
- **API mapping:** `gameTransactionErrorToTRPC` maps these to `NOT_FOUND` / `CONFLICT`.
- **Tests:** [gameTransaction.test.ts](../tests/integration/gameTransaction.test.ts) shows that 25 concurrent read-modify-writes serialize exactly (counter = 25), different games don't wait for each other, an unknown game never runs `work`, `work` errors roll back, and a held lock reports `busy` after the bound. Removing `FOR UPDATE` makes the serialization and busy tests fail.

PR03's score writer is its first consumer. PR02 does not change any existing endpoint to use it.

## Topology spike (measured, not fixed here)

### Streams per page (browser, `next dev`)

[connections.spec.ts](../tests/spike/connections.spec.ts) counts `text/event-stream` requests per page in Chromium. Run it with `RUN_SPIKES=1 bunx playwright test tests/spike`.

| Page                        | Peak open streams | Steady open | Subscriptions                                                                              |
| --------------------------- | ----------------- | ----------- | ------------------------------------------------------------------------------------------ |
| Host admin                  | 3                 | 3           | `gameGeneral.gameState` ×2, `gameGeneral.whoBuzzedIn`                                      |
| Anonymous public scoreboard | 4                 | 3           | `public.gameState` ×3 (one per team card), plus `gameGeneral.gameState`, which is rejected |
| Player                      | 6                 | 3           | `gameGeneral.gameState` from several components                                            |

- Every component calls `useSubscription` itself, so stream count grows with components rather than with views. The public page opens one stream per team: 8 teams means 8 streams.
- **Consequence:** HTTP/1.1 browsers allow 6 connections per host. With two admin tabs open for one game in the same browser, both pages render, but the first tab's **Start Buzzer** had still not committed after 15 s, because the click's request never got a connection. In an earlier run, the second tab could not finish loading within 20 s. Which symptom appears depends on timing, so this is recorded by the spike rather than pinned as a pass/fail test.
- The same budget applies to a host who keeps the admin page and the scoreboard display open in one browser over HTTP/1.1. HTTP/2 (typical behind Vercel or a TLS proxy) multiplexes these streams, but the local dev/`next start` servers are HTTP/1.1.
- PR04 must reduce this to **at most one gameplay stream per view** (plan, chat rule 3) by sharing one subscription per page.

### Two production instances sharing Redis

[twoInstance.ts](../tests/spike/twoInstance.ts) ran two `next start` instances (ports 3201/3202) on one Redis and one PostgreSQL, subscribed N clients per instance to `public.gameState`, and sent five score changes to instance 3201 only.

| Subscribers per instance | Delivered on 3201 | Delivered on 3202 | p50 / p95 / max (ms) | Redis connections added | Still open after all clients aborted |
| ------------------------ | ----------------- | ----------------- | -------------------- | ----------------------- | ------------------------------------ |
| 25                       | 125/125           | 125/125           | 29 / 73–82 / 85      | 50 (1 per subscriber)   | 50                                   |
| 100                      | 500/500           | 500/500           | 47–50 / 81–85 / 94   | 200 (1 per subscriber)  | 200                                  |

- **Cross-instance fan-out works:** state written through one instance reaches subscribers on the other, with a p95 under 100 ms at 200 local subscribers.
- **SSE response headers suit proxies:** `content-type: text/event-stream`, `cache-control: no-cache, no-transform` and `x-accel-buffering: no`. The tRPC server also pings every 2 s, which keeps idle proxies from closing the stream.
- **Redis connection cost is the limiting defect:** each subscription duplicates the Redis client, which is 1 connection per stream, and **none are released**. A 60-person event with about 3 streams each would hold about 180 connections and add more on every reconnect, until Redis `maxclients` (10,000 by default) or a managed plan's lower cap is hit. PR04 replaces this with one subscriber connection per server process and releases subscriptions on abort.

### Not measured

- A real reverse proxy (nginx or Vercel) between the browser and the app, and proxy idle timeouts.
- HTTP/2 connection behavior.
- Real phones.
- Redis-outage recovery, which is in PR04's scope.

## Commands and results

| Command                    | Result                                                                     |
| -------------------------- | -------------------------------------------------------------------------- |
| `bun run check`            | 0 errors, 9 warnings (unchanged from PR01)                                 |
| `bun run test`             | 9 passed, 1 expected fail                                                  |
| `bun run test:integration` | 6 files: 46 passed, 3 expected fail                                        |
| `bun run test:e2e`         | 2 passed in 4 consecutive runs                                             |
| `bun run build`            | Passes                                                                     |
| Spikes                     | Numbers above, from the reports in `test-results/`, which is not committed |

## Decisions for PR03/PR04

1. Score writes use `withGameLock`. A `busy` result maps to `CONFLICT` with a retry message, never a raw Prisma error.
2. PR04 shares one Redis subscriber connection per process and one gameplay stream per page, and releases both on abort. The two-instance spike will be re-run as its acceptance evidence.
3. Reference topology for now: any number of app instances behind HTTP/2 or TLS, plus one Redis and one PostgreSQL. Do not deploy during a live event. A rolling-deploy guarantee is not offered.
