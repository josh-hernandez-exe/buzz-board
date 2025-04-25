import { JoinGameComponent } from "@/app/_components/client/JoinGame";
import { HydrateClient } from "@/trpc/server";

export default async function JoinGamePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await searchParams;

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h1 className="mb-4 text-2xl font-bold">Join a Game</h1>
          <JoinGameComponent code={code as string | undefined} />
        </div>
      </main>
    </HydrateClient>
  );
}
