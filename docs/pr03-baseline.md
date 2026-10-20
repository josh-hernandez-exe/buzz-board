# PR03: shared score writer, receipts and score-effect evidence

This is the recorded evidence for **PR03** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR02](./pr02-baseline.md).

| Item          | Value                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch        | `feature/game-kit-pr03-score-effects` (from PR02)                                                                                                                                                      |
| Schema impact | Additive migration `20261020120000_score_operations`: new `GameOperation` and `ScoreEffect` tables. No existing column changes.                                                                        |
| Rollback      | Redeploy the PR02 app. It ignores the new tables, and scores and history stay in the existing `Scoreboard`/`ScoreboardState` format. Undo/redo after a rollback uses the old (buggy) redo order again. |

## PR03 contract

- **Scope:**
  - A single shared write path for manual scores, with actor-bound receipts and immutable per-unit deltas.
  - Fixes for the concurrency, redo-order and zero-input defects that PR01 pinned.
  - Integer bounds, and errors that tell the host what went wrong.
- **Workflows/tests:** T05.
- **Non-goals:**
  - Buzzer claims and streams, which are PR04.
  - Activity, correction and void compensation, and control epochs. These are Phase 3: their columns will be added to `GameOperation`/`ScoreEffect` by the Game Kit PRs.
  - Any change to how the scoreboard displays history.

## Design

- **One writer:** `runScoreCommand` in [scoreService.ts](../src/server/scores/scoreService.ts) handles `add`, `set`, `undo` and `redo`. It runs inside `withGameLock` (PR02). In one transaction it:
  1. reads the current state;
  2. writes the next state and history pointers;
  3. creates the `GameOperation` receipt;
  4. creates one `ScoreEffect` per unit whose score actually changed.
- **Scores are not recalculated from effects:** current scores still come only from `Scoreboard.currentState`. Effects are evidence and are never summed into a total, so there is no second score.
- **Retries:** receipts are unique per `(gameId, requestId)` and store the action, actor and a SHA-256 hash of the canonical payload. Retrying the same request returns the stored result with `replayed: true`. Reusing the ID for a different payload, action or actor returns `CONFLICT`. Receipts contain no bodies or tokens.
- **Evidence survives:** effects are not foreign keys to `GameTeam` or `ScoreboardState`, so they outlive removed teams and cleared redo branches.
- **Opening balances:** legacy scores are kept as-is, and no provenance is invented for writes made before PR03.
- **Fractional legacy scores:** `delta` and both before/after values are `double precision`, so old fractional balances are recorded exactly. New input must be a whole number: at most ±1,000,000 per change, with a result within ±1,000,000,000.
- **Pure arithmetic:** [scoreMath.ts](../src/server/scores/scoreMath.ts) does the calculations and returns neverthrow `Result`s. Legacy states that are missing a unit or hold a non-numeric value read as 0.
- **History semantics:** `pastStateIds` is a stack whose last element is the previous state, and `futureStateIds[0]` is the next state to redo.
  - Undo pushes the current state onto the front of `futureStateIds`; redo takes the front.
  - A new change clears the redo branch, and a change that alters nothing does not add an undo step.
  - Legacy redo stacks are already in this order, because the old undo also prepended. Only the old redo was wrong.
- **API:**
  - The endpoints accept `{ requestId, changes }`, and undo/redo accept `{ requestId }`. The bare `{ [teamId]: amount }` shape that pre-PR03 tabs send is still accepted (with a server-generated ID, so no retry deduplication); this was verified against a production build in the two-instance spike.
  - Errors are typed: `BAD_REQUEST` with a readable message for invalid amounts, out-of-range results and unknown teams; `CONFLICT` for a busy game or a reused ID; `NOT_FOUND`.
  - State is published after commit. A publish failure is logged and does not undo or repeat the saved change.
- **Admin control:**
  - The input is text, so `0`, negative numbers, an empty field and a lone `-` are handled correctly. **Set to 0 now works.**
  - Each click sends a new ID from `newRequestId()`, which uses `crypto.getRandomValues` so it also works on plain-http LAN addresses.
  - Buttons are disabled while saving, a disabled button explains why, and server errors are shown.
- **Removed code:** the unlocked `checkTeamsAndGetCurrentScores` helper. Nothing calls it any more.

## Evidence

| Case                                                                                                                                                                    | Test                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20 parallel `addScore(+1)` → 20, with 20 undo steps and no errors (PR01: 1 success, 19 deadlocks or timeouts)                                                           | [scoreboard.test.ts](../tests/integration/scoreboard.test.ts)                                                                                               |
| 0 → 10 → 30, two undos, redo → 10 → 30; interleaved undo/redo                                                                                                           | scoreboard.test.ts                                                                                                                                          |
| Fractional, oversized and empty changes are rejected without side effects; no-op changes add no undo step                                                               | scoreboard.test.ts                                                                                                                                          |
| A retry returns the original result; 8 concurrent retries apply once; a reused ID with a different change or a different admin gets `CONFLICT`; IDs are scoped per game | [scoreEffects.test.ts](../tests/integration/scoreEffects.test.ts)                                                                                           |
| The action and actor are recorded for add, set, undo and redo                                                                                                           | scoreEffects.test.ts                                                                                                                                        |
| Actual deltas are recorded, not requested amounts (setting an unchanged value records nothing)                                                                          | scoreEffects.test.ts                                                                                                                                        |
| An undone branch's evidence survives a new change; evidence survives team removal                                                                                       | scoreEffects.test.ts                                                                                                                                        |
| Opening balance plus recorded deltas equals the current score, including under concurrent add/undo                                                                      | scoreEffects.test.ts                                                                                                                                        |
| A legacy game keeps its scores with no invented provenance, and its legacy redo stack redoes in the right order after upgrade                                           | scoreEffects.test.ts with the PR02 legacy fixture                                                                                                           |
| Populated upgrade through both migrations leaves legacy columns identical; no drift                                                                                     | [migrations.test.ts](../tests/integration/migrations.test.ts)                                                                                               |
| Bounds, legacy fractions, missing units and stable effect ordering                                                                                                      | [scoreMath.test.ts](../src/server/scores/scoreMath.test.ts)                                                                                                 |
| Zero, negative and invalid text input; a unique request ID per click; a disabled reason is shown                                                                        | [GameAdminScoreboardAdvancedControl.test.tsx](../src/app/_components/client/GameAdminScoreboardAdvancedControl/GameAdminScoreboardAdvancedControl.test.tsx) |

## Commands and results

| Command                             | Result                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `bun run check`                     | 0 errors, 9 warnings (unchanged)                                              |
| `bun run test`                      | 32 passed                                                                     |
| `bun run test:integration`          | 7 files: 63 passed, 1 expected fail (Redis subscriber leak, PR04)             |
| `bun run test:e2e`                  | 2 passed, twice in a row                                                      |
| `bun run build`                     | Passes                                                                        |
| `bun tests/spike/twoInstance.ts 10` | Legacy-shape score writes on a production build; 50/50 delivered per instance |

## Deferred to Phase 3, by design

- **The plan's activity arithmetic fixture is not yet run:** opening A=100/B=50; an activity gives A+30, which is corrected to A−30/A+25; then B+7; voiding the activity must give A=100/B=57, and voiding again must change nothing. This needs activity IDs, which arrive with Game Kit sessions/activities.
- **Ready for it:** the effect table already records actual per-unit deltas tied to the operation and is never edited, which is what that compensation will sum.
- **Control epochs:** the score-history boundary after a handoff to basic controls also arrives with Game Kit.
