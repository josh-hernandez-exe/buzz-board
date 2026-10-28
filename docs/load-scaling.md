# Load scaling: 10, 100 and 1,000 users

Measured 2026-10-23 (chat follow-up 2026-10-27) on this Codespace:
- **Hardware:** 4 vCPUs (AMD EPYC 9V74), 16 GB.
- **Server:** one production build (`next start`) on Node, with PostgreSQL and Redis in Docker.
- **Load generator:** the load runner, a single Bun process on the same machine.

Every number below shares those 4 vCPUs between the server, the database and the generator. Raw reports are in `load-results/` (git-ignored). Compare any of them with:

```bash
bun scripts/load/compare.ts load-results/<dir>/*.json
```

## How it was measured

Profiles `scale-10`, `scale-100` and `scale-1000` all use the same per-user workload, so per-user costs can be compared directly:
- **Players:** each bot is a player on one of 6 teams. It holds the live game-state and chat streams, buzzes in every buzzer window (one every 10 s), and posts a chat message every ~30 s (80% to its team, 20% to everyone).
- **Staff:** 3 staff desks and an audience display run alongside the bots.
- **Timing:** a ramp, then a 3-minute **hold**. Latencies are steady-state, taken from the hold only.

### Separating the app from the machine

The runner now records the following, every 5 s ([resources.ts](../scripts/load/resources.ts)).

| Signal | Points to |
| --- | --- |
| CPU of the **server's main thread** | Near 1.0 core: the single Node.js event loop is saturated. That's the per-process ceiling, whatever the machine. |
| CPU of the **whole machine**, steal time, run queue | Near 100%, or a run queue well above 4: the **machine** is the limit |
| CPU of PostgreSQL, Redis and the runner | Which part competes for the 4 vCPUs |
| The runner's own timer lag | Above ~100 ms: the **generator** is behind, so its latencies overstate the server's |
| A probe in **its own process** timing a small request every 0.5 s | Server responsiveness, untouched by generator slowness |
| **Cost per unit of work** (server CPU ms per request and per stream update, bytes per update) | Flat as users grow: the app scales linearly. Rising: the **app** does more work per user as the game grows |

New runner options:
- `--instances N`: start N server processes and spread the bots across them.
- `--server-cpus 0`: pin the server to given CPUs.
- `--chat-every S` (0 = no chat): isolate chat's cost.
- `--server-profile DIR`: write a V8 CPU profile of the server.

## Results (after the fixes below)

These are the first full measurements, after the live-update fixes in section 2. The final numbers, after every fix, are in [section 4](#cpu-or-architecture).

| Metric | 10 users | 100 users | 100 users, server pinned to 1 CPU | 1,000 users | 1,000, no chat | 1,000, no chat, 2 servers |
| --- | --- | --- | --- | --- | --- | --- |
| Buzz ack p50 / p95 | 12 / 40 ms | 322 / 1,078 ms | 801 / 2,026 ms | 24.8 / 54.8 s | 2.1 / 5.4 s | 1.5 / 2.7 s |
| Chat send ack p50 / p95 | 14 / 17 ms | 28 / 522 ms | 385 / 1,275 ms | 14.3 / 34.0 s | – | – |
| Chat delivery p50 / p95 | 150 / 171 ms | 440 / 1,069 ms | 1,140 / 2,522 ms | 21.0 / 38.9 s | – | – |
| Probe in own process p50 / p95 | 7 / 9 ms | 17 / 144 ms | 166 / 387 ms | 3.7 / 7.3 s | 16 / 446 ms | 12 / 226 ms |
| Server main thread (cores) | 0.03 | 0.49 | 0.41 | **0.93** | 0.63 (peak 0.95) | 0.74 across both |
| Whole machine busy | 9% | 46% | 38% | 68% | 47% | 51% (peak 88%) |
| Server CPU ms / request | 12.9 | 9.5 | 7.5 | 12.6 | 9.4 | 10.8 |
| Server CPU ms / stream update | 8.1 | 7.4 | 6.0 | 5.2 | 2.0 | 2.2 |
| Bytes / stream update | 2.4 KB | 12.9 KB | 13.4 KB | 12.2 KB | 1.8 KB | 1.7 KB |
| Runner timer lag p99 (peak) | 5 ms | 23 ms | 16 ms | 831 ms | 276 ms | 333 ms |
| Unexpected errors | 0 | 0 | 0 | 1,839 (stopped at 5%) | 413 | 15 |
| Correctness invariants | all hold | all hold | all hold | all hold | all hold | all hold |

Correctness held at every size, including 1,000, even when the run was stopped for errors:
- one winner per buzzer window;
- wins match stored claims;
- scores reconcile;
- every accepted message is stored;
- no private-chat leaks.

The errors at 1,000 are refusals ("the game is busy" or a transaction timeout), never wrong results.

## What limits what

### 10 → 100 users: linear, fine for the event

Server CPU per request (12.9 → 9.5 ms) and per update (8.1 → 7.4 ms) stay flat, so the app does the same work per user at 100 as at 10.

The machine is half idle (46%) and the server's main thread is at half a core. The higher p95 at 100 users comes from bursts: 100 players buzz within the same ~100 ms, and every buzz in one game serialises on the game lock by design (that's how "first buzz wins" is made exact). The p50 shows normal service.

**Expected for the event (tens of players):** buzz acks in tens of ms, chat delivered within ~0.2–0.5 s.

### 1,000 users: two kinds of limit

**1. Machine and single-process limits (not app bugs)**

- **The server's main thread saturates.** It sits at 0.93–0.95 cores while the machine is only 47–68% busy. Node.js runs request handling on one thread, so one process can't use more than one core however big the machine is.
  - Adding a **second server process** (`--instances 2`) roughly halved buzz p95 (5.4 → 2.7 s) and probe p95 (446 → 226 ms), and cut errors from 413 to 15.
  - So this limit is addressed by running more processes, not by changing code.
  - On this 4-vCPU box, two servers plus PostgreSQL plus the generator peaked at 88% of the machine, so a third server wouldn't help here.
- **Fewer cores: slower, same work.** Pinning the server to **1 CPU** at 100 users made latency ~2.5× worse (buzz p95 1.1 → 2.0 s) with *lower* CPU per request (7.5 vs 9.5 ms, less contention). That's the signature of being CPU-starved, not of doing more work.
  - **For the real host:** give the server **at least 2 vCPUs**, or 2 small instances.
- **The generator shares the machine.** At 1,000 users the runner itself uses ~0.25 cores and its timers lag up to ~0.8 s. Its latencies at 1,000 overstate the server's somewhat; the separate probe is the fairer measure.
  - Before the fixes, its lag reached 3.1 s.
  - Also before the fixes, Bun's default limit of 256 concurrent fetches capped the first 1,000-user run at 256 open streams, a generator artifact now raised and guarded.
- **One game is one lock.** Every write in a game serialises on the game lock, by design, so buzzing and scoring stay exact. A single room of 1,000 people therefore has a throughput ceiling no hardware removes. Separate games don't share locks.

**2. App scaling problems (found and fixed)**

| Problem | Effect | Fix | Before → after (1,000 users) |
| --- | --- | --- | --- |
| Every game-state update re-sent the **whole player list** to every viewer | Bytes and CPU grew with players × viewers. Updates grew from 4.2 KB (10 users) to 22.7 KB (100 users). | The list is sent once per stream, then only the players who changed, or nothing ([liveRoster.ts](../src/utils/liveRoster.ts), [rosterTracker.ts](../src/server/live/rosterTracker.ts)). A lagging stream catches up with chained changes. Team member lists are rebuilt on the page instead of sent. | Bytes / update **22.7 KB → 1.8 KB**; server CPU / update **4.3 → 2.0 ms**; runner lag p99 3.1 s → 0.3 s |
| Each **new viewer** made the server reload the state and send it to *every* viewer | Joining cost grew with the number already in the room | New viewers get the latest snapshot without a reload ([gameFeed.ts](../src/server/live/gameFeed.ts)) | Join no longer fans out |
| The chat "names changed" revision was a hash of **every player**, so it changed on every join | Every join made every viewer re-fetch every chat channel | The revision now changes only when something shown in existing headers changes: a rename, a move, a removal, a team name or a staff role ([chatLive.ts](../src/server/chat/chatLive.ts)) | Joins no longer trigger refetches |
| The runner's "one winner per window" check could double-count a slow acknowledgement | A false alarm once acknowledgements took longer than a window | It now checks stored claims per window, and reports late acknowledgements separately | – |

Each fix has a test that fails without it. The same merge code runs in the browser and in the load bots, so the bots measure what pages do.

**3. Chat refetches (fixed 2026-10-27)**

Every chat message made every viewer re-fetch the channel's newest 50 messages (~16 KB). With 1,000 people posting, that was half of all traffic.

Now each channel records the revision of its last change other than a new message (removal, pin, clear, settings). A viewer passes the view it holds (revision and newest message). If only new messages arrived since, it gets just those, and the page merges them in ([chatChannelMerge.ts](../src/utils/chatChannelMerge.ts)). Anything else, including a forged revision, a name change or a reconnect, still gets the full view.

| | 100 users before | 100 users after | 1,000 before (1 server) | 1,000 after (1 server) | 1,000 after (2 servers) |
| --- | --- | --- | --- | --- | --- |
| Received KB/s (all traffic) | 1,833 | **274** | 3,924 | 2,385 | 2,221 |
| Chat fetches answered with only new messages | – | – | – | 93% | 97% |
| Server CPU ms / request | 9.5 | 7.5 | 12.6 | 10.4 | 11.6 |
| Buzz ack p95 | 1,078 ms | **658 ms** | 54.8 s | 60.1 s | 36.2 s |
| Chat delivery p95 | 1,069 ms | **690 ms** | 38.9 s | 48.5 s | 26.0 s |
| Server main thread | 0.49 | 0.39 | 0.93 | 0.89 | 1.36 across both |
| Whole machine busy | 46% | 42% | 68% | 72% | **95%** (run queue 9) |
| Completed | yes | yes | no (errors) | no (errors) | **yes** |

**How to read it:**
- **100 users:** clearly faster and much lighter.
- **1,000 users with chat, one process:** the number of fetches, not their size, saturates the server's single main thread. Every request carries fixed costs (authentication, game lookup) on that one thread.
- **1,000 users with chat, two processes:** it completes, but the whole 4-vCPU machine is 95% busy with 9 threads waiting for a CPU. On this codespace the hardware, shared with the database and the load generator, is now the limit, not an app path that grows with the square of the players.

**4. Profiling at 1,000 users, and one architecture fix (2026-10-28)**

A V8 CPU profile of the single server at 1,000 users (`--server-profile`) shows its main thread **93% busy** and no single app hotspot:

| Share of main-thread time | What |
| --- | --- |
| ~18% | Garbage collection |
| ~15% | Prisma (query building, result mapping, engine calls) |
| ~14.5% | AsyncLocalStorage / async hooks (per-request context in Next.js and tRPC) |
| rest | Next.js routing and rendering internals, web streams, JSON, tRPC, app code spread thinly |

That's the shape of a process that is simply out of CPU: fixed per-request framework costs, multiplied by request volume.

Looking for waits rather than CPU turned up one real architecture problem, now fixed:

| Problem | Fix | Effect |
| --- | --- | --- |
| When a whole room buzzed at once, **every buzz opened a transaction and held one of the ~9 pooled database connections** while queueing for the game lock. Everything else in every game (chat, scoring, joins) then waited for a connection. | First-buzz claims for a game are coalesced in each server process: one claim runs, the others wait **without a connection** and are then answered from what was saved ([buzzerService.ts](../src/server/buzzer/buzzerService.ts)). Queued buzzing still records every buzz. | 60 simultaneous buzzes: 60 transactions → at most 3, still exactly one winner (test in [buzzer.test.ts](../tests/integration/buzzer.test.ts)) |
| An overloaded chat send that couldn't get a connection in time was reported as an **internal error** | It now answers "Chat is very busy right now. Try again in a moment." (nothing was saved, so a retry with the same request ID is safe) | Test in [chat.test.ts](../tests/integration/chat.test.ts) |

A bigger connection pool is **not** the answer: `connection_limit=30` made 1,000-user latency and errors worse, because more connections just meant more transactions queueing on the same game lock and more PostgreSQL contention on the same 4 vCPUs.

The runner was also corrected so overload can't look like data loss: a send whose outcome is unknown (timed out, connection dropped) is tracked separately, and in-flight sends are allowed to settle before the invariants are checked. Earlier "accepted but not stored" failures at 1,000 users were this runner timing artifact; the server log showed no restarts and only rolled-back transactions.

**Final numbers (after all fixes, chat every 30 s)**

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

### CPU or architecture?

The long acknowledgement and delivery times at 1,000 users are **mostly a CPU limit**, not an architecture one:
- One Node.js process tops out at ~0.9–0.95 of a core (its main thread) while the machine still has idle CPU. That's a per-process ceiling, addressed by running more processes; the Redis bus already supports that.
- With two processes, the whole 4-vCPU machine is 94–98% busy with ~10 threads waiting for a CPU, shared with PostgreSQL and the load generator. Latency halves with the second process, then the hardware is the limit.
- Server CPU per request stays flat (7–11 ms) from 10 to 1,000 users, so no remaining code path grows with the square of the players.
- Pinning to fewer CPUs makes it slower without making each request more expensive, which is what CPU starvation looks like.

What *is* architectural, by design:
- **One game is one lock.** Writes in a game are serialised so first-buzz and scoring stay exact. A single room of 1,000 has a throughput ceiling no hardware removes; separate games don't share it.
- **The connection pool plus a 5 s wait** turns overload into polite "busy" refusals instead of unbounded queues. Nothing is half-saved.

## Bottom line

- **Up to ~100 players in one game:** the app scales linearly on this 4-vCPU machine with headroom. Bursty buzz p95s are by design (exact first-buzz).
- **Around 1,000 players in one game:**
  - The **single Node process** (one core) is the first limit. Running two processes helps immediately.
  - With two processes, 1,000 players with chat completes, and the **4-vCPU machine** (shared with the database and the generator) is the limit.
  - All four O(n²) paths found are fixed, and simultaneous buzzes no longer tie up database connections.
  - The slow times there are CPU, not design: see [CPU or architecture?](#cpu-or-architecture).
- **Real host:** at least 2 vCPUs. Re-run `scale-100` and a soak there (see [operations](./operations.md)).
