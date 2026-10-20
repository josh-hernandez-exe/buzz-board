# PR11: chat on the host desk and player page, and the chat Help article

This is the recorded evidence for **PR11** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR10](./pr10-chat-live.md) and puts the PR09 chat backend and PR10 live signals in front of people. Earlier PRs already shipped the role desks (PR07 helpers, PR08 roster), so this PR adds chat to them.

| Item          | Value                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| Branch        | `feature/game-kit-pr11-chat-ui` (from PR10)                                                 |
| Schema impact | None.                                                                                       |
| Rollback      | Redeploy PR10. Chat stays reachable only through the API; existing messages are unaffected. |

## What people see

**Player page:** a new **Chat** tab (Buzzer, Team, Chat, Info). [ChatPanel](../src/app/_components/client/ChatPanel/index.tsx) shows:

- Channel tabs: **Everyone**, plus **Team: …** for the player's current team. Moving teams switches channels at once.
- Messages with the author's current name, their team (in Everyone), "(you)" on their own, and an **Organizer** name with a role badge for staff. Removed and expired messages show as such.
- The pinned message, and **Show older messages** up to the newest 200, then "Only the newest 200 messages are shown."
- A composer that counts bytes the way the server does, keeps the text when sending fails, and reuses the request ID for retries of the same text so a retry can't post twice.
- Instead of a composer when posting isn't possible: finished (read-only), muted ("You can still play"), or staff-only. Each links to **Why?** in Help. Server errors use the existing [ErrorNotice](../src/app/_components/client/ErrorNotice/index.tsx) with "What can I do?" links.

**Host desk:** a **Chat** tab for every staff role:

- Owners and co-hosts get **Chat for this game** (off by default).
- Staff with `moderateChat` get, per channel, **Staff only**, **Slow mode** (Off, 10, 30, 60 seconds) and **Clear history…** with a confirmation step. Per message they get **Remove**, **Pin**/**Unpin** and **Mute 10 min**. Mute isn't offered for their own messages or the owner's; the server still enforces the full hierarchy.
- An **All channels** view lists the newest messages from every channel, labelled by channel.
- A **Muted** list with **Unmute**.

**Live updates:** the panel uses PR10's `useChatLive`, so the stream is open only while the Chat tab is shown. A page with chat open has exactly two streams (game state and chat), within the plan's budget. "Reconnecting… chat may be out of date." shows while the chat stream reconnects.

## Help

- New article **Chat** ([chat.md](../src/help/articles/chat.md)) for players and hosts: turning chat on, who can see each channel, why a message won't send (one line per server error), moderating, and retention, including that screenshots and backups can't be recalled.
- A **Chat** fact panel generated from [chatLimits.ts](../src/utils/chatLimits.ts): off by default, message size, sending limits, mute length, history window and retention.
- Every chat error now links to the article. The mute error reads "You're muted in chat for about N more minutes. You can still play.", worked out on the server so a wrong device clock doesn't matter. Before, it showed an ISO timestamp.

`CHAT_LIMITS` moved to the browser-safe [chatLimits.ts](../src/utils/chatLimits.ts) (re-exported from `chatRules.ts`), so the client doesn't bundle `node:crypto`.

## Evidence

- [chat.spec.ts](../tests/e2e/chat.spec.ts), a browser journey with a host and two players on different teams:
  - The host turns chat on from the desk.
  - Ben sees Ana's Everyone message live.
  - Ben has no Team 1 tab; Ana's team message shows in the host's **All channels** labelled "Team: Team 1".
  - The host's message shows as "Organizer" with "Owner" and never the account name.
  - **Remove** replaces the text with "Message removed by an organizer." for Ben.
  - **Mute** blocks Ana's composer and lists her as muted; **Unmute** restores it.
  - The chat tab fits a 360px phone without sideways scrolling.
  - The player page holds exactly `chat.live` and `gameGeneral.gameState` streams.
  - Passed 3 times alone and in both full runs.
- A real UX bug found by the test: checkboxes only changed after the server replied, so the click looked ignored. They now show the new value at once while saving.
- [help.test.ts](../src/help/help.test.ts) validates the new article, its anchors and every new error help link.
- **Full validation:** `bun run check` (0 errors, the 7 existing warnings); `bun run test:all` 27 files, 349 tests passed; browser suite 13 passed twice; production build passes.

## Not in this PR

- Unread counts on the Chat tab. They would need the chat stream open on every tab of the page; that's a product decision against the connection budget.
- Mute durations other than 10 minutes from the UI (the API supports 1 minute to 24 hours and until-unmuted), and moderation reasons in the UI (the API takes a reason category).
- Captain features and response activities (Game Kit, PR13+).
- Load evidence (PR12).
