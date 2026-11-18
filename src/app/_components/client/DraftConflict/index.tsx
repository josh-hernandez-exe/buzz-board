"use client";

import { useState } from "react";

import { Button } from "@/app/_components/ui/button";
import { Notice } from "@/app/_components/ui/page";

/** True when a save was refused because another host saved first. */
export function isDraftConflict(
  error: { data?: { code?: string } | null } | null | undefined,
) {
  return error?.data?.code === "CONFLICT";
}

/**
 * Shown when another host saved this setup while you were editing. Nothing
 * is lost either way: keep yours (replacing theirs), use theirs (dropping
 * yours), or download yours first to keep a copy.
 */
export function DraftConflict({
  onKeepMine,
  onUseTheirs,
  mine,
  fileName,
}: {
  onKeepMine: () => Promise<unknown>;
  onUseTheirs: () => Promise<unknown>;
  /** Your unsaved version, for the download. */
  mine: unknown;
  fileName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    action()
      .catch((e: unknown) =>
        setProblem(e instanceof Error ? e.message : "That didn't work."),
      )
      .finally(() => setBusy(false));
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(mine, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Notice tone="warning" role="alert">
      <div data-testid="draft-conflict" className="flex flex-col gap-2">
        <p>
          <strong>Another host saved this setup while you were editing.</strong>{" "}
          Your changes are still here. Choose which version to keep.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Save your version over the other host's? Their changes since you started are replaced.",
                )
              ) {
                run(onKeepMine);
              }
            }}
          >
            Keep mine
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Load the other host's version? Your unsaved changes are dropped (download them first to keep a copy).",
                )
              ) {
                run(onUseTheirs);
              }
            }}
          >
            Use theirs
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={download}>
            Download mine
          </Button>
        </div>
        {problem && <p className="text-destructive">{problem}</p>}
      </div>
    </Notice>
  );
}
