"use client";

import { useRef, useState } from "react";

import { GameFormat } from "@prisma/client";
import { useRouter } from "next/navigation";

import { Button } from "@/app/_components/ui/button";
import { api } from "@/trpc/react";
import { NAME_LIMITS } from "@/utils/displayName";
import { newRequestId } from "@/utils/requestId";

const MIN_TEAMS = 1;
const MAX_TEAMS = 8;

/**
 * One short form: name, format and (for team games) team count. Chat, modes
 * and content are not part of creating a basic game.
 */
export function CreateGame() {
  const router = useRouter();
  const [name, setName] = useState("Trivia night");
  const [format, setFormat] = useState<GameFormat>(GameFormat.team);
  const [teamCount, setTeamCount] = useState(2);
  // One ID per attempt: a double-click or a retried request after a slow
  // response returns the same game instead of creating a second room.
  const requestId = useRef(newRequestId());

  const createGame = api.user.game.create.useMutation({
    onSuccess: (game) => {
      requestId.current = newRequestId();
      router.push(`/game/${game.id}/admin`);
    },
  });

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !createGame.isPending;

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-white/10 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        createGame.mutate({
          name: trimmed,
          format,
          teamCount: format === GameFormat.team ? teamCount : undefined,
          requestId: requestId.current,
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Game name
        <input
          type="text"
          value={name}
          maxLength={NAME_LIMITS.maxGameName}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg bg-white/10 px-3 py-2 text-base text-white"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Players compete</legend>
        {(
          [
            [GameFormat.team, "As teams"],
            [GameFormat.individual, "Individually"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              value={value}
              checked={format === value}
              onChange={() => setFormat(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {format === GameFormat.team && (
        <div className="flex flex-col gap-1">
          <span id="team-count-label" className="text-sm font-medium">
            Number of teams
          </span>
          <div
            className="flex items-center gap-3"
            role="group"
            aria-labelledby="team-count-label"
          >
            <Button
              type="button"
              variant="secondary"
              aria-label="Fewer teams"
              disabled={teamCount <= MIN_TEAMS}
              onClick={() => setTeamCount((n) => Math.max(MIN_TEAMS, n - 1))}
            >
              −
            </Button>
            <output aria-live="polite" className="w-6 text-center text-lg">
              {teamCount}
            </output>
            <Button
              type="button"
              variant="secondary"
              aria-label="More teams"
              disabled={teamCount >= MAX_TEAMS}
              onClick={() => setTeamCount((n) => Math.min(MAX_TEAMS, n + 1))}
            >
              +
            </Button>
          </div>
          <p className="text-xs text-white/70">
            New players are placed on the team with the fewest players. You can
            change this, and rename or add teams, from the host desk.
          </p>
        </div>
      )}

      {createGame.error && (
        <p role="alert" className="text-sm text-red-300">
          {createGame.error.message}
        </p>
      )}

      <Button type="submit" disabled={!canSubmit}>
        {createGame.isPending ? "Creating…" : "Create game"}
      </Button>
    </form>
  );
}
