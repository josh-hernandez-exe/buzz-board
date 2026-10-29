# Event readiness: checklist and dress rehearsal

For the first event: a holiday, family-feud style game for several families on a video call. Automated tests prove the rules and the code paths. This page covers what they can't: real devices, real networks, the real host, real content and real people. Work through it top to bottom, and write down anything that surprises someone.

## Before the event

| When | Do | Done when |
| --- | --- | --- |
| 6 weeks | Deploy to the real host (see the [README](../README.md#deployment)). Set Discord/Google sign-in redirect URLs for the real domain. | You can sign in on the real domain from a phone |
| 6 weeks | Schedule `bun run ops:cleanup` hourly and set up database backups ([operations](./operations.md)) | The first scheduled run succeeded |
| 5 weeks | **Backup-restore rehearsal** on the real database host ([how](./operations.md#backups-and-restore)) | `ops:verify-restore` reports no differences |
| 5 weeks | Run a **load soak** against a production build that matches the real host as closely as you can: `bun run load -- --profile soak-100 --start-server --buzzer-mode queue` (also once without `--buzzer-mode`) | Every invariant is `true`; note any latency targets missed |
| 4 weeks | Choose the format: game mode, rules, buzzing mode and team count. Write the real boards or grid, starting from the samples. **Export them** (Import or export) and keep the file somewhere safe. | A complete game passes preflight; the export file re-imports |
| 4 weeks | Pick backup content: one spare board (Ranked Answers) or a few spare questions | Saved in the export |
| 3 weeks | **Dress rehearsal** (below) | Every step passes, or has a fix and a re-test |
| 1 week | Short second rehearsal with the final content; send families the join link and a one-line "how to join" | Families know they need only a phone and the link |
| Day before | **Duplicate** the rehearsed game into a fresh game for the event, and check it opens on the right tab with the content | Fresh game ready, join code noted |

## Sign-in checks so far

Run locally (2026-10-23) with the real Discord and Google app settings from `.env.local` on `http://localhost:3000`:

| Check | Result |
| --- | --- |
| Both providers configured; callback URLs `http://localhost:3000/api/auth/callback/{discord,google}` | Pass |
| **Google**: the app's sign-in reaches Google's "Sign in to continue to Buzz-Board" page (client ID and callback URL accepted) | Pass |
| **Discord**: the app exists ("buzz-board") and sign-in reaches Discord's login page | Pass. Discord only checks the callback URL after login, so one real sign-in is still needed |
| Cancelling at the provider returns to the sign-in page; a forged callback is refused | Pass |
| **Secrets** (2026-10-28): Discord issues an app token for the client ID and secret; Google's token endpoint accepts the client and refuses only the dummy code (`invalid_grant`, not `invalid_client`) | Pass: both secrets are valid |
| **Other ports** (2026-10-28): Google refuses `http://localhost:5555/...` ("Access blocked"); only port 3000 is registered | Expected. Run sign-in on port 3000, or register the extra port (see the README) |
| A full sign-in with a real account, landing on the dashboard | Google: done by the owner. Discord: **not done**, needs a person with an account |

Automated tests create signed-in hosts directly in the database, so they never exercise the providers. Repeat this check on the real domain after deploying (first row of the table above).

## Load results so far

The 10 / 100 / 1,000-user comparison, and how to tell app scaling problems from machine limits, is in [load scaling](./load-scaling.md). In short:
- Up to ~100 players the app scales linearly on 4 vCPUs.
- Give the real server at least 2 vCPUs.
- Four O(n²) live-update paths were fixed (the last was chat refetches).
- At 1,000 players with chat, two server processes complete the run and this 4-vCPU machine is the limit. The slow acknowledgements there are CPU starvation, not an app design problem; a whole room buzzing at once no longer ties up database connections.
- At 100 players: buzz ack p95 380 ms, chat delivery p95 655 ms.

The table below is the earlier PR12 history.

All runs were local: a production build, PostgreSQL and Redis in Docker, and 100 bots plus 4 staff and display clients, all on one 4-vCPU, 16 GB machine.

| Run | Buzzing | Invariants | Buzz ack p95 | Chat send p95 | Chat delivery p95 | Speed targets |
| --- | --- | --- | --- | --- | --- | --- |
| `776ddb8` | First buzz | All pass | 1,391 ms | 927 ms | 1,667 ms | 2 of 5 |
| `ec40618` | First buzz | All pass | 1,490 ms | 1,032 ms | 1,958 ms | 2 of 5 |
| `315ca95` | **Queue** (83 rounds, 498 entries, 0 rule violations) | All pass | 1,358 ms | 984 ms | 1,685 ms | 2 of 5 |

**Correctness held at 100 bots in every run:**
- One winner per window, or the queue keeping its rules.
- Scores matching.
- No private leaks.
- Muted players can still buzz.
- No unexpected errors.

**Speed:** the targets (p95 under 500 ms for buzzes and sends, chat under 1 s) are still missed on this machine, where the bots share the CPU with the server. Queued buzzing is no slower than first-buzz. A family event is far below 100 people, but run the soak on hardware like the real host before relying on these numbers.

## Editor responsiveness

Measured 2026-10-28 with [editorResponsiveness.spec.ts](../tests/spike/editorResponsiveness.spec.ts) on a production build (Chromium, 4-vCPU codespace). The bank is the plan's reference: 200 questions, 906 KB, an 8 × 10 grid and four images per clue. Times are from the browser's Event Timing API: each key press or click until the next paint.

| Interaction | p95 | p95, CPU slowed 4× | Target |
| --- | --- | --- | --- |
| Select a tile | 40 ms | 88 ms | under 200 ms |
| Type in a clue | 32 ms | 64 ms | under 100 ms |
| Type with the question library open | 40 ms | 80 ms | under 100 ms |
| Type with import/export open | 48 ms | 80 ms | under 100 ms |

- The editor is usable about 1 s after loading. No media is requested until a question is selected, and then only that question's.
- Per key press, the app's own JavaScript (including React) takes 3–5 ms, or 11–17 ms with the CPU slowed. The rest is the browser painting a large page, so rewriting the editor wouldn't help much. (Memoising the grid tiles was tried and made no measurable difference, so it wasn't kept.)
- Saved setups are capped at 1 MiB (the plan's limit) for every mode. A bigger one is refused with its size and a hint; nothing is lost.
- Not yet done: a real iPad or Android tablet check (emulation isn't proof).

## Running the search-prediction trivia format

The event plan's format (teams take turns, one answer each, 11 − rank points, no buzzer, strikes or steals) is **Ranked Answers → Round robin**. Checked 2026-10-29 against the plan's rehearsal script, in [rankedEventScript.test.ts](../tests/integration/rankedEventScript.test.ts) (API and scoreboard) and [rankedEventScript.spec.ts](../tests/e2e/rankedEventScript.spec.ts) (host desk, player phone and display in a browser).

**Setup (Ranked Answers tab, before starting):**

| Setting | Value |
| --- | --- |
| Starting point | Round robin |
| Answers per team per board | 3 |
| A full round of turns with no new answer | Closes the board |
| Points by rank | `10, 9, 8, 7, 6, 5, 4, 3, 2, 1` (11 − rank; boards hold up to 10 answers) |
| Practice board | Board type **practice**: plays normally, scores nothing, doesn't move the starting team |
| Points lost for a miss | 0 |

Team order is the order on the Players tab (Team A, B, C, D). Board 1 starts with A, board 2 with B, and so on.

**Each board on the host desk:**
1. **Show this board.** Players and the display see the prompt and numbered blank rows. The host sees every answer (in italics until found) and the aliases.
2. The desk says whose turn it is, for example "Team A's turn (1 of 12)". The team's phone says "Your team's turn! Say your answer."; the others say whose turn it is. There's no Buzz button on these boards.
3. Judge the spoken answer:
   - **Right:** press its button (for example **#1 TikTok**, or the key `1`). The row appears for everyone with the team's name and points, the scoreboard updates at once, and play moves to the next team.
   - **Anything else** (wrong, repeat of a shown answer, pass, out of time): press **✕ Wrong / pass** (or `X`). 0 points, next team.
4. The board closes by itself when every answer is found, when a full round finds nothing new, or after 3 rounds. The display says which. **Close board** ends it early, for time.
5. **Reveal remaining answers (0 points)**, then choose the next board and **Show this board**.

**Mistakes:**
- **Wrong button just pressed:** **Undo last action** takes the points back and returns the turn. A row everyone has seen stays shown for 0 points, so nobody can score it later.
- **Older mistake:** fix that team's score on the **Play** tab (add or subtract). The board carries on where it is.
- **Double click:** the second click is refused; points and turns move once.

**Rehearsal script result:** after A TikTok, B TikTok again, C Spotify, D pass, A Instagram, B Zoom, C timeout, D Teams, the scores are **A 19, B 2, C 0, D 6** and only ranks 1, 2, 5 and 9 are shown, matching the plan. The separate checks pass as well: a no-match round, a double click, close and reveal, the next board's starter, corrections, and privacy across a reconnect.

## Dress rehearsal script (about 60 minutes)

**People:** you as owner on a laptop, a co-host on a second computer, a moderator, and at least six players on their own phones in three or more teams. Use a mix of iPhone and Android, Wi-Fi and mobile data. Join them all to a video call.

**Screens:** share the audience display from one computer, with **Turn on sound**, so everyone hears through the call.

**Record for each step:** who did it, how long it took, errors, and anything someone had to ask.

1. **Create and invite.** Create the game as planned: mode, rules, buzzing and teams. Invite the co-host and moderator from **Room → Helpers**. Share the join link in the call's chat.
2. **Join on phones.** Everyone joins with a nickname and lands on a team. Check that:
   - Nobody scrolls sideways.
   - Dark mode works (theme button).
   - One person leaves and rejoins from the same phone and keeps their player.
3. **Teams and names.** The moderator renames one player, moves one between teams, and locks a name.
4. **Buzzer.** Run three plain questions with the buzzer: open, buzz, award points with one tap, next question.
   - With **Queue** on: Wrong → next in line → Correct.
   - Press **Next question** by mistake, then **Undo** it.
5. **Keyboard.** Run the next question with shortcuts only: O, then C / W / S, then N.
6. **Game mode.** Run the practice board or a few clues, then two real ones:
   - **Ranked Answers, Open answering:** teams shout; tap the teams, then the answer number. Credit two teams on one answer. Reveal the leftovers at the end.
   - **Category Grid:** the picking team chooses, open the buzzer, wrong then right, and check the pick moves.
7. **Corrections.**
   - Credit the wrong team, then **Undo**: the answer stays shown and the points come back.
   - **Void** one board or clue: its points come back.
   - Check the scoreboard against a paper tally.
8. **Two hosts.** The co-host runs one board while you watch. Both press at once once: one action counts and the other screen updates.
9. **Trouble.**
   - A player turns on aeroplane mode for 30 seconds: they see "Reconnecting" and recover.
   - The display computer reloads.
   - Mute a chatter mid-board: they can still buzz.
   - Remove a message.
10. **Fallback.** On a duplicate of the game, press **Use basic controls** mid-board, then carry on with the buzzer and manual scores.
11. **Finish.**
    - **Room → Finish game**: the display shows the winner and places, and phones show "You finished …".
    - **Reopen**, fix a score, finish again.

**Pass:**
- You ran every step without making up a rule.
- Players understood how to join, buzz and see results without help.
- The display never showed a hidden answer or clue.
- The scoreboard matched the paper tally.
- Sound came through the call.

## On the day

- **Open early:** open the host desk and the display 20 minutes before. Check that **Turn on sound** works through the call.
- **Two desks:** keep the co-host's desk open as a backup controller.
- **If something misbehaves:**
  - Use **Undo** or **Void** first.
  - If a game mode gets stuck, use **Use basic controls** and keep going with the buzzer and manual scores. Scores stay.
  - If the app is unreachable, keep score on paper and carry on by voice. Re-enter the scores afterwards with **More score tools → Set**.
- **Afterwards:** finish the game so results stay visible. You can reopen within 24 hours to correct them.
