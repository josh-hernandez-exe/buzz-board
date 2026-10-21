# Contributing to Buzz-Board

Thanks for helping. This guide is for people changing the code. Players and hosts should read the in-app **Help** (`/help`) instead.

## Before you start

- **License:** the project has **no license chosen yet**. Until the owner adds one, contributions are accepted only with the owner's agreement, and the code may not be reused elsewhere.
- **Assets:** only add images, sounds, fonts or copy you have the rights to share, and credit their source in `README.md` (see "External Sources"). Do not add branded names or assets from other games or products.
- **Data:** never commit secrets, `.env` files, real participant data or private question packs. Tests and examples use synthetic data only.

## Set up

See "Development Setup" in [README.md](./README.md). In short:

```bash
bun install
docker compose --file ./docker-compose.db.yml up --detach
bun db:migrate:deploy
bun dev
```

## Checks every change must pass

```bash
bun run check                # ESLint + TypeScript
bun run test                 # unit + component (no services)
bun run test:services:up     # disposable PostgreSQL + Redis for tests
bun run test:integration     # real tRPC routers against those services
bun run test:e2e             # Playwright browser journeys
bun run build
```

CI runs the same commands (`.github/workflows/ci.yml`). [tests/README.md](./tests/README.md) explains the test layers, the safety check that stops tests from resetting a non-test database, and the `it.fails` convention for known defects.

## Rules of thumb

- **Database changes** are additive Prisma migrations created with `bun db:migrate --name <change>`. Existing games, scores and history must keep working, and the populated-upgrade test in `tests/integration/migrations.test.ts` must still pass. Never edit a migration that has shipped.
- **Game-state writes** (scores, buzzer, roster, lifecycle) go through the services in `src/server/**` under `withGameLock`. Routers stay thin: validate input, call a service, map errors with `toTRPCError`.
- **Expected failures** are returned as `neverthrow` results by services and turned into typed tRPC errors with a message a player or host can act on. Give the error a Help link in `ERROR_HELP` (`src/server/api/errors.ts`) when an article explains it.
- **Live updates** are published after commit with `emitUpdatedGameState`. Never put private data in Redis messages: they only say which game changed.
- **Public rules and limits** live in `src/utils/gameRules.ts`. Import them instead of repeating numbers in code, UI copy or Help.
- **UI** follows the folder layout in `.github/copilot-instructions.md`. Pages and controls must work at 360 px wide and with a keyboard.
- **Styling** uses the design tokens and page building blocks described in [docs/design-system.md](./docs/design-system.md): `bg-surface` and `text-muted-foreground`, not `bg-white` or `text-gray-500`. A unit test rejects raw palette colours in `src/app`.

## Help and documentation

Help is part of the product. If a change affects what players or hosts see or do, update Help in the same pull request:

- Articles are plain Markdown in `src/help/articles/<id>.md`, listed in `src/help/manifest.ts` (title, summary, audiences, fact panels). Don't repeat the title as a `#` heading. Phrase `##` headings as the questions people ask; they become FAQ entries and link anchors.
- No raw HTML or template syntax in articles. Limits come from fact panels (`src/app/_components/server/FactPanels`), not prose.
- Link to Help from the app with `helpHref("article-id", "heading-anchor")`. `src/help/help.test.ts` fails if any link, anchor or article is missing.
- Add an article only for a feature that has shipped.

## Pull requests

- Keep each pull request focused on one change, with its tests and Help updates included.
- In the description, state the scope, schema impact, how to roll back, what you tested, and anything you could not test (for example, real phones).
- Record measurements and evidence in the PR or the `docs/` notes, never a claim about a test you did not run.
