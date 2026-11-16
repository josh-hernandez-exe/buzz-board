import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_CHOICE_ATTRIBUTE, THEME_INIT_SCRIPT } from "@/utils/theme";

import { ThemeToggle } from ".";

let systemDark = false;
const listeners = new Set<() => void>();

function setSystemDark(dark: boolean) {
  systemDark = dark;
  act(() => listeners.forEach((listener) => listener()));
}

/** Runs the inline <head> script string the way the browser does. */
function runHeadScript() {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function(THEME_INIT_SCRIPT)();
}

beforeEach(() => {
  systemDark = false;
  listeners.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute(THEME_CHOICE_ATTRIBUTE);
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    get matches() {
      return systemDark;
    },
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  // Private browsing: every storage access throws.
  const blocked = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme with blocked storage", () => {
  it("the head script still follows a dark device setting", () => {
    systemDark = true;
    runHeadScript();
    expect(document.documentElement).toHaveClass("dark");
  });

  it("keeps an in-page Light choice when the device switches to dark", async () => {
    const user = userEvent.setup();
    runHeadScript();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: /Device setting/ }));
    expect(screen.getByRole("button", { name: /Light/ })).toBeInTheDocument();

    setSystemDark(true);

    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("follows the device after the toggle unmounts (client navigation)", () => {
    runHeadScript();
    render(<ThemeToggle />).unmount();

    setSystemDark(true);

    expect(document.documentElement).toHaveClass("dark");
  });

  it("a remounted toggle shows the in-page choice", async () => {
    const user = userEvent.setup();
    runHeadScript();
    const first = render(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: /Device setting/ }));
    await user.click(screen.getByRole("button", { name: /Light/ }));
    first.unmount();

    render(<ThemeToggle />);

    expect(
      await screen.findByRole("button", { name: /Colour theme: Dark/ }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
  });
});
