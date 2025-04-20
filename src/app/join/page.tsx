import { logger } from "@/utils/logger";
import { JoinGameComponent } from "@/app/_components/client/JoinGame";
import { HydrateClient } from "@/trpc/server";

export default function JoinGamePage({
  searchParams,
}: {
  searchParams: { code?: string | null | undefined };
}) {
  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Join a Game</h1>
          <JoinGameComponent code={searchParams?.code} />
        </div>
      </main>
    </HydrateClient>
  );
}
