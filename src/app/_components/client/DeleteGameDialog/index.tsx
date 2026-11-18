"use client";

import { useState } from "react";

import {
  ErrorNotice,
  type NoticeError,
} from "@/app/_components/client/ErrorNotice";
import { Button } from "@/app/_components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/app/_components/ui/dialog";

export type DeletableGame = {
  name: string;
  status: "lobby" | "running" | "finished";
  playerCount: number;
};

/** Finished games and lobbies nobody joined can be deleted directly. */
export function needsFinishing(game: DeletableGame) {
  return !(
    game.status === "finished" ||
    (game.status === "lobby" && game.playerCount === 0)
  );
}

/**
 * Owner-only permanent delete, with the game's name typed to confirm. A game
 * still in play needs one more explicit tick: deleting it ends the game for
 * everyone in it.
 */
export function DeleteGameDialog({
  game,
  onDelete,
  isPending,
  error,
  triggerLabel = "Delete…",
  triggerAriaLabel,
}: {
  game: DeletableGame;
  onDelete: (input: { confirmName: string; finishFirst?: boolean }) => void;
  isPending: boolean;
  error: NoticeError;
  triggerLabel?: string;
  triggerAriaLabel?: string;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [endForEveryone, setEndForEveryone] = useState(false);
  const active = needsFinishing(game);

  return (
    <Dialog
      onOpenChange={() => {
        setConfirmName("");
        setEndForEveryone(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" aria-label={triggerAriaLabel}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this game permanently?</DialogTitle>
          <DialogDescription>
            This removes <strong>{game.name}</strong>, its players, scores, chat
            and history for everyone. It can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        {active && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={endForEveryone}
              onChange={(e) => setEndForEveryone(e.target.checked)}
            />
            <span>
              This game is still{" "}
              {game.status === "running" ? "in play" : "open"}
              {game.playerCount > 0 &&
                ` with ${game.playerCount} ${game.playerCount === 1 ? "player" : "players"}`}
              . End it for everyone and delete it.
            </span>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span>
            Type the game name, <strong>{game.name}</strong>, to confirm
          </span>
          <input
            aria-label="Game name to confirm deletion"
            className="field px-2 py-1"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
          />
        </label>
        <ErrorNotice error={error} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={
              confirmName.trim() !== game.name ||
              (active && !endForEveryone) ||
              isPending
            }
            onClick={() =>
              onDelete(
                active ? { confirmName, finishFirst: true } : { confirmName },
              )
            }
          >
            {isPending ? "Deleting…" : "Delete forever"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
