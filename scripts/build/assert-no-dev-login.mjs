/**
 * Runs after `next build` (see the "build" script): fails the build if the
 * development-only sign-in reached the production output, as a route or as
 * code. See src/server/auth/devLoginGate.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? ".next";
/** Only the dev-login module contains this (dev account emails). */
const MARKERS = ["dev-login.buzz-board.invalid"];
const ROUTES = ["/dev-login", "/api/dev-login"];

const problems = [];

if (!existsSync(OUT)) {
  console.error(`assert-no-dev-login: no build output at ${OUT}`);
  process.exit(1);
}

for (const name of [
  "app-paths-manifest.json",
  "app-path-routes-manifest.json",
]) {
  const file = join(OUT, "server", name);
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const route of ROUTES) {
    if (
      text.includes(`"${route}/page"`) ||
      text.includes(`"${route}/route"`) ||
      text.includes(`"${route}"`)
    ) {
      problems.push(`${name} lists the route ${route}`);
    }
  }
}

let scanned = 0;
function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "cache" || entry === "dev") continue;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      scan(path);
    } else if (
      stat.size < 20_000_000 &&
      /\.(js|mjs|cjs|json|html|rsc|txt|map|body)$/.test(entry)
    ) {
      scanned++;
      const text = readFileSync(path, "utf8");
      for (const marker of MARKERS) {
        if (text.includes(marker))
          problems.push(`${path} contains "${marker}"`);
      }
    }
  }
}
scan(OUT);

if (problems.length > 0) {
  console.error("Development sign-in found in the production build:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("It must never ship. See src/server/auth/devLoginGate.ts.");
  process.exit(1);
}
console.log(
  `assert-no-dev-login: OK (${scanned} files checked, no dev sign-in in the build)`,
);
