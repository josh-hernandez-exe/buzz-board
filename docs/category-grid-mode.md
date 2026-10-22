# Category Grid mode

A quiz-show grid: categories across the top, clues worth more as you go down. It's the plan's **Category Grid** module (W15, PR25 in the [delivery plan](./buzz-board-game-kit-delivery-plan.md)). It's built directly, like [Ranked Answers](./ranked-answers-mode.md), rather than on the full Game Kit platform, and uses the same patterns: a pure engine, a game-locked service, a public projection and a host desk tab. How hosts use it is in the [Help article](../src/help/articles/category-grid.md).

## Choosing a game mode

- When creating a game, **Game** offers **Buzzer and scoreboard**, **Ranked Answers** or **Category Grid**. Either mode can also be set up later from its host-desk tab.
- A game runs one mode at a time (one `GameMode` row per game, with a `kind`). The desk shows the tab for the mode the game is set up for, or both before one is chosen.
- To switch before starting, use **Discard setup** on the other mode. **Duplicate** copies the mode's rules and content.

## What's built

| Part | Where | Notes |
| --- | --- | --- |
| Content | [content.ts](../src/utils/categoryGrid/content.ts) | The plan's Question Bank v1 shape (`schemaVersion`, `kind`, `title`, `questions`, `modes.categoryGrid.columns/rules`), with image/GIF, audio and YouTube media ([media.ts](../src/utils/media.ts): HTTPS only, no credentials, exact YouTube hosts, privacy-enhanced embeds). Other layouts (`modes.pubQuiz`) are kept. Up to 8 categories × 10 rows; rectangular. Preflight blocks empty titles, clues or answers, missing or repeated questions and ragged grids. |
| Rules | content.ts | `wrongAnswerLockout` (default on) and `wrongAnswerPenalty` (`none` default, or `clueValue`), as in the plan |
| Engine | [engine.ts](../src/utils/categoryGrid/engine.ts) | Pure reducer. Open a clue (the selecting team's pick) → judge right or wrong → reveal → back to the grid. A right answer scores and takes the next pick; an unanswered or voided clue leaves the pick where it was. Host can pass the pick. A void takes back only that clue's points. |
| Projection | [projection.ts](../src/utils/categoryGrid/projection.ts) | Closed tiles carry only label and points. A clue's text appears while it's open, and its answer only once shown. Accepted answers and host notes never reach players. |
| Service and API | [categoryGridService.ts](../src/server/modes/categoryGridService.ts), [categoryGrid.ts](../src/server/api/routers/categoryGrid.ts) | Owners and co-hosts only. Each action runs under the game lock with scores in the same transaction. Retries are applied once; a stale screen gets "another host changed it first". Teams deleted since are skipped, so they never block play or undo. |
| Host desk | [CategoryGridPanel](../src/app/_components/client/CategoryGridPanel/index.tsx) | Grid editor (titles, values, clue, answer, accepted answers, notes, sample, JSON import/export, preflight), then the grid to pick from, the clue with its answer, Correct/Wrong pre-filled from whoever holds the buzz, reveal, void, pass the pick, undo |
| Board | [CategoryGridBoard](../src/app/_components/client/CategoryGridBoard/index.tsx) | On the player's Buzzer tab, large on the audience display, and on the desk |
| Sample | [sample.ts](../src/utils/categoryGrid/sample.ts) | An invented 5 × 5 holiday trivia grid |

## Buzzer

The grid uses the game's buzzer; there's no separate one. With **Also update the buzzer** (on by default), each step is mirrored on the buzzer after the grid action succeeds:

| Grid step | Buzzer (queue mode) | Buzzer (first-buzz mode) |
| --- | --- | --- |
| Open a clue | **Next question**: nobody is locked out | Same |
| Right answer | The answering entry is marked **Correct** | **Next question** |
| Wrong answer, lockout on | The entry is marked **Wrong**; the next in line answers | Reopens for the other teams |
| Wrong answer, lockout off | The entry is **skipped**; the team may buzz again | Fresh question, reopened |
| Show answer, or void | **Close buzzer** | Same |

The host opens the buzzer themselves after reading the clue ("deliberately opens buzzers", W15).

## Honesty rules

- **A clue that was shown can't be played again.** Undoing *opening* a clue marks the tile void.
- **A shown answer stays shown** across undo, so the host can re-judge (for example after crediting the wrong team).
- **Void** reverses exactly the points that clue gave or took, and gives the pick back.

## Evidence

- [engine.test.ts](../src/utils/categoryGrid/engine.test.ts):
  - Sample validity and preflight, media accepted and unsafe media blocked, and media sent only while a clue is open.
  - Scoring and the pick, lockout and penalty, void, wrong-phase refusals.
  - Undo honesty and privacy of the projection.
  - 300 randomised games checking that seen clues stay used, seen answers stay seen, players never get an unshown answer, and totals equal replaying history.
- [categoryGrid.test.ts](../tests/integration/categoryGrid.test.ts):
  - Creation with rules and sample, duplicate, and mutual exclusion with Ranked Answers.
  - Preflight refusal, and moderators and players refused.
  - Privacy of clue and answer in player and public state, scores, and the pick.
  - Retry applied once, stale screen refused, undo.
  - Void, and a deleted team never jamming undo.
- [categoryGrid.spec.ts](../tests/e2e/categoryGrid.spec.ts) (browser): create from the dashboard, the desk opens on the grid, a clue is shown on screens, a buzzed team is wrong and locked out, the next buzz is right, the answer and score reach the display, and the tile shows who got it.

## Not done yet

- **Uploads** (PR20, UploadThing): media is added by link only. Uploads need a provider account and your approval.
- **Wagers / "daily doubles"**, a final round, and timers. These are not in the plan's MVP either.
- **A shared question library** across modes (Phase 4A) and Sequential Quiz (Phase 4C).
