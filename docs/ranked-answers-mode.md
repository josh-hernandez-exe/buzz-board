# Ranked Answers mode

The family-feud style game mode, built so it can run a first event now. The rules started as the proposal in [pr13-ranked-answers-event-spec.md](./pr13-ranked-answers-event-spec.md) (configurable points and four play styles). They are now fully configurable: six play styles (all from two teams up; **Classic feud**, for 2–8 teams, is the TV show exactly with two teams), nine presets and options for face-offs, passing, banking, steals, shared answers, race lockouts, miss penalties and a target score, chosen when the game is created ([the rule space](./ranked-answers-rules.md)). How to use it is in the [Ranked Answers Help article](../src/help/articles/ranked-answers.md).

| Item          | Value                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Branch        | `feature/game-kit-perf` (stacked on the dashboard, rules, ops-restore and load work)                                          |
| Schema impact | Additive migration `20261021120000_game_mode`: one `GameMode` row per game (draft, frozen content, state, undo history, step) |
| Rollback      | Redeploy the previous commit. The table is ignored and boards disappear from screens; scores already awarded stay.            |

## What's built

| Part                  | Where                                                                                                                                  | Notes                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content and preflight | [content.ts](../src/utils/rankedAnswers/content.ts)                                                                                    | Zod schema shared by server and editor. Drafts may be unfinished; preflight lists what blocks starting and what's worth knowing.                                                |
| Engine                | [engine.ts](../src/utils/rankedAnswers/engine.ts)                                                                                      | Pure reducer: (state, host action) → (state, points). All four styles, buzzer or secret face-offs, practice and spare boards, tie-breaks between chosen teams, undo.            |
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
- **One-way exit:** **Use basic controls** ends the mode for good. Players, chat and scores stay; boards can't be edited or restarted in that room.
- **Game status:** starting the mode moves the game from lobby to live, as opening the buzzer does.

## Evidence

- [engine.test.ts](../src/utils/rankedAnswers/engine.test.ts) (16 tests): replays the reference model's worked examples through the real engine with identical points for every style. Also covers face-off rules, rotation, refusing a steal from the playing team, practice and double-points boards, tie-break teams, leftovers, closing early and undo.
- [rankedAnswers.test.ts](../tests/integration/rankedAnswers.test.ts) (9 tests, real PostgreSQL and Redis):
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
- Screens were checked by eye: audience display, a 360px player phone, the host controls and the editor.
- **Full validation:** `bun run check` (0 errors, the 7 existing warnings); `bun run test:all` 31 files, 415 tests passed; browser suite 15 passed twice; production build passes.

## Not done yet

- **Approval:** the rules are your call. Everything above is the proposal, and changing it is cheap while the engine is small.
- **Timers:** pacing (seconds to consult and answer) is up to the host; the engine doesn't run clocks.
- **Typed answers:** players don't submit answers in the app. Teams say them aloud or post in team chat, and the host records them. What typing would add, cost and enable is weighed in the [typed answers exploration](./typed-answers-exploration.md).
- **Undo vs. basic score undo:** the Game Controls tab's score undo/redo still works while a mode runs. Using it reverts a score without the board, so the Help article points hosts to the mode's own undo.
- **Captains:** there is no captain role yet; the host decides who speaks for a team.
- **Load:** the mode adds a little to each game-state read, but hasn't been load-tested with 100 bots.
