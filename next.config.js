/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

import "./src/env.js";

/**
 * Files named `page.dev.tsx` / `route.dev.ts` are routes only under
 * `next dev`: the development sign-in lives there, so production builds
 * never contain it (see src/server/auth/devLoginGate.ts).
 */
const ROUTE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];
const DEV_ROUTE_EXTENSIONS = ["dev.tsx", "dev.ts", ...ROUTE_EXTENSIONS];

/** @type {(phase: string) => import("next").NextConfig} */
export default function config(phase) {
  const devServer = phase === PHASE_DEVELOPMENT_SERVER;
  if (!devServer && process.env.DEV_LOGIN) {
    throw new Error(
      "DEV_LOGIN is set, but development sign-in is only for `next dev`. " +
        "Remove it from this environment (keep it in .env.development.local, " +
        "which builds and `next start` don't read).",
    );
  }
  return {
    pageExtensions: devServer ? DEV_ROUTE_EXTENSIONS : ROUTE_EXTENSIONS,
  };
}
