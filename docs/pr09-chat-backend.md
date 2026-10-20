# PR09: chat storage, moderation, guards and retention

This is the recorded evidence for **PR09** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR08](./pr08-roster-identity.md) and covers the chat backend of W10–W11 and W16–W18, with test T07. Live delivery is PR10, and the chat UI and Help article are PR11. Until then chat is reachable only through the API and is **off by default** in every game.

| Item          | Value                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch        | `feature/game-kit-pr09-chat-backend` (from PR08)                                                                                                                                                   |
| Schema impact | Additive migration `20261020170000_chat`: `Game.chatEnabled` (default off) and new tables `ChatChannel`, `ChatMessage`, `ChatMute`. No existing column changes.                                    |
| Rollback      | Redeploy PR08. The chat tables are ignored; nothing else reads them.                                                                                                                               |
| Operations    | `bun run ops:cleanup` on a schedule (see [README](../README.md#scheduled-cleanup)). Reads hide expired text even if it is late. Chat sends **fail closed** while Redis is down; nothing else does. |

## Channels and access

- **Two kinds of channel:** **Everyone** (`game`) and one per team (`team:<id>`). Individual games have only Everyone. Channels are created on first use; concurrent first messages use `INSERT … ON CONFLICT DO NOTHING`, so neither send aborts (a race found by T07).
- **Access is checked against the current roster** on every read and send, not stored per channel:
  - Players see Everyone and their **current** team's channel. Moving teams removes the old channel at once, and new teammates see the existing history (the plan's team-history rule).
  - Owner, co-hosts and moderators see every channel.
  - Removed players and people from other games get the normal "not in this game" errors. An unreadable channel is reported as not found, so its existence isn't revealed.
- **Finished games:** chat becomes read-only for players. Staff can still post a closing message.

## Messages

- **Validated once, in one place:** [chatRules.ts](../src/utils/chatRules.ts) applies NFC, normalizes line endings, trims, and rejects control and bidi-override characters. The limit is **2,000 UTF-8 bytes** (so 1,000 `é` fits, 1,001 doesn't).
- **Stored before acknowledged:** `send` returns the stored message (with its sequence) only after the transaction commits.
- **Retries are safe:** each send carries a `requestId`. Retrying returns the same message (`replayed: true`); reusing the ID for different text is `CONFLICT`. Four concurrent retries store one message.
- **Ordered:** each channel's `lastSequence` is incremented atomically in the same transaction, so sequences are unique and gapless under concurrency. `revision` changes on every visible change (send, pin, remove, policy, clear) for PR10's invalidations.
- **Concurrency:** sends take a **shared** lock on the game row. Sends don't block each other, but a mute or finish (which take the game lock) can't interleave with a send's checks. Once a mute or finish commits, no later send from that person is accepted.

## Identity

- **Names are read live:** authors are stored as an internal key (`player:<id>` or `staff:<userId>`), and names are looked up when read. A staff rename applies to old messages, and removed players show as **Removed player**. Players never receive the internal key.
- **Staff speak as "Organizer"** with a role badge (Owner, Co-host, Moderator). Their account name never appears in chat.
- **One person, two roles:** a host who also joined as a player chooses with `as: "player" | "staff"`. A player can't choose `staff`.

## Moderation (owner, co-host, moderator: `moderateChat`)

| Action          | Effect                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remove          | Text **and its hash** are erased (short messages are guessable from a hash). Everyone sees "removed". A pin on it is cleared. Retrying the original send returns the removed placeholder, not the text. |
| Mute            | 10 minutes by default, 1 minute to 24 hours, or until unmuted. Muted people **can still buzz and play**. Expired mutes stop applying at once and are cleaned up later.                                  |
| Mute hierarchy  | Nobody mutes the owner or themselves. Co-hosts can mute moderators and players; moderators can mute players only.                                                                                       |
| Staff-only mode | Only staff can post in that channel (for example to keep guesses quiet).                                                                                                                                |
| Slow mode       | 1–600 seconds between one player's messages. Staff are exempt.                                                                                                                                          |
| Pin             | One visible message per channel; pinning replaces, `null` unpins.                                                                                                                                       |
| Clear           | Hides that channel's history up to now for everyone. Other channels are unaffected.                                                                                                                     |
| Recent feed     | One merged, bounded list (default 100, max 200) across channels, tagged "Everyone" or "Team: …", with author keys for mute and rename actions.                                                          |

Every moderation action is a `GameOperation` row (`chat.remove`, `chat.mute`, …) with the target and an optional reason category (offensive, spam, spoiler or other; no free text, so nothing personal ends up in the log). Reasons are visible to staff only.

## Limits

| Limit                     | Value                                                          | Where                             |
| ------------------------- | -------------------------------------------------------------- | --------------------------------- |
| Message size              | 2,000 UTF-8 bytes                                              | `CHAT_LIMITS.maxMessageBytes`     |
| Per person                | 5 messages per 10 seconds, 30 per minute                       | Redis counters                    |
| Per game                  | 50 messages per second                                         | Redis counter                     |
| History a client can load | First 50; can page back through the **newest 200** per channel | `recentWindow`, `initialMessages` |
| Merged staff feed         | 100 by default, 200 max                                        | `mergedDefault`, `mergedMax`      |

Chat limits never apply to buzzing or scoring. **If Redis is unavailable, chat sends are refused** ("Chat is temporarily unavailable. Your message wasn't sent; the game itself still works.") rather than allowed without limits. Join limits keep failing open, so a Redis outage can't stop a game.

## Retention (data classes)

| Data                          | Rule                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Chat text                     | 7 days. Reads hide older text immediately; `ops:cleanup` erases it (and its hash).                                     |
| Message identity and sequence | Kept with the game, so an old retry can never recreate an expired or removed message.                                  |
| Mutes                         | Deleted by cleanup after they expire.                                                                                  |
| Moderation reasons            | Stripped from the audit log after 30 days. The action, target and time stay.                                           |
| Old unfinished games          | **Reported only** by `ops:cleanup` (untouched for 7 days), for the operator to follow up. Never deleted automatically. |

## API

`chat.status`, `chat.channel`, `chat.send` and `chat.setEnabled` (host and co-host, `runGame`); `chat.moderation.{recent, mutes, remove, mute, unmute, setPolicy, pin, clear}` (`moderateChat`). Errors use the existing helpful-error mapping, for example "You're muted in chat until an organizer unmutes you. You can still play."

## Evidence

- [chat.test.ts](../tests/integration/chat.test.ts) (T07, 28 tests, real PostgreSQL and Redis): byte boundaries; off by default; retry, conflict and concurrent retry; gapless sequences under concurrent player and staff sends; team privacy, moves, individual format, removed players and other games; Organizer identity and `as` choice; staff-only and slow mode; mute default, until-unmuted, expiry, hierarchy, mute/send race, buzzing while muted; finish/send race and staff closing message; remove, pin, clear, revision changes; merged feed tags and limits; the 200-message window and paging; flood limit not affecting others or the buzzer; read-time expiry, cleanup and retry after cleanup; reason stripping and mute cleanup. Repeated 4 times with no failures.
- [rateLimit.test.ts](../src/server/utils/rateLimit.test.ts): chat fails closed and joins fail open while Redis is down or drops mid-request; game ceiling and burst wait.
- [chatRules.test.ts](../src/utils/chatRules.test.ts): normalization, rejected characters, byte counting and mute hierarchy.

- **Full validation:** `bun run check` (0 errors, the 7 existing warnings); `bun run test:all` 25 files, 328 tests passed; browser suite 12 passed twice; production build passes; `bun run ops:cleanup` run against the test database.
- **Browser test fix (PR08):** one full run caught a timing problem in [roster.spec.ts](../tests/e2e/roster.spec.ts). It cleared the player search while the rename dialog was still closing, so the clear was lost. The test now waits for the dialog to close and checks the search is empty; it then passed 3 times alone and in both full runs. No app change was needed.

## Not in this PR

- Live delivery (PR10). Clients must re-fetch until then; `revision` and `sequence` are ready for it.
- Chat UI, the moderator feed UI, and the chat Help article (PR11). The `muted` error currently shows an ISO time, which the UI will format.
- Load evidence for chat (PR12).
- Reopening finished games (the 24-hour reopen window) isn't implemented, so chat in a finished game stays read-only.
- Operator health exposure of overdue cleanup is part of the PR12 runbook.
