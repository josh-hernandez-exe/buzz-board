import Link from "next/link";
import { redirect } from "next/navigation";
import { api, HydrateClient } from "@/trpc/server";

import { auth } from "@/server/auth";

import { CreateGame } from "@/app/_components/client/GameCreate";
import { UserGameView } from "@/app/_components/client/UserGameView";

export default async function DashboardPage() {
  const session = await auth();
  const games = await api.user.game.getAll();

  if (!session) {
    redirect("/");
  }

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
          <p className="text-center text-2xl text-white">
            {session && <span>Logged in as {session.user?.name}</span>}
          </p>
          <div className="flex w-full max-w-xs flex-col items-center gap-2">
            <Link
              href={session ? "/api/auth/signout" : "/api/auth/signin"}
              className="w-full rounded-full bg-white/10 px-10 py-3 text-center font-semibold no-underline transition hover:bg-white/20"
            >
              {session ? "Sign out" : "Sign in"}
            </Link>
            <Link
              href="/join"
              className="w-full rounded-full bg-white/10 px-10 py-3 text-center font-semibold no-underline transition hover:bg-white/20"
            >
              Join a Game
            </Link>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            Create New Game
          </h1>
          <CreateGame />
        </div>

        <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
          <UserGameView games={games} />
        </div>
      </main>
    </HydrateClient>
  );
}
