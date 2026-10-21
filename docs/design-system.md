# Design system

How Buzz Board looks, and how to change it without editing dozens of files.

## The rule

**Colours come from tokens, never raw palette classes.** Write `bg-surface`, `text-muted-foreground`, `bg-primary` or `bg-stage-tile`, not `bg-white`, `text-gray-500`, `bg-blue-600` or `bg-[#2e026d]`. [designTokens.test.ts](../tests/unit/designTokens.test.ts) fails the build on a raw colour in `src/app`. shadcn's generated components in `src/app/_components/ui` are exempt and stay as generated. In the rare case a raw colour is truly needed, add a `design-tokens: allow` comment on that line; better still, add a token.

## Where things live

| What | Where |
| --- | --- |
| Brand palette, semantic tokens, the stage theme, fonts' CSS variables, the `field` input style, Help prose styles | [globals.css](../src/styles/globals.css) |
| Fonts (Bricolage Grotesque for headings and the board, Atkinson Hyperlegible for text) | [layout.tsx](../src/app/layout.tsx) |
| Page building blocks: `PageShell`, `SiteHeader`, `PageHeading`, `Panel`, `StatusPill`, `Notice`, `MessagePage`, `LinkButton`, `Wordmark` | [ui/page.tsx](../src/app/_components/ui/page.tsx) |
| The header with signed-in links | [AppHeader](../src/app/_components/server/AppHeader/index.tsx) |
| Buttons, dialogs, tabs, cards | shadcn components in `src/app/_components/ui` (they read the same tokens) |

## Themes

- **App (default):** warm paper and ink, with a buzzer-red primary and a gold accent. Used for desks, the dashboard, Help and player pages.
- **Stage (`.stage`):** a dark game-show look for the Ranked Answers board and the audience display, which are often projected or screen-shared. Anything inside an element with the `stage` class (or `<PageShell stage>`) gets dark surfaces automatically, plus the `stage-*` colours for board tiles, highlights and strikes.

## Tokens

| Token | Use |
| --- | --- |
| `background` / `foreground` | Page background and body text |
| `surface`, `surface-sunken` | Raised panels; recessed areas inside them |
| `muted`, `muted-foreground` | Quiet backgrounds; secondary text |
| `primary` (+ `-hover`, `-foreground`) | The main action on a screen: Join, Start buzzer, Send |
| `secondary` | Other actions |
| `accent` | Highlights and badges (gold) |
| `success`, `warning`, `destructive`, `info` (+ `-soft`/`-foreground`) | Status: live, needs attention, errors and deletion, information |
| `border`, `input`, `ring` | Lines, field borders, focus rings |
| `stage`, `stage-foreground`, `stage-muted`, `stage-tile`, `stage-tile-border`, `stage-tile-revealed`, `stage-highlight`, `stage-strike` | The board and audience display |
| `qr` | QR code backgrounds: always white, so codes scan in either theme |

## Common changes

- **New brand colours:** change the `--brand-*` values at the top of `globals.css`. Everything follows, including shadcn components.
- **A dark mode for the app:** add a `.dark` block that overrides the semantic tokens, like `.stage` does, and toggle the class on `<html>`.
- **A new page:** wrap it in `PageShell` with `AppHeader`, put content in `Panel`s and use `PageHeading` for the title. Use `MessagePage` for "not found" style pages.
- **A form field:** `className="field px-3 py-2 text-base"`, with padding and size to suit.
- **A status label:** `<StatusPill tone="success">Live</StatusPill>`.

## Checks

- **Accessibility:**
  - Primary buttons use white text on buzzer red (contrast at least 4.5:1).
  - Focus outlines use `ring` and are visible on every interactive element.
  - The body font was chosen for legibility.
- **Before merging a visual change:** look at the home page, dashboard, host desk, a 360px player phone, the audience display and a Help article. The browser tests check behaviour, not looks.
