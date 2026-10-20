import Link from "next/link";
import { notFound } from "next/navigation";
import { type Metadata } from "next";

import { FactPanels } from "@/app/_components/server/FactPanels";
import { HelpMarkdown } from "@/app/_components/server/HelpMarkdown";
import { extractHeadings, readArticleBody } from "@/help/content";
import {
  HELP_ARTICLES,
  HELP_AUDIENCES,
  getHelpArticle,
  type HelpArticleId,
} from "@/help/manifest";

export const dynamicParams = false;

export function generateStaticParams() {
  return HELP_ARTICLES.map((article) => ({ articleId: article.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ articleId: string }>;
}): Promise<Metadata> {
  const { articleId } = await params;
  const article = getHelpArticle(articleId);
  return {
    title: article ? `${article.title} · Buzz-Board Help` : "Help",
    description: article?.summary,
  };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { articleId } = await params;
  const article = getHelpArticle(articleId);
  if (!article) notFound();

  const body = readArticleBody(article.id as HelpArticleId);
  const sections = extractHeadings(body).filter((h) => h.level === 2);
  const related = HELP_ARTICLES.filter(
    (other) =>
      other.id !== article.id &&
      other.audiences.some((a) => article.audiences.includes(a)),
  );

  return (
    <article className="flex flex-col gap-6">
      <p>
        <Link href="/help" className="text-blue-700 underline">
          All help
        </Link>
      </p>
      <header>
        <h1 className="text-3xl font-extrabold">{article.title}</h1>
        <p className="mt-2 text-slate-700">
          For{" "}
          {article.audiences
            .map((a) => HELP_AUDIENCES[a])
            .join(" and ")
            .toLowerCase()}
        </p>
      </header>

      {sections.length > 1 && (
        <nav aria-label="On this page" className="rounded-xl border p-4">
          <h2 className="font-bold">On this page</h2>
          <ul className="mt-2 ml-4 list-disc">
            {sections.map((h) => (
              <li key={h.anchor}>
                <a href={`#${h.anchor}`} className="text-blue-700 underline">
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <FactPanels panels={article.facts} />

      <div>
        <HelpMarkdown markdown={body} />
      </div>

      {related.length > 0 && (
        <nav aria-label="Related guides" className="border-t pt-4">
          <h2 className="font-bold">Related guides</h2>
          <ul className="mt-2 ml-4 list-disc">
            {related.map((other) => (
              <li key={other.id}>
                <Link
                  href={`/help/${other.id}`}
                  className="text-blue-700 underline"
                >
                  {other.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </article>
  );
}
