import { signInPath } from "@/server/auth/devLoginGate";
import { redirect } from "next/navigation";

import { CreateGame } from "@/app/_components/client/GameCreate";
import { UserGameView } from "@/app/_components/client/UserGameView";
import { auth } from "@/server/auth";
import { api, HydrateClient } from "@/trpc/server";
import { helpHref } from "@/help/manifest";
import { AppHeader } from "@/app/_components/server/AppHeader";
import {
  LinkButton,
  PageHeading,
  PageShell,
  Panel,
} from "@/app/_components/ui/page";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) {
    redirect(signInPath("/dashboard"));
  }
  const games = await api.user.game.getAll();

  return (
    <HydrateClient>
      <PageShell header={<AppHeader />} width="wide">
        <PageHeading
          title="My games"
          description="Create a game, or open one you host or help run."
          actions={
            <LinkButton href={helpHref("host-quickstart")} variant="secondary">
              Host guide
            </LinkButton>
          }
        />
        <Panel title="Create a game">
          <CreateGame />
        </Panel>
        <Panel title="Your games">
          <UserGameView games={games} />
        </Panel>
      </PageShell>
    </HydrateClient>
  );
}
