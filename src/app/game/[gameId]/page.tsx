import { GameFormat } from "@prisma/client";

import { ok, err } from "neverthrow";

import { api } from "@/trpc/server";
import { GameBuzzer } from "@/app/_components/client/GameBuzzer";
import { logger } from "@/utils/logger";

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

  const result = await api.gameUser.getSimpleInfo();

  if (!result) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Unauthorized</h1>
          <p>Game user not exist or you are not authorized.</p>
        </div>
      </main>
    );
  }

  const { game, gameUser, gameTeams } = result;

  logger.debug(
    `GamePage: ${JSON.stringify(
      {
        game,
        gameUser,
        gameTeams,
      },
      null,
      2,
    )}`,
  );

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

        <p>Player ID: {gameUser.id}</p>
        <p>Player Name: {gameUser.name}</p>
        <p>Player Team ID: {gameUser.gameTeamId}</p>
        {gameUser.gameTeam && <p>Player Team Name: {gameUser.gameTeam.name}</p>}
        {gameUser.gameTeam && (
          <p>Player Team Buzzer State: {gameUser.gameTeam.buzzerState}</p>
        )}
        <GameBuzzer game={game} gameTeams={gameTeams} gameUser={gameUser} />
      </div>
    </main>
  );
}
