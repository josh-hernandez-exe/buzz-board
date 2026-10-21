"use client";

import { useRouter } from "next/navigation";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { Button } from "@/app/_components/ui/button";
import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { api } from "@/trpc/react";

/** Uses a recovery link only when the person chooses to continue. */
export function RecoverPlayer({
  token,
  nickname,
}: {
  token: string;
  nickname: string;
}) {
  const router = useRouter();
  const [, setGameTokenData] = useGameTokenData();
  const redeem = api.public.redeemRecovery.useMutation({
    onSuccess: (data) => {
      setGameTokenData({ token: data.token, gameId: data.gameId });
      router.push(`/game/${data.gameId}/user`);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <Button
        disabled={redeem.isPending || redeem.isSuccess}
        onClick={() => redeem.mutate({ token })}
      >
        {redeem.isPending ? "Getting you back in…" : `Continue as ${nickname}`}
      </Button>
      <ErrorNotice error={redeem.error} className="text-destructive text-sm" />
    </div>
  );
}
