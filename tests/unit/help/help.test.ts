import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FACTS } from "@/app/_components/server/FactPanels";
import { extractHeadings, readArticleBody } from "@/help/content";
import {
  HELP_ARTICLES,
  HELP_AUDIENCES,
  helpHref,
  slugify,
} from "@/help/manifest";

const ROOT = process.cwd();
const ARTICLES_DIR = path.join(ROOT, "src", "help", "articles");

const anchorsById = new Map(
  HELP_ARTICLES.map((a) => [
    a.id as string,
    new Set(extractHeadings(readArticleBody(a.id)).map((h) => h.anchor)),
  ]),
);

function resolves(target: string): boolean {
  const match = /^\/help\/([a-z0-9-]+)(?:#([a-z0-9-]+))?$/.exec(target);
  if (!match) return false;
  const anchors = anchorsById.get(match[1]!);
  return !!anchors && (!match[2] || anchors.has(match[2]));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

describe("help manifest", () => {
  it("has unique, URL-safe IDs with exactly one Markdown body each", () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);

    const files = readdirSync(ARTICLES_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(files).toEqual([...ids].sort());
  });

  it("gives every article a title, a short summary and a known audience", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.title.trim()).not.toBe("");
      expect(article.summary.length).toBeGreaterThan(20);
      expect(article.summary.length).toBeLessThanOrEqual(200);
      expect(article.audiences.length).toBeGreaterThan(0);
      for (const audience of article.audiences) {
        expect(Object.keys(HELP_AUDIENCES)).toContain(audience);
      }
      for (const panel of article.facts) {
        expect(FACTS[panel].facts.length).toBeGreaterThan(0);
      }
    }
  });

  it("builds anchors and links consistently", () => {
    expect(slugify("Why can't I buzz?")).toBe("why-cant-i-buzz");
    expect(helpHref("troubleshooting", "x")).toBe("/help/troubleshooting#x");
  });
});

describe.each(HELP_ARTICLES.map((a) => [a.id]))("article %s", (id) => {
  const body = readFileSync(path.join(ARTICLES_DIR, `${id}.md`), "utf8");
  const headings = extractHeadings(body);

  it("does not repeat the title as a level-1 heading", () => {
    expect(body).not.toMatch(/^#\s/m);
  });

  it("contains no raw HTML or template syntax", () => {
    const prose = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    expect(prose).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(prose).not.toMatch(/\{\{|\{%|\$\{/);
  });

  it("has unique headings without links", () => {
    const anchors = headings.map((h) => h.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const line of body.split("\n").filter((l) => /^#{2,6}\s/.test(l))) {
      expect(line).not.toMatch(/\]\(/);
    }
  });

  it("links only to Help pages and anchors that exist", () => {
    const links = [...body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!);
    for (const link of links.filter((l) => l.startsWith("/"))) {
      expect(resolves(link), link).toBe(true);
    }
  });
});

describe("help links in the app", () => {
  it("point to articles and headings that exist", () => {
    const calls: { file: string; target: string }[] = [];
    for (const file of sourceFiles(path.join(ROOT, "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /helpHref\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)"\s*)?,?\s*\)/g,
      )) {
        calls.push({
          file: path.relative(ROOT, file),
          target: match[2]
            ? `/help/${match[1]}#${match[2]}`
            : `/help/${match[1]}`,
        });
      }
    }

    expect(calls.length).toBeGreaterThan(10);
    const broken = calls.filter((c) => !resolves(c.target));
    expect(broken).toEqual([]);
  });

  it("covers the main player and host tasks", () => {
    const every = HELP_ARTICLES.flatMap((a) => a.audiences);
    expect(new Set(every)).toEqual(new Set(Object.keys(HELP_AUDIENCES)));
  });
});

describe("public Help has no game, session or database dependency", () => {
  const files = [
    ...sourceFiles(path.join(ROOT, "src", "help")),
    ...sourceFiles(path.join(ROOT, "src", "app", "help")),
    ...["HelpMarkdown", "FactPanels"].map((name) =>
      path.join(ROOT, "src/app/_components/server", name, "index.tsx"),
    ),
    path.join(ROOT, "src/app/_components/client/HelpSearch/index.tsx"),
    path.join(ROOT, "src/utils/gameRules.ts"),
    path.join(ROOT, "src/utils/displayName.ts"),
    path.join(ROOT, "src/server/scores/scoreMath.ts"),
  ];

  it.each(files.map((f) => [path.relative(ROOT, f), f]))(
    "%s imports none of them",
    (_, file) => {
      const source = readFileSync(file, "utf8");
      for (const forbidden of [
        "@/server/db",
        "@/server/auth",
        "@/trpc/server",
        "@/trpc/react",
        "next/headers",
        "@prisma/client",
      ]) {
        expect(source).not.toContain(`"${forbidden}`);
      }
    },
  );
});
