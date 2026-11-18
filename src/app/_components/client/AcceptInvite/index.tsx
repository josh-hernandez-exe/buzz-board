"use client";

import { useRouter } from "next/navigation";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { Button } from "@/app/_components/ui/button";
import { api } from "@/trpc/react";
import { ROLE_LABEL, type StaffRoleName } from "@/utils/capabilities";

export function AcceptInvite({
  token,
  gameId,
  accountName,
  currentRole,
  alreadyAccepted,
}: {
  token: string;
  gameId: string;
  accountName: string;
  currentRole: StaffRoleName | null;
  alreadyAccepted: boolean;
}) {
  const router = useRouter();
  const accept = api.user.invite.accept.useMutation({
    onSuccess: (result) => router.push(`/game/${result.gameId}/admin`),
  });

  if (alreadyAccepted && currentRole) {
    return (
      <div className="flex flex-col gap-3">
        <p>
          You accepted this invitation. You&apos;re a{" "}
          <strong>{ROLE_LABEL[currentRole]}</strong> in this game.
        </p>
        <Button onClick={() => router.push(`/game/${gameId}/admin`)}>
          Open the host desk
        </Button>
      </div>
    );
  }
  if (alreadyAccepted) {
    return (
      <p role="alert" className="bg-muted rounded-md p-3">
        You accepted this invitation earlier, but you&apos;re no longer a helper
        in this game. Ask the host for a new link if that&apos;s a mistake.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {currentRole && (
        <p className="text-muted-foreground text-sm">
          You&apos;re already a {ROLE_LABEL[currentRole]} here. Accepting never
          lowers your role.
        </p>
      )}
      <Button
        disabled={accept.isPending}
        onClick={() => accept.mutate({ token })}
      >
        {accept.isPending ? "Accepting…" : `Accept as ${accountName}`}
      </Button>
      <ErrorNotice error={accept.error} className="text-destructive text-sm" />
    </div>
  );
}
