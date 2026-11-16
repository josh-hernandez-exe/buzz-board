import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { HeaderMenu } from ".";

const links = [
  { href: "/join", label: "Join" },
  { href: "/help", label: "Help" },
];

describe("HeaderMenu", () => {
  it("returns focus to the Menu button when Escape closes it from a link", async () => {
    const user = userEvent.setup();
    render(<HeaderMenu links={links} />);
    const button = screen.getByRole("button", { name: "Menu" });

    await user.click(button);
    await user.tab();
    expect(screen.getByRole("link", { name: "Join" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("leaves focus alone when Escape closes it from elsewhere", async () => {
    const user = userEvent.setup();
    render(
      <>
        <HeaderMenu links={links} />
        <input aria-label="Elsewhere" />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });
    elsewhere.focus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
  });
});
