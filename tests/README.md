# Tests

| Layer                                              | Command                    | Needs services | Location                                |
| -------------------------------------------------- | -------------------------- | -------------- | --------------------------------------- |
| Unit                                               | `bun run test`             | No             | `src/**/*.test.ts`, `tests/unit/`       |
| Component (React Testing Library, jsdom)           | `bun run test`             | No             | `src/**/*.test.tsx`, `tests/component/` |
| Integration (real tRPC routers, PostgreSQL, Redis) | `bun run test:integration` | Yes            | `tests/integration/`                    |
| Browser (Playwright, `next dev` on port 3100)      | `bun run test:e2e`         | Yes            | `tests/e2e/`                            |

```bash
bun run test:services:up     # disposable PostgreSQL :55432 and Redis :56379 (tmpfs)
bun run test:integration
bunx playwright install chromium   # first time only
bun run test:e2e
bun run test:services:down
```

Override the service URLs with `TEST_DATABASE_URL` and `TEST_KV_URL`. Integration and browser runs **reset the test database**, so [testEnv.ts](./support/testEnv.ts) refuses any database that is not on localhost or whose name does not contain `test`. Never point these at a development or production database.

## How the integration tests reach the app

[integration.ts](./support/integration.ts) calls the real `appRouter` with the real `gameAuth` scoping. Only `next/headers` is stubbed, because there is no Next request scope; callers authenticate with the same `x-buzz-board-*` headers the browser client sends, plus an explicit NextAuth session for hosts. `requestCaller` resolves a new context on every call, like a separate HTTP request.

The browser tests sign a host in by seeding a NextAuth database session and cookie ([e2e/support.ts](./e2e/support.ts)). No OAuth provider or credential is used.

## Known defects: `it.fails`

Characterization tests describe today's behavior. A known defect is written with the **correct** expectation and marked `it.fails("KNOWN DEFECT: ...")`, so the suite stays green while the defect exists. When a fix lands, Vitest reports the unexpected pass; change it to a normal `it` in the same PR. Tests named `CURRENT BEHAVIOR: ...` pin behavior a later PR may change deliberately. The current list is in [docs/pr01-baseline.md](../docs/pr01-baseline.md).

Storybook is not part of this stack; see the testing strategy in the [delivery plan](../docs/buzz-board-game-kit-delivery-plan.md).
