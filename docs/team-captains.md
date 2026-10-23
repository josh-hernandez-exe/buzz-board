# Team captains

An **option** for team games, off by default. By default everyone on a team can buzz and save quiz answers. With **captains-only** on, only each team's captain can. Teammates still see the team's buzzer state, saved answers and chat.

## Who is captain

- `GameTeam.captainId` (unique; `ON DELETE SET NULL`) is kept filled whenever the team has members: the earliest-joined current member (lowest player number), until someone chooses another.
- `repairCaptains(tx, gameId)` ([captains.ts](../src/server/roster/captains.ts)) runs under the game lock after every membership change (join, move, removal). A captain who moved, left or was removed is replaced by the earliest member left. Stale captains are cleared before new ones are assigned, so the unique key never collides when a captain moves to another team.
- Captains are maintained even while the rule is off, so switching it on is instant and hosts can pick captains in advance.
- The migration backfills a captain for every existing team game.
- The plan proposed "no automatic election". The owner was unavailable, and automatic first-joined captains with free reassignment were chosen as the friendlier default for family events, so a team never ends up locked out.

## Choosing a captain

| Who | Where | Rule |
| --- | --- | --- |
| Owner, co-hosts, moderators (`moveRoster`) | Players tab, **Make captain** | Any current member of a team |
| The captain | Team tab, **Make captain** | Only to a current teammate |

Changes take effect from the next buzz or answer save. Turning the rule on or off is `gameAdmin.setCaptainsOnly` (`runGame`), and is also offered when creating a game. Duplicating a game copies the setting.

## Enforcement

`mayActForTeam(game, team, gameUserId)` is true unless the game is a captains-only team game and someone else captains the team. A team without a captain (no members yet) never locks anyone out.

- **First buzz wins:** checked before the claim, so a teammate's refused buzz never closes the window for everyone, and checked again under the lock in case the captain changed in between.
- **Queue:** checked under the lock, before the team's existing entry is considered.
- **Sequential Quiz answers:** checked under the game lock in `submitTeamAnswer`.
- Refusals are `FORBIDDEN`: "Only your team captain, Ana, can do that in this game", linked to Help.

The player's buzzer says **Buzzer open: only your captain, Ana, can buzz.** and stays disabled. Team-level news (won, sat out, place in the queue) is shown to everyone on the team as before.

## Tests

- [captains.test.ts](../tests/integration/captains.test.ts): first-joined captain, moves and removals, staff and moderator choice, hand-off rules, captains-only buzzing in both modes (including that a refused buzz doesn't close the buzzer), switching off, quiz answers, creation, duplicate, and refusal for individual games.
- [buzzerStatus.test.ts](../src/app/_components/client/PlayerStatus/buzzerStatus.test.ts): player messages.
- [captainsAndLibrary.spec.ts](../tests/e2e/captainsAndLibrary.spec.ts): the browser flow.
