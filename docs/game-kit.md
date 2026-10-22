# Game Kit

Game Kit is the shared runner behind every game mode. A mode such as Ranked Answers or Category Grid is a small **module**; everything the modes share is written and tested once in [gameKit.ts](../src/server/modes/gameKit.ts). It's the plan's PR14–PR18 (W21–W23), built inside the app, not as a separate platform.

## What the runner guarantees, for every mode

| Guarantee | How |
| --- | --- |
| One mode per game | One `GameMode` row per game with a `kind`. Saving another kind's draft is refused ("set up for X, discard that setup first") |
| Drafts can't overwrite each other | `draftRevision` compare-and-set |
| Start is safe | Preflight must pass; the draft is frozen as `content`; a lobby game goes live |
| Each host action happens once, in order | Under the game lock; a `GameOperation` receipt per `requestId` (a retry is a no-op); `expectedStep` refuses a stale screen ("another host changed it first") |
| Board and scores always agree | The action's points go through the shared score writer in the same transaction |
| Deleted teams never jam play | Points for teams deleted since are skipped; undo reverses exactly what was applied |
| The scoreboard's own undo can't desync a board | After a mode changes scores, a **score-history barrier** clears the scoreboard's undo/redo stack. Manual changes made after that are undoable as usual. History rows stay stored for review |
| Honest undo | `undoInModeSession` reverses the last action's applied points and calls the module's `undo(current, previous)`, which must never hide anything people have seen |
| Safe recovery (W23 handoff) | `handOffToBasic` in one transaction: the mode ends for good, the buzzer closes, the score barrier is set, and a `mode.handoff` receipt is written |
| A broken mode never breaks the game | `publicGameModeView` returns nothing for an unknown kind or unreadable content, so scores, teams, chat and the buzzer keep working |

## Adding a mode (W22 recipe)

1. **Pure files** under `src/utils/<mode>/`:
   - `content.ts`: a zod schema for drafts (unfinished drafts allowed) and `preflight(content, teamCount)` returning `{ blocking, warnings }`.
   - `engine.ts`: `initialState(teams)`, `apply(content, state, action) → Result<{ state, scores }, RuleError>`, and an honest `undo(current, previous)`.
   - `projection.ts`: the public view. It must never include hidden content. Test it with "the hidden text is not in the JSON".
2. **A module** in `src/server/modes/<mode>Service.ts`: a `ModeModule` object (`kind`, `parseDraft`, `emptyDraft`, `preflight`, `initialState`, `withTeams`, `apply`, `undo`, `ruleError`), plus one-line wrappers that call the runner.
3. **Register** the kind in [modes.ts](../src/utils/modes.ts) (`MODE_KINDS`, `MODE_LABEL`, a branch in `publicGameModeView`), add a rule-error variant to `ModeRuleError` and its messages in [errors.ts](../src/server/api/errors.ts).
4. **Router** with `staffProcedure("runGame")`: `hostView`, `saveDraft`, `discardDraft`, `start`, `act`, `undo`, `end`. Copy [categoryGrid.ts](../src/server/api/routers/categoryGrid.ts).
5. **UI:** a host panel (editor before start, controls after), a public board component, a desk tab, an option in the create form, and a Help article.
6. **Tests:** engine unit tests, a randomised invariants test, API tests (privacy, retry, stale step, undo, deleted team), and one browser flow.

The synthetic "Quiz Maze" module in [gameKit.test.ts](../tests/integration/gameKit.test.ts) is defined only in the test and runs through the real runner and database, which is the proof that the recipe needs no other app changes.

## Handoff policy (W23)

"Use basic controls" is the plan's **proposed one-way default**, still waiting for the owner's approval:
- It ends the mode in this room for good.
- It keeps the room, players, teams, chat and scores.
- It closes the buzzer; nothing reopens by itself.
- It limits the scoreboard's undo to changes made after it.

Going back to the mode, or picking another one, means duplicating the game. A reversible handoff would need a reconciliation engine and is deferred.
