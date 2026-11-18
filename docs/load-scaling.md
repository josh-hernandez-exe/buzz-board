# Load scaling: 10, 100 and 1,000 users

How Buzz Board behaves as one game grows from 10 to 100 to 1,000 players, measured in late October 2026 on a Codespace:
- **Hardware:** 4 vCPUs (AMD EPYC 9V74), 16 GB.
- **Server:** one production build (`next start`) on Node, with PostgreSQL and Redis in Docker.
- **Load generator:** the [load runner](./operations.md#load-runner), a single Bun process on the same machine.

Every number below shares those 4 vCPUs between the server, the database and the generator, so read them for their shape, not as a promise for other hardware. Raw reports are written to `load-results/` (git-ignored). Compare any of them with:

```bash
bun scripts/load/compare.ts load-results/<dir>/*.json
```

## How it was measured

Profiles `scale-10`, `scale-100` and `scale-1000` all use the same per-user workload, so per-user costs can be compared directly:
- **Players:** each bot is a player on one of 6 teams. It holds the live game-state and chat streams, buzzes in every buzzer window (one every 10 s), and posts a chat message every ~30 s (80% to its team, 20% to everyone).
- **Staff:** 3 staff desks and an audience display run alongside the bots.
- **Timing:** a ramp, then a 3-minute **hold**. Latencies are steady-state, taken from the hold only.

### Separating the app from the machine

The runner records the following every 5 s ([resources.ts](../scripts/load/resources.ts)).

| Signal | Points to |
| --- | --- |
| CPU of the **server's main thread** | Near 1.0 core: the single Node.js event loop is saturated. That's the per-process ceiling, whatever the machine. |
| CPU of the **whole machine**, steal time, run queue | Near 100%, or a run queue well above 4: the **machine** is the limit |
| CPU of PostgreSQL, Redis and the runner | Which part competes for the 4 vCPUs |
| The runner's own timer lag | Above ~100 ms: the **generator** is behind, so its latencies overstate the server's |
| A probe in **its own process** timing a small request every 0.5 s | Server responsiveness, untouched by generator slowness |
| **Cost per unit of work** (server CPU ms per request and per stream update, bytes per update) | Flat as users grow: the app scales linearly. Rising: the **app** does more work per user as the game grows |

The runner also tracks a send whose outcome is unknown (timed out, connection dropped) separately, and lets in-flight sends settle before it checks the invariants, so overload can't look like data loss. Its "one winner per window" check counts stored claims per window and reports late acknowledgements separately.

## Results

Chat every 30 s per player.

| | 10 users | 100 users | 100 users, server pinned to 2 CPUs | 1,000 users, 1 process | 1,000 users, 2 processes |
| --- | --- | --- | --- | --- | --- |
| Buzz ack p50 / p95 | 10 / 30 ms | 202 / 380 ms | 229 / 1,057 ms | 36 / 52 s | 21 / 38 s |
| Chat send ack p50 / p95 | 14 / 20 ms | 15 / 315 ms | 37 / 433 ms | 16 / 40 s | 12 / 24 s |
| Chat delivery p50 / p95 | 151 / 177 ms | 334 / 655 ms | 453 / 1,002 ms | 22 / 45 s | 18 / 32 s |
| Probe in own process p50 / p95 | 7 / 10 ms | 8 / 95 ms | 11 / 134 ms | 4.4 / 8.4 s | 4.6 / 6.2 s |
| Server main thread (cores) avg / peak | 0.03 / 0.05 | 0.39 / 0.61 | 0.45 / 0.79 | **0.91 / 0.95** | 1.34 / 1.5 across both |
| Whole machine busy avg / peak | 9 / 12% | 36 / 56% | 39 / 64% | 68 / 74% | **94 / 98%** |
| Server CPU ms / request | 11.0 | 7.4 | 7.2 | 10.2 | 10.9 |
| Completed | yes | yes | yes | stopped at the 5% error ceiling | yes |
| Data invariants | all hold | all hold | all hold | all hold¹ | all hold |

¹ The only failed check was the moderation probe ("a muted player can't buzz"), which couldn't finish its own steps under that overload; no muted buzz was accepted.

Correctness held at every size, including 1,000, even when a run was stopped for errors:
- one winner per buzzer window;
- wins match stored claims;
- scores reconcile;
- every accepted message is stored;
- no private-chat leaks.

The errors at 1,000 are refusals ("the game is busy" or a transaction timeout), never wrong results.

After upgrading to Next.js 16.4, Auth.js beta.32, Prisma 6.19, tRPC 11.22 and zod 4, 10 and 100 users were measured again on the same machine with no regression: at 100 users buzz ack p50 / p95 was 168 / 257 ms, chat delivery 302 / 562 ms and server CPU 6.9 ms per request, with no errors.

## What limits what

### Up to ~100 users in one game: linear

Server CPU per request (7–11 ms) and per stream update stays flat from 10 to 1,000 users, so the app does the same work per user at 100 as at 10. At 100 users the machine is about a third busy and the server's main thread is under half a core.

The higher p95 at 100 users comes from bursts: 100 players buzz within the same ~100 ms, and every buzz in one game serialises on the game lock by design (that's how "first buzz wins" is made exact). The p50 shows normal service. For tens of players, expect buzz acks in tens of milliseconds and chat delivered within about 0.2–0.5 s.

### Around 1,000 users: machine and process limits

- **The server's main thread saturates.** It sits at 0.9–0.95 cores while the machine still has idle CPU: Node.js runs request handling on one thread, so one process can't use more than one core however big the machine is.
  - A **second server process** (`--instances 2`) roughly halves latency (buzz p95 52 → 38 s with chat; 5.4 → 2.7 s with chat off in an earlier run) and cuts errors sharply. The Redis bus already supports several processes, so this limit is addressed by running more processes, not by changing code.
  - On this 4-vCPU machine, two servers plus PostgreSQL plus the generator reach 94–98% busy with about ten threads waiting for a CPU, so a third server wouldn't help here.
- **Fewer cores: slower, same work.** In an earlier run, pinning the server to **1 CPU** at 100 users made latency ~2.5× worse (buzz p95 1.1 → 2.0 s) with *lower* CPU per request (7.5 vs 9.5 ms, less contention). That's the signature of being CPU-starved, not of doing more work.
- **The generator shares the machine.** At 1,000 users the runner uses ~0.25 cores and its timers lag up to ~0.8 s, so its latencies overstate the server's somewhat; the separate probe is the fairer measure. Bun's default limit of 256 concurrent fetches is raised and guarded so it can't cap the open streams.
- **One game is one lock.** Every write in a game serialises on the game lock, by design, so buzzing and scoring stay exact. A single room of 1,000 people therefore has a throughput ceiling no hardware removes. Separate games don't share locks.
- **The connection pool plus a 5 s wait** turn overload into polite "busy" refusals instead of unbounded queues. Nothing is half-saved. A bigger pool is **not** the answer: `connection_limit=30` made 1,000-user latency and errors worse, because more connections just meant more transactions queueing on the same game lock and more PostgreSQL contention.

A V8 CPU profile of the single server at 1,000 users (`--server-profile`) shows its main thread **93% busy** and no single app hotspot:

| Share of main-thread time | What |
| --- | --- |
| ~18% | Garbage collection |
| ~15% | Prisma (query building, result mapping, engine calls) |
| ~14.5% | AsyncLocalStorage / async hooks (per-request context in Next.js and tRPC) |
| rest | Next.js routing and rendering internals, web streams, JSON, tRPC, app code spread thinly |

That's the shape of a process that is simply out of CPU: fixed per-request framework costs (authentication, game lookup), multiplied by request volume.

### CPU or architecture?

The long acknowledgement and delivery times at 1,000 users are **mostly a CPU limit**, not an architectural one:
- One process tops out at ~0.9–0.95 of a core while the machine still has idle CPU; a second process halves latency, then the shared hardware is the limit.
- Server CPU per request stays flat (7–11 ms) from 10 to 1,000 users, so no code path grows with the square of the players.
- Pinning to fewer CPUs makes it slower without making each request more expensive.

What *is* architectural, by design, is the per-game lock and the bounded connection pool described above.

## Why per-user cost stays flat

Each of these was found by measuring at 1,000 users and has a test that fails without it. The same merge code runs in the browser and in the load bots, so the bots measure what pages do.

| Behaviour | Why | Where |
| --- | --- | --- |
| The player list is sent **once per stream**, then only the players who changed (or nothing) | Re-sending the whole list on every update grew bytes and CPU with players × viewers (22.7 KB per update at 1,000 users, against 1.8 KB now). A lagging stream catches up with chained changes; team member lists are rebuilt on the page instead of sent. | [liveRoster.ts](../src/utils/liveRoster.ts), [rosterTracker.ts](../src/server/live/rosterTracker.ts) |
| A **new viewer** gets the latest snapshot without a reload, and nobody else is re-sent the state | Otherwise joining cost grew with the number already in the room | [gameFeed.ts](../src/server/live/gameFeed.ts) |
| The chat **"names changed" revision** changes only when something shown in existing headers changes: a rename, a move, a removal, a team name or a staff role | It used to hash every player, so every join made every viewer re-fetch every channel | [chatLive.ts](../src/server/chat/chatLive.ts) |
| A chat fetch carries the view the viewer holds (revision and newest message) and gets **only the new messages** when nothing else changed | Every message used to make every viewer re-fetch the newest 50 messages (~16 KB), half of all traffic at 1,000 users. Now 93–97% of fetches there are answered with only new messages. Anything else (a forged revision, a removal, pin, clear or settings change, a name change, an `ops:cleanup` erasure, a reconnect) still gets the full view, and a response older than the view already held is ignored, so a slow fetch can't bring back removed text. | [chatChannelMerge.ts](../src/utils/chatChannelMerge.ts) |
| **First-buzz claims** for a game are coalesced in each server process: one claim runs, the others wait without a database connection and are answered from what was saved | Each buzz used to open a transaction and hold one of the ~9 pooled connections while queueing for the game lock, starving chat, scoring and joins. 60 simultaneous buzzes now take at most 3 transactions, still with exactly one winner. Queued buzzing still records every buzz. | [buzzerService.ts](../src/server/buzzer/buzzerService.ts), [buzzer.test.ts](../tests/integration/buzzer.test.ts) |
| An overloaded chat send that can't get a connection in time answers "Chat is very busy right now. Try again in a moment." | Nothing was saved, so a retry with the same request ID is safe, and it isn't reported as an internal error | [chat.test.ts](../tests/integration/chat.test.ts) |
| The page shares **one member game-state stream** across components | Browsers have a small per-host HTTP/1.1 connection budget; a stream per component could leave none for actions such as starting the buzzer | [connections.spec.ts](../tests/spike/connections.spec.ts) |

## Bottom line

- **Up to ~100 players in one game:** the app scales linearly on a 4-vCPU machine with headroom. Bursty buzz p95s are by design (exact first-buzz).
- **Around 1,000 players in one game:**
  - The **single Node process** (one core) is the first limit. Running two processes helps immediately.
  - With two processes, 1,000 players with chat completes, and the **4-vCPU machine** (shared with the database and the generator) is the limit.
  - The slow times there are CPU, not design: see [CPU or architecture?](#cpu-or-architecture).
- **Sizing a hosted deployment:** give the server at least 2 vCPUs, or run 2 small instances, then re-run `scale-100` and a soak on that host (see the [operations runbook](./operations.md#load-runner)).
