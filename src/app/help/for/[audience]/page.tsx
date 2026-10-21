import Link from "next/link";
import { notFound } from "next/navigation";
import { type Metadata } from "next";

import { loadHelpIndex } from "@/help/content";
import { HELP_AUDIENCES, type HelpAudience } from "@/help/manifest";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(HELP_AUDIENCES).map((audience) => ({ audience }));
}

function isAudience(value: string): value is HelpAudience {
  return value in HELP_AUDIENCES;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ audience: string }>;
}): Promise<Metadata> {
  const { audience } = await params;
  return {
    title: isAudience(audience)
      ? `Help for ${HELP_AUDIENCES[audience].toLowerCase()} · Buzz-Board`
      : "Help · Buzz-Board",
  };
}

export default async function HelpForAudience({
  params,
}: {
  params: Promise<{ audience: string }>;
}) {
  const { audience } = await params;
  if (!isAudience(audience)) notFound();

  const articles = loadHelpIndex().filter((a) =>
    (a.audiences as readonly string[]).includes(audience),
  );

  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link href="/help" className="text-primary underline">
          All help
        </Link>
      </p>
      <h1 className="text-3xl font-extrabold">
        Help for {HELP_AUDIENCES[audience].toLowerCase()}
      </h1>
      {articles.map((article) => (
        <section key={article.id} aria-labelledby={`a-${article.id}`}>
          <h2 id={`a-${article.id}`} className="text-xl font-bold">
            <Link
              href={`/help/${article.id}`}
              className="text-primary underline"
            >
              {article.title}
            </Link>
          </h2>
          <p className="text-muted-foreground">{article.summary}</p>
          <ul className="mt-2 ml-4 list-disc">
            {article.headings
              .filter((h) => h.level === 2)
              .map((h) => (
                <li key={h.anchor}>
                  <Link
                    href={`/help/${article.id}#${h.anchor}`}
                    className="text-primary underline"
                  >
                    {h.text}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
