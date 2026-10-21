import { MessagePage, PageShell, SiteHeader } from "@/app/_components/ui/page";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GameFormat } from "@prisma/client";

import { auth, gameAuth } from "@/server/auth";

import { gameApi, HydrateClient } from "@/trpc/server";
import { GameBuzzerTab } from "@/app/_components/client/GameBuzzerTab";
import { TeamSwitcherTab } from "@/app/_components/client/TeamSwitcherTab";
import { GameWhoBuzzedIn } from "@/app/_components/client/GameWhoBuzzedIn";
import { GameSoundEffects } from "@/app/_components/client/GameSoundEffects";

import { logger } from "@/logger";
import { InformationTab } from "./InformationTab";
import { GameScope } from "@/app/_components/client/GameScope";
import { PlayerHeader } from "@/app/_components/client/PlayerStatus";
import { PlayerTabs } from "@/app/_components/client/PlayerTabs";
import { LiveRankedAnswersBoard } from "@/app/_components/client/RankedAnswersBoard";
import { LiveCategoryGrid } from "@/app/_components/client/CategoryGridBoard";

export default async function GameUserPage({
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

  if (gameSession?.gameUser?.gameId !== gameId) {
    logger.error("Game user not found for this game.");
    redirect("/join");
  }

  if (!gameId) {
    return (
      <MessagePage title="Game not found">
        <p className="text-muted-foreground">No game identifier was given.</p>
      </MessagePage>
    );
  }

  const api = await gameApi(gameId);
  const gameUser = await api.gameUser.getSelfInfo();
  const currentGameState = await api.gameGeneral.currentGameState();

  if (!gameUser) {
    return (
      <MessagePage title="You're not in this game">
        <p className="text-muted-foreground">
          Join the game again with its code, or ask the host for help.
        </p>
      </MessagePage>
    );
  }

  const { game, gameTeams } = currentGameState;
  const isTeamGame = game.format === GameFormat.team;
  const hasTeamAssigned = gameUser.gameTeamId !== null;

  // Players without a team start on the team picker.
  const defaultTab =
    isTeamGame && !hasTeamAssigned ? "team-switcher" : "buzzer";

  return (
    <HydrateClient>
      <GameScope gameId={gameId} initialState={currentGameState}>
        <PageShell
          header={<SiteHeader links={[{ href: "/help", label: "Help" }]} />}
          width="wide"
        >
          {/* Game sound effects for the user's team */}
          <GameSoundEffects gameTeamId={gameUser.gameTeamId ?? undefined} />
          <PlayerTabs
            defaultTab={defaultTab}
            header={
              <PlayerHeader
                gameUserId={gameUser.id}
                signedIn={!!session?.user}
                linked={!!gameUser.user}
              />
            }
            buzzer={
              <>
                <LiveRankedAnswersBoard />
                <LiveCategoryGrid />
                <GameBuzzerTab gameUserId={gameUser.id} />
                <GameWhoBuzzedIn gameUserId={gameUser.id} />
              </>
            }
            team={
              isTeamGame ? (
                <TeamSwitcherTab
                  game={game}
                  gameTeams={gameTeams}
                  initialGameTeamId={gameUser.gameTeamId}
                />
              ) : undefined
            }
            info={
              <InformationTab
                gameState={currentGameState}
                gameUser={gameUser}
              />
            }
          />
        </PageShell>
      </GameScope>
    </HydrateClient>
  );
}
