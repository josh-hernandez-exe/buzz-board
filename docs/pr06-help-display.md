# PR06: public Help, safe audience display and contributor guide

This is the recorded evidence for **PR06** in the [delivery plan](./buzz-board-game-kit-delivery-plan.md). It is stacked on [PR05](./pr05-basic-ux.md). With PR06, the code side of the plan's **basic casual release** gate is in place. A non-creator pilot and the owner's rights and licence decisions are still needed before a public release.

| Item           | Value                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| Branch         | `feature/game-kit-pr06-help-display` (from PR05)                                   |
| Schema impact  | None                                                                               |
| New dependency | `react-markdown` 10, which renders the trusted Help Markdown with raw HTML skipped |
| Rollback       | Revert the branch. No data changes.                                                |

## Help center (W20, T19)

- **Source:** one typed manifest, [manifest.ts](../src/help/manifest.ts), plus plain Markdown bodies in [`src/help/articles`](../src/help/articles). There is no CMS, database, template language or external search.
- **Articles:** five, covering only what has shipped: `join-and-resume`, `host-quickstart`, `teams-and-names`, `scoreboards-and-display` and `troubleshooting`. The remaining articles in the plan (helpers, moderation, chat, game modes, content and media) arrive with their features.
- **Pages:**
  - `/help` has role entry points, local search, all guides, and an FAQ made of every question-style `##` heading.
  - `/help/for/player` and `/help/for/host` are the role landing pages.
  - `/help/<id>` shows the article, an "On this page" list, fact panels and related guides.
- **Public and static:** every Help route is prerendered at build time (`○ /help`, `● /help/[articleId]`, `● /help/for/[audience]` in the build output). The Help layout reads no session, game or database. A test also fails if Help modules import the database, auth, tRPC, `next/headers` or Prisma.
- **Fact panels:** [FactPanels](../src/app/_components/server/FactPanels/index.tsx) shows team counts, the reopen window, name and score limits, team-assignment settings and game statuses. They come from [gameRules.ts](../src/utils/gameRules.ts), the same constants the server and UI now import. Article prose never repeats these numbers.
- **Safe rendering:** [HelpMarkdown](../src/app/_components/server/HelpMarkdown/index.tsx) skips raw HTML, gives headings stable anchors, opens internal links in place, and opens external links in a new tab with `noopener noreferrer`. It is only for this repository's Markdown, never for names or other user text.
- **Help from the app:**
  - Landing **Help**, **Need help joining?** on the join page, **Host guide** on the dashboard and host desk, **About the display** next to the share hint, and a buzzer-messages link in the player header.
  - Expected server errors now carry a Help path (`HelpfulTRPCError` → `error.data.help`). `ErrorNotice` shows it as **What can I do?**, opening in a new tab so the game page and typed input are kept.
- **Integrity checks** ([help.test.ts](../src/help/help.test.ts)):
  - IDs are unique and URL-safe, with exactly one body each.
  - Every article has a summary, audiences and valid fact panels.
  - No `#` title heading, no raw HTML or template syntax, unique headings with no links in them.
  - Every internal link and every `helpHref(...)` call in `src/` resolves to an existing article and heading.
- **Found by the checks:** five links pointed to anchors that didn't exist, because apostrophes became hyphens (`why-can-t-i-buzz`). Anchors now drop apostrophes.

## Audience display (W12)

- **Content:**
  - An **Audience display** label, the game name, and a large status line: _Starting soon_, _Buzzers are open!_, _Owls buzzed in first!_, _Get ready for the next question_, or _Final scores_.
  - Team or player cards in a responsive grid.
- **Join code:** shown with the join address and a QR code **only while joining is open and the game isn't finished**. The public state carries `joinCode: null` otherwise, so a closed room's code is never sent.
- **Removed:** the old public info card, which showed the internal game ID.
- **Sound:** off until **Turn on sound** is pressed (`aria-pressed`), so only the one display sharing its audio with the meeting plays it, and browsers allow it once clicked.
- **Not found:** an unknown display URL shows "Game Not Found" instead of an unhandled error.

## Live-update gap found and fixed

A flaky test (`channelSubscribers` read as 0) exposed a real gap. A stream loads its first snapshot before Redis confirms the game's subscription. A change committed by **another** server instance in that window had no notification this instance would receive, so viewers could show stale state until the next change.

The bus now reloads a game's listeners once when its subscription is confirmed. That costs one extra read per game per process, not per viewer. A new test simulates a commit between the first read and the confirmation; it fails without the fix and passes with it. The cross-process and lifetime tests now wait for the subscription instead of racing it.

## Other

- [CONTRIBUTING.md](../CONTRIBUTING.md) covers setup, required checks, migration and service rules, Help impact, PR expectations, and the fact that **no licence has been chosen yet**, which is an owner decision.
- The README's Usage section now points players and hosts to `/help` instead of repeating instructions.
- `GameCreate`, `HostRoomPanel` and the server read limits and labels from `gameRules.ts`.

## Evidence

| Area                                                                                                                                                                                       | Tests                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Help integrity and dependency boundaries                                                                                                                                                   | help.test.ts (37 cases)                                                                   |
| Markdown renderer: anchors, raw HTML dropped, external link `rel`                                                                                                                          | [HelpMarkdown.test.tsx](../src/app/_components/server/HelpMarkdown/HelpMarkdown.test.tsx) |
| The join code is public only while joining is open and before finish; an unknown display is `NOT_FOUND`                                                                                    | [lifecycle.test.ts](../tests/integration/lifecycle.test.ts)                               |
| The subscription gap and the cross-process first change                                                                                                                                    | [liveState.test.ts](../tests/integration/liveState.test.ts)                               |
| Browser: Help from the landing page without signing in; search → question → anchor; fact text from constants; role page; 404 for an unknown article                                        | [helpAndDisplay.spec.ts](../tests/e2e/helpAndDisplay.spec.ts)                             |
| Browser: an unknown-code error links to `/help/join-and-resume#why-cant-i-join` in a new tab                                                                                               | helpAndDisplay.spec.ts                                                                    |
| Browser: the display shows label, status, code and QR; no host controls or game ID; sound off until pressed; the code disappears live when joining closes; status follows start and finish | helpAndDisplay.spec.ts                                                                    |

## Commands and results

| Command            | Result                                                    |
| ------------------ | --------------------------------------------------------- |
| `bun run check`    | 0 errors, 8 warnings (one baseline unused import removed) |
| `bun run test:all` | 19 files, 221 passed                                      |
| `bun run test:e2e` | 10 passed, twice in a row                                 |
| `bun run build`    | Passes; Help routes are static or SSG                     |

## Still needed for the basic release gate (outside code)

- An unbriefed non-creator pilot: create and share a room, join as a guest, find why a buzzer is disabled. Record the steps, time and errors.
- Owner decisions on the code licence, public naming and asset rights (the two sound effects are credited to Pixabay in the README).
- Real phone and screen-reader checks. Only Chromium at 360 px is automated.
