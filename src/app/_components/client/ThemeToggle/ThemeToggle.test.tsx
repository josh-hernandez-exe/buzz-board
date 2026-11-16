import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_INIT_SCRIPT } from "@/utils/theme";

import { ThemeToggle } from ".";

let systemDark = false;
const listeners = new Set<() => void>();

function setSystemDark(dark: boolean) {
  systemDark = dark;
  act(() => listeners.forEach((listener) => listener()));
}

beforeEach(() => {
  systemDark = false;
  listeners.clear();
  document.documentElement.classList.remove("dark");
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
  it("the init script still follows a dark device setting", () => {
    systemDark = true;
    // Runs the inline <head> script string the way the browser does.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement).toHaveClass("dark");
  });

  it("keeps an in-page Light choice when the device switches to dark", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: /Device setting/ }));
    expect(screen.getByRole("button", { name: /Light/ })).toBeInTheDocument();

    setSystemDark(true);

    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("follows the device while Device setting is chosen", () => {
    render(<ThemeToggle />);
    setSystemDark(true);
    expect(document.documentElement).toHaveClass("dark");
  });
});
