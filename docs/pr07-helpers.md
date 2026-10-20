# PR07: helper roles, invitations and revocation

This is the recorded evidence for **PR07** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR06](./pr06-help-display.md) and covers W03 and the role half of W04, with tests T01 and T04.

| Item          | Value                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch        | `feature/game-kit-pr07-helpers` (from PR06)                                                                                                                                                                                                       |
| Schema impact | Additive migration `20261020150000_staff_roles_invites`: `GameAdmin.role` (`admin` shown as Co-host, or `moderator`; default `admin`), and a new `GameInvite` table (token hash, purpose, role or recovery target, issuer, expiry, revoked/used). |
| Existing data | Every existing `GameAdmin` row becomes a co-host, which is the same authority it had before.                                                                                                                                                      |
| Rollback      | Redeploy PR06. Moderators would then be treated as full admins by the old checks, so remove moderator rows first, or don't roll back while moderators exist.                                                                                      |

## Roles

- **Fixed table:** [capabilities.ts](../src/utils/capabilities.ts) is the only source of staff authority. There is no permission builder.

  | Capability                                             | Owner | Co-host | Moderator |
  | ------------------------------------------------------ | ----- | ------- | --------- |
  | Run buzzer/scores/teams/settings/lifecycle (`runGame`) | ✓     | ✓       |           |
  | Move players between teams (`moveRoster`)              | ✓     | ✓       | ✓         |
  | Invite, re-role and remove helpers (`manageHelpers`)   | ✓     | ✓       |           |
  | Duplicate (`duplicateGame`)                            | ✓     | ✓       |           |
  | Delete (`deleteGame`)                                  | ✓     |         |           |

- **The owner** is always `Game.createdById`, never a stored role. Helpers can't change or remove the owner, and the owner stays the owner even if its `GameAdmin` row is missing.
- **Server checks:** `protectedGameStaffProcedure` derives the role on **every request** from current membership. `staffProcedure(capability)` enforces the table, and `protectedGameAdminProcedure` is now `staffProcedure("runGame")`. A refused action gets a clear message, for example "Your role (Moderator) can't do that." A player token alone never grants staff access.
- **Helper list:** `gameAdmin.staff.list` shows the owner separately from helpers and includes the caller's own role. Every staff role can read it.

## Invitations

- **Creating:** **Helpers → Co-host/Moderator → Create invitation link** returns `/invite/<token>` once. Only a SHA-256 hash is stored. Links are single-use and expire after 24 hours.
- **The invitation page** shows the game, the offered role and a plain summary of that role.
  - Opening or previewing it **never uses it**; tests preview it three times first. It is marked `noindex`.
  - A visitor who isn't signed in is sent to sign in and brought back to the same page.
- **Accepting** happens under the game lock:
  - Exactly one account wins a concurrent race.
  - A different account gets "already been used".
  - The same account retrying sees its current role and gets no second grant.
  - **A helper removed after accepting cannot use the old link to get back in.**
  - An existing equal or higher role is **never lowered**; a moderator can be raised by a co-host link.
  - The owner opening a link changes nothing and leaves the link unused.
- **Unusable links** (expired, cancelled, used or unknown) each have their own message and a Help link. Unused invitations can be cancelled from the Helpers tab.
- **Recovery links:** guest recovery (`InvitePurpose.guestRecovery`) shares this table, but its redemption flow is PR08.

## Revocation

- **Removing or demoting** a helper takes effect on that helper's very next request (tested for both).
- **Live view:** a removed helper's private live stream ends with "Your role in this game was removed." at the next change, instead of continuing to receive private state. A regression check that disables this makes the test time out.
- **Other games:** removal is scoped to one game and doesn't sign anyone out.

## Host desk

- **Role line:** a line at the top says which role you have ("You're the Moderator of this game…").
- **Moderators** see Player Management, Helpers and Information, plus the share section (code, link, QR, display). They don't see game controls, team management, joining/policy settings, or finish/duplicate/delete.
- **Helpers tab:** lists the owner, then each helper with a role menu and **Remove** (for anyone who can manage helpers), invitation creation with a role choice and summary, and unused invitations with **Cancel invitation**.
- **Dashboard:** lists games you help run (PR05 fixed that query).

## Help

- **New article:** `helpers-and-roles` covers who can help, inviting, accepting, unusable links, existing roles, and changing or removing helpers.
- **Fact panel:** a new `staffRoles` panel renders the capability table and link lifetime from code.
- **Links:** invitation errors and owner-protection errors link to the article.

## Evidence

| Area                                                                                                                                                                                                                                                                                                                                | Tests                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Capability table: owner has everything, co-host can't delete, moderator limited to roster moves, non-staff gets nothing, role ranks                                                                                                                                                                                                 | [capabilities.test.ts](../src/utils/capabilities.test.ts)                                    |
| A pre-PR07 admin row acts as a co-host                                                                                                                                                                                                                                                                                              | [staff.test.ts](../tests/integration/staff.test.ts)                                          |
| Preview never uses the link; one use; another account rejected; same-account retry; concurrent race; sign-in required; expired, cancelled and unknown links; hash-only storage; no downgrade; moderator raised; removed helper can't return with the old link; owner no-op; scoped to its own game                                  | staff.test.ts                                                                                |
| Co-host can run the game and invite but not delete; moderator refused 8 gameplay and helper actions but can move players; owner can't be changed or removed; listing; players aren't staff                                                                                                                                          | staff.test.ts                                                                                |
| Removal and demotion apply on the next request; removal ends the private live stream                                                                                                                                                                                                                                                | staff.test.ts                                                                                |
| Moderator panel shows sharing but no controls                                                                                                                                                                                                                                                                                       | [HostRoomPanel.test.tsx](../src/app/_components/client/HostRoomPanel/HostRoomPanel.test.tsx) |
| Browser: owner creates a co-host link → a visitor who isn't signed in sees it without using it → co-host accepts and starts the buzzer → the used link is rejected for someone else → moderator accepts and gets the limited desk → owner removes the co-host → the co-host's next action does nothing and a reload leaves the desk | [helpers.spec.ts](../tests/e2e/helpers.spec.ts)                                              |
| Help links for the new errors resolve                                                                                                                                                                                                                                                                                               | [help.test.ts](../src/help/help.test.ts)                                                     |

## Commands and results

| Command            | Result                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `bun run check`    | 0 errors, 8 warnings                                                                       |
| `bun run test:all` | 21 files, 250 passed                                                                       |
| `bun run test:e2e` | 11 passed, twice in a row                                                                  |
| `bun run build`    | Passes; `/help/helpers-and-roles` is generated at build time, `/invite/[token]` is dynamic |

## Not done in PR07

- Desk briefing for a newly added helper (current phase, recent actions panel): W04, with PR11.
- A game-scoped notice for a revoked helper. Today they get the authorization error and the reload sends them to the dashboard.
- Moderator name and chat tools, and name locks (PR08/PR09).
- Guest recovery redemption and explicit account linking (PR08).
- Staff display aliases. Helpers are listed by account name, visible only to staff.
