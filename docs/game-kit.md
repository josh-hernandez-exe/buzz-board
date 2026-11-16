# Game Kit

Game Kit is the shared runner behind every game mode. A mode such as Ranked Answers, Category Grid or [Sequential Quiz](./sequential-quiz-mode.md) is a small **module**; everything the modes share is written and tested once in [gameKit.ts](../src/server/modes/gameKit.ts). It's built inside the app, not as a separate platform.

## What the runner guarantees, for every mode

| Guarantee | How |
| --- | --- |
| One mode per game | One `GameMode` row per game with a `kind`. Saving another kind's draft is refused ("set up for X, discard that setup first") |
| Drafts can't overwrite each other | `draftRevision` compare-and-set. Host views carry `gameId`, and a host panel ignores a view for another game: the browser's query cache isn't keyed by game, so after moving between host desks it can hold the last game's draft |
| Start is safe | Preflight must pass; the draft is frozen as `content`; a lobby game goes live |
| Each host action happens once, in order | Under the game lock; a `GameOperation` receipt per `requestId` (a retry is a no-op); `expectedStep` refuses a stale screen ("another host changed it first") |
| Board and scores always agree | The action's points go through the shared score writer in the same transaction |
| Deleted teams never jam play | Points for teams deleted since are skipped; undo reverses exactly what was applied |
| The scoreboard's own undo can't desync a board | After a mode changes scores, a **score-history barrier** clears the scoreboard's undo/redo stack. Manual changes made after that are undoable as usual. History rows stay stored for review |
| Honest undo | `undoInModeSession` reverses the last action's applied points and calls the module's `undo(current, previous)`, which must never hide anything people have seen |
| Safe recovery | `handOffToBasic` in one transaction: the mode ends for good, the buzzer closes, the score barrier is set, and a `mode.handoff` receipt is written |
| A broken mode never breaks the game | `publicGameModeView` returns nothing for an unknown kind or unreadable content, so scores, teams, chat and the buzzer keep working |

## Adding a mode

1. **Pure files** under `src/utils/<mode>/`:
   - `content.ts`: a zod schema for drafts (unfinished drafts allowed) and `preflight(content, teamCount)` returning `{ blocking, warnings }`.
   - `engine.ts`: `initialState(teams)`, `apply(content, state, action) → Result<{ state, scores }, RuleError>`, and an honest `undo(current, previous)`.
   - `projection.ts`: the public view. It must never include hidden content. Test it with "the hidden text is not in the JSON".
2. **A module** in `src/server/modes/<mode>Service.ts`: a `ModeModule` object (`kind`, `parseDraft`, `emptyDraft`, `preflight`, `initialState`, `withTeams`, `apply`, `undo`, `ruleError`), plus one-line wrappers that call the runner. Two optional hooks: `enrich(tx, gameId, content, state, action)` fills in server-side facts before `apply` (Sequential Quiz adds which teams answered), and `ignoresStep(action)` exempts actions that carry their own conflict check from the stale-step rule (quiz marks carry the verdict the screen showed).
3. **Register** the kind in [modes.ts](../src/utils/modes.ts) (`MODE_KINDS`, `MODE_LABEL`, a branch in `publicGameModeView`), add a rule-error variant to `ModeRuleError` and its messages in [errors.ts](../src/server/api/errors.ts).
4. **Router** with `staffProcedure("runGame")`: `hostView`, `saveDraft`, `discardDraft`, `start`, `act`, `undo`, `end`. Copy [categoryGrid.ts](../src/server/api/routers/categoryGrid.ts).
5. **UI:** a host panel (editor before start, controls after) that takes the page's `gameId` and shows "Loading…" until `hostView` returns that game's view, a public board component, a desk tab, an option in the create form, and a Help article.
6. **Tests:** follow the [testing folder structure](./testing.md#folder-structure):
   - Engine unit tests and randomised invariants tests belong in `tests/unit/utils/<mode>/`, mirroring `src/utils/<mode>/`. See the Ranked Answers [engine tests](../tests/unit/utils/rankedAnswers/engine.test.ts) and [invariants tests](../tests/unit/utils/rankedAnswers/fuzz.test.ts).
   - Host-panel component tests belong in `tests/unit/app/_components/client/<Panel>/`. See [SequentialQuizPanel.test.tsx](../tests/unit/app/_components/client/SequentialQuizPanel/SequentialQuizPanel.test.tsx).
   - API tests (privacy, retry, stale step, undo, deleted team) stay in `tests/integration/<mode>.test.ts`.
   - Add one browser flow in `tests/e2e/<mode>.spec.ts`.

The synthetic "Quiz Maze" module in [gameKit.test.ts](../tests/integration/gameKit.test.ts) is defined only in the test and runs through the real runner and database, which is the proof that the recipe needs no other app changes.

## Handoff policy

"Use basic controls" is a **one-way handoff**:
- It ends the mode in this room for good.
- It keeps the room, players, teams, chat and scores.
- It closes the buzzer; nothing reopens by itself.
- It limits the scoreboard's undo to changes made after it.

Going back to the mode, or picking another one, means duplicating the game. Reversible handoff is not supported; it would need a way to reconcile intervening manual score changes with the mode's state.
