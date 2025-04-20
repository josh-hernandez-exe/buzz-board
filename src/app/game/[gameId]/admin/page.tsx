import Link from "next/link";
import { redirect } from "next/navigation";
import { api, HydrateClient } from "@/trpc/server";
import { headers } from "next/headers";

import { auth, gameAuth } from "@/server/auth";

import { GameAdminInfo } from "./GameAdminInfo";

import { logger } from "@/logger";

export default async function GameAdminPage({
  params,
}: {
  params: { gameId: string };
}) {
  const { gameId } = await params;
  const session = await auth();
  const gameSession = await gameAuth({
    headers: await headers(),
    user: session?.user,
  });

  if (!gameSession?.gameAdmin || gameSession.gameAdmin.gameId !== gameId) {
    logger.error("Game admin not found for this game.");
    redirect("/dashboard");
  }

  const currentGameState = await api.gameGeneral.currentGameState();
  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
          <p className="text-center text-2xl text-white">
            {session && <span>Logged in as {session.user?.name}</span>}
          </p>
          <Link
            href={session ? "/api/auth/signout" : "/api/auth/signin"}
            className="rounded-full bg-white/10 px-10 py-3 font-semibold no-underline transition hover:bg-white/20"
          >
            {session ? "Sign out" : "Sign in"}
          </Link>
        </div>

        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
          <Link
            href={`/game/${gameId}/scoreboard`}
            className="rounded-full bg-white/10 px-10 py-3 font-semibold no-underline transition hover:bg-white/20"
          >
            Scoreboard
          </Link>
          <GameAdminInfo gameState={currentGameState} />
        </div>
      </main>
    </HydrateClient>
  );
}
