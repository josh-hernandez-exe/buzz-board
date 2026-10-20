# PR04: durable buzzer claim and live-state streams

This is the recorded evidence for **PR04** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR03](./pr03-baseline.md). With PR04 the plan's **corrected-core gate** is met.

| Item          | Value                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch        | `feature/game-kit-pr04-buzzer-streams` (from PR03)                                                                                                                                                    |
| Schema impact | Additive migration `20261020130000_buzz_claims`: `Game.buzzerWindow INTEGER DEFAULT 0` and a new `BuzzClaim` table.                                                                                   |
| Rollback      | Redeploy the PR03 app. It ignores `BuzzClaim`, still reads `GameTeam.buzzerState`, and its Redis channels differ, so the two versions should not run side by side. Do not deploy during a live event. |

## PR04 contract

- **Scope:** a durable, database-enforced buzz winner; one gameplay stream per page; bounded Redis use and release on disconnect; reconnect and Redis-loss recovery; sound for anonymous displays; a clear status when live updates stop.
- **Workflows/tests:** T05 (one durable winner under Redis loss), T08 baseline, T11/T12 (displays).
- **Non-goals:** chat and private invalidation channels (PR09/PR10), staff roles (PR07), roster guards (PR08), UI redesign (PR05).

## Durable buzzer claim

- **Winner record:** `buzzIn` in [buzzerService.ts](../src/server/buzzer/buzzerService.ts) runs under `withGameLock`. It re-reads the game, participant and team under the lock instead of trusting the request context, which was loaded before the lock. In one transaction it then:
  1. inserts a `BuzzClaim` (participant ID, the team at claim time, optional request ID, window number);
  2. marks the team `selected`;
  3. closes listening.
- **One winner per window:** `@@unique([gameId, window])` enforces this in PostgreSQL, so the lock is not the only safeguard. Opening and resetting the buzzer increment `buzzerWindow`, also under the lock.
- **Retries:** a retried `requestId` from the same participant is acknowledged (`replayed: true`) even after the window closed, without a second claim. The same ID from another participant gets `CONFLICT`. Pre-PR04 tabs that send no ID still work.
- **Winner always comes from PostgreSQL:** `getBuzzWinner` reads the current window's claim. A `selected` team without a claim (left by pre-PR04 code) is reported as team-only (`gameUserId: null`), never as an invented player.
- **Team at claim time:** moving the winner afterwards does not change which team won.
- **Private state:** member pages now get `buzzWinner` inside the private game state, so they no longer need a separate `whoBuzzedIn` stream. That procedure remains for tabs opened before the deploy, now loaded from the claim.

## Live streams

**Before** (PR02 spike): every component opened its own stream. That meant 3–6 per page, the member-only stream was rejected on anonymous displays, and **every stream held its own Redis connection, which was never released**. Two admin tabs in one browser could not both act over HTTP/1.1.

**After:**

- **Notifications only:** [gameChangeBus.ts](../src/server/live/gameChangeBus.ts) sends "game changed" notifications through Redis, with no state payload. Listeners reload authoritative state from PostgreSQL, so lost, duplicated or reordered messages are harmless and private data never travels through Redis.
- **Fixed connection count:** each server process uses one subscriber and one publisher connection, whatever the number of streams.
- **Shared reads:** [gameFeed.ts](../src/server/live/gameFeed.ts) gives all subscribers to one game in a process a single loader. Reads never overlap, and bursts coalesce, so each subscriber holds only the newest snapshot. Snapshots arrive in commit order.
- **Disconnect:** when a client disconnects, its stream ends without error. When the last stream for a game ends, the Redis channel is unsubscribed.
- **Local delivery:** changes made by a process reach that process's own streams directly, so a single instance keeps updating while Redis is down.
- **Redis reconnects:** after the subscriber reconnects, every open game is reloaded, because notifications may have been missed.
- **Startup does not wait for Redis:** pages and requests no longer block on Redis. The old top-level `await redisClient.connect()` blocked every render when Redis was down; PR01 measured 55 s for `/join`.
- **First publish:** each process's first publish waits up to 1 s for the initial connection. This is the only Redis wait on a request path.
- **One stream per page:** pages get it through `LiveGameStateProvider` (inside `GameScope`) or `PublicLiveGameStateProvider`. When the stream is reconnecting or has stopped, the page shows a banner ("Reconnecting… scores and buzzers may be out of date" / "Live updates stopped. Reload the page to reconnect.").
- **Display sound:** the anonymous public scoreboard plays buzz sounds from the public stream (`PublicGameSoundEffects`).
- **Removed:** the Redis state caches, which could serve stale state after an outage, and `asyncGenerator.ts`.

## Defect found while measuring, and fixed

The first two-instance run on the PR04 build delivered rounds 2–5 to the second instance, but **never round 1**: 400/500, identically in two runs. The publisher connected lazily with `disableOfflineQueue`, so each process's first publish was rejected while its connection was still opening.

Integration tests had missed this because publisher and subscriber ran in one process, where delivery is local. A new two-bus test ("delivers a process's first change to another process") reproduced it (0 received). The fix waits once, for at most 1 s, for the initial connection, and fails fast after that.

## Evidence

| Case                                                                                                                                                | Test                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A claim records the participant and the team at claim time; moving the winner does not rewrite it                                                   | [buzzer.test.ts](../tests/integration/buzzer.test.ts)                                              |
| A second claim for the same window is rejected by PostgreSQL (`P2002`)                                                                              | buzzer.test.ts                                                                                     |
| A retried winning buzz is acknowledged after the window closed; the same ID from another player gets `CONFLICT`                                     | buzzer.test.ts                                                                                     |
| 5 rounds of 4 teams buzzing while the host reopens and resets concurrently: never more than one `selected` team, and one claim per window           | buzzer.test.ts                                                                                     |
| A pre-PR04 `selected` team is reported as team-only; reopen and reset clear the winner                                                              | buzzer.test.ts                                                                                     |
| After Redis `FLUSHALL`, the winner is still correct in the state query and in the `whoBuzzedIn` stream                                              | [liveState.test.ts](../tests/integration/liveState.test.ts)                                        |
| 20 streams use **no extra Redis connections** and one channel subscription; after disconnect, subscribers drop to 0 and the channel is unsubscribed | liveState.test.ts (replaces the PR01 `it.fails` leak test)                                         |
| A waiting stream ends within 1 s of disconnect                                                                                                      | liveState.test.ts                                                                                  |
| 5 streams × 20 concurrent changes: each sees non-decreasing scores and ends on the final value                                                      | liveState.test.ts                                                                                  |
| After `CLIENT KILL TYPE pubsub`, a change whose notification was lost still reaches open streams                                                    | liveState.test.ts                                                                                  |
| With Redis unreachable, the process's own streams still update, and later notifies do not wait                                                      | liveState.test.ts                                                                                  |
| A process's first change reaches another process                                                                                                    | liveState.test.ts                                                                                  |
| Winner card wording: you, teammate, other team, individual, legacy team-only, moved winner, listening/not                                           | [GameWhoBuzzedIn.test.tsx](../src/app/_components/client/GameWhoBuzzedIn/GameWhoBuzzedIn.test.tsx) |
| Admin, player and anonymous display each hold exactly one stream; the display no longer calls the member stream                                     | [liveStreams.spec.ts](../tests/e2e/liveStreams.spec.ts)                                            |
| Two admin tabs for one game in one browser: one starts the buzzer, the other sees it and pauses it                                                  | liveStreams.spec.ts                                                                                |

### Measurements

[connections.spec.ts](../tests/spike/connections.spec.ts), Chromium against `next dev`:

| Page                                               | PR02 peak/steady streams                            | PR04 peak/steady streams                                                  |
| -------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| Host admin                                         | 3 / 3                                               | 1 / 1                                                                     |
| Anonymous public scoreboard                        | 4 / 3 (one per team, plus a rejected member stream) | 1 / 1                                                                     |
| Player                                             | 6 / 3                                               | 2 / 1 (development double-mount; the extra stream is aborted immediately) |
| Two admin tabs: first tab's Start Buzzer committed | not within 15 s                                     | 850 ms                                                                    |

[twoInstance.ts](../tests/spike/twoInstance.ts), two `next start` instances, 100 public subscribers each, 5 changes sent to instance 3201:

| Run                               | Delivered on 3201 | Delivered on 3202            | p50 / p95 (ms) | Redis connections for 200 streams           | Channel subscriptions after all disconnect |
| --------------------------------- | ----------------- | ---------------------------- | -------------- | ------------------------------------------- | ------------------------------------------ |
| PR02                              | 500/500           | 500/500                      | 47–50 / 81–85  | 200 (+1 per stream, never released)         | not measured (connections leaked)          |
| PR04 before the first-publish fix | 500/500           | **400/500** (round 1 missed) | 37–39 / 40–69  | 2                                           | 0                                          |
| PR04 final (two runs)             | 500/500           | 500/500                      | 46–56 / 93–107 | 2, plus 1 publisher on the writing instance | 0                                          |

p95 rose by about 15 ms because each change is now reloaded from PostgreSQL once per instance, instead of a pre-rendered payload being fanned out. That is the price of keeping Redis payload-free.

## Commands and results

| Command            | Result                                                              |
| ------------------ | ------------------------------------------------------------------- |
| `bun run check`    | 0 errors, 9 warnings (same as PR01)                                 |
| `bun run test:all` | 13 files: 116 passed, **0 known defects remaining**                 |
| `bun run test:e2e` | 4 passed, twice in a row; no abort or error lines in the server log |
| `bun run build`    | Passes                                                              |
| Spikes             | As above                                                            |

## Corrected-core gate (plan)

| Requirement                                        | Status                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Populated upgrade and restore                      | Upgrade proved by tests across all three migrations, which leave legacy columns identical. **Restore from a real backup was not rehearsed**; it needs a deployment operator. |
| Existing-flow characterization                     | PR01, kept green throughout.                                                                                                                                                 |
| Real score-effect, history, winner and retry tests | PR03 and PR04.                                                                                                                                                               |
| Recorded baseline failures                         | PR01, all now fixed.                                                                                                                                                         |

Still open, and outside this environment: a reverse proxy or HTTP/2 deployment, real phones, a 100-bot mixed load run (PR12), and the owner's review before any production deploy.
