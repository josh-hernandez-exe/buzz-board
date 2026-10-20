import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

import { slugify } from "@/help/manifest";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return Children.toArray(node).map(textOf).join("");
}

const components: Components = {
  h2: ({ children }) => (
    <h2
      id={slugify(textOf(children))}
      className="mt-8 scroll-mt-4 text-xl font-bold"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      id={slugify(textOf(children))}
      className="mt-6 scroll-mt-4 text-lg font-semibold"
    >
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-3 ml-6 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 ml-6 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="my-1">{children}</li>,
  a: ({ href = "", children }) =>
    href.startsWith("/") ? (
      <Link href={href} className="text-blue-700 underline">
        {children}
      </Link>
    ) : (
      <a
        href={href}
        className="text-blue-700 underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),
};

/**
 * Renders trusted Help Markdown from this repository. Raw HTML is dropped.
 * Never use this for user-written text such as names or chat.
 */
export function HelpMarkdown({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown skipHtml components={components}>
      {markdown}
    </ReactMarkdown>
  );
}
