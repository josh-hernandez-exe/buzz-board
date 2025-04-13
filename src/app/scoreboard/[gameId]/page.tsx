import { GameFormat, Prisma } from "@prisma/client";

import { ok, err } from "neverthrow";

import { GenericCard } from "@/app/_components/GenericCard";
import { db } from "@/server/db";
import { logger } from "@/utils/logger";

async function getScoreBoardInfo({ gameId }: { gameId: string }) {
  const game = await db.game.findUnique({
    select: {
      id: true,
      name: true,
      format: true,
      isBuzzerListening: true,
      gameTeams: {
        select: {
          id: true,
          name: true,
          buzzerState: true,
          _count: {
            select: {
              gameUsers: true,
            },
          },
        },
      },
      scoreboard: {
        select: {
          currentState: {
            select: {
              state: true,
            },
          },
        },
      },
    },
    where: {
      id: gameId,
    },
  });

  if (!game) {
    return err(new Error("Game not found"));
  }
  if (!game.scoreboard) {
    return err(new Error("Game does not have a scoreboard"));
  }
  if (!game.scoreboard.currentState) {
    return err(new Error("Game does not have a current scoreboard state"));
  }
  return ok(game);
}

export default async function GamePage({
  params,
}: {
  params: { gameId: string };
}) {
  if (!params.gameId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Game Not Found</h1>
          <p>No game identifier was given.</p>
        </div>
      </main>
    );
  }

  const result = await getScoreBoardInfo({ gameId: params.gameId });

  if (result.isErr()) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Game Not Found</h1>
          <p>No game was found or not ready yet to be viewed.</p>
        </div>
      </main>
    );
  }

  const { gameTeams, scoreboard, ...game } = result.value;
  const scoreboardState = scoreboard?.currentState?.state as Prisma.JsonObject;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="flex min-h-screen flex-col items-center justify-center">
        <h1 className="mb-4 text-2xl font-bold">
          Welcome to Game {game?.name}
        </h1>
        <p>Game ID: {game?.id}</p>
        <p>
          Game Buzzer Listening State :{" "}
          {game.isBuzzerListening ? "Listening" : "Not Listening"}
        </p>
        {game?.format === GameFormat.team && (
          <p>Number of Teams: {gameTeams.length ?? 0}</p>
        )}
        {gameTeams.map((gameTeam) => {
          const score =
            (scoreboardState?.[gameTeam.id] as number | undefined) ?? 0;

          const content = (
            <div>
              <p>Buzzer: {gameTeam.buzzerState}</p>
              <p> Score: {score} </p>
              <p>Number of Players: {gameTeam._count.gameUsers ?? 0}</p>
              <p>Team Buzzer State: {gameTeam.buzzerState}</p>
            </div>
          );
          return (
            <GenericCard
              key={gameTeam.id}
              title={gameTeam.name}
              content={content}
            />
          );
        })}
      </div>
    </main>
  );
}
