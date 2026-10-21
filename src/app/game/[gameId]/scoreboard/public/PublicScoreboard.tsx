"use client";

import { useState } from "react";

import { BuzzerState, GameFormat, GameStatus } from "@prisma/client";

import { GamePublicScoreboardTeamCard } from "@/app/_components/client/GamePublicScoreboardTeamCard";
import { PublicGameSoundEffects } from "@/app/_components/client/GameSoundEffects";
import { JoinQrCode } from "@/app/_components/client/JoinQrCode";
import {
  PublicLiveGameStateProvider,
  usePublicLiveGameState,
} from "@/app/_components/client/LiveGameState";
import { RankedAnswersBoard } from "@/app/_components/client/RankedAnswersBoard";
import { Button } from "@/app/_components/ui/button";
import { env } from "@/env";

import type { PublicGameState } from "@/types";

export function PublicScoreboard({
  gameState: initialGameState,
}: {
  gameState: PublicGameState;
}) {
  return (
    <PublicLiveGameStateProvider
      gameId={initialGameState.game.id}
      initialState={initialGameState}
    >
      <AudienceDisplay initialGameState={initialGameState} />
    </PublicLiveGameStateProvider>
  );
}

function buzzerLine(state: PublicGameState): string {
  const { game, gameTeams } = state;
  if (game.status === GameStatus.finished) return "Final scores";
  const winner = gameTeams.find((t) => t.buzzerState === BuzzerState.selected);
  if (winner) return `${winner.name} buzzed in first!`;
  if (game.isBuzzerListening) return "Buzzers are open!";
  if (game.status === GameStatus.lobby) return "Starting soon";
  return "Get ready for the next question";
}

/**
 * The screen-shareable view. It shows only public game information: never
 * host controls, player credentials or private state.
 */
function AudienceDisplay({
  initialGameState,
}: {
  initialGameState: PublicGameState;
}) {
  const state = usePublicLiveGameState().data ?? initialGameState;
  const [soundOn, setSoundOn] = useState(false);
  const { game, gameTeams } = state;
  const joinHost = env.NEXT_PUBLIC_QRCODE_BASE_URL.replace(/^https?:\/\//, "");

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PublicGameSoundEffects enabled={soundOn} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold tracking-wide uppercase">
            Audience display
          </span>
          <h1 className="mt-2 text-3xl font-extrabold">{game.name}</h1>
        </div>
        <Button
          variant="secondary"
          aria-pressed={soundOn}
          onClick={() => setSoundOn((on) => !on)}
        >
          {soundOn ? "Turn off sound" : "Turn on sound"}
        </Button>
      </header>

      {state.mode?.status === "running" ? (
        <RankedAnswersBoard
          view={state.mode}
          names={Object.fromEntries(gameTeams.map((t) => [t.id, t.name]))}
          size="large"
        />
      ) : (
        <p
          role="status"
          data-testid="display-status"
          className="text-center text-4xl font-bold"
        >
          {buzzerLine(state)}
        </p>
      )}

      {game.joinCode && (
        <section
          aria-label="How to join"
          className="flex flex-wrap items-center justify-center gap-6 rounded-xl bg-white/10 p-4"
        >
          <div className="text-center">
            <p className="text-lg">
              Join at <strong>{joinHost}/join</strong> with code
            </p>
            <p
              data-testid="display-join-code"
              className="font-mono text-5xl font-bold tracking-[0.3em]"
            >
              {game.joinCode}
            </p>
          </div>
          <div className="rounded-lg bg-white p-2">
            <JoinQrCode code={game.joinCode} className="h-28 w-28" />
          </div>
        </section>
      )}

      <section
        aria-label={game.format === GameFormat.team ? "Teams" : "Players"}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {gameTeams.map((gameTeam) => (
          <GamePublicScoreboardTeamCard
            key={gameTeam.id}
            gameId={game.id}
            gameTeam={gameTeam}
          />
        ))}
      </section>
      {gameTeams.length === 0 && (
        <p className="text-center text-white/80">
          Players will appear here as they join.
        </p>
      )}
    </div>
  );
}
