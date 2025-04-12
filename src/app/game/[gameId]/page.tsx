import { GameFormat } from "@prisma/client";
import { cookies, headers } from "next/headers";

import { ok, err, Result } from "neverthrow";

import { db } from "@/server/db";

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

  const gameUser = result.value;
  const game = gameUser.game;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="flex min-h-screen flex-col items-center justify-center">
        <h1 className="mb-4 text-2xl font-bold">
          Welcome to Game {game?.name}
        </h1>
        <p>Game ID: {game?.id}</p>
        <p>Buzzer Listening State: {game?.isBuzzerListening}</p>
        {game?.format === GameFormat.team && (
          <p>Number of Teams: {game?.gameTeams.length || 0}</p>
        )}
      </div>
    </main>
  );
}
