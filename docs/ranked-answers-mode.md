# Ranked Answers mode

Ranked Answers is a family-feud style game mode with six play styles, nine presets and configurable face-offs, passing, banking, steals, shared answers, race lockouts, miss penalties and a target score. Every style supports at least two teams; **Classic feud** supports 2–8. Hosts choose rules when creating the game or edit them before starting ([the rule space](./ranked-answers-rules.md)). How to use it is in the [Ranked Answers Help article](../src/help/articles/ranked-answers.md).

It runs on [Game Kit](./game-kit.md). One `GameMode` row per game stores the draft, frozen content, state, undo history and step. For deployment rollback, follow the [migration and fallback procedures](./vercel-migration-plan.md#5-fallback-procedures); an older application must be checked for compatibility with the current database.

## Implementation

| Part                  | Where                                                                                                                                  | Notes                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content and preflight | [content.ts](../src/utils/rankedAnswers/content.ts)                                                                                    | Zod schema shared by server and editor. Drafts may be unfinished; preflight lists what blocks starting and what's worth knowing.                                                |
| Engine                | [engine.ts](../src/utils/rankedAnswers/engine.ts)                                                                                      | Pure reducer: (state, host action) → (state, points). All six styles, buzzer or secret face-offs, practice and spare boards, tie-breaks between chosen teams, undo.            |
| Public projection     | [projection.ts](../src/utils/rankedAnswers/projection.ts)                                                                              | What players and the display get: hidden rows carry no text and no points.                                                                                                      |
| Service and API       | [rankedAnswersService.ts](../src/server/modes/rankedAnswersService.ts), [rankedAnswers.ts](../src/server/api/routers/rankedAnswers.ts) | Owner and co-host only (`runGame`). Each action runs under the game lock and awards points through the shared score writer in the same transaction.                             |
| Host desk             | [RankedAnswersPanel](../src/app/_components/client/RankedAnswersPanel/index.tsx)                                                       | Editor (rules, boards, per-answer points, multipliers, sample boards, JSON import/export, live preflight), then step-by-step controls with the hidden answers shown in italics. |
| Board                 | [RankedAnswersBoard](../src/app/_components/client/RankedAnswersBoard/index.tsx)                                                       | On the player's Buzzer tab, large on the audience display, and as a preview on the host desk.                                                                                   |
| Sample                | [sample.ts](../src/utils/rankedAnswers/sample.ts)                                                                                      | Invented holiday boards: practice, three main (one 2×) and a spare.                                                                                                             |

## Safety properties

- **No early reveal:** hidden answers never leave the server except to owners and co-hosts.
- **Board and scoreboard agree:** each action changes the board and the scores in one transaction.
- **No double actions:** a retried request is applied once. Two hosts acting on the same screen state: only the first counts, and the other gets "Another host changed the board first". The host desk advances its own step immediately, so quick clicks don't trip this.
- **Undo is honest:** it takes back the points, but an answer already shown stays shown, for 0 points, so it can't be scored again.
- **Score history is bounded by mode actions:** whenever a mode changes scores, Game Kit clears the manual scoreboard's undo/redo stack. Use the mode's undo for its actions; manual score changes made afterwards remain undoable until the next mode score change.
- **One-way exit:** **Use basic controls** ends the mode for good. Players, chat and scores stay; boards can't be edited or restarted in that room.
- **Game status:** starting the mode moves the game from lobby to live, as opening the buzzer does.
- **Captains:** the optional [captains-only rule](./team-captains.md) controls who can buzz. Ranked Answers outcomes are still recorded by the host, not submitted through an answer box.

## Evidence

- [engine.test.ts](../tests/unit/utils/rankedAnswers/engine.test.ts): replays the [reference model's worked examples](./ranked-answers-reference.md) through the real engine for the original styles. Also covers face-off rules, rotation, refusing a steal from the playing team, practice and double-points boards, tie-break teams, leftovers, closing early and undo. Additional styles and options are covered in [variants.test.ts](../tests/unit/utils/rankedAnswers/variants.test.ts).
- [rankedAnswers.test.ts](../tests/integration/rankedAnswers.test.ts) (real PostgreSQL and Redis):
  - draft conflicts; preflight refusal; a style that doesn't fit the team count;
  - moderators and players refused the host view;
  - a full Classic feud board with exact scores, and no hidden answer text in player or public state at any point;
  - practice and 2× boards;
  - concurrent retries and a stale screen (applied once);
  - undo returning points while keeping the row shown;
  - face-off ladder simultaneous steals;
  - ending the mode.
- [rankedAnswers.spec.ts](../tests/e2e/rankedAnswers.spec.ts) (browser):
  - the host loads sample boards, saves, starts and runs a Classic feud face-off, play, strikes and a steal;
  - the player page and the audience display show each answer only once revealed;
  - the bank and status line update live, and the score lands on the scoreboard.
- See [testing](./testing.md) for validation commands and optional responsiveness measurements.

## Current limitations and future work

- **Timers:** pacing (seconds to consult and answer) is up to the host; the engine doesn't run clocks.
- **Typed answers:** Ranked Answers players say answers aloud or post in team chat, and the host records them. Extending the quiz's typed-answer support to this mode is a [future proposal](./typed-answers-exploration.md), not current behavior.
- **Load:** the load runner exercises the shared buzzer, scores and chat, not a full Ranked Answers session. Mode-specific load measurements are still needed.
