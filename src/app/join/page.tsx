import { JoinGameComponent } from "@/app/_components/client/JoinGame";
import { auth } from "@/server/auth";
import { HydrateClient } from "@/trpc/server";
import { helpHref } from "@/help/manifest";
import Link from "next/link";

import { AppHeader } from "@/app/_components/server/AppHeader";
import { PageHeading, PageShell } from "@/app/_components/ui/page";

export default async function JoinGamePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await searchParams;
  const session = await auth();

  return (
    <HydrateClient>
      <PageShell header={<AppHeader />} width="narrow" center>
        <PageHeading
          title="Join a game"
          description="Enter the code your host shared, and pick a nickname."
        />
        <JoinGameComponent
          code={code as string | undefined}
          signedIn={!!session?.user}
        />
        <Link
          href={helpHref("join-and-resume")}
          className="text-muted-foreground text-sm underline"
        >
          Need help joining?
        </Link>
      </PageShell>
    </HydrateClient>
  );
}
