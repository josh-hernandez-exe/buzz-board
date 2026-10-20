import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateGame } from "@/app/_components/client/GameCreate";
import { UserGameView } from "@/app/_components/client/UserGameView";
import { auth } from "@/server/auth";
import { api, HydrateClient } from "@/trpc/server";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) {
    redirect("/api/auth/signin?callbackUrl=/dashboard");
  }
  const games = await api.user.game.getAll();

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-[#2e026d] to-[#15162c] px-4 py-8 text-white">
        <div className="flex w-full max-w-3xl flex-col items-center gap-8">
          <header className="flex w-full flex-wrap items-center justify-between gap-2">
            <p>Signed in as {session.user?.name ?? "host"}</p>
            <nav className="flex gap-2">
              <Link
                href="/join"
                className="rounded-full bg-white/10 px-4 py-2 font-semibold hover:bg-white/20"
              >
                Join a game
              </Link>
              <Link
                href="/api/auth/signout"
                className="rounded-full bg-white/10 px-4 py-2 font-semibold hover:bg-white/20"
              >
                Sign out
              </Link>
            </nav>
          </header>
          <section className="flex w-full flex-col items-center gap-4">
            <h1 className="text-3xl font-extrabold tracking-tight">
              Create a game
            </h1>
            <CreateGame />
          </section>
          <section className="w-full overflow-x-auto">
            <h2 className="mb-2 text-xl font-bold">Your games</h2>
            <UserGameView games={games} />
          </section>
        </div>
      </main>
    </HydrateClient>
  );
}
