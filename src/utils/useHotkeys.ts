"use client";

import { useEffect, useRef } from "react";

/**
 * Single-key shortcuts for the host desk, such as "1" to reveal answer 1.
 * Ignored while typing in a field, with a modifier held, while a dialog is
 * open, or when the key repeats from being held down.
 */
export function useHotkeys(
  handlers: Record<string, (() => void) | undefined>,
  enabled = true,
) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true']") ||
        document.querySelector("[role='dialog'], [role='alertdialog']")
      ) {
        return;
      }
      const run = latest.current[e.key.toLowerCase()];
      if (run) {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** A row of key hints, e.g. "1–8 answer · X strike". */
export function hotkeyHint(parts: [string, string][]) {
  return parts.map(([key, what]) => `${key} ${what}`).join(" · ");
}
