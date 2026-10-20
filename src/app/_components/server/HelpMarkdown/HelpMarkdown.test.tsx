import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const { HelpMarkdown } = await import("./index");

describe("HelpMarkdown", () => {
  it("gives headings the same anchors the manifest checks use", () => {
    render(<HelpMarkdown markdown={"## Why can't **I** buzz?\n\nText"} />);

    expect(
      screen.getByRole("heading", { name: "Why can't I buzz?" }),
    ).toHaveAttribute("id", "why-cant-i-buzz");
  });

  it("drops raw HTML instead of rendering it", () => {
    const { container } = render(
      <HelpMarkdown
        markdown={'Hello <script>alert(1)</script><img src=x onerror="x">'}
      />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("Hello");
  });

  it("opens external links in a new tab without opener access", () => {
    render(
      <HelpMarkdown
        markdown={
          "[Inside](/help/troubleshooting) and [outside](https://example.com)"
        }
      />,
    );

    expect(screen.getByRole("link", { name: "Inside" })).toHaveAttribute(
      "href",
      "/help/troubleshooting",
    );
    expect(screen.getByRole("link", { name: "outside" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });
});
