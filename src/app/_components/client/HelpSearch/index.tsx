"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

export type HelpSearchEntry = {
  id: string;
  title: string;
  summary: string;
  headings: { text: string; anchor: string }[];
  text: string;
};

type Result = {
  entry: HelpSearchEntry;
  score: number;
  headings: HelpSearchEntry["headings"];
};

function search(entries: HelpSearchEntry[], query: string): Result[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const results: Result[] = [];
  for (const entry of entries) {
    const haystack =
      `${entry.title} ${entry.summary} ${entry.headings.map((h) => h.text).join(" ")} ${entry.text}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;
    const headings = entry.headings.filter((h) =>
      terms.some((term) => h.text.toLowerCase().includes(term)),
    );
    const title = entry.title.toLowerCase();
    const score =
      terms.filter((t) => title.includes(t)).length * 3 + headings.length;
    results.push({ entry, score, headings });
  }
  return results.sort((a, b) => b.score - a.score);
}

/** Local search over the Help articles' titles, summaries and text. */
export function HelpSearch({ entries }: { entries: HelpSearchEntry[] }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const results = useMemo(() => search(entries, query), [entries, query]);

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={inputId} className="font-semibold">
        Search Help
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="For example: resume, joining closed, undo"
        className="field px-3 py-2 text-base"
      />
      {query.trim() !== "" && (
        <div aria-live="polite">
          {results.length === 0 ? (
            <p>
              No articles match &ldquo;{query.trim()}&rdquo;. Try fewer or
              different words.
            </p>
          ) : (
            <ul
              className="flex list-none flex-col gap-3"
              aria-label="Search results"
            >
              {results.map(({ entry, headings }) => (
                <li key={entry.id}>
                  <Link
                    href={`/help/${entry.id}`}
                    className="text-link font-semibold underline"
                  >
                    {entry.title}
                  </Link>
                  <p className="text-muted-foreground text-sm">
                    {entry.summary}
                  </p>
                  {headings.length > 0 && (
                    <ul className="mt-1 ml-4 list-disc text-sm">
                      {headings.map((h) => (
                        <li key={h.anchor}>
                          <Link
                            href={`/help/${entry.id}#${h.anchor}`}
                            className="text-link underline"
                          >
                            {h.text}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
