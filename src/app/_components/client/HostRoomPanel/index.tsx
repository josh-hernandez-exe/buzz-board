"use client";

import { useEffect, useRef, useState } from "react";

import { GameFormat, GameStatus, TeamAssignment } from "@prisma/client";
import { useRouter } from "next/navigation";
import * as QRCode from "qrcode";

import { GenericCard } from "@/app/_components/GenericCard";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
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
import { Switch } from "@/app/_components/ui/switch";
import { env } from "@/env";
import { logger } from "@/logger";
import { api } from "@/trpc/react";
import { newRequestId } from "@/utils/requestId";

const REOPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

export const STATUS_LABEL: Record<GameStatus, string> = {
  lobby: "Lobby: not started",
  running: "Live",
  finished: "Finished",
};

const ASSIGNMENT_LABEL: Record<TeamAssignment, string> = {
  auto: "Automatic: fewest players first",
  choose: "Players choose their team",
  staff: "Host assigns teams",
};

export function joinUrl(code: string) {
  return `${env.NEXT_PUBLIC_QRCODE_BASE_URL}/join?code=${code}`;
}

function JoinQrCode({ code }: { code: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(
      canvasRef.current,
      joinUrl(code),
      { errorCorrectionLevel: "L" },
      (error) => {
        if (error) logger.error("Error generating QR code", error);
      },
    );
  }, [code]);
  return (
    <canvas
      ref={canvasRef}
      className="h-32 w-32"
      role="img"
      aria-label={`QR code to join with code ${code}`}
    />
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState<boolean | "failed">(false);
  return (
    <Button
      variant="secondary"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => setCopied("failed"),
        );
        setTimeout(() => setCopied(false), 2_000);
      }}
    >
      {copied === true
        ? "Copied"
        : copied === "failed"
          ? "Copy failed: select the link"
          : label}
    </Button>
  );
}

function ErrorText({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-600">
      {message}
    </p>
  );
}

/**
 * The host desk's room overview: how to share it, who may join, and the
 * game's lifecycle. Shown to every host/co-host; delete is owner-only.
 */
export function HostRoomPanel({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const { data } = useLiveGameState();
  const [confirmName, setConfirmName] = useState("");
  // Updated each minute so "Reopen" disables once the 24-hour window ends.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const duplicateRequestId = useRef(newRequestId());

  const setJoiningOpen = api.gameAdmin.setJoiningOpen.useMutation();
  const setTeamAssignment = api.gameAdmin.setTeamAssignment.useMutation();
  const finishGame = api.gameAdmin.finishGame.useMutation();
  const reopenGame = api.gameAdmin.reopenGame.useMutation();
  const duplicateGame = api.gameAdmin.duplicateGame.useMutation({
    onSuccess: ({ gameId }) => {
      duplicateRequestId.current = newRequestId();
      router.push(`/game/${gameId}/admin`);
    },
  });
  const deleteGame = api.gameAdmin.deleteGame.useMutation({
    onSuccess: () => router.push("/dashboard"),
  });

  if (!data) return null;
  const { game } = data;
  const playerCount = Object.keys(data.gameUsers).length;
  const finished = game.status === GameStatus.finished;
  const canReopen =
    finished &&
    !!game.finishedAt &&
    now - new Date(game.finishedAt).getTime() <= REOPEN_WINDOW_MS;
  const deleteBlockedReason =
    finished || (game.status === GameStatus.lobby && playerCount === 0)
      ? undefined
      : "Finish the game first. Only finished games or unused lobbies can be deleted.";

  return (
    <GenericCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          {game.name}
          <span
            data-testid="game-status"
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              finished
                ? "bg-gray-200 text-gray-800"
                : game.status === GameStatus.running
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-900"
            }`}
          >
            {STATUS_LABEL[game.status]}
          </span>
        </span>
      }
      content={
        <div className="flex flex-col gap-6">
          <section
            aria-labelledby="share-heading"
            className="flex flex-col gap-4 sm:flex-row"
          >
            <div className="flex flex-1 flex-col gap-2">
              <h3 id="share-heading" className="font-semibold">
                Share
              </h3>
              <p>
                Join code{" "}
                <strong
                  data-testid="join-code"
                  className="font-mono text-2xl tracking-widest"
                >
                  {game.code}
                </strong>
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={joinUrl(game.code)} label="Copy join link" />
                <Button variant="secondary" asChild>
                  <a
                    href={`/game/${game.id}/scoreboard/public`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open audience display
                  </a>
                </Button>
              </div>
              <p className="text-sm text-gray-600">
                Screen-share the audience display, not this host desk. It shows
                scores and buzzes, never controls.
              </p>
            </div>
            <div className="flex flex-col items-center">
              <JoinQrCode code={game.code} />
              <span className="text-xs text-gray-600">Scan to join</span>
            </div>
          </section>

          <section
            aria-labelledby="joining-heading"
            className="flex flex-col gap-3"
          >
            <h3 id="joining-heading" className="font-semibold">
              Players ({playerCount})
            </h3>
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="joining-open" className="text-sm">
                {game.joiningOpen
                  ? "New players can join"
                  : "Joining is closed; players already in can still return"}
              </label>
              <Switch
                id="joining-open"
                aria-label="Allow new players to join"
                checked={game.joiningOpen}
                disabled={finished || setJoiningOpen.isPending}
                onCheckedChange={(open: boolean) =>
                  setJoiningOpen.mutate({ open })
                }
              />
            </div>
            {game.format === GameFormat.team && (
              <label className="flex flex-col gap-1 text-sm">
                Team assignment for new players
                <select
                  className="rounded-md border px-2 py-1"
                  value={game.teamAssignment}
                  disabled={finished || setTeamAssignment.isPending}
                  onChange={(e) =>
                    setTeamAssignment.mutate({
                      teamAssignment: e.target.value as TeamAssignment,
                    })
                  }
                >
                  {Object.values(TeamAssignment).map((value) => (
                    <option key={value} value={value}>
                      {ASSIGNMENT_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ErrorText
              message={
                setJoiningOpen.error?.message ??
                setTeamAssignment.error?.message
              }
            />
          </section>

          <section
            aria-labelledby="game-heading"
            className="flex flex-col gap-3"
          >
            <h3 id="game-heading" className="font-semibold">
              Game
            </h3>
            <div className="flex flex-wrap gap-2">
              {!finished && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">Finish game…</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Finish this game?</DialogTitle>
                      <DialogDescription>
                        The buzzer closes, nobody new can join, and players can
                        no longer change names or teams. Scores stay visible.
                        You can reopen within 24 hours to correct results.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="secondary">Keep playing</Button>
                      </DialogClose>
                      <DialogClose asChild>
                        <Button onClick={() => finishGame.mutate()}>
                          Finish game
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
              {finished && (
                <Button
                  variant="outline"
                  disabled={!canReopen || reopenGame.isPending}
                  title={
                    canReopen
                      ? undefined
                      : "Games can only be reopened within 24 hours of finishing."
                  }
                  onClick={() => reopenGame.mutate()}
                >
                  Reopen to correct results
                </Button>
              )}
              <Button
                variant="outline"
                disabled={duplicateGame.isPending}
                onClick={() =>
                  duplicateGame.mutate({
                    requestId: duplicateRequestId.current,
                  })
                }
              >
                {duplicateGame.isPending ? "Duplicating…" : "Duplicate"}
              </Button>
              {isOwner && (
                <Dialog onOpenChange={() => setConfirmName("")}>
                  <DialogTrigger asChild>
                    <Button variant="destructive">Delete…</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete this game permanently?</DialogTitle>
                      <DialogDescription>
                        This removes the game, its players, scores and history
                        for everyone. It cannot be undone.
                      </DialogDescription>
                    </DialogHeader>
                    {deleteBlockedReason ? (
                      <p className="text-sm">{deleteBlockedReason}</p>
                    ) : (
                      <label className="flex flex-col gap-1 text-sm">
                        <span>
                          Type the game name, <strong>{game.name}</strong>, to
                          confirm
                        </span>
                        <input
                          aria-label="Game name to confirm deletion"
                          className="rounded-md border px-2 py-1"
                          value={confirmName}
                          onChange={(e) => setConfirmName(e.target.value)}
                        />
                      </label>
                    )}
                    <ErrorText message={deleteGame.error?.message} />
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="secondary">Cancel</Button>
                      </DialogClose>
                      <Button
                        variant="destructive"
                        disabled={
                          !!deleteBlockedReason ||
                          confirmName.trim() !== game.name ||
                          deleteGame.isPending
                        }
                        onClick={() => deleteGame.mutate({ confirmName })}
                      >
                        Delete forever
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
            <ErrorText
              message={
                finishGame.error?.message ??
                reopenGame.error?.message ??
                duplicateGame.error?.message
              }
            />
          </section>
        </div>
      }
    />
  );
}
