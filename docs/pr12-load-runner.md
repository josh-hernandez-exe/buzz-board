# PR12: mixed chat + buzzer load runner, 100-bot evidence, operations runbook

This is the recorded evidence for **PR12** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR11](./pr11-chat-ui.md) and covers T15 (runner tests and load) and the operations/cleanup runbook part of T16.

| Item          | Value                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| Branch        | `feature/game-kit-pr12-load-runner` (from PR11)                            |
| Schema impact | None.                                                                      |
| App change    | One: losing buzzes are answered without waiting for the game lock (below). |
| Rollback      | Redeploy PR11. The runner and runbook are tooling only.                    |

## What was built

- **Runner** ([scripts/load](../scripts/load)), `bun run load`: one Bun/TypeScript runner against the real endpoints, as the plan asks. The legacy k6 script stays as reference.
  - Bots join with their own tokens and hold the two streams a player page holds (`gameGeneral.gameState`, `chat.live`). They fetch changed channels through the real `chat.channel` query (the PR10 invalidation-plus-fetch path, not a benchmark-only body stream) and buzz when the buzzer opens.
  - Four more clients act as owner/coordinator, co-host, moderator (fetching the merged moderation feed on each pulse) and audience display. Streams reopen like the browser client's do if they drop.
  - Probes: mute (a muted bot is refused in chat but can still buzz), rename + lock/unlock, message removal, team move, reconnect, role change, and a per-bot privacy probe (another team's channel must be refused).
  - Details are in the [operations runbook](./operations.md#load-runner).
- **Profiles:** `smoke-10`, `mixed-100`, `soak-100` and the optional `capacity-1000-local`, with the plan's shapes and workload (6 teams, 128-byte messages every ~30 s, 80/20 team/everyone, a buzzer window every 10 s).
- **Interlocks:**
  - Loopback-only by default; remote targets need four explicit approvals and are still not executed here.
  - A dry run prints the plan before any traffic.
  - Finite ceilings stop the run.
  - Cleanup touches only the run's own game and users, on a database the runner has checked is a local test database.
- **Report:** SHA, runtime, hardware, topology and generator, plan, counts, latency percentiles from the runner's monotonic clock, targets, invariants, sanitized errors and 5-second samples (streams, PostgreSQL connections and lock waits, server CPU/RSS, runner RSS). Written to the git-ignored `load-results/`.
- **Operations runbook** ([operations.md](./operations.md)): scheduling `ops:cleanup` and what to alert on, running and reading the load runner, and backups. `ops:cleanup` now also reports `overdueBodies`, chat text that earlier runs should already have removed, so a missed schedule is visible.

## Evidence

All runs were local: `next start` (production build), PostgreSQL 16 and Redis 7 in Docker, and the runner on the same 4-vCPU (AMD EPYC 7763), 16 GB machine.

| Run                                     | Result                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `smoke-10`                              | All invariants and **all targets met**, 0 unexpected errors. Chat visible delivery p50 166 ms, p95 195 ms; buzz ack p95 76 ms. |
| `mixed-100` #1 (before the buzz change) | All invariants met, 0 unexpected errors, 0 stream drops. Latency targets **not** met (below).                                  |
| `mixed-100` #2 (after)                  | All invariants met, 0 unexpected errors, 0 stream drops. Latency improved but targets still **not** met.                       |

`mixed-100` #2 in detail (#1 in brackets where it differs):

| Measure                            | Value                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Clients, peak streams              | 104 clients, 207 streams (as estimated: 2 per bot, 2 per desk, 1 display)                             |
| Requests, bytes received           | 77,605 requests, 2.44 GB                                                                              |
| Messages                           | 2,402 accepted, all stored exactly once; 1 refused (the muted bot); 0 rate-limited                    |
| Buzzer                             | 85 windows, 85 winners, 85 durable claims; 1,149 teammate-held, 6,067 not-listening; scores reconcile |
| Live signal                        | 62,993 pulses, 65,843 channel fetches, 1,412 fetches coalesced by bots                                |
| Visible deliveries during the hold | 66,113 of 66,351 expected (99.6%; the rest were in flight when the hold ended)                        |
| Privacy probes                     | 100 attempted, 100 refused, 0 leaked                                                                  |
| Move probe                         | Moved bot's pulse listed its new team channel after 501 ms                                            |
| Reconnect probe                    | Current state 246 ms after reopening                                                                  |
| PostgreSQL                         | At most 7 connections, at most 4 sessions waiting on locks in any sample                              |
| Server process                     | Up to ~108% CPU (one core saturated), up to 546 MB RSS                                                |

| Latency (ms)             | p50       | p95           | p99           | Target               |
| ------------------------ | --------- | ------------- | ------------- | -------------------- |
| Buzz acknowledgment      | 621 [724] | 1,175 [1,416] | 1,263 [1,541] | p95 500              |
| Chat send acknowledgment | 117 [158] | 859 [1,057]   | 1,288 [1,393] | p95 500              |
| Chat visible delivery    | 669 [718] | 1,546 [1,756] | 2,091 [2,134] | p95 1,000, p99 2,000 |
| Channel fetch            | 296 [344] | 796 [882]     | 1,092 [1,222] |                      |

### The buzz change

Every buzz used to wait for the game's row lock, even though, once someone has won, all the others can only be told "not listening". With 100 people buzzing at once, those losing attempts queued behind each other. Now `buzzIn` first reads committed state without the lock. If that state already decides the answer, it replies at once: a retried claim, a team that holds or lost the buzz, a finished game, or a closed buzzer. Only attempts that could still win take the lock, which re-checks everything.

- **Why it's safe:** the early answers are exactly what the locked path would return for a request arriving at that moment.
- **Tests:** a new integration test holds the game lock and shows losing buzzes are still answered within a second. It **fails on the old code**, which blocked for 5 seconds. All 14 buzzer tests and the related lifecycle, live-state, roster and chat tests pass.

### Shortfall for owner review

On this hardware the mixed-100 latency targets aren't met; correctness is. The plan says to report a shortfall rather than weaken correctness or permissions, so here are the facts and the likely causes:

- **Server CPU is the limit.** The single `next start` process sits at about one full core during the hold, while PostgreSQL shows few lock waits. The buzz change confirmed it: removing the lock queue helped only modestly.
- **Likely costs (inferred from counts, not profiled):**
  - About 66,000 channel fetches, each returning the 50 newest messages, so most of the 2.4 GB is messages the bot already had.
  - Each game change serializes the full private game state (all 100 players) separately for each of 104 streams.
- **Generator shares the machine:** the runner, PostgreSQL and Redis run on the same 4 vCPUs, so the server had at most the remaining capacity.

Options, roughly by expected effect:

1. **Incremental chat fetch:** fetch messages after the last known sequence, with a separate small check for removals and pins.
2. **Serialize once per change:** fan out one serialized game-state snapshot to every stream.
3. **Run two instances:** the PR02/PR04 topology already supports more than one instance behind Redis notifications.
4. **Re-measure on production-like hardware**, with the runner on a separate machine.

None of these is needed for correctness, so they're left for a decision instead of being done speculatively here.

### Not run

- `soak-100` (60-minute hold): before an event, per the plan.
- `capacity-1000-local`: optional research. At these mixed-100 numbers it would hit the server's CPU limit early.
- Remote or provider load: not authorized and not implemented.
- A real backup-restore rehearsal, a non-creator pilot and T24 persona rehearsals: these need people and hosting decisions.

## Validation

- [loadRunner.test.ts](../tests/unit/loadRunner.test.ts) (T15, 11 tests): target interlocks, including look-alike hosts and every missing remote approval; profile shapes, including the plan's 3.33 and 33.33 messages a second; ceilings; seeded randomness; percentiles; and 128-byte synthetic messages.
- [buzzer.test.ts](../tests/integration/buzzer.test.ts): new lock-free losing-buzz test (above).
- **Full validation:** `bun run check` (0 errors, the 7 existing warnings); `bun run test:all` 28 files, 361 tests passed; browser suite 13 passed twice; production build passes (it is the build the second mixed-100 run used).
