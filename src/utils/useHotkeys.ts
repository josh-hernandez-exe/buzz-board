"use client";

import { useEffect, useRef } from "react";
import { useLocalStorage } from "usehooks-ts";

/**
 * Whether this browser uses single-key shortcuts. On by default; anyone can
 * turn them off (WCAG 2.1.4), e.g. with speech input, where a spoken word
 * could otherwise press keys. One setting for every host panel.
 */
export function useHotkeysPreference() {
  return useLocalStorage<boolean>("buzz-board-single-key-shortcuts", true, {
    // Same markup on the server and the first client render.
    initializeWithValue: false,
  });
}

/**
 * Single-key shortcuts for the host desk, such as "1" to reveal answer 1.
 * Ignored while typing in a field, with a modifier held, while a dialog is
 * open, when the key repeats from being held down, or when this browser has
 * shortcuts turned off. Returns whether shortcuts are on, so buttons only
 * advertise keys (aria-keyshortcuts) that work.
 */
export function useHotkeys(
  handlers: Record<string, (() => void) | undefined>,
  enabled = true,
) {
  const [on] = useHotkeysPreference();
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!enabled || !on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, audio, video, [contenteditable='true'], [data-media]",
        ) ||
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
  }, [enabled, on]);
  return on;
}

/** A row of key hints, e.g. "1–8 answer · X strike". */
export function hotkeyHint(parts: [string, string][]) {
  return parts.map(([key, what]) => `${key} ${what}`).join(" · ");
}
