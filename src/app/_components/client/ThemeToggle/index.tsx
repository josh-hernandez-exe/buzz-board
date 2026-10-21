"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/app/_components/ui/button";
import {
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

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function applyTheme(choice: ThemeChoice) {
  document.documentElement.classList.toggle(
    "dark",
    resolveDark(choice, media().matches),
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
    const onChange = () => applyTheme(readChoice());
    const query = media();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
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
