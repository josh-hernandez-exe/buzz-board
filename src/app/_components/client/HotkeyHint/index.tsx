"use client";

import { hotkeyHint, useHotkeysPreference } from "@/utils/useHotkeys";

/**
 * The key hints under a host panel, with the switch that turns single-key
 * shortcuts on or off for this browser (WCAG 2.1.4).
 */
export function HotkeyHint({ parts }: { parts: [string, string][] }) {
  const [on, setOn] = useHotkeysPreference();
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {on && <span>Keyboard: {hotkeyHint(parts)}</span>}
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
        />
        Single-key shortcuts
      </label>
    </div>
  );
}
