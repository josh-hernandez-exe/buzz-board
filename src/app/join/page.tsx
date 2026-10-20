import { JoinGameComponent } from "@/app/_components/client/JoinGame";
import { auth } from "@/server/auth";
import { HydrateClient } from "@/trpc/server";
import { helpHref } from "@/help/manifest";
import Link from "next/link";

export default async function JoinGamePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await searchParams;
  const session = await auth();

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] px-4 text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Join a Game</h1>
          <JoinGameComponent
            code={code as string | undefined}
            signedIn={!!session?.user}
          />
          <Link
            href={helpHref("join-and-resume")}
            className="mt-6 text-sm text-white/80 underline"
          >
            Need help joining?
          </Link>
        </div>
      </main>
    </HydrateClient>
  );
}
