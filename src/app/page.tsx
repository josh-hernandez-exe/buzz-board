import Link from "next/link";

import { auth } from "@/server/auth";
import { HydrateClient } from "@/trpc/server";

const linkClass =
  "w-full rounded-full bg-white/10 px-10 py-3 text-center font-semibold no-underline transition hover:bg-white/20";

/** Join and Host are always offered, whether or not someone is signed in. */
export default async function Home() {
  const session = await auth();

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] px-4 text-white">
        <div className="flex w-full max-w-xs flex-col items-center gap-8 py-16">
          <h1 className="text-5xl font-extrabold tracking-tight">Buzz-Board</h1>
          <p className="text-center text-white/80">
            Buzzers and a live scoreboard for trivia, quizzes and game nights.
          </p>
          <nav className="flex w-full flex-col gap-3" aria-label="Get started">
            <Link href="/join" className={linkClass}>
              Join a game
            </Link>
            <Link
              href={
                session
                  ? "/dashboard"
                  : "/api/auth/signin?callbackUrl=/dashboard"
              }
              className={linkClass}
            >
              Host a game
            </Link>
            {session && (
              <Link href="/api/auth/signout" className={linkClass}>
                Sign out
              </Link>
            )}
          </nav>
          <p className="text-center text-sm text-white/70">
            Players don&apos;t need an account. Hosts sign in to create games.
          </p>
        </div>
      </main>
    </HydrateClient>
  );
}
