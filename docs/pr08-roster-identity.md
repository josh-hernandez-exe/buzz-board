# PR08: names, roster guards, removal, account linking and guest recovery

This is the recorded evidence for **PR08** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR07](./pr07-helpers.md) and covers W06–W09 (except chat and captains), with tests T02–T04 and T06.

| Item          | Value                                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch        | `feature/game-kit-pr08-roster-identity` (from PR07)                                                                                                                                                                                            |
| Schema impact | Additive migration `20261020160000_roster_identity`: `GameUser.allowSelfRename`, `nameVersion` and `removedAt`; `GameTeam.allowMemberRename` and `nameVersion`. Recovery links reuse PR07's `GameInvite` table with `purpose = guestRecovery`. |
| Rollback      | Redeploy PR07. Removed players would reappear (their old credential was replaced, so they still can't act), and locks would be ignored.                                                                                                        |

## Names and rename locks (W07, W08)

- **One write path:** [rosterService.ts](../src/server/roster/rosterService.ts) is the only place names change. Player endpoints (`changeName`, `changeTeamName`) and staff endpoints (`roster.renamePlayer`, `roster.renameTeam`) all go through it, under the game lock, with the shared name rules (NFC, 40 code points, no controls or bidi overrides).
- **Rename and lock in one save:** staff can rename and set **Stop this player renaming themselves** (or **Stop team members renaming it**) together. Unlocking is the same visible action.
- **Locks follow the player:** they are stored on the player and team, so they survive a resume, a recovery link and a linked device.
- **Stale edits are refused:** each name has a `nameVersion`. A player saving a draft that started before a staff rename gets "This name was changed by someone else while you were editing. Your text is kept…", so a moderated name can't be overwritten.
- **Individual games:** renaming a player keeps their scoring unit's label in sync, and team renaming is rejected.
- **After finish:** players can't rename, but staff can still correct a final name.
- **Player side:** **Edit my game profile** shows locked fields as disabled with the reason, keeps typed text when a save is refused, and says it changes only this game, not the account. There is now one edit button on the Info tab instead of two.

## Moves (W09)

- **Same rules for everyone:** players and staff move through `movePlayer`. **Moves wait while the buzzer is open** for both ("…Pause it first, then try again."). Before, staff could move a player mid-buzz and change who was eligible.
- **Unassign:** staff can choose **No team** (`targetGameTeamId: null`). Points stay with the team that earned them.
- **Player limits:** self-moves still respect `freezeTeams`, the host-assigns policy and finished games.
- **Individual games** reject moves.

## Removal (W09)

- **Immediate:** `roster.removePlayer` works at once, **even while the buzzer is open**. The player gets `removedAt`, and their credential is replaced with one nobody has.
- **Where it takes effect:**
  - Every request and server-rendered page denies the old credential.
  - The player disappears from the roster, team member lists, the public player count, and automatic team balancing.
  - Their open private stream ends with "You were removed from this game.", checked against each live snapshot, so no extra database query per viewer.
- **What stays:** a buzz they already won, their team's points and the claim's team are kept. They can't be recovered.
- **Rejoining:** closing joining is what stops them coming back as someone new. The UI and Help say so, and don't promise a ban.

## Account linking (W05, W06)

- **No silent linking:** previously, a signed-in browser presenting a guest token silently linked the guest to the account. PR01 pinned this as "current behavior". Joining while signed in also no longer saves the player to the account.
- **Explicit save:** **Save this player to my account** (`gameUser.linkAccount`) is the only way to link.
  - It refuses if the player is already saved to another account.
  - It refuses if the account already has a different player in that game ("Your account already has a player in this game (Ada)…").
- **Other devices:** on a signed-in device, the join page offers **Resume as Ada** for the account's saved player (`public.linkedPlayers` and `public.resumeLinked`). It hands over the same credential, so the first device keeps working. Other accounts never see the player.

## Guest recovery (W06)

- **Who and when:** owners and co-hosts (not moderators) create a **Recovery link** for an unlinked guest who is still in the game, after verifying them in the meeting.
- **The link:** works once and expires in 15 minutes, and only its hash is stored. Creating one cancels any older unused link for that player.
- **Opening it:** the page shows the game and the player name, and does nothing until **Continue as …** is chosen.
- **Using it** (under the game lock):
  1. Re-checks that the link is valid, the player is still in the game, and they haven't since saved to an account.
  2. Issues a **new credential**, which signs out the old device.
  3. Keeps name, team, points and locks.
- **After use:** a used link can't issue another credential; the host makes a new one.
- **Separate from staff invitations:** a recovery link can't be accepted as a staff invitation, and a staff invitation can't be redeemed as a recovery link.

## Join limits

- **Limiter:** [rateLimit.ts](../src/server/utils/rateLimit.ts) uses Redis counters per client address (`x-forwarded-for`):

  | Limit            | Allowance         | Purpose                                                     |
  | ---------------- | ----------------- | ----------------------------------------------------------- |
  | Join             | 300 per minute    | Fits a whole event joining from one office or venue network |
  | Unknown codes    | 30 per 5 minutes  | Slows down guessing codes                                   |
  | Link redemptions | 30 per 10 minutes | Slows down guessing links                                   |

- **Errors:** when a limit is reached, the request returns `TOO_MANY_REQUESTS` with how long to wait.
- **Redis down:** if Redis is unavailable the limiter allows the request. Limits must never stop a game.
- **KeyDB:** uses `INCR` then `EXPIRE` on the first count, because KeyDB (used in development) lacks `EXPIRE … NX`. A key that has lost its expiry is repaired, never left blocking.

## Staff UI and Help

- **Player Management** is replaced by [RosterPanel](../src/app/_components/client/RosterPanel/index.tsx):
  - **Teams:** rename and lock each team.
  - **Players:** search by name or number, then for each player:
    - Name, number, team, and **Name locked** / **Saved to account** badges.
    - **Rename** with a lock option.
    - A team menu that includes **No team**.
    - **Recovery link** (owner/co-host, unlinked players only).
    - **Remove** with confirmation.
  - **Other:** a count of removed players, and a note when the buzzer is open.
  - The old TanStack table is deleted.
  - **Live:** names, teams and locks come from the live game state, so a change made at another desk appears without a reload. The roster query only adds the "Saved to account" flag and is refetched when players join or leave. An earlier version read everything from that query, so other desks' changes didn't appear; the browser test now checks this and fails on that version.
- **Moderators** now have the capabilities `moderateNames` and `removePlayers` as well as `moveRoster`. `recoverGuests` is owner/co-host only. The role summary and fact panel describe this from code.
- **Help:**
  - New article `moderation` covers renaming and locking, moving, removing, and recovering a guest, with a recovery-link fact panel.
  - `join-and-resume` gains "Can I save my player to an account?" and a rewritten lost-device answer.
  - `teams-and-names` covers locks, stale edits and moves waiting for the buzzer.
  - New errors link to these sections.

## Evidence

| Area                                                                                                                                                                                                                                                                                                                                                                                                                | Tests                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Staff rename and lock in one save; lock persists through resume; unlock; stale player edit refused, moderated name kept; team-name lock; staff renames validated; individual scoring-unit label; staff fix after finish; players and other games can't use staff renames                                                                                                                                            | [rosterIdentity.test.ts](../tests/integration/rosterIdentity.test.ts)         |
| Moves wait while the buzzer is open, for players and staff alike; unassign keeps points; moderator moves; individual games reject moves                                                                                                                                                                                                                                                                             | rosterIdentity.test.ts                                                        |
| Removal during an open buzzer: credential dead, rejoining with the old token creates a new player, roster and public counts exclude them; winning buzz and points kept; live stream ends; balancing ignores removed players                                                                                                                                                                                         | rosterIdentity.test.ts                                                        |
| Explicit link → resume on another device while the first keeps working; other accounts can't see or take the player; one player per account per game; joining while signed in doesn't link                                                                                                                                                                                                                          | rosterIdentity.test.ts                                                        |
| Recovery: preview and create don't cut off the working device; redeem rotates the credential and keeps name, team, points and locks; single use; owner/co-host only; refused for linked or removed players; a newer link cancels the older; 15-minute expiry; hash only; separate from staff invitations                                                                                                            | rosterIdentity.test.ts                                                        |
| 60 concurrent joins from one address all succeed; code guessing is limited at exactly 30, and another address is unaffected                                                                                                                                                                                                                                                                                         | rosterIdentity.test.ts                                                        |
| Signed-in browsers no longer link guests silently (replaces the PR01 "current behavior" test)                                                                                                                                                                                                                                                                                                                       | [roster.test.ts](../tests/integration/roster.test.ts)                         |
| Capability table includes the new roster capabilities                                                                                                                                                                                                                                                                                                                                                               | [capabilities.test.ts](../src/utils/capabilities.test.ts)                     |
| Join page: saved player offered when signed in, not looked up when signed out                                                                                                                                                                                                                                                                                                                                       | [JoinGame.test.tsx](../src/app/_components/client/JoinGame/JoinGame.test.tsx) |
| Browser: host keeps Player Management open → moderator searches, renames and locks → player sees the new name live and the locked field with its reason → the host's open desk shows the new name and lock without reloading → host makes a recovery link → new device continues as the player, old device is sent to Join, the link fails a second time → moderator removes a player, whose reload is sent to Join | [roster.spec.ts](../tests/e2e/roster.spec.ts)                                 |

## Commands and results

| Command            | Result                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `bun run check`    | 0 errors, 7 warnings                                                                         |
| `bun run test:all` | 22 files, 284 passed                                                                         |
| `bun run test:e2e` | 12 passed, twice in a row (and three more full runs while investigating one earlier failure) |
| `bun run build`    | Passes; `/recover/[token]` is dynamic, `/help/moderation` is generated at build time         |

## Not done in PR08

- **Captains** (badges, suggestions, repair) are for integrated modes in Phase 3.
- **Chat:** author menus and chat mutes are PR09/PR10.
- **Desk extras:** a recent-actions panel and the helper briefing (W04) are PR11.
- **Deleting teams:** an unused-team rule ("only empty, zero-score teams") is not enforced yet. **Delete Team** behaves as before.
- **Sign out:** a game-scoped notice and clearing account-related browser credentials on **Sign out** (W06). Sign-in itself is unchanged and untested, as agreed.
