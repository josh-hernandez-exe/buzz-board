# Ranked Answers: the rule space

Ranked Answers ("family-feud style") has been played many ways: on TV, in classrooms, at parties, over video calls and with dozens of teams. This page lists **every dimension the rules can vary along**, what Buzz Board implements for each, and the variants left out (with why). The engine is in [engine.ts](../src/utils/rankedAnswers/engine.ts), the options in [content.ts](../src/utils/rankedAnswers/content.ts), and players and hosts read about them in the [Help article](../src/help/articles/ranked-answers.md).

The host chooses the rules **when creating the game** (or later, on the host desk, until Ranked Answers starts). They pick a **preset** and can then change any option. Presets are only starting points: a preset is a set of option values, and the editor shows "Custom rules" once an option differs from every preset.

## 1. Who answers when (the play style)

This decides the shape of a board. Every other option hangs off it.

| Style | Teams | Flow | Built |
| --- | --- | --- | --- |
| **Open answering** | 2–50 | No turns: any team answers any time; the host reveals a row and credits every team that got it | Yes (new; suggested for 3+ teams) |
| **Classic feud** (`faceOffLadder`) | 2–8 | The TV format: with two teams, the show exactly; with more, a rotating pair faces off each board → play or pass → the playing team answers until it clears the board or strikes out → steal | Yes |
| Classic, two teams only | 2 | The TV show exactly | **Merged into Classic feud** (owner decision, 2026-10-28: two-team events are supported, though most events have more teams). Classic feud plays it identically with two teams; drafts or games saved with the old style load as Classic feud |
| **Round robin** | 2–12 | One answer per team per turn, rotating; starting team rotates per board | Yes |
| **Pass-along** | 2–12 | A team keeps answering until it misses, then the next team takes over | Yes (new) |
| **Buzz race** | 2–50 | Every answer is a buzzer race: first to buzz answers; a hit scores, a miss locks the team out | Yes (new) |
| **All-play** | 2–50 | Every team answers privately at once each round; reveal together | Yes |
| Bracket tournament | 4–16 | Pairs play classic matches, winners advance | No: needs a bracket screen and seeding; head-to-head pairs plus the scoreboard covers a casual version |
| Fast money / bonus round | 1–2 players | One player answers five boards against a clock; a second player can't repeat answers; reach a target | No: it needs per-player timed input, which is a typed-answers feature. See [typed answers exploration](./typed-answers-exploration.md) |

## 2. How the playing team is chosen (face-off styles)

| Option | Values | Notes |
| --- | --- | --- |
| **Face-off** | `buzzer` (first to buzz answers; the top row wins at once, otherwise both answer and the higher row wins), `secret` (both answer, higher row wins), `none` (the playing team rotates board by board) | With the buzzer, the host desk pre-selects whoever holds the buzz |
| **Face-off winner** (`allowPass`) | play or pass, always play | Passing is the TV rule; some hosts drop it to keep things moving |
| Pairing (3 or more teams) | rotating pairs | Fixed by the engine: pairs rotate so every team faces off equally (preflight warns when boards don't divide evenly) |

## 3. Where points go while a team plays (face-off styles)

| Option | Values | Notes |
| --- | --- | --- |
| **Points while playing** (`scoring`) | `bank` (rows build a bank paid to the board's winner), `direct` (each row scores for whoever found it, face-off rows included) | Direct is gentler: a team that strikes out keeps what it found |
| **Strikes** | 1–5 | 3 is the TV rule |
| **Steal by** (`stealBy`) | `opponent`, `everyone`, `none` | Default: everyone, so the whole room plays every board (the "head-to-head" preset uses opponent). `none` ends the board at the last strike; the playing team keeps the bank |
| **Steal reward** (`stealReward`) | `bankPlusRow` (TV), `rowOnly` (the playing team keeps the bank) | Hidden with direct scoring, where there's no bank to win |
| **Several correct steals** (`stealWinner`) | `bestRow` (highest row takes the bank; other correct steals score their own row), `allCorrect` (every correct stealer takes the bank) | Only shown when everyone steals |

## 4. Turn styles

| Option | Values | Notes |
| --- | --- | --- |
| **Answers or turns per team** (`turnCycles`) | 1–4 | Round robin: answers per team. Pass-along: turns per team (a turn ends at a miss) |
| **A full round with no new answer** (`endOnEmptyCycle`) | keep going (default), closes the board | Round robin only: once every team has had a turn without finding anything new (repeats, misses and passes count), the board closes |

## 5. Buzz race

| Option | Values | Notes |
| --- | --- | --- |
| **After a wrong answer** (`raceLockout`) | `untilNextFind`, `afterStrikes` (uses **Strikes** as misses per team per board), `none` | If every team is locked out "until the next find", everyone gets another go; if everyone has struck out, the board closes |

The race uses the real buzzer. In queue mode the buzz queue *is* the race order, so the host desk can mark the buzzer at the same time ("Also update the buzzer", on by default). The buzzer is updated only after the board action succeeds, and only for the team that holds the buzz:
- **Right answer:** the queue entry is marked Correct, which closes the buzzer. In first-buzz mode the buzzer moves to **Next question**.
- **Wrong, and the rules sit the team out:** the entry is marked Wrong and the next in line answers. In first-buzz mode the buzzer reopens for the other teams.
- **Wrong, but the rules don't sit the team out:** the entry is skipped, so the team may buzz again. In first-buzz mode the buzzer starts a fresh question and reopens.
- **Everyone is out:** the buzzer moves to **Next question**, so every team can race again.

**Open buzzer** after a correct answer starts a fresh question, so every team can race for the next row.

## 6. All-play and open answering

| Option | Values | Notes |
| --- | --- | --- |
| **Rounds per board** | 1–8 | |
| **Same row found by several teams** (`sharedAnswers`, all-play and open answering) | `full` (each scores it), `split` (points divided, rounded down), `uniqueOnly` (nobody scores a shared row, "Scattergories" style) | The row is revealed either way, so it can't be scored later |

## 7. Points and the end of the game

| Option | Values | Notes |
| --- | --- | --- |
| **Points by rank** | positive, strictly decreasing, up to 10 | Default 30/25/20/15/10/8/5/2 |
| Per-board / per-answer points | survey counts or custom values | On each board |
| **Multiplier** | game-wide, and per board | "Double points" final boards |
| **Points lost for a miss** (`missPenalty`) | 0–1000 | Applies when one team alone was answering: a strike, a round robin or pass-along miss, a race miss. Not in all-play or steals. Practice boards never change scores |
| **Target score** | none, or a number | Shown on every board ("First to 300 points wins") and announced when reached. Informational: the host still finishes |
| Practice and spare boards | per board | Practice never scores; spare boards run tie-breaks between chosen teams |
| Clear-the-board bonus | — | No: the bank already rewards clearing; a host can add points by hand |
| Timers | — | No: pacing stays with the host, as in the rest of the app |

## Turn-order review

Before the first event the engine was reviewed line by line and tested with randomised games ([fuzz.test.ts](../src/utils/rankedAnswers/fuzz.test.ts)): every preset at several team counts, random legal and illegal host actions and random undos. After every step it checks:
- No row is revealed twice, and a shown row stays shown.
- Points awarded match the scores reported.
- The bank only holds banked rows.
- Nobody loses points without a penalty, and boards don't pay more than they're worth where the rules allow one payout.
- The turn and control teams are the ones the rotation says.
- From any state the host can close the board and finish.

A heavier run of about 27,000 games of up to 500 steps also passes. The review fixed:
- A repeated face-off answer that was already on the board could win the face-off.
- A deleted team could jam scoring and undo, and a team added after the start could never play.
- Undo could let a board whose answers had been seen be played again.

Fixed rotations are pinned by explicit tests:
- **Round robin:** order within a board; the first team moves on each main board, and practice or spare boards don't move it.
- **Classic feud:** every team faces off equally often, for 2 to 8 teams (with two, they face off every board).
- **No face-off:** every team plays the same number of boards.

## Compatibility

All new options are optional fields. Drafts and running games saved before them load unchanged, because `resolveRules` fills in each style's previous behaviour (for example the ladder's "everyone steals"). The original engine tests pass unmodified; [variants.test.ts](../src/utils/rankedAnswers/variants.test.ts) covers every new option, and [rankedAnswers.test.ts](../tests/integration/rankedAnswers.test.ts) creates a game with rules chosen up front, duplicates it, and plays a buzz race through the API.
