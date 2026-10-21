import { AppHeader } from "@/app/_components/server/AppHeader";
import {
  LinkButton,
  PageShell,
  Panel,
  Wordmark,
} from "@/app/_components/ui/page";
import { auth } from "@/server/auth";
import { HydrateClient } from "@/trpc/server";

/** Join and Host are always offered, whether or not someone is signed in. */
export default async function Home() {
  const session = await auth();

  return (
    <HydrateClient>
      <PageShell header={<AppHeader />} width="normal" center>
        <section className="flex flex-col items-center gap-4 py-6 text-center">
          <h1 className="text-5xl sm:text-6xl">
            <Wordmark />
          </h1>
          <p className="text-muted-foreground max-w-md text-lg">
            Buzzers, a live scoreboard and family-feud style boards for trivia,
            quizzes and game nights.
          </p>
        </section>
        <div className="grid gap-4 sm:grid-cols-2" aria-label="Get started">
          <Panel
            title="Playing?"
            description="No account needed: just a code and a nickname."
          >
            <LinkButton href="/join" size="lg" className="w-full">
              Join a game
            </LinkButton>
          </Panel>
          <Panel
            title="Hosting?"
            description="Sign in to create games and run them from your desk."
          >
            <LinkButton
              href={
                session
                  ? "/dashboard"
                  : "/api/auth/signin?callbackUrl=/dashboard"
              }
              size="lg"
              variant="secondary"
              className="w-full"
            >
              {session ? "Go to my games" : "Host a game"}
            </LinkButton>
          </Panel>
        </div>
        <p className="text-muted-foreground text-center text-sm">
          New here?{" "}
          <LinkButton href="/help" variant="ghost" size="sm">
            Read the guides
          </LinkButton>
        </p>
      </PageShell>
    </HydrateClient>
  );
}
