/**
 * Keeps the look maintainable: app code uses the semantic colour tokens in
 * src/styles/globals.css (bg-surface, text-muted-foreground, bg-primary,
 * bg-stage-tile...), never raw palette classes or hex colours, so a restyle
 * is a change to one file. See docs/design-system.md.
 *
 * shadcn's generated components (src/app/_components/ui, apart from our own
 * page.tsx) are left as generated. A line that genuinely needs a raw colour
 * can say so with a `design-tokens: allow` comment.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../src/app");
const SHADCN = join(ROOT, "_components/ui");
const OWN_UI = new Set([join(SHADCN, "page.tsx")]);

const PALETTE =
  "white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RAW_COLOUR = new RegExp(
  `(?<![\\w-])(?:[a-z]+:)*(?:bg|text|border|ring|from|to|via|outline|fill|stroke|divide|placeholder|decoration|shadow)-(?:(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?|\\[#[0-9a-fA-F]{3,8}\\])(?![\\w-])`,
  "g",
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("design tokens", () => {
  it("app code uses semantic colour tokens, not raw palette colours", () => {
    const offences: string[] = [];
    for (const file of files(ROOT)) {
      if (file.startsWith(SHADCN) && !OWN_UI.has(file)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.includes("design-tokens: allow")) return;
          for (const match of line.matchAll(RAW_COLOUR)) {
            offences.push(`${relative(ROOT, file)}:${i + 1} ${match[0]}`);
          }
        });
    }
    expect(offences).toEqual([]);
  });

  it("catches what it should", () => {
    const hits = (s: string) => [...s.matchAll(RAW_COLOUR)].map((m) => m[0]);
    expect(
      hits(
        'className="bg-blue-600 hover:text-white/80 from-[#2e026d] bg-primary text-muted-foreground"',
      ),
    ).toEqual(["bg-blue-600", "hover:text-white/80", "from-[#2e026d]"]);
  });
});
