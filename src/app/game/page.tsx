import { type Game } from "@prisma/client";

import { api, HydrateClient } from "@/trpc/server";

import { CreateGame } from "@/app/_components/client/GameCreate";

import { logger } from "@/utils/logger";

export default async function Page() {
  const games = await api.game.getAll();

  let selectedGame = null;
  const onGameChange = (game: Game) => {
    selectedGame = game;
  };

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            View Existing Games
          </h1>
          <ul>
            {games.map((game) => {
              return (
                <li key={game.id}>
                  {game.name} ({game.id})
                </li>
              );
            })}
          </ul>
        </div>

        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            Create New Game
          </h1>
          <CreateGame />
        </div>
      </main>
    </HydrateClient>
  );
}
