# Ranked Answers reference model

This page documents the historical rules baseline kept in [referenceModel.ts](../tests/fixtures/ranked-answers/referenceModel.ts) and its executable examples. The app does not import this model. It provides independent scoring examples for regression tests, not the current runtime's full rules or content format.

For current behavior, use [Ranked Answers mode](./ranked-answers-mode.md) and [the rule space](./ranked-answers-rules.md). The runtime supports six styles and up to ten rows per board; this reference model keeps four original styles and four to eight rows. Its separate two-team **Classic** and multi-team **Face-off ladder** styles correspond to the runtime's **Classic feud**.

## Reference rules

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

These are the original style categories, not the current preset recommendations. The runtime defaults to Open answering.

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

1. Each team contributes **one answer** per round (**3 rounds** by default, configurable 1–8). The model receives the host's matched row IDs, not free-text player submissions.
2. The host locks the round and reveals. **Every team** whose answer is a row still hidden at the start of that round scores it, so several teams can score the same row. Rows found in an earlier round score 0.
3. The board ends after the last round or when every row is found.

Each round evaluates all teams together. The reference model does not implement answer collection; the current Ranked Answers host records answers heard aloud or read in team chat.

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

[referenceModel.ts](../tests/fixtures/ranked-answers/referenceModel.ts) encodes these rules, and [rankedAnswersSpec.test.ts](../tests/unit/rankedAnswersSpec.test.ts) checks worked examples, including:

- **Points:** the 115-point default, custom rank points, a double-points board with survey counts, and preflight blocking bad points.
- **Style fit:** a style blocked for the wrong number of teams, and warnings when turns or face-offs don't share out evenly.
- **Classic:** buzzer and secret face-offs, clearing the board, a successful steal (bank plus row) and a failed one.
- **Face-off ladder:** rotating pairs, simultaneous steals with the bank to the highest row, and tied steals.
- **Round robin:** rotation, 12 turns for six teams, and early close.
- **All-play:** 10 teams, several scoring the same row, and the round limit.

The [runtime engine tests](../tests/unit/utils/rankedAnswers/engine.test.ts) compare the corresponding styles against these independent examples. Current option-specific behavior is covered separately in [variants.test.ts](../tests/unit/utils/rankedAnswers/variants.test.ts).

## Synthetic fixtures

[synthetic-pack.json](../tests/fixtures/ranked-answers/synthetic-pack.json) contains one practice board, three main boards and a spare. All content is invented, and every board is marked `"source": { "kind": "synthetic" }`.

This fixture uses the reference model's format, not the host editor's import format. For the editor's import format, start with the [sample boards](../src/utils/rankedAnswers/sample.ts).

## Preparing real boards

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

Current participant privacy guidance is in [Chat Help](../src/help/articles/chat.md); retention, backups and cleanup are documented in the [operations runbook](./operations.md). Asset and content rights are covered in [licensing](./licensing.md).
