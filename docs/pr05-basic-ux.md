# PR05: basic create, join, resume and lifecycle

This is the recorded evidence for **PR05** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR04](./pr04-baseline.md). It covers the basic workflows W01, W05, W06 (in part), W17 and W18 (in part), with chat and optional modes off. Basic-release help and copy (PR06) are still to come.

| Item           | Value                                                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch         | `feature/game-kit-pr05-basic-ux` (from PR04)                                                                                                                                                                                                        |
| Schema impact  | Additive migration `20261020140000_game_lifecycle`. It adds `Game.status` (`lobby`/`running`/`finished`), `finishedAt`, `joiningOpen`, `teamAssignment` (`auto`/`choose`/`staff`) and `creationRequestId`, with a unique key on owner + request ID. |
| Existing games | The migration backfills them as `running`, with players choosing their own team, which is today's behavior. Only new games start in the lobby with automatic team assignment.                                                                       |
| Rollback       | Redeploy PR04. It ignores the new columns, but finished games would become playable again under PR04.                                                                                                                                               |

## What changed for people

**Hosts**

- **Landing page:** **Join a game** and **Host a game** are always shown. Players are told they don't need an account.
- **Create form:** one short form with an editable name, _As teams_ / _Individually_, and a 1–8 team stepper (default 2). The format default is now what is actually shown; before, the form displayed `team` and submitted `individual`. Creating opens the host desk directly. A double-click or retry returns the same game instead of a second room.
- **Room panel** at the top of the host desk:
  - Share: join code, **Copy join link**, QR code, and **Open audience display**, with a reminder to share that window rather than the host desk.
  - Players: player count, an **Allow new players to join** switch, and the team-assignment policy.
  - Game: lifecycle status, **Finish game…** (with confirmation), **Reopen to correct results** (within 24 hours), **Duplicate**, and **Delete…** (owner only, by typing the game name; only finished games or unused lobbies).
- **Lifecycle:** opening the buzzer moves a game from lobby to live.
- **Dashboard:** lists games you created **or help run**. The old `every` filter would have hidden a game with two hosts from one of them.

**Players**

- **Join form:** code (pre-filled from a link) and a **nickname** on one screen, and nothing joins automatically. A signed-in player's account name is never used as their nickname.
- **Resume:** if this browser has played in that game, **Resume as Ada on Owls** is offered first. **Join as someone new** is an explicit choice for shared devices.
- **Player header:** shows the game, the code, and "You are Ada on Owls". After finish, a notice says the game has ended.
- **Buzzer status:** the buzzer always says why it can or can't be pressed:

  - _Buzzer open: press now!_
  - _Buzzer closed. Wait for the host to open it._
  - _You / Your team buzzed in first!_
  - _Foxes buzzed in first._
  - _Your team already had its turn this round._
  - _Pick a team to play._ / _Waiting for your host to put you on a team._
  - _This game has finished._

  While live updates are reconnecting, the button stays enabled so stale state never blocks a real buzz.

- **Leave this room on this device:** forgets only this browser's credential for that game. The player's name, team and points stay on the server.
- **Team tab:** explains when the host assigns teams.
- **Phone layout:** the player, join and host pages fit a 360 px phone. Fixed 400/700 px widths were removed.

## Server rules

- **Service:** `gameService.ts` handles create, duplicate, join, resume preview, finish/reopen, joining open/closed, team policy and delete. All game-state changes run under `withGameLock`.
- **Names:** players, teams and games go through `normalizeName`:

  - It trims, applies NFC, and counts at most 40 code points (60 for games).
  - It rejects newlines, C0/C1 controls and bidi overrides or isolates.
  - It keeps emoji, ZWJ sequences, combining marks and right-to-left text.

  This replaces `z.string().min(1).max(32)`, which counted UTF-16 units.

- **Joining** happens under the game lock: player numbers are unique, and **automatic** assignment puts each new player on the team with the fewest players (ties go to the lowest number). A returning player is never moved. `staff` leaves new players unassigned and blocks self-switching. `choose` keeps the old behavior.
- **After finish:** joining, buzzing, opening the buzzer, score add/set/undo/redo, player renames, team renames and team switches are rejected with "This game has finished". Results stay readable.
- **Reopen** returns the game to `running` with the buzzer closed. After 24 hours, reopen explains that the host should duplicate the game instead.
- **Duplicate** copies the name (with "(copy)" added), format, settings, team policy and team names. It copies **no** players, credentials, scores, history or helpers, and the person duplicating becomes the owner.
- **Delete:** owner only, with the exact name typed. Only a finished game or a lobby with no players and no operations can be deleted. Cascades remove all of its data.
- **Errors:** every service error now goes through one `toTRPCError` with messages people can act on. For example, "No game has that code. Check it with your host." and "Joining is closed for this game. Ask your host to open it."
- **Per-game player cookie:** `buzz-board-game-user-token.<gameId>` lets a server-rendered page find the right player even after the browser joined another game. Client tabs also keep credentials per game (`tokensByGame`).
- **Removed:** `DropDownSelection`, the component that caused the format-default bug.

## Evidence

| Area                                                                                                                                                                                                       | Tests                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Name normalization: NFC, 40/41 boundary, astral emoji, ZWJ, variation selectors, RTL; rejects controls, C1 and bidi; blank names; game-name limit                                                          | [displayName.test.ts](../src/utils/displayName.test.ts) (17)                                 |
| Create defaults, team counts 0/9/2.5 rejected, name rules, 5 concurrent retries create one game, request IDs scoped per host                                                                               | [lifecycle.test.ts](../tests/integration/lifecycle.test.ts)                                  |
| Nickname normalized; account name never published; invalid nickname explained; resume ignores a new nickname; resume preview; unknown code                                                                 | lifecycle.test.ts                                                                            |
| 13 concurrent joins over 3 teams: sizes differ by at most 1, numbers 1–13 unique; no rebalance on resume; staff policy; individual backing team named after the nickname                                   | lifecycle.test.ts                                                                            |
| Closed joining blocks newcomers with a message, lets existing players resume, and reopens                                                                                                                  | lifecycle.test.ts                                                                            |
| Lobby → live on first buzzer open; finish blocks 9 kinds of change but keeps results; reopen within 24 h; refused after 24 h or when not finished                                                          | lifecycle.test.ts                                                                            |
| Delete: name confirmation, full cascade, unused lobby only, not a running game or a lobby with players, owner only                                                                                         | lifecycle.test.ts                                                                            |
| Duplicate copies setup only, with the co-host as owner; dashboard lists created and helped games but not strangers'                                                                                        | lifecycle.test.ts                                                                            |
| A server render finds this game's player via the per-game cookie after another game took the shared cookies                                                                                                | [roster.test.ts](../tests/integration/roster.test.ts)                                        |
| Every buzzer state message, including rejected-while-open and policy-dependent missing team                                                                                                                | [buzzerStatus.test.ts](../src/app/_components/client/PlayerStatus/buzzerStatus.test.ts)      |
| Join form: no auto-join, nickname and code validation, server error shown, resume offer, join as someone new                                                                                               | [JoinGame.test.tsx](../src/app/_components/client/JoinGame/JoinGame.test.tsx)                |
| Room panel: code, status, display link, owner-only delete with typed name, explained delete block, reopen window, policy change                                                                            | [HostRoomPanel.test.tsx](../src/app/_components/client/HostRoomPanel/HostRoomPanel.test.tsx) |
| Browser: create (double-click makes one room) → share → 2 guests on different teams → close joining (newcomer told why) → start (Live) → finish (players see it, buzzer disabled) → reopen (buzzer closed) | [hostJourney.spec.ts](../tests/e2e/hostJourney.spec.ts)                                      |
| Browser: resume after reopening the link; leave on this device forgets the credential but keeps the player                                                                                                 | hostJourney.spec.ts                                                                          |
| Browser: join and buzz on a 360 × 740 phone with no sideways scrolling at any step                                                                                                                         | hostJourney.spec.ts                                                                          |

## Commands and results

| Command            | Result                              |
| ------------------ | ----------------------------------- |
| `bun run check`    | 0 errors, 9 warnings (same as PR01) |
| `bun run test:all` | 17 files, 178 passed                |
| `bun run test:e2e` | 7 passed, in two consecutive runs   |
| `bun run build`    | Passes                              |

## Not done in PR05

- **Help and copy:** public Help/FAQ, original styling tokens and the safe-display polish are PR06.
- **Guest recovery:** organizer-assisted recovery links (W06) arrive with invitations in PR08. Until then, a guest who leaves on a device, or loses it, can only come back as a new player.
- **Signing in later:** guest profiles are still linked to an account automatically when a signed-in browser presents their token (pinned in roster.test.ts). Explicit linking is PR08.
- **Practice copy and private preview** (W02) belong with optional content (Phase 3). **Duplicate** covers reuse for basic games.
- **Not measured:** real phones and screen readers. Keyboard and 360 px checks are automated in Chromium only.
