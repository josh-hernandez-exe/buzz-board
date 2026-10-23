# Sequential Quiz mode

Sequential Quiz is the plan's W16 / PR17 + PR26: pub-quiz rounds with **typed team answers**. Questions go in a fixed order. While a question is open, every team types one answer on a phone. The host locks answers, marks them (identical answers grouped), and reveals the answer and the points together. There's no buzzer race. It is the "simultaneous format" that [typed answers exploration](./typed-answers-exploration.md) identified as the one place typed answers are clearly worth it.

It's built on [Game Kit](./game-kit.md), so the runner's guarantees apply. These cover retries, stale screens, scores in the same transaction, deleted teams, the score-history barrier and the W23 handoff. Help: `/help/sequential-quiz`.

## Content

Content is the shared question bank ([Category Grid](./category-grid-mode.md) format, version 1). The quiz layout is `modes.pubQuiz`: `questionOrder` (question IDs, in play order; one ID may appear twice) and `pointsPerQuestion`. One bank can hold a grid and a quiz built from the same questions, and import/export keeps both. Questions support media (pictures, GIFs, audio, YouTube) exactly as in the grid.

The preflight blocks:
- no teams
- an empty order
- an order that names a missing question
- a question with no prompt or no answer
- bad media

It warns about repeated questions, questions left out of the order, and more than 40 teams.

## Play

| Phase | Host can | Teams see |
| --- | --- | --- |
| ready | Open first question, Finish | "Get ready", question count |
| open | Lock, Void | The question; their answer box; "x of y answered" |
| locked | Reopen (until the answer was shown), Mark, Mark the rest wrong, Reveal (once every team is marked), Void | "Answers are locked" and their saved answer |
| revealed | Next question, Finish | The answer, which teams got it, their own verdict |
| finished | — | "That's the end of the quiz" |

- **Marking** is per team. The desk groups identical answers (case, accents, spaces and punctuation ignored) so one tap marks a group. **Mark exact matches correct** marks every answer equal to the answer or an accepted wording. **Mark the rest wrong** marks unmarked teams that answered as wrong and teams that didn't as missing.
- **Reveal** awards `pointsPerQuestion` to each team marked correct, once, through the shared score writer.
- **Void** closes the question with no points and without showing the answer.
- **Undo** reverses the last action and its points. Undoing a reveal returns to marking with the answer still showing. Answering never reopens after that, even when undoing back past the lock.

## Team answers

- **Storage.** Answers are stored in their own `TeamAnswer` table, one row per game, question key (`"<position>:<questionId>"`) and team. Mode state doesn't hold them, so teams never wait on each other or on the host. The team ID isn't a foreign key: an answer stays as evidence if the team is deleted.
- **Who can save.** By default any player on the team can save or replace the answer. If the game is **captains-only** (an option at creation and on the Room tab), only the team's captain can, and teammates see a read-only view of the saved answer (`myAnswer.answeredByCaptain`). The answer records who saved it last, and every teammate sees the current answer. See [team captains](./team-captains.md).
- **No silent overwrites.** A save sends the revision the player last saw. If a teammate saved since, the save is refused with the teammate's answer (`CONFLICT`), and the phone shows it with "Saving yours replaces it" or "Keep theirs".
- **Checked under the game lock.** Saves are refused once answers are locked ("Answers are closed… your answer wasn't saved"). Blank answers are refused, and saves are limited to 60 per player per minute.
- **Privacy.**
  - Answer text reaches only the team that wrote it (`sequentialQuiz.myAnswer`) and owners and co-hosts (`sequentialQuiz.responses`).
  - Moderators, other teams and the display never see it, before or after the reveal.
  - The shared game state carries only which teams answered, plus a content-free `answerVersion` counter so teammates' phones refresh.
- **Individual games.** Each player is their own team, so they answer for themselves.

## Concurrent hosts

Marks don't need the latest step, so two hosts can mark different teams at once. Each mark carries the verdict its screen showed (`from`). If another host changed that team's mark first, the mark is refused (`CONFLICT`) and the screen refreshes. Each mark and each answer save also carries the question its screen showed, so neither can land on the next question if the quiz moved on while it was being sent. Marks don't advance a desk's view of the step, so the desk's next step-checked action is still checked against what it last showed. Every other action still needs the latest step.

## Tests

- [engine.test.ts](../src/utils/sequentialQuiz/engine.test.ts): rules, preflight, normalisation, projection privacy, and a 300-seed randomised play-and-undo invariant test. The invariants: points always equal recorded results, a shown answer is never hidden again, and there is one result per question.
- [sequentialQuiz.test.ts](../tests/integration/sequentialQuiz.test.ts): creation and duplicate, roles, privacy before and after the reveal, teammate conflicts, blanks, late saves, reopen, no team, individual games, reveal once with retry, undo, the score barrier, two hosts marking, a deleted team, void, and handoff.
- [sequentialQuiz.spec.ts](../tests/e2e/sequentialQuiz.spec.ts): the browser flow from creation to points on the display.

## Not built

- Timers.
- Partial credit.
- A "review every question" screen at the end.
- Letting players see other teams' answers after the reveal.
