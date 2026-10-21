# PR13: Ranked Answers event rules, naming and rehearsal (proposal for owner review)

> [!important] Status: proposed, not approved
> This is the PR13 deliverable from the [delivery plan](./buzz-board-game-kit-delivery-plan.md): the package the owner reviews to pass the **Phase 2 exit**. Nothing here is approved. Every rule below is the plan's proposed default, written so it can be checked rather than invented. Game Kit and the Ranked Answers mode (PR14 onward) wait for the decisions in the next section.

## Decisions needed

| #   | Decision                                                                                               | Proposed default                                                                                                           | Blocks                    |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| D1  | Ranked Answers rules: points, play styles, timing, ties, corrections                                   | As written below. Points are configurable; four play styles cover 2 to 50 teams                                            | PR22–PR23                 |
| D2  | **W23 handoff:** can a host stop an integrated mode and continue in the same room with basic controls? | One-way **Use basic controls**; the room never returns to that mode; basic undo stops at the handoff                       | PR14 (Game Kit contracts) |
| D3  | Public names                                                                                           | Players see **Game mode**, **Ranked Answers**, **Team answer**, **Use basic controls**. "Game Kit" is for developers only. | PR14 Help and UI labels   |
| D4  | Licence and public assets (logo, sounds, screenshots)                                                  | Options in [licensing.md](./licensing.md); keep event content out of the repository                                        | Any public release        |
| D5  | Source-capture and rights policy for real boards                                                       | Manual capture procedure below; no real pack in the repository                                                             | First real event          |
| D6  | Participant and operator privacy notices                                                               | Drafts below                                                                                                               | First real event          |
| D7  | Backup and restore owner, and a recorded restore rehearsal                                             | Process in the [operations runbook](./operations.md#backups-and-restore)                                                   | First real event          |

## Proposed rules (D1)

### Boards

- A board is a prompt (for example "foods at a holiday dinner") with **4 to 8** ranked answers, stable IDs and approved aliases.
- Boards are **main**, **practice** (not scored) or **spare** (for tie-breaks and replacing a compromised board).

### Points (configurable)

Points are set per game, and can be changed per board or per answer:

| Setting                      | Where       | Default                            | Example                                        |
| ---------------------------- | ----------- | ---------------------------------- | ---------------------------------------------- |
| Points by rank               | Game        | 30 / 25 / 20 / 15 / 10 / 8 / 5 / 2 | 100 / 50 / 25 / 10 for a four-row style        |
| Points by rank for one board | Board       | The game's                         | A harder board worth more                      |
| Points for each answer       | Answer      | Off                                | Survey-style counts: 38 / 22 / 14 / 11 / 8 / 4 |
| Multiplier                   | Game, board | 1                                  | 2 for a "double points" final board            |

- Rank points must be positive whole numbers and strictly decreasing.
- Per-answer points must be given for every row or none, positive, and never higher than the row above. Ties are allowed, as with real survey counts.
- With the defaults an eight-row board is worth 115 points. These are game points, not percentages.
- Everything is frozen when the game starts. Preflight warns when main boards are worth different totals.

### Play styles: turns that scale from 2 to 50 teams

The host picks a style when setting up. Preflight blocks a style that doesn't fit the number of teams.

| Style               | Teams | In one sentence                                                                         | Scoring                                     |
| ------------------- | ----- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Classic**         | 2     | The TV format: face-off, play or pass, three strikes, one steal                         | Winner takes the bank                       |
| **Face-off ladder** | 3–8   | Classic, with two teams facing off each board and **every** other team stealing at once | Bank, plus own row for other correct steals |
| **Round robin**     | 2–12  | Teams answer one at a time in a rotating order                                          | Each row to the team that found it          |
| **All-play**        | 2–50  | Every team answers secretly at the same time each round                                 | Each row to **every** team that found it    |

Suggested defaults: **Classic** for 2 teams, **Face-off ladder** for 3–6, **All-play** for 7 or more. Round robin suits groups that want it calm and simple.

#### Classic (2 teams)

1. **Face-off.** One player from each team. With **buzzer** face-offs (good when everyone is in one room), the first to buzz answers; the top row wins at once, otherwise the other player answers and the higher row wins. With **secret** face-offs (fair online, because connection speed can't decide it), both answer privately and the higher row wins. If neither finds a row, or both give the same row, face off again.
2. **Play or pass.** The winning team chooses to play the board or pass it to the other team.
3. **Control.** The playing team answers one at a time. Each hidden row found adds its points to the **bank**. A wrong answer is a strike.
4. **Clear or steal.** If they find every row, they take the bank. After **3 strikes** (configurable 1–5), the other team gets **one** steal answer. A hidden row takes the whole bank plus that row; otherwise the playing team takes the bank.
5. Remaining rows are revealed for 0.

#### Face-off ladder (3–8 teams)

Like Classic, but:

- Two teams face off each board, and the **pairs rotate** (with 6 teams: 1 v 2, then 3 v 4, then 5 v 6). Preflight warns when the board count doesn't give every team the same number of face-offs.
- On a steal, **every other team** gives a secret steal answer at the same time, so nobody waits idle for long.
- The team with the **highest** hidden row takes the bank plus their row. Other teams that found a hidden row score just their row. Teams tied on the best row each take the bank; it's never decided by who submitted first.

#### Round robin (2–12 teams)

1. The team order is frozen, and the **starting team rotates by one each board**, never by score or by who seems online.
2. Each team gives **one** answer through its captain, then the next team acts, for **2 cycles** by default (configurable 1–4).
3. The first accepted hidden row scores its points for that team. A miss, duplicate, pass or timeout scores 0 and uses the turn.
4. The board closes when every row is found, the turns run out, or the host closes it for time.

**Starter fairness:** a board can close before later teams act, so preflight warns when the board count doesn't give every team the same number of first turns.

#### All-play (2–50 teams)

1. Every team's captain submits **one secret answer** per round (**3 rounds** by default, configurable 1–8). Chat messages are never answers.
2. The host locks the round and reveals. **Every team** whose answer is a row still hidden at the start of that round scores it, so several teams can score the same row. Rows found in an earlier round score 0.
3. The board ends after the last round or when every row is found.

This is the only style where a round takes the same time with 4 teams or 40. It reuses the team-answer feature the plan already needs for the Sequential Quiz mode.

### For every style

- The host reads the prompt. Game chat may switch to staff-only; team chat stays open.
- The host judges answers, including aliases and close calls, and closes each window. Pacing aims for 10 seconds to consult and 5 to answer (configurable).
- There are no negative points.
- Remaining rows are revealed for 0 points when a board closes. Then standings are shown, and the next board starts deliberately.

### Corrections and problems

- A host or co-host can correct the latest result. Correcting pauses play and changes the board state and scores together. Chat, names, helpers and moderation are never part of an undo.
- A revealed answer can't be hidden again. If a hidden row is revealed by accident, the board is **compromised**: the host voids it or switches to a spare, rather than replaying that turn.
- An unsuitable board can be skipped or voided under the announced rules.
- Captain problems pause play for repair; no team is eliminated.

### Ties

- Play a **spare board** with only the tied teams, in the same style if it fits that many teams (Classic for two), or share the placing if the announced time runs out. A tie is never decided by network speed.

### Executable worked examples

[referenceModel.ts](../tests/fixtures/ranked-answers/referenceModel.ts) encodes these rules, and [rankedAnswersSpec.test.ts](../tests/unit/rankedAnswersSpec.test.ts) checks 20 worked examples, including:

- **Points:** the 115-point default, custom rank points, a double-points board with survey counts, and preflight blocking bad points.
- **Style fit:** a style blocked for the wrong number of teams, and warnings when turns or face-offs don't share out evenly.
- **Classic:** buzzer and secret face-offs, clearing the board, a successful steal (bank plus row) and a failed one.
- **Face-off ladder:** rotating pairs, simultaneous steals with the bank to the highest row, and tied steals.
- **Round robin:** rotation, 12 turns for six teams, and early close.
- **All-play:** 10 teams, several scoring the same row, and the round limit.

This model is a review aid only. The app never imports it. The real mode is built through Game Kit after approval, and these examples become its acceptance tests.

## Proposed 60-minute event

| Minutes | Segment                                                    |
| ------- | ---------------------------------------------------------- |
| 0–8     | Joining, teams, chat and privacy check, captains confirmed |
| 8–12    | Practice board (synthetic)                                 |
| 12–48   | About six boards of about six minutes each                 |
| 48–55   | Buffer for recovery, disputes and ties                     |
| 55–60   | Final standings and wrap-up                                |

Fix the board count only after a timed rehearsal.

## Where real boards come from (D5)

Real boards aren't in this repository and must never be committed. Two sources work:

**Your own survey** (the classic family-feud way, and simplest for a holiday event):

1. Ask a group (friends, family, colleagues) each prompt, for example with a form, and count the answers.
2. Merge obvious duplicates into one row with aliases ("pumpkin pie", "pie"). Keep the top 4–8.
3. Use the counts as per-answer points, or use rank points.
4. Keep the raw responses private. Only the prompt, the answers and the points go into the game.

**Search suggestions** (the original Ranked Answers idea). Record privately:

1. The exact prompt, the capture time and timezone, and the language and location settings used.
2. The original suggestion order, any exclusions with the reason, and the resulting display order.
3. Tell players that suggestions depend on context and aren't survey percentages or "most searched". Nothing in play calls a live suggestion service or scrapes anything.

**Either way**, review each board privately before use: duplicates, ambiguity, anything sensitive or identity-related, and whether you have the right to show any images or sounds you add.

## Privacy notices (D6, drafts)

**For participants** (show on join, and in Help):

> You can play with just a nickname; no account is needed. Organizers can see your nickname, team and chat messages, including your team's chat. Organizers appear in chat as "Organizer". Chat text is deleted 7 days after it's sent, and a removed message is erased at once, but anyone can screenshot what's on screen. Don't share private details in chat. Your points and name stay with the game's results.

**For the operator** (in the deployment notes):

> You hold player nicknames, team membership, scores, chat text for up to 7 days, and staff accounts from the sign-in provider. Run the scheduled cleanup, and know your backup retention: deleted chat can survive in backups until they expire. Load and test tools use synthetic data only; never point them at a live event.

## Rehearsal script (W13 and W14 walk-through)

Run it with the synthetic pack, an owner, a co-host, a moderator, and at least six people on phones in three or more teams. For each step, record who did it, the clicks or taps, the time taken, errors, and anything someone had to ask about.

1. **Prepare (W13):** select the mode and the synthetic pack, run preflight, read the warnings, and start. Now possible: the mode is built ([ranked-answers-mode.md](./ranked-answers-mode.md)). The full event checklist, and a rehearsal that also covers queued buzzing, Category Grid and keyboard shortcuts, is in [event-readiness.md](./event-readiness.md).
2. **Join (W05):** everyone joins by code, gets a team, and confirms captains. Check team chat privacy: team A can't see team B's channel.
3. **Practice board:** read the prefix, set game chat to staff-only, and take the practice board through all outcomes (accept, miss, duplicate, timeout, pass).
4. **Main boards (W14):** play two boards. Confirm the starter rotates, the leftovers are revealed for 0, and the scores match a paper tally.
5. **Correction:** deliberately mis-accept one answer, correct it, and confirm scores and board state change together, with no answer re-hidden.
6. **Problems:** disconnect a captain and repair; mute a disruptive chatter mid-board (they can still play); remove a message.
7. **Tie:** create a tie and play the spare board.
8. **Recovery (W23, if approved):** use **Use basic controls** and continue with buzzers in the same room, losing nobody.
9. **Wrap-up:** finish, show final standings, and check the audience display never showed hidden answers.

**Pass:** the owner can run every step without making up a rule. Participants understand captains, team chat and the privacy notice. No hidden answer leaks to the audience display.

Steps 2, 3's chat part, and 6's chat and moderation part can be rehearsed **today** with basic controls and the chat shipped in PR09–PR11.

## Synthetic fixtures

[synthetic-pack.json](../tests/fixtures/ranked-answers/synthetic-pack.json) contains one practice board, two main boards (8 and 6 rows) and a 4-row spare. All of it is invented, and every board is marked `"source": { "kind": "synthetic" }`. It uses the default rules. It passes the model's preflight checks and is safe to use in public tests, demos and rehearsals.

## Not in this PR

- Any Game Kit or mode code (PR14+), which waits for D1–D3.
- A real question pack (never in the repository).
- A recorded rehearsal: that needs people. The script above is what to run.
