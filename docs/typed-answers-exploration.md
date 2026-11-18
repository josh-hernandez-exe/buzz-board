# Typed answers beyond Sequential Quiz

> **Future proposal:** typed answers already work in Sequential Quiz. This page considers extending them to Ranked Answers and other formats; those extensions are not implemented or committed to a release.

## Current behavior

| Area | Implemented behavior |
| --- | --- |
| [Sequential Quiz](./sequential-quiz-mode.md) | One saved answer per team and question, revision-checked replacement, host grouping and marking, and scoring on reveal |
| [Team captains](./team-captains.md) | Any teammate can save by default; captains-only games restrict saves to the captain |
| Answer privacy | Only the submitting team and owners/co-hosts can read quiz answer text. Other teams, moderators and the audience display cannot |
| [Ranked Answers](./ranked-answers-mode.md) | Teams speak or post in team chat; the host records the matched row or miss. There is no dedicated player answer box |
| [Category Grid](./category-grid-mode.md) | The buzzer decides who answers; the host judges the spoken answer |

The buzzer and typed answers solve different problems. A buzzer decides **who answers and in what order**; a typed submission records **what they answered**. Typing should not replace the buzzer as a speed contest.

## Possible extensions

- **Ranked Answers all-play:** collect each team's answer in one private list rather than making the host read several chat channels.
- **Secret face-offs and multi-team steals:** collect answers privately, close the window and judge them together.
- **Answer suggestions:** group identical answers and suggest a board row or alias for the host to confirm. Fuzzy suggestions would be new behavior, not an existing matching guarantee.
- **Buzz, then type:** retain the buzz order while letting teams type when audio is difficult.

Timed individual bonus rounds and closest-number formats are separate future possibilities, not prerequisites for these extensions.

## Proposed flow

1. The host opens an answer window for the current board and phase.
2. A team saves or replaces its answer. The UI distinguishes a local draft, an in-flight save, a server-confirmed answer, a conflict, and a failed or late save. Captains-only settings still apply.
3. The host closes the window and sees received/missing counts and grouped answers. Chat messages do not automatically become submissions.
4. The host confirms the matched rows and applies the existing Ranked Answers action. Board state and scores change together, and mode undo keeps revealed answers visible.
5. Players see their own submission; the audience sees progress and revealed board rows, not raw submitted text.

## Implementation considerations

The quiz already provides storage, conflict checks, an answer composer and host grouping. Its answer keys and endpoints are quiz-specific; extending them requires an explicit design rather than assuming they work for arbitrary board phases.

| Area | Work for an extension |
| --- | --- |
| Storage and lifetime | Scope submissions to the game, mode session, board and phase; define retention and whether a shared answer-window model is needed |
| Service | Open/close windows under the game lock, reject late or stale submissions, preserve revision checks and rate limits, and enforce team/captain access |
| Live updates | Publish progress without answer text; refresh private views only for authorized teams and hosts |
| Matching | Reuse the quiz's meaning-preserving normalization where appropriate; keep any new fuzzy matching advisory until the host confirms |
| Host controls | Add received/missing lists and suggested rows to all-play, face-off and steal controls |
| Tests and Help | Cover cross-team privacy, captains, conflicts, late saves, double actions, undo and reconnects before exposing the new flow |

## Trade-offs and open decisions

Typing can help with noisy calls and many simultaneous teams, but it slows phone users and adds host review work. Keep spoken play available, use short answers, and give teams enough time.

Before implementing an extension, decide:

- Which Ranked Answers phases need it first: all-play, steals or secret face-offs.
- Whether exact matches can be accepted automatically or always require host confirmation.
- Whether raw answers ever become visible beyond the team and hosts. The current quiz keeps them private even after reveal.
- How long submitted text is retained.
- Whether event experience shows enough benefit to justify the extra controls.
