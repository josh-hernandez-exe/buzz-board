import { type Game } from "@prisma/client";

import { api, HydrateClient } from "@/trpc/server";

import { auth } from "@/server/auth";

import { CreateGame } from "@/app/_components/client/GameCreate";
import { GameInfoAdmin } from "@/app/_components/client/GameInfoAdmin";

import { logger } from "@/utils/logger";

export default async function DashboardPage() {
  const session = await auth();
  const games = await api.user.game.getAll();

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
          <p className="text-center text-2xl text-white">
            {session && <span>Logged in as {session.user?.name}</span>}
          </p>
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            Create New Game
          </h1>
          <CreateGame />
        </div>

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
            Inspect Existing Games
          </h1>
          <GameInfoAdmin games={games} />
        </div>
      </main>
    </HydrateClient>
  );
}
