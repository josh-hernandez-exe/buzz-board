# Queued buzzing and buzzer history

Two host features for the buzzer:

1. **Queued buzzing (opt-in).** Instead of only the first buzz counting, every team that buzzes joins a queue in order, and the host works through it. The default stays exactly as today: the first buzz wins.
2. **Buzzer history.** Every host buzzer action can be undone and redone, so an accidental press (Next question instead of Wrong, say) never loses who buzzed.

## Words

| Word | Meaning |
| --- | --- |
| **Question** | One round of buzzing, from **Next question** to the next **Next question**. Internally a "window" number. |
| **First-buzz mode** | Today's behaviour, and the default: the first buzz wins and closes the buzzer. |
| **Queue mode** | Every buzz joins the queue; the buzzer stays open until the host closes it. |
| **Answering** | The team at the front of the queue, whose answer the host is judging. |

## Queue mode: flows

### Host

| Situation | Host does | What happens |
| --- | --- | --- |
| Ask a question | **Open buzzer** | Players can buzz. Each buzzing team joins the queue in order; the first becomes **answering**. |
| The answering team is right | **Correct** | Marked correct; the buzzer closes; the rest of the queue stays visible but doesn't play on. Points are separate: **+ points** next to the team adds them in one tap. |
| The answering team is wrong | **Wrong** | Marked wrong and locked out for this question; the next team in the queue becomes answering. Late buzzes still join the back. |
| The answering team doesn't answer (left, frozen, passing) | **Skip** | Moves on with no lockout: the team may buzz again for this question. |
| An accidental buzz is waiting in the queue | **Remove** on that entry | Taken out without lockout. |
| Stop more buzzes but keep the queue | **Close buzzer** | No new buzzes; the host can still work through the queue. **Open buzzer** again lets more join. |
| Move on | **Next question** | Clears the queue and every lockout; the buzzer stays closed until opened. |
| Someone got it; ask the next question | **Open buzzer for a new question** | Same as **Next question** then **Open buzzer**: a fresh queue with no lockouts. |
| Nobody is answering and the queue is empty | Nothing | The buzzer stays open; the next buzz becomes answering at once. |

### Players

| State | Buzzer says |
| --- | --- |
| Buzzer open, not queued | **Buzz** |
| Queued | "You're 3rd in line" (or "Your team is 3rd: Ada buzzed") |
| Answering | "Your team is answering!" |
| Wrong this question | "Not this time: your team is locked out until the next question" |
| Correct | "Correct!" |
| Buzzer closed | as today |

One entry per team per question: a teammate's buzz counts for the team ("Ada already buzzed for your team"). Muted chat never affects buzzing, and the chat lock is separate.

### Audience display

The queue in order with team names and status (answering, waiting, wrong, correct), in large type, and "Buzzers are open!" while open.

### Switching modes

**Buzzing: First buzz / Queue** is in the header of the host desk's Buzzer panel and in the create-game form. It can only change while the buzzer is closed, and switching starts a new question so the two modes never mix. It's recorded in buzzer history like any other action.

## Buzzer history: undo and redo

- **What's recorded:** before each host buzzer action (open, close, next question, correct, wrong, skip, remove, mode switch), a snapshot of the buzzer state: open or closed, mode, the current question, every team's buzzer state, and the status of each queue entry in that question.
- **Undo** restores the snapshot before the last action; **Redo** re-applies it. Buttons name the action ("Undo: Next question"), and the desk lists the last few actions with times.
- **Players' buzzes are never undone or lost.**
  - Undoing a host action leaves every queue entry made after it in the queue.
  - Those buzzes were judged against state the undo removed, so the queue is then tidied: only the earliest answering entry stays answering (others go back to waiting), the next in line answers if nobody is and nobody got it, and only the answering team is selected.
  - Undoing **Next question** brings the previous question back, with its winner or queue.
  - An accepted buzz clears the redo list, as typing does in an editor, because redo would otherwise overwrite it.
- **Scores are separate:** they keep their own undo and redo. **Correct** doesn't award points by itself, so undoing a buzzer action never changes scores silently.
- **Bounds:** the last 50 actions are kept.

## Data model (additive migration)

| Change | Why |
| --- | --- |
| `Game.buzzerMode` (`first` by default) | Opt-in queue mode |
| `Game.buzzerWindowHigh` | Questions are never reused, even after undo: a new question always gets a number above any used before. Without this, undoing then reopening could pick a number that already has a winner. |
| `BuzzQueueEntry` (game, question, position, team, player, status, request ID) | The queue. Unique per question and position, and per request ID (retries are safe). Rows are never deleted, so history can restore any status. |
| `BuzzerHistory` (one row per game: past, future) | Undo and redo stacks, kept off the `Game` row because that row is read on every request. |

**First-buzz mode is unchanged:** one durable claim per question, losers answered without the lock, and the same tests. Queue mode takes the game lock for every buzz, because positions must be assigned in order. That's milliseconds per buzz, and it doesn't touch first-buzz games.

## Tests

- First-buzz mode: all existing buzzer tests pass unchanged.
- Queue mode:
  - order under concurrent buzzes (unique, gapless positions);
  - one entry per team; retries;
  - correct, wrong (lockout, advance), skip (re-buzz allowed) and remove;
  - close keeps the queue; next question clears it;
  - late buzzes join the back;
  - mode switch only while closed.
- History:
  - undo and redo of every action;
  - undoing Next question restores the winner (first mode) or the queue;
  - players' buzzes survive undo;
  - a new action or an accepted buzz clears redo;
  - a reopen after undo never reuses a question number;
  - the 50-entry bound.
- Browser: a queue-mode question with three teams (wrong, then correct), an undo of an accidental Next question, and the player and display views.
