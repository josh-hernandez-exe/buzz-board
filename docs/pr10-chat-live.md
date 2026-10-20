# PR10: live chat signals

This is the recorded evidence for **PR10** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR09](./pr09-chat-backend.md) and covers the plan's chat reliability rules 3–9 and 11 for delivery, with test T08. The chat UI that uses it is PR11.

| Item          | Value                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| Branch        | `feature/game-kit-pr10-chat-live` (from PR09)                                     |
| Schema impact | None.                                                                             |
| Rollback      | Redeploy PR09. Chat still works by re-fetching; nothing else uses the new stream. |

## How it works

1. A committed chat change (send, remove, pin, policy, clear, mute, unmute) publishes `chat:<gameId>` on the existing [GameChangeBus](../src/server/live/gameChangeBus.ts). Replayed sends publish nothing. Like game changes, the notification has **no content**, so lost, repeated or reordered notifications are harmless and no private text goes through Redis.
2. Each server keeps **one chat feed per game** ([events.ts](../src/server/utils/events.ts)), shared by every chat stream on that server. On a change it loads a small summary once ([chatLive.ts](../src/server/chat/chatLive.ts)): channel revisions, current players and teams, staff roles, mutes, and a roster revision hash. It never loads messages.
3. Each stream projects that summary for its viewer using **current** membership (`projectChatPulse`) and sends a **pulse** only if the viewer's part changed:

   ```ts
   { enabled, readOnly, muted, channels: [{ key, revision }], rosterRevision }
   ```

4. The client ([useChatLive](../src/app/_components/client/ChatLive/index.tsx), using the pure [chatPulseChanges](../src/utils/chatPulse.ts)) re-fetches changed channels through the normal access-checked `chat.channel` query, drops channels the viewer lost from its cache, and re-fetches open channels when the roster revision changes so renamed or removed authors update.

## Plan rules covered

| Rule                                                | How                                                                                                                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bounded invalidations, never bodies (4)             | Pulses hold only keys, revisions, posting state and a hash: under 1 KiB in the test. Old stream context can't leak new text, because text is only returned by a fresh, access-checked query.                                           |
| Coalesce bursts (4, 6)                              | The chat feed waits 100 ms before reading, and reads for a game never overlap. 50 notifications cost 1–2 reads in the test. One summary per game is shared by all its viewers on that server.                                          |
| Periodic check (6)                                  | The chat feed reloads every 5 seconds while anyone watches, so a lost notification (for example during a Redis outage) is caught. Viewers only get a pulse if something they can see changed.                                          |
| Current names (7)                                   | Name, team and role changes already publish game changes; the chat feed listens to those too and the roster revision changes. Removed authors already show as "Removed player" (PR09).                                                 |
| Current access, revocation (9)                      | Team moves change a player's channel list in the next pulse, and they get no further signals about the old team. A removed player's or revoked helper's stream **ends** with the usual message. Reads stay checked per request (PR09). |
| Reconnect and gaps (4)                              | A reconnecting stream starts with a fresh pulse; the client compares revisions and re-fetches anything that changed while away. There's no replay protocol to get wrong.                                                               |
| Bounded queues (11)                                 | Each stream holds at most the **newest** summary (the existing [GameFeed](../src/server/live/gameFeed.ts) design), so a slow client can't grow server memory; it skips to the latest state instead.                                    |
| One chat stream per page, bounded subscriptions (3) | `useChatLive` opens one `chat.live` stream. Each server holds one Redis subscription per game topic, however many viewers.                                                                                                             |

[GameFeed](../src/server/live/gameFeed.ts) gained three optional settings for this (`topics`, `coalesceMs`, `refreshEveryMs`). Existing game-state feeds don't set them and behave exactly as before.

## Evidence

- [chatLive.test.ts](../tests/integration/chatLive.test.ts) (T08, 13 tests, real PostgreSQL and Redis):
  - First pulse lists the viewer's channels and state, contains no message text or names, and is under 1 KiB.
  - Team messages signal only that team and staff; game messages signal everyone.
  - Remove, mute and unmute show up live.
  - A moved player's channels change at once, and later messages in the old team channel send them nothing.
  - Renames change the roster revision; finishing makes players (not staff) read-only.
  - Removed players' and revoked helpers' streams end with FORBIDDEN.
  - Disconnecting releases the feed subscription.
  - Coalescing (50 notifications, at most 2 reads); periodic recheck with Redis unreachable.
  - A change made through one server reaches a chat feed on a **second server instance** (a separate GameChangeBus with its own Redis connections).
  - The summary stays the same size whatever the message count.
- **Mutation check:** with the "skip unchanged pulses" filter disabled, the two privacy tests fail (team-two viewer and moved player get pulses about channels they can't read).
- Repeated 3 times together with the PR04 live-state tests: 23/23 each time.
- [chatPulse.test.ts](../src/utils/chatPulse.test.ts): re-fetch on connect, changed revisions only, lost channels dropped, roster change re-fetches all.

- **Full validation:** `bun run check` (0 errors, the 7 existing warnings); `bun run test:all` 27 files, 345 tests passed; browser suite 12 passed twice; production build passes.

## Not in this PR

- Browser evidence (the chat UI is PR11). When PR11 adds chat to pages, the page's stream count becomes two (game state plus chat), which is within the plan's "one chat stream plus the shared gameplay stream" budget; the [liveStreams](../tests/e2e/liveStreams.spec.ts) browser test will be updated then.
- Measured fetch rates and two-instance cost under load (PR12's mixed runner).
