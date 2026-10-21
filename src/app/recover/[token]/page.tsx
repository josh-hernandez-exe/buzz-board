import { type Metadata } from "next";

import { RecoverPlayer } from "@/app/_components/client/RecoverPlayer";
import { previewRecovery } from "@/server/identity/identityService";
import { HydrateClient } from "@/trpc/server";
import { AppHeader } from "@/app/_components/server/AppHeader";
import { PageShell, Panel } from "@/app/_components/ui/page";

export const metadata: Metadata = {
  title: "Get back into your game · Buzz-Board",
  // Recovery links are private; keep them out of search engines.
  robots: { index: false, follow: false },
};

const STATUS_MESSAGE = {
  used: "This link has already been used.",
  revoked: "This link no longer works. Your host may have made a newer one.",
  expired: "This link has expired.",
} as const;

/**
 * Shows what a recovery link restores. Opening it (or a link preview) never
 * uses it; the player chooses Continue.
 */
export default async function RecoverPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const recovery =
    token.length >= 16 && token.length <= 200
      ? await previewRecovery({ token })
      : null;

  return (
    <HydrateClient>
      <PageShell header={<AppHeader />} width="narrow" center>
        <Panel className="gap-4 p-6">
          {!recovery ? (
            <>
              <h1 className="text-2xl font-bold">Link not found</h1>
              <p>This link isn&apos;t valid. Ask your host for a new one.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold">
                Get back into{" "}
                <span className="break-words">{recovery.gameName}</span>
              </h1>
              {recovery.status !== "valid" || !recovery.nickname ? (
                <p role="alert" className="bg-warning/40 rounded-md p-3">
                  {recovery.status === "valid"
                    ? STATUS_MESSAGE.revoked
                    : STATUS_MESSAGE[recovery.status]}{" "}
                  Ask your host for a new link.
                </p>
              ) : (
                <>
                  <p>
                    You&apos;ll continue as <strong>{recovery.nickname}</strong>
                    , with your team and points. Any other device you used for
                    this player will be signed out.
                  </p>
                  <RecoverPlayer token={token} nickname={recovery.nickname} />
                </>
              )}
            </>
          )}
        </Panel>
      </PageShell>
    </HydrateClient>
  );
}
