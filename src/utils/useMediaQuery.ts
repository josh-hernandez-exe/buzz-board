"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches. False during server rendering and the
 * first client render, so markup always hydrates cleanly.
 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
