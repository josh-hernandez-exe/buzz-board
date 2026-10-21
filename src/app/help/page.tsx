import Link from "next/link";
import { type Metadata } from "next";

import { HelpSearch } from "@/app/_components/client/HelpSearch";
import { loadHelpIndex } from "@/help/content";
import { HELP_AUDIENCES, type HelpAudience } from "@/help/manifest";

export const dynamic = "force-static";

export const metadata: Metadata = { title: "Help · Buzz-Board" };

export default function HelpHome() {
  const index = loadHelpIndex();

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h1 className="text-3xl font-extrabold">Help</h1>
        <p className="text-muted-foreground mt-2">
          Guides for playing and hosting Buzz-Board games. No account needed to
          read them.
        </p>
        <nav aria-label="Help by role" className="mt-4 flex flex-wrap gap-3">
          {(Object.keys(HELP_AUDIENCES) as HelpAudience[]).map((audience) => (
            <Link
              key={audience}
              href={`/help/for/${audience}`}
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-full px-4 py-2 font-semibold"
            >
              Help for {HELP_AUDIENCES[audience].toLowerCase()}
            </Link>
          ))}
        </nav>
      </section>

      <HelpSearch
        entries={index.map(({ id, title, summary, headings, text }) => ({
          id,
          title,
          summary,
          headings,
          text,
        }))}
      />

      <section aria-labelledby="articles-heading">
        <h2 id="articles-heading" className="text-xl font-bold">
          All guides
        </h2>
        <ul className="mt-3 flex list-none flex-col gap-3">
          {index.map((article) => (
            <li key={article.id}>
              <Link
                href={`/help/${article.id}`}
                className="text-link font-semibold underline"
              >
                {article.title}
              </Link>
              <p className="text-muted-foreground text-sm">{article.summary}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-xl font-bold">
          Frequently asked questions
        </h2>
        <ul className="mt-3 flex list-none flex-col gap-1">
          {index.flatMap((article) =>
            article.headings
              .filter((h) => h.level === 2 && h.text.endsWith("?"))
              .map((h) => (
                <li key={`${article.id}#${h.anchor}`}>
                  <Link
                    href={`/help/${article.id}#${h.anchor}`}
                    className="text-link underline"
                  >
                    {h.text}
                  </Link>
                </li>
              )),
          )}
        </ul>
      </section>
    </div>
  );
}
