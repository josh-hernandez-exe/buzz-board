# Event readiness: checklist and dress rehearsal

For the first event: a holiday, family-feud style game for several families on a video call. Automated tests prove the rules and the code paths. This page covers what they can't: real devices, real networks, the real host, real content and real people. Work through it top to bottom, and write down anything that surprises someone.

## Before the event

| When | Do | Done when |
| --- | --- | --- |
| 6 weeks | Deploy to the real host (see the [README](../README.md#deployment)). Set Discord/Google sign-in redirect URLs for the real domain. | You can sign in on the real domain from a phone |
| 6 weeks | Schedule `bun run ops:cleanup` hourly and set up database backups ([operations](./operations.md)) | The first scheduled run succeeded |
| 5 weeks | **Backup-restore rehearsal** on the real database host ([how](./operations.md#backups-and-restore)) | `ops:verify-restore` reports no differences |
| 5 weeks | Run a **load soak** against a production build that matches the real host as closely as you can: `bun run load -- --profile soak-100 --start-server --buzzer-mode queue` (also once without `--buzzer-mode`) | Every invariant is `true`; note any latency targets missed |
| 4 weeks | Choose the format: game mode, rules, buzzing mode and team count. Write the real boards or grid, starting from the samples. **Export them** (Import or export) and keep the file somewhere safe. | A complete game passes preflight; the export file re-imports |
| 4 weeks | Pick backup content: one spare board (Ranked Answers) or a few spare questions | Saved in the export |
| 3 weeks | **Dress rehearsal** (below) | Every step passes, or has a fix and a re-test |
| 1 week | Short second rehearsal with the final content; send families the join link and a one-line "how to join" | Families know they need only a phone and the link |
| Day before | **Duplicate** the rehearsed game into a fresh game for the event, and check it opens on the right tab with the content | Fresh game ready, join code noted |

## Dress rehearsal script (about 60 minutes)

**People:** you as owner on a laptop, a co-host on a second computer, a moderator, and at least six players on their own phones in three or more teams. Use a mix of iPhone and Android, Wi-Fi and mobile data. Join them all to a video call.

**Screens:** share the audience display from one computer, with **Turn on sound**, so everyone hears through the call.

**Record for each step:** who did it, how long it took, errors, and anything someone had to ask.

1. **Create and invite.** Create the game as planned: mode, rules, buzzing and teams. Invite the co-host and moderator from **Room → Helpers**. Share the join link in the call's chat.
2. **Join on phones.** Everyone joins with a nickname and lands on a team. Check that:
   - Nobody scrolls sideways.
   - Dark mode works (theme button).
   - One person leaves and rejoins from the same phone and keeps their player.
3. **Teams and names.** The moderator renames one player, moves one between teams, and locks a name.
4. **Buzzer.** Run three plain questions with the buzzer: open, buzz, award points with one tap, next question.
   - With **Queue** on: Wrong → next in line → Correct.
   - Press **Next question** by mistake, then **Undo** it.
5. **Keyboard.** Run the next question with shortcuts only: O, then C / W / S, then N.
6. **Game mode.** Run the practice board or a few clues, then two real ones:
   - **Ranked Answers, Open answering:** teams shout; tap the teams, then the answer number. Credit two teams on one answer. Reveal the leftovers at the end.
   - **Category Grid:** the picking team chooses, open the buzzer, wrong then right, and check the pick moves.
7. **Corrections.**
   - Credit the wrong team, then **Undo**: the answer stays shown and the points come back.
   - **Void** one board or clue: its points come back.
   - Check the scoreboard against a paper tally.
8. **Two hosts.** The co-host runs one board while you watch. Both press at once once: one action counts and the other screen updates.
9. **Trouble.**
   - A player turns on aeroplane mode for 30 seconds: they see "Reconnecting" and recover.
   - The display computer reloads.
   - Mute a chatter mid-board: they can still buzz.
   - Remove a message.
10. **Fallback.** On a duplicate of the game, press **Use basic controls** mid-board, then carry on with the buzzer and manual scores.
11. **Finish.**
    - **Room → Finish game**: the display shows the winner and places, and phones show "You finished …".
    - **Reopen**, fix a score, finish again.

**Pass:**
- You ran every step without making up a rule.
- Players understood how to join, buzz and see results without help.
- The display never showed a hidden answer or clue.
- The scoreboard matched the paper tally.
- Sound came through the call.

## On the day

- **Open early:** open the host desk and the display 20 minutes before. Check that **Turn on sound** works through the call.
- **Two desks:** keep the co-host's desk open as a backup controller.
- **If something misbehaves:**
  - Use **Undo** or **Void** first.
  - If a game mode gets stuck, use **Use basic controls** and keep going with the buzzer and manual scores. Scores stay.
  - If the app is unreachable, keep score on paper and carry on by voice. Re-enter the scores afterwards with **More score tools → Set**.
- **Afterwards:** finish the game so results stay visible. You can reopen within 24 hours to correct them.
