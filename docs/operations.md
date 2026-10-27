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
| `scale-10` / `scale-100` / `scale-1000` | 10 / 100 / 1,000 + 4 | Same workload and short shape at each size | Scaling comparison ([load scaling](./load-scaling.md)) |

Options:
- `--instances N`: start N server processes.
- `--server-cpus 0`: pin the server to given CPUs.
- `--chat-every S`: seconds between a bot's messages; 0 turns chat off.
- `--server-profile DIR`: write a V8 CPU profile of the server.

Each report records:
- resource use per part (server, its main thread, PostgreSQL, Redis, the runner) and machine-wide;
- an independent latency probe;
- steady-state latencies;
- costs per request and per update;
- traffic per API path.

Compare reports with `bun scripts/load/compare.ts <reports>`.

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

`--buzzer-mode queue` runs the same workload with queued buzzing. Every round, the coordinator marks the first team in line wrong and the next one right, and the `oneWinnerPerWindow` invariant becomes "the line kept its rules": one team answering, unique places, and one place per team.

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

Redis holds only rate-limit counters and change notifications, so it needs no backup: after a Redis restart, streams resync from PostgreSQL. PostgreSQL holds everything else.

**Backups:** turn on your PostgreSQL host's automated backups (most offer daily snapshots and point-in-time restore). Note how long they're kept: deleted chat stays in backups until they expire, and the privacy notice says so.

### What a backup-restore rehearsal is

A backup you've never restored is a hope, not a backup. A **rehearsal** is a practice run of the real thing, done before an event while nothing is wrong:

1. Restore your latest backup into a **new, separate** database. Never restore over the live one.
2. Check the restored copy matches: every table, and a game you know (its scores, players and chat).
3. Write down how long it took, who did it, and anything confusing, so a real restore at a stressful moment is a routine.
4. Delete the restored copy.

"Recorded" means step 3 is written somewhere you can find it, for example a dated line in your event notes.

### Rehearsing with a hosted database

1. Pause anything writing to the database, or note the time, because later writes show up as differences.
2. Use your host's restore feature to create a **new** database from the latest backup.
3. Compare: `bun run ops:verify-restore -- --source "$DATABASE_URL" --restored "$RESTORED_DATABASE_URL"`. It reads both databases (never writes), compares every table's row count and a fingerprint of all its contents, and exits 1 with the tables that differ.
4. Optionally point a local copy of the app at the restored database and open a known game.
5. Delete the restored database, and record the result and the time taken.

### Rehearsing locally

`bun run ops:backup-rehearsal` runs the whole drill against the disposable test database, refusing any other:

1. It plays a marker game through the app's own services (3 players, scores 30/25/8, a chat message).
2. It backs up with `pg_dump` and restores into a new database with `pg_restore`.
3. It runs the same table comparison, re-reads the marker game from the restored copy, and prints timings.
4. It deletes the copy and the dump (`--keep` leaves them for inspection).

Without local PostgreSQL tools, add `--docker-container buzz-board-test-buzz-board-test-db-1` to use the ones in the test container. The report goes to the git-ignored `backups/` folder.

**Recorded local rehearsal (21 Oct 2026):** passed. The whole database (18 tables) matched after restore, and the marker game's scores, players and chat came back. Backup took 0.26 s and restore 0.26 s for a 56 KB test database. A deliberately altered score in the restored copy was reported as `ScoreEffect: same row count, different contents`. A rehearsal with the production host's own backups is still to do before the first event.
