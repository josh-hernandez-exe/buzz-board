import { readFileSync } from "node:fs";
import path from "node:path";

import {
  HELP_ARTICLES,
  slugify,
  type HelpArticle,
  type HelpArticleId,
} from "@/help/manifest";

const ARTICLES_DIR = path.join(process.cwd(), "src", "help", "articles");

export type HelpHeading = { level: 2 | 3; text: string; anchor: string };

export type HelpIndexEntry = HelpArticle & {
  headings: HelpHeading[];
  /** Body as plain text, for local search. */
  text: string;
};

export function readArticleBody(id: HelpArticleId): string {
  return readFileSync(path.join(ARTICLES_DIR, `${id}.md`), "utf8");
}

/** Removes inline Markdown so heading text matches what is rendered. */
function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

/** Level-2 and level-3 headings outside code blocks, with their anchors. */
export function extractHeadings(markdown: string): HelpHeading[] {
  const headings: HelpHeading[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = stripInline(match[2]!);
    headings.push({
      level: match[1]!.length as 2 | 3,
      text,
      anchor: slugify(text),
    });
  }
  return headings;
}

export function toPlainText(markdown: string): string {
  return stripInline(
    markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^#+\s+/gm, "")
      .replace(/^\s*[-*]\s+|^\s*\d+\.\s+/gm, "")
      .replace(/\s+/g, " "),
  );
}

export function loadHelpIndex(): HelpIndexEntry[] {
  return HELP_ARTICLES.map((article) => {
    const body = readArticleBody(article.id);
    return {
      ...article,
      headings: extractHeadings(body),
      text: toPlainText(body),
    };
  });
}
