# PR13: Ranked Answers event rules, naming and rehearsal (proposal for owner review)

> [!important] Status: proposed, not approved
> This is the PR13 deliverable from the [delivery plan](./buzz-board-game-kit-delivery-plan.md): the package the owner reviews to pass the **Phase 2 exit**. Nothing here is approved. Every rule below is the plan's proposed default, written so it can be checked rather than invented. Game Kit and the Ranked Answers mode (PR14 onward) wait for the decisions in the next section.

## Decisions needed

| #   | Decision                                                                                               | Proposed default                                                                                                           | Blocks                    |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| D1  | Ranked Answers rules: points, turns, timing, ties, corrections                                         | As written below                                                                                                           | PR22–PR23                 |
| D2  | **W23 handoff:** can a host stop an integrated mode and continue in the same room with basic controls? | One-way **Use basic controls**; the room never returns to that mode; basic undo stops at the handoff                       | PR14 (Game Kit contracts) |
| D3  | Public names                                                                                           | Players see **Game mode**, **Ranked Answers**, **Team answer**, **Use basic controls**. "Game Kit" is for developers only. | PR14 Help and UI labels   |
| D4  | Licence and public assets (logo, sounds, screenshots)                                                  | None proposed: owner's call                                                                                                | Any public release        |
| D5  | Source-capture and rights policy for real boards                                                       | Manual capture procedure below; no real pack in the repository                                                             | First real event          |
| D6  | Participant and operator privacy notices                                                               | Drafts below                                                                                                               | First real event          |
| D7  | Backup and restore owner, and a recorded restore rehearsal                                             | Process in the [operations runbook](./operations.md#backups-and-restore)                                                   | First real event          |

## Proposed rules (D1)

### Boards and points

- A board is a prefix (for example "rainy day activities") with **4 to 8** ranked answers, stable IDs and approved aliases.
- Revealing the row at rank _n_ scores the _n_-th rank value:

  | Rank   | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   |
  | ------ | --- | --- | --- | --- | --- | --- | --- | --- |
  | Points | 30  | 25  | 20  | 15  | 10  | 8   | 5   | 2   |

  An eight-row board is worth **115 points** at most. These are game points, not percentages. A four-row board uses the first four values.

- Rank values must be positive whole numbers, strictly decreasing, with at least as many values as the longest board has rows. A whole-number multiplier (default 1) is announced and frozen before play.

### Turns

1. The team order is frozen per board. The **starting team rotates by one each board**, never by score or by who seems online. With six teams, board 2 starts with team 2.
2. The host reads the prefix. Game chat may switch to staff-only; team chat stays open.
3. Each team gives **one spoken official answer** through its captain, then the next team acts. Chat messages are never answers.
4. The first accepted, still-hidden row scores its points. A **miss, duplicate, pass or timeout scores 0** and uses the turn. There are no negative points and no carry-over.
5. The default is **two cycles**: up to 12 turns with six teams. Pacing aims for 10 seconds to consult and 5 to answer; the host judges and closes each window.
6. The board closes when every row is found, the turns run out, or the host closes it for time. The remaining rows are revealed **for 0 points**. Then standings are shown and the next board starts deliberately.

**Starter fairness:** a short board can close before every team has acted. Preflight should warn when the board count doesn't give each team a start, or when boards' totals differ, rather than claim perfect fairness.

### Corrections and problems

- A host or co-host can correct the latest result. Correcting pauses play and changes the board state and scores together. Chat, names, helpers and moderation are never part of an undo.
- A revealed answer can't be hidden again. If a hidden row is revealed by accident, the board is **compromised**: the host voids it or switches to a prepared reserve, rather than replaying that turn.
- An unsuitable board can be skipped or voided under the announced rules.
- Captain problems pause play for repair; no team is eliminated.

### Ties

- Play a prepared **spare board** under the same rules, or share the placing if the announced time runs out. There is never a speed race decided by network latency.

### Executable worked examples

[referenceModel.ts](../tests/fixtures/ranked-answers/referenceModel.ts) encodes these rules as a small model, and [rankedAnswersSpec.test.ts](../tests/unit/rankedAnswersSpec.test.ts) checks the worked examples:

- the 115-point maximum and the multiplier;
- rotation by board;
- six teams getting 12 turns, with misses, duplicates, timeouts and passes scoring 0;
- leftovers revealed for 0 in rank order;
- a board closing early when every row is found, so later teams don't act;
- the host closing for time;
- preflight rejecting non-decreasing values and short, gappy or over-long boards.

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

## Source capture for real boards (D5)

Real boards aren't in this repository and must never be committed. For each board, the organizer records privately:

1. The exact prefix, the capture time and timezone, and the language and location settings used.
2. The original suggestion order, any exclusions with the reason, and the resulting display order.
3. A private suitability review: duplicates, ambiguity, sensitive or identity-related suggestions, and whether the organizer has the right to show them.

Tell players that suggestions depend on context and aren't survey percentages or "most searched". Nothing in play calls a live suggestion service or scrapes anything.

## Privacy notices (D6, drafts)

**For participants** (show on join, and in Help):

> You can play with just a nickname; no account is needed. Organizers can see your nickname, team and chat messages, including your team's chat. Organizers appear in chat as "Organizer". Chat text is deleted 7 days after it's sent, and a removed message is erased at once, but anyone can screenshot what's on screen. Don't share private details in chat. Your points and name stay with the game's results.

**For the operator** (in the deployment notes):

> You hold player nicknames, team membership, scores, chat text for up to 7 days, and staff accounts from the sign-in provider. Run the scheduled cleanup, and know your backup retention: deleted chat can survive in backups until they expire. Load and test tools use synthetic data only; never point them at a live event.

## Rehearsal script (W13 and W14 walk-through)

Run it with the synthetic pack, an owner, a co-host, a moderator, and at least six people on phones in three or more teams. For each step, record who did it, the clicks or taps, the time taken, errors, and anything someone had to ask about.

1. **Prepare (W13):** select the mode and the synthetic pack, run preflight, read the warnings, and start. _Not possible until PR21–PR22: record as "pending build"._
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
