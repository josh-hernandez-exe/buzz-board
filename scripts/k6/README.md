# k6 Stress Testing Suite

This directory contains the scripts and configuration for running k6 stress tests against the Buzz-Board application.

## Architectural Decisions

The setup in this directory might seem complex, so this document explains the reasoning behind the key architectural decisions.

### Why a dedicated `tsconfig.json`?

The root of this project has a `tsconfig.json` configured for a Next.js application. That environment is a combination of Node.js (for the server) and the browser (for the client). The root `tsconfig.json` includes TypeScript library definitions for the DOM (e.g., `window`, `document`), which are not available in the k6 runtime.

Using the root `tsconfig.json` for the k6 scripts would cause TypeScript to incorrectly assume that browser-specific globals exist, leading to potential type-checking errors and runtime failures that are difficult to debug.

By having a dedicated `tsconfig.json` in this directory, we can tailor the TypeScript environment specifically for k6, ensuring that the code is type-checked against the correct set of available APIs and libraries.

### Why a dedicated tRPC Client (`trpc.ts`)?

Initially, we attempted to use the application's vanilla tRPC client located at `@/trpc/vanilla-client`. However, this led to persistent and hard-to-resolve TypeScript errors, specifically `Unsafe assignment of an error typed value`.

The root cause of this issue is the fundamental difference between the module resolution and execution environments of Next.js and k6. The application's tRPC client is deeply integrated with the Next.js build system, and its type inferences are based on that environment. The k6 runtime handles modules and dependencies differently, causing TypeScript's type inference to fail when importing the client from the main application.

To resolve this, we created a self-contained tRPC client in `scripts/k6/trpc.ts`. This client:

1.  Is built specifically for the k6 environment.
2.  Has no dependencies on the main application's source code (`/src`).
3.  Resolves all type inference issues, providing a stable and reliable way to make tRPC requests from within our k6 tests.

This approach isolates the testing environment from the main application, which is a best practice for ensuring that tests are reliable and maintainable.

## How to Run the Tests

To execute the stress test, you first need to build the test script using the following command:

```bash
bun k6:build
```

This will bundle the `test-worker.ts` script and its dependencies into a single file located at `scripts/k6/dist/test-worker.js`. Then, you can run the test using the following command from the root of the project:

```bash
BASE_URL=<your_base_url> GAME_CODE=<your_game_join_code> \
    bun k6 run scripts/k6/dist/test-worker.js
```

-   **`BASE_URL`**: The base URL of the server to test (e.g., `http://localhost:3000`).
-   **`GAME_CODE`**: The join code for the game to use for testing.

### Example Usage

```bash
bun k6:build
GAME_CODE="4J55SM" bun k6 run scripts/k6/dist/test-worker.js
```
