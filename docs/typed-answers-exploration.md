# Typed answers: exploration

> [!note] Status: exploration for a decision, nothing built
> This weighs whether Buzz Board should let players **type** answers in the app, what that would take, and which games it would make possible. It ends with a recommendation and the decisions the owner needs to make. It builds on the plan's existing **Team answer** design for Sequential Quiz (W16 in the [delivery plan](./buzz-board-game-kit-delivery-plan.md)).

## Summary

- **The buzzer and typed answers do different jobs.** The buzzer decides **who answers and in what order** (speed, turn-taking, lockouts). A typed answer carries **what they answered**. Typing replaces *speaking*, not *buzzing*.
- **Speed formats keep the buzzer.** A typed answer only helps there when speaking is the problem (a noisy call, a secret face-off).
- **Simultaneous formats don't need a buzzer at all.** These are all-play boards, pub-quiz rounds and secret steals. For them, typed answers are the natural way to collect many answers at once, privately.
- **For the first event (families on a call), typed answers aren't needed.** Buzz formats work with spoken answers. All-play and multi-team steals work with captains posting in their **team chat**, which hosts can already read in **All channels**.
- **Worth building later**, as one shared feature ("Team answer"), when either of these happens:
  - You run all-play with many teams (about 8 or more).
  - You want pub-quiz style rounds (the plan's Sequential Quiz).
- **Smallest useful slice:** about three PRs. The rest of this page has the detail.

## Why have a buzzer if teams can type?

Because they answer different questions:

| Question in the game | Tool | Why |
| --- | --- | --- |
| Who gets to answer first? | Buzzer | A race needs one shared, server-decided order; the queue makes it fair for many teams |
| Whose turn is it? | Buzzer / host | Turn styles (Classic, Round robin, Pass-along) decide by rules, not by typing |
| What did each team say, when they all answer at once? | Typed answers | Speaking over each other doesn't scale; a typed list does |
| What did they say, without the other teams hearing? | Typed answers | Secret face-offs and steals need privacy |
| Who typed the right answer first? | Neither, ideally | A typing race rewards fast typists and good connections, and invites searching the web. Use the buzzer for speed, and typing for content |

So the two combine rather than compete:

- **Buzz, then speak** (today): best in a room or on a call with good audio.
- **Buzz, then type**: the buzz queue fixes the order and each team in line types its answer. The host sees answers in queue order, with no talking over each other. Useful on laggy calls.
- **No buzzer, everyone types**: all-play, quiz rounds and secret steals. The host closes the window, then judges and reveals.

## What it would enable

| Game or improvement | Without typed answers | With typed answers |
| --- | --- | --- |
| **All-play** Ranked Answers with 8–50 teams | Captains post in team chat; the host reads All channels and picks each team's row from a menu | Each team's answer arrives in one list. Rows are **suggested** from the board's answers and aliases, and the host confirms them in one tap |
| **Secret face-offs and multi-team steals** | Teams say answers aloud (no longer secret) or post in team chat | Private by design; revealed together |
| **Unique-answers all-play** ("Scattergories" style) | Works, but the host has to spot duplicate answers by ear | Identical answers are grouped automatically |
| **Pub-quiz rounds** (the plan's Sequential Quiz) | Not possible | The core feature: answer each question, then grade and reveal |
| **Fast-money style bonus round** | Not possible fairly (needs per-player timed input) | Possible, with a timer per player and no repeated answers |
| **Closest-number questions** ("How many lights on the tree?") | Shouting numbers | Typed numbers, closest wins, sorted automatically |
| **Accessibility** | Hard-of-hearing or shy players depend on teammates | Anyone on the team can see and type (if the team allows) |
| **Disputes** | "I said tinsel first!" | A timestamped record of what each team submitted |

## What it costs players and hosts

| Concern | Detail | Mitigation |
| --- | --- | --- |
| Typing on phones is slow | Especially for children and older relatives, and under time pressure | Short answers only; generous windows; a captain types for the team |
| Less "game-show energy" | Shouting answers is half the fun at a family event | Keep typing optional per board or round; buzz formats stay spoken |
| Spelling | "Ornamints" | Matching ignores case, punctuation and accents, uses aliases, and **suggests** fuzzy matches; the host always confirms |
| Searching the web | Typing time is googling time | Short windows, and honour-system reminders. Ranked Answers is about opinions (survey answers), which is harder to search |
| Host overload | 40 unique answers to judge | Grouping of identical answers, and one-tap "match to row". Recommend team play, not individual, for big events (as W16 says) |
| Who types for a team? | Several devices per team | One **Team answer** per team that any member (or only the captain) can replace until the window closes; everyone sees the latest |
| Moderation | Answers can be rude | Text is only shown to hosts. The display shows the matched board row, never raw text, unless the host reveals it |

## How the user flows would change

**Players.**
- When the host opens an answer window, the Buzzer tab shows a **Team answer** box with **Save** (or **Replace**) under the board.
- After saving, it shows "Received 19:42: *lights*" and lets them change it until the window closes.
- Chat is never an official answer.
- Players never see other teams' answers before the reveal.

**Host (Ranked Answers).**
- During all-play, a secret face-off or a steal, the desk shows **Open answers** and **Close answers**, plus a received/missing count.
- The answer list is grouped by suggested row: "#1 Lights ← Owls, Foxes".
- The host confirms or changes each match, then presses **Reveal round**. It's today's action, with the picks pre-filled from the typed answers. Undo works as now.

**Host (quiz rounds, later).** Each question opens a window. The host locks it, grades (with grouping), resolves teams that didn't answer, and finalises. Scores land on the scoreboard (W16).

**Audience display.** It shows "7 of 9 teams answered" while the window is open, and the matched rows on reveal. It never shows raw text.

**Moderators.** No access to typed answers, the same as hidden board answers (they don't run the game).

## Work required

| Part | What | Size |
| --- | --- | --- |
| Data | `AnswerWindow` (game, purpose such as rankedAllPlay, steal, faceOff or quiz question, status open/closed/finalised, opened and closed times), `TeamAnswer` (window, team or player, text, revision, submitter, timestamps), retention like chat | Small migration |
| Service | Open and close windows under the game lock; save or replace with revision checks; one answer per team per window; rate limits; refuse after close; staff read; team members read their own | Medium |
| Live updates | Players learn about open and closed windows from the game state. Hosts get answers through a staff-only refresh signal. Answer text is never in public state | Small: reuses the chat pulse pattern |
| Matching | Normalise text (case, punctuation, accents, plurals), match exactly against answers and aliases, suggest fuzzy matches by edit distance. Pure and unit-tested; suggestions only | Small |
| Player UI | Team-answer composer with distinct Draft, Sending, Received, Replaced, Failed and Closed states (W16). Phone-first | Medium |
| Host UI | Answer list with grouping, one-tap match, missing teams, and "pre-fill picks" into all-play, steal and face-off controls | Medium |
| Display | Answered counts and reveal | Small |
| Quiz rounds | The Sequential Quiz mode itself (question bank, grading, finalise) | Large: the plan's PR24 and PR26 |
| Tests and Help | Unit (matching), integration (windows, privacy, concurrency), e2e (all-play with typed answers), a Help article | Medium |

**Suggested slices:**
1. **Answer windows and Team answer**: backend, privacy, retention, and the player composer.
2. **Ranked Answers integration**: host answer list, matching suggestions, and pre-filled all-play, steal and secret face-off picks.
3. **(Later) Sequential Quiz** on the same service, as the plan already describes.

## Recommendation

1. **For the first event: don't build it.** Use spoken answers with the buzzer (queue mode for many teams). For all-play and multi-team steals, ask captains to post in team chat, which the host reads in **All channels**.
2. **After the event, decide from what happened.** Build slices 1–2 if any of these were painful:
   - All-play with many teams.
   - Hearing answers on the call.
   - Keeping steals secret.
3. **Never make typing the way to decide speed.** The buzzer stays the source of "who first".

## Decisions for the owner

| # | Decision | Options | Suggested |
| --- | --- | --- | --- |
| T1 | Build typed answers now, after the first event, or not at all | now / after / never | After, based on how the event goes |
| T2 | Who types for a team | any member (last save wins) / captain only | Any member, with the latest answer visible to all (simpler for families); add captains with Sequential Quiz |
| T3 | Where typing is used first | all-play only / plus steals and secret face-offs / plus quiz rounds | All-play, steals and secret face-offs (slice 2) |
| T4 | Automatic matching | suggest only / auto-accept exact matches | Suggest only: the host always confirms |
| T5 | Show raw text on the display | never / host chooses / always | Host chooses, per answer, after the reveal |
