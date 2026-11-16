"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/app/_components/ui/button";
import {
  THEME_CHOICE_ATTRIBUTE,
  THEME_STORAGE_KEY,
  resolveDark,
  type ThemeChoice,
} from "@/utils/theme";

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const LABEL: Record<ThemeChoice, string> = {
  system: "Device setting",
  light: "Light",
  dark: "Dark",
};

const isChoice = (value: string | null): value is ThemeChoice =>
  value === "system" || value === "light" || value === "dark";

function readChoice(): ThemeChoice {
  const inPage = document.documentElement.getAttribute(THEME_CHOICE_ATTRIBUTE);
  if (isChoice(inPage)) return inPage;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** The <head> script (THEME_INIT_SCRIPT) reads the attribute on device changes. */
function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  root.setAttribute(THEME_CHOICE_ATTRIBUTE, choice);
  root.classList.toggle(
    "dark",
    resolveDark(
      choice,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
  );
}

/**
 * Cycles the colour theme: device setting → light → dark. The choice is
 * remembered on this device; "device setting" follows the system live.
 */
export function ThemeToggle() {
  // null until mounted: the server can't know the choice.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    // Reading localStorage must wait until after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(readChoice());
  }, []);

  const current = choice ?? "system";
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Colour theme: ${LABEL[current]}. Change theme`}
      title={`Theme: ${LABEL[current]}`}
      onClick={() => {
        const next = NEXT[current];
        try {
          if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
          else localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Private browsing: the choice lasts for this page only.
        }
        setChoice(next);
        applyTheme(next);
      }}
    >
      <Icon aria-hidden className="size-4" />
      <span className="sr-only sm:not-sr-only">{LABEL[current]}</span>
    </Button>
  );
}
