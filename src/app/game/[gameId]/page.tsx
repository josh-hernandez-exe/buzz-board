import { GameFormat } from "@prisma/client";
import { cookies } from "next/headers";

import { ok, err } from "neverthrow";

import { GameBuzzer } from "@/app/_components/client/GameBuzzer";
import { db } from "@/server/db";
import { logger } from "@/utils/logger";

async function getSimpleGameInfo({
  gameUserToken,
  gameId,
}: {
  gameUserToken: string | undefined;
  gameId: string;
}) {
  if (!gameUserToken) {
    return err(new Error("Game User token not found"));
  }

  const gameUser = await db.gameUser.findUnique({
    where: {
      token: gameUserToken,
    },
    include: {
      game: {
        include: {
          gameTeams: true,
        },
      },
      gameTeam: true,
    },
  });

  if (!gameUser) {
    return err(new Error("Game User not found"));
  }

  if (gameUser.gameId !== gameId) {
    return err(new Error("Game User not authorized for this game"));
  }

  return ok(gameUser);
}

export default async function GamePage({
  params,
}: {
  params: { gameId: string };
}) {
  const cookieStore = await cookies();
  const gameUserToken = cookieStore.get("buzz-board-game-user-token")?.value;

  if (!params.gameId && !gameUserToken) {
    // fast return
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Unauthorized</h1>
          <p>You need to authenticated as a player for the game.</p>
        </div>
      </main>
    );
  }

  const result = await getSimpleGameInfo({
    gameId: params.gameId,
    gameUserToken,
  });

  if (result.isErr()) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Unauthorized</h1>
          <p>Game user not exist or you are not authorized.</p>
        </div>
      </main>
    );
  }

  let { game: gameData, ...gameUser } = result.value;
  let { gameTeams, ...game } = gameData;
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
