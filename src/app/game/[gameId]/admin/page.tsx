import Link from "next/link";
import { redirect } from "next/navigation";
import { gameApi, HydrateClient } from "@/trpc/server";
import { headers } from "next/headers";

import { auth, gameAuth } from "@/server/auth";

import { GameAdminInfo } from "./GameAdminInfo";

import { logger } from "@/logger";
import { GameScope } from "@/app/_components/client/GameScope";
import { staffRoleFor } from "@/server/staff/staffService";

export default async function GameAdminPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const session = await auth();
  const gameSession = await gameAuth({
    headers: await headers(),
    user: session?.user,
    gameId,
  });

  const staffRole =
    gameSession && "createdById" in gameSession
      ? staffRoleFor({
          createdById: gameSession.createdById,
          gameAdmin:
            gameSession.gameAdmin?.gameId === gameId
              ? gameSession.gameAdmin
              : null,
          userId: session?.user?.id,
        })
      : null;
  if (!staffRole) {
    logger.error("Game admin not found for this game.");
    redirect("/dashboard");
  }

  const currentGameState = await (
    await gameApi(gameId)
  ).gameGeneral.currentGameState();
  return (
    <HydrateClient>
      <GameScope gameId={gameId} initialState={currentGameState}>
        <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
          <div className="container flex flex-col items-center justify-center gap-6 px-4 py-6">
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

          <div className="container flex flex-col items-center justify-center gap-6 px-4 py-6">
            <Link
              href={`/game/${gameId}/scoreboard`}
              className="rounded-full bg-white/10 px-10 py-3 font-semibold no-underline transition hover:bg-white/20"
            >
              Scoreboard
            </Link>
            <GameAdminInfo gameState={currentGameState} staffRole={staffRole} />
          </div>
        </main>
      </GameScope>
    </HydrateClient>
  );
}
