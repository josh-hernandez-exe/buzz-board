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
| Light/dark switching: the pre-paint script and stored choice; the header button; the narrow-screen menu | [theme.ts](../src/utils/theme.ts), [ThemeToggle](../src/app/_components/client/ThemeToggle/index.tsx), [HeaderMenu](../src/app/_components/client/HeaderMenu/index.tsx) |
| Buttons, dialogs, tabs, cards | shadcn components in `src/app/_components/ui` (they read the same tokens) |

## Themes

- **App, light (default):** warm paper and ink, with a buzzer-red primary and a gold accent. Used for desks, the dashboard, Help and player pages.
- **App, dark (`.dark` on `<html>`):** the same semantic tokens re-pointed to deep navy surfaces. Status colours get lighter with dark text on them, and `-soft` tints get deeper, so they stay readable. Visitors choose **Device setting**, **Light** or **Dark** with the header's theme button. The choice is stored in `localStorage` (`buzz-board-theme`) and applied by an inline script in `<head>` before first paint, so there's no flash. shadcn's `dark:` variants work too.
- **Stage (`.stage`):** a dark game-show look for the Ranked Answers board and the audience display, which are often projected or screen-shared. It looks the same in light and dark mode. Anything inside an element with the `stage` class (or `<PageShell stage>`) gets dark surfaces automatically, including every `-soft` tint, plus the `stage-*` colours for board tiles, highlights and strikes.

## Tokens

| Token | Use |
| --- | --- |
| `background` / `foreground` | Page background and body text |
| `surface`, `surface-sunken` | Raised panels; recessed areas inside them |
| `muted`, `muted-foreground` | Quiet backgrounds; secondary text |
| `primary` (+ `-hover`, `-foreground`) | The main action on a screen: Join, Start buzzer, Send |
| `secondary` | Other actions |
| `accent` (+ `-soft`) | Highlights and badges (gold); `accent-soft` for a highlighted row |
| `success`, `warning`, `destructive`, `info` (+ `-soft`/`-foreground`) | Status: live, needs attention, errors and deletion, information. Use `X-foreground` only on a solid `bg-X`, and `text-foreground` on `bg-X-soft` |
| `warning-text` | Warning-coloured text on the page or a surface (not on `bg-warning`) |
| `link` | Links in running text, readable on the page and on surfaces in both modes |
| `border`, `input`, `ring` | Lines, field borders, focus rings |
| `overlay` | Dialog backdrops |
| `stage`, `stage-foreground`, `stage-muted`, `stage-tile`, `stage-tile-border`, `stage-tile-revealed`, `stage-highlight`, `stage-strike` | The board and audience display |
| `qr` | QR code backgrounds: always white, so codes scan in either theme |

## Common changes

- **New brand colours:** change the `--brand-*` values at the top of `globals.css`. Everything follows, including shadcn components.
- **A new token:** add it to `:root`, `.dark` **and** `.stage` in `globals.css` (or check the inherited value works on the dark stage), then to the `@theme inline` block as `--color-…`.
- **A new page:** wrap it in `PageShell` with `AppHeader`, put content in `Panel`s and use `PageHeading` for the title. Use `MessagePage` for "not found" style pages.
- **A form field:** `className="field px-3 py-2 text-base"`, with padding and size to suit.
- **A status label:** `<StatusPill tone="success">Live</StatusPill>`.

## Checks

- **Accessibility:**
  - Primary buttons use white text on buzzer red (contrast at least 4.5:1) in both modes.
  - Every screen passes axe's colour-contrast rule in light and dark at phone and desktop widths.
  - Focus outlines use `ring` and are visible on every interactive element.
  - The body font was chosen for legibility.
- **Before merging a visual change:** look at the home page, dashboard, host desk, a 360px player phone, the audience display and a Help article, in light **and** dark. The browser tests check behaviour, not looks.
- **Screen sizes:** player pages must work from a 360px phone to a full desktop, including half-width windows and tablets. Host desks are designed for tablets and desktops (full and half width) and must not break on a phone. Below 1024px the header collapses into a **Menu**; the host desk's Play tab goes to two columns at 1024px; player pages show chat beside the buzzer at 1024px when chat is on.
