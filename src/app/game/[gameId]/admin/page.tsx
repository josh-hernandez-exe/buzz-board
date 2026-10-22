import { redirect } from "next/navigation";
import { gameApi, HydrateClient } from "@/trpc/server";
import { headers } from "next/headers";

import { auth, gameAuth } from "@/server/auth";

import { GameAdminInfo } from "./GameAdminInfo";

import { logger } from "@/logger";
import { GameScope } from "@/app/_components/client/GameScope";
import { AppHeader } from "@/app/_components/server/AppHeader";
import { PageShell } from "@/app/_components/ui/page";
import { staffRoleFor } from "@/server/staff/staffService";
import { db } from "@/server/db";
import { isModeKind } from "@/utils/modes";

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
  // Games set up for a game mode open on its tab until it's over.
  const mode = await db.gameMode.findUnique({
    where: { gameId },
    select: { status: true, kind: true },
  });
  return (
    <HydrateClient>
      <GameScope gameId={gameId} initialState={currentGameState}>
        <PageShell
          header={
            <AppHeader
              extra={[
                { href: `/game/${gameId}/scoreboard`, label: "Scoreboard" },
              ]}
            />
          }
          width="wide"
        >
          <GameAdminInfo
            gameState={currentGameState}
            staffRole={staffRole}
            modeKind={mode && isModeKind(mode.kind) ? mode.kind : null}
            modeFirst={
              !!mode && isModeKind(mode.kind) && mode.status !== "ended"
            }
          />
        </PageShell>
      </GameScope>
    </HydrateClient>
  );
}
