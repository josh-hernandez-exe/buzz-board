/**
 * Whether the development-only "Sign in as…" page is on, and where sign-in
 * links point. No accounts or session code live here, so the production
 * bundle that imports this module carries nothing of the dev login itself.
 *
 * The dev login can never run in production. Each layer is enough on its own:
 * 1. Its page and route are named `page.dev.tsx` / `route.dev.ts`, which only
 *    `next dev` treats as routes (next.config.js), so production builds
 *    don't contain them. `scripts/build/assert-no-dev-login.mjs` fails the
 *    build if any of its code shows up anyway.
 * 2. A build or `next start` with DEV_LOGIN set refuses to run.
 * 3. `devLoginEnabled()` is false whenever NODE_ENV is "production" (inlined
 *    as a constant in production builds) or on Vercel, and otherwise only
 *    true with DEV_LOGIN=1.
 * 4. The page and route answer only requests to localhost, and the route
 *    only same-origin form posts.
 */

export function devLoginEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL) return false;
  return process.env.DEV_LOGIN === "1";
}

/** Where "Host" and "Sign in" links go: the dev login page when it's on. */
export function signInPath(callbackUrl = "/dashboard"): string {
  const query = `callbackUrl=${encodeURIComponent(callbackUrl)}`;
  return devLoginEnabled()
    ? `/dev-login?${query}`
    : `/api/auth/signin?${query}`;
}

/** localhost, 127.0.0.1 or ::1, with or without a port. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0]!;
  return (
    name === "localhost" || name === "::1" || /^127(\.\d{1,3}){3}$/.test(name)
  );
}

/** A same-site path to return to after signing in, never another site. */
export function safeCallbackPath(raw: string | null | undefined): string {
  if (
    !raw?.startsWith("/") ||
    raw.startsWith("//") ||
    raw.startsWith("/\\") ||
    raw.length > 500
  ) {
    return "/dashboard";
  }
  return raw;
}
