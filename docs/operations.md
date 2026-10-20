# Operations runbook

How to run Buzz Board's scheduled jobs and the load runner, and what to do when something is wrong. For deployment itself see the [README](../README.md#deployment).

## Scheduled cleanup

Run `bun run ops:cleanup` on a schedule, hourly is plenty, with the production environment (`DATABASE_URL`, `KV_URL`). It is safe to repeat and safe while games are running.

| It does                                                                             | Why                                                            |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Erases chat text (and its hash) older than 7 days                                   | Retention promise in [Help](../src/help/articles/chat.md)      |
| Deletes expired mutes                                                               | Housekeeping                                                   |
| Strips moderation reasons older than 30 days; keeps the action, target and time     | Retention of staff explanations                                |
| Lists unfinished games idle for 7 days as `staleUnfinishedGames`, **never deletes** | The operator decides whether to contact the host or close them |

It prints one JSON line and exits non-zero on failure. **Alert on**:

- a non-zero exit, or no successful run for 3 hours;
- `overdueBodies` above 0: chat text that should have gone more than 2 hours ago was still stored when the run started, so earlier runs failed or didn't happen.

If cleanup is late, players still never see expired text: reads hide it after 7 days. Cleanup can't erase backups or screenshots; set backup expiry in your database host's settings, and the Help article says so.

## Load runner

[scripts/load/run.ts](../scripts/load/run.ts) drives real bots against the app's real HTTP/tRPC/SSE endpoints. Each bot joins with its own token and holds the same two streams as a player page (game state and chat). It chats through the real invalidation-plus-fetch path and buzzes when the buzzer opens. Four more clients act as owner (coordinator), co-host, moderator and audience display.

### Profiles

| Profile               | Clients                     | Shape                                    | Use                                  |
| --------------------- | --------------------------- | ---------------------------------------- | ------------------------------------ |
| `smoke-10`            | 10 bots + 4                 | 15 s ramp, 90 s hold, 15 s ramp-down     | After small changes                  |
| `mixed-100`           | 100 bots + 4                | 2 min ramp, 10 min hold, 2 min ramp-down | After material shared-core changes   |
| `soak-100`            | 100 bots + 4                | 5 min ramp, 60 min hold, 5 min ramp-down | Before an event or release           |
| `capacity-1000-local` | 100 → 250 → 500 → 1,000 + 4 | Stepped, 29 minutes                      | Optional research, **not** a promise |

Workload, from the delivery plan: 6 teams. Each bot sends one 128-byte message about every 30 seconds (seeded jitter), 80% to its team and 20% to everyone. Every 10 seconds the coordinator resets and opens the buzzer for 3 seconds; every bot tries to buzz, and the winner's team gets 1 point. During the hold, probes run once each:

| Probe              | Checks                                                                          |
| ------------------ | ------------------------------------------------------------------------------- |
| Mute               | A muted bot's message is refused, but its buzz is still processed. Then unmute. |
| Rename + lock      | Rename a bot and lock its name, then unlock.                                    |
| Remove message     | The moderator removes a recent message.                                         |
| Move               | A bot moves team; time until its chat pulse lists the new team channel.         |
| Reconnect          | A bot drops both streams and reopens them; time until current state arrives.    |
| Role change        | The co-host becomes a moderator and back, with desks connected.                 |
| Privacy (each bot) | Fetching another team's channel must be refused.                                |

### Running it

Everything is local: a production build of the app, and the disposable PostgreSQL and Redis from `bun run test:services:up`.

```bash
bun run test:services:up
export DATABASE_URL=postgresql://postgres:postgres@localhost:55432/buzz_board_test
export KV_URL=redis://localhost:56379/0 SKIP_ENV_VALIDATION=1
bunx prisma migrate deploy
bun run build

bun run load -- --profile smoke-10 --dry-run        # plan, estimates and ceilings only
bun run load -- --profile mixed-100 --start-server  # starts `next start` on :3300
```

Options: `--target` (default `http://localhost:3300`; use it without `--start-server` for a server you started), `--seed`, `--hold-scale 0.1` for a shorter trial (recorded in the report), `--keep` to leave the run's game in the database, and `--out` (default `load-results/`, which git ignores).

### Interlocks

- **Local by default.** The target must be a bare origin. Only `localhost`, `127.x.x.x` and `[::1]` run without flags; look-alike hosts, credentials in the URL and paths are refused.
- **Remote targets are refused unless all of these are given:** `--allow-remote`, `--acknowledge-costs`, the exact origin in `LOAD_TARGET_ALLOWLIST`, and `--operator-approval "<who approved, where recorded>"`. The deployment operator must approve, because the bill is theirs; a game owner can't. Even then, this repository doesn't execute remote runs: they would also need pre-created synthetic credentials, provider cost alerts and an operator-run cleanup. Never point it at a live event.
- **Dry run first.** Every run prints the plan, the estimated requests, messages, deliveries and bytes, and the **ceilings** before any traffic.
- **Ceilings stop the run** and are never raised automatically: time, requests, accepted messages, bytes, clients, and unexpected errors (count and rate over 5%). Ctrl-C stops it too.
- **Cleanup touches only this run:** the runner refuses a database that isn't a local test database, and deletes only the game and the three staff users it created.

### Reading the report

The runner prints a summary and writes `load-results/<profile>-<runId>.json` with the SHA, runtime, hardware, plan, counts, latency, targets, invariants, the first 20 unexpected errors, and 5-second samples. Samples include bots, open streams, requests, PostgreSQL connections and lock waits, server CPU and memory (with `--start-server`) and runner memory. It contains no tokens or real names.

**Invariants** must all be true; the runner exits 1 otherwise. A failure means a correctness bug: stop and investigate.

| Invariant                | Meaning                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `acceptedMessagesStored` | Every acknowledged message is in the database, exactly once.               |
| `noUnexpectedMessages`   | Nothing else was stored.                                                   |
| `oneWinnerPerWindow`     | At most one bot won each buzzer window.                                    |
| `winsMatchClaims`        | Bots that were told they won equal the durable claims.                     |
| `scoresReconcile`        | Final scores from the public API equal the points the coordinator applied. |
| `noPrivateLeaks`         | No bot could read another team's channel.                                  |
| `mutedCanStillBuzz`      | The muted bot was refused in chat and processed by the buzzer.             |

**Targets** are from the plan, for calibration rather than pass/fail: buzz and send acknowledgment p95 under 500 ms, chat visible delivery p95 under 1 s and p99 under 2 s, unexpected failures under 0.1%, and a reconnect getting current state within 5 s. Visible delivery is timed from the sender's send to the moment another bot's fetch returns the message, on the runner's monotonic clock. Only recipients who were in the channel when it was sent count. If targets aren't met on adequate hardware, report the shortfall; never relax permissions or correctness to meet them.

**Expected, not errors:** `notListening` buzzes (someone else won first), `teammateHeld` (a teammate already holds it), one refused send from the muted bot, and `TOO_MANY_REQUESTS` if a bot exceeds the chat limits.

**Generator limits:** one Bun process drives every bot on the same machine as the server, so at high counts the runner itself may be the bottleneck. Check `runnerRssMb` and the host's CPU before blaming the app.

## Backups and restore

Use your PostgreSQL host's automated backups. Before an event, rehearse a restore into a separate database and check that a game, its scores and its chat come back. That rehearsal hasn't been recorded for this release yet; see the delivery plan's release gates. Redis holds only rate-limit counters and change notifications, so it needs no backup: after a Redis restart, streams resync from PostgreSQL.
