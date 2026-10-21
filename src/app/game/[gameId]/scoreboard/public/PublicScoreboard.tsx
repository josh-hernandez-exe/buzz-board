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
import { CategoryGridBoard } from "@/app/_components/client/CategoryGridBoard";
import { FinalStandings } from "@/app/_components/client/FinalStandings";
import { Button } from "@/app/_components/ui/button";
import { cn } from "@/app/_lib/utils";
import { env } from "@/env";
import { unlockAudio } from "@/utils/synthSounds";

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
  const { game, gameTeams, buzzQueue } = state;
  if (game.status === GameStatus.finished) return "Final scores";
  if (game.buzzerMode === "queue") {
    const name = (id: string) =>
      gameTeams.find((t) => t.id === id)?.name ?? "A removed team";
    const correct = buzzQueue.find((e) => e.status === "correct");
    if (correct) return `${name(correct.gameTeamId)} got it!`;
    const answering = buzzQueue.find((e) => e.status === "answering");
    if (answering) return `${name(answering.gameTeamId)} is answering`;
  }
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
  const teamNames = Object.fromEntries(gameTeams.map((t) => [t.id, t.name]));
  const best = Math.max(0, ...gameTeams.map((t) => t.score));
  const waiting = state.buzzQueue.filter((e) => e.status === "waiting");
  const queueSpot = (teamId: string) => {
    const at = waiting.findIndex((e) => e.gameTeamId === teamId);
    return at === -1 ? undefined : at + 1;
  };
  const joinHost = env.NEXT_PUBLIC_QRCODE_BASE_URL.replace(/^https?:\/\//, "");

  return (
    <div className="flex w-full flex-col gap-6 py-2">
      <PublicGameSoundEffects enabled={soundOn} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="bg-muted rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase">
            Audience display
          </span>
          <h1 className="mt-2 text-3xl font-extrabold">{game.name}</h1>
        </div>
        <Button
          variant="secondary"
          aria-pressed={soundOn}
          onClick={() => {
            // The click lets the browser play the chimes made in-page.
            if (!soundOn) unlockAudio();
            setSoundOn((on) => !on);
          }}
        >
          {soundOn ? "Turn off sound" : "Turn on sound"}
        </Button>
      </header>

      {state.mode?.kind === "categoryGrid" &&
      state.mode.status === "running" ? (
        <CategoryGridBoard view={state.mode} names={teamNames} size="large" />
      ) : state.mode?.kind === "rankedAnswers" &&
        state.mode.status === "running" ? (
        <RankedAnswersBoard
          view={state.mode}
          names={teamNames}
          size="large"
          scores={Object.fromEntries(gameTeams.map((t) => [t.id, t.score]))}
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

      {game.status === GameStatus.finished && (
        <FinalStandings teams={gameTeams} size="large" />
      )}

      {game.buzzerMode === "queue" && state.buzzQueue.length > 0 && (
        <ol
          aria-label="Buzz queue"
          className="flex flex-wrap justify-center gap-2"
        >
          {state.buzzQueue.map((entry) => (
            <li
              key={entry.position}
              className={cn(
                "flex items-center gap-2 rounded-full border-2 px-4 py-1.5 text-xl font-bold",
                entry.status === "answering" || entry.status === "correct"
                  ? "bg-stage-highlight border-stage-highlight text-accent-foreground"
                  : entry.status === "wrong"
                    ? "border-stage-strike text-stage-muted line-through"
                    : entry.status === "skipped"
                      ? "border-stage-tile-border text-stage-muted"
                      : "bg-stage-tile border-stage-tile-border",
              )}
            >
              <span className="tabular-nums">{entry.position}</span>
              {teamNames[entry.gameTeamId] ?? "A removed team"}
              {entry.status === "wrong" && <span aria-label="wrong">✕</span>}
              {entry.status === "correct" && (
                <span aria-label="correct">✓</span>
              )}
            </li>
          ))}
        </ol>
      )}

      {game.joinCode && (
        <section
          aria-label="How to join"
          className="bg-surface-sunken flex flex-wrap items-center justify-center gap-6 rounded-xl p-4"
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
          <div className="bg-qr rounded-lg p-2">
            <JoinQrCode code={game.joinCode} className="h-28 w-28" />
          </div>
        </section>
      )}

      <section
        aria-label={game.format === GameFormat.team ? "Teams" : "Players"}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      >
        {gameTeams.map((gameTeam) => (
          <GamePublicScoreboardTeamCard
            key={gameTeam.id}
            gameId={game.id}
            gameTeam={gameTeam}
            queueSpot={queueSpot(gameTeam.id)}
            leading={best > 0 && gameTeam.score === best}
          />
        ))}
      </section>
      {gameTeams.length === 0 && (
        <p className="text-muted-foreground text-center">
          Players will appear here as they join.
        </p>
      )}
    </div>
  );
}
