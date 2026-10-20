import Link from "next/link";
import { type Metadata } from "next";

import { AcceptInvite } from "@/app/_components/client/AcceptInvite";
import { auth } from "@/server/auth";
import { previewStaffInvite } from "@/server/staff/staffService";
import { HydrateClient } from "@/trpc/server";
import { helpHref } from "@/help/manifest";
import { ROLE_LABEL, ROLE_SUMMARY } from "@/utils/capabilities";

export const metadata: Metadata = {
  title: "Helper invitation · Buzz-Board",
  // Invitation links are private; keep them out of search engines.
  robots: { index: false, follow: false },
};

const STATUS_MESSAGE = {
  used: "This invitation has already been used.",
  revoked: "This invitation was cancelled.",
  expired: "This invitation has expired.",
} as const;

/**
 * Shows a staff invitation. Opening (or previewing) the link never uses it;
 * the invitee must sign in and choose Accept.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();
  const invite =
    token.length >= 16 && token.length <= 200
      ? await previewStaffInvite({ token, userId: session?.user?.id })
      : null;

  return (
    <HydrateClient>
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] px-4 text-white">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-white/10 p-6">
          {!invite ? (
            <>
              <h1 className="text-2xl font-bold">Invitation not found</h1>
              <p>
                This link isn&apos;t valid. Ask the host to send you a new
                invitation.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold">
                Help run <span className="break-words">{invite.gameName}</span>
              </h1>
              <p>
                You&apos;re invited as a{" "}
                <strong>{ROLE_LABEL[invite.role]}</strong>.
              </p>
              <p className="text-white/80">{ROLE_SUMMARY[invite.role]}</p>

              {invite.status !== "valid" && !invite.usedBySelf ? (
                <p role="alert" className="rounded-md bg-white/20 p-3">
                  {STATUS_MESSAGE[invite.status]} Ask the host for a new link.
                </p>
              ) : !session ? (
                <>
                  <p>Sign in with the account you&apos;ll use to help.</p>
                  <Link
                    href={`/api/auth/signin?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`}
                    className="rounded-full bg-white px-6 py-3 text-center font-semibold text-[#2e026d]"
                  >
                    Sign in to accept
                  </Link>
                </>
              ) : (
                <AcceptInvite
                  token={token}
                  gameId={invite.gameId}
                  accountName={session.user?.name ?? "this account"}
                  currentRole={invite.currentRole}
                  alreadyAccepted={invite.usedBySelf}
                />
              )}
              <p className="text-xs text-white/70">
                Anyone with this link can accept it until it&apos;s used or
                expires, so don&apos;t share it publicly.{" "}
                <Link
                  href={helpHref(
                    "helpers-and-roles",
                    "how-do-i-accept-an-invitation",
                  )}
                  className="underline"
                >
                  About invitations
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
    </HydrateClient>
  );
}
