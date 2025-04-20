"use client";

import { useState, useEffect } from "react";

import { useRouter } from "next/navigation";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";

import { Button } from "@/app/_components/ui/button";
import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { api } from "@/trpc/react";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/app/_components/ui/input-otp";

import { logger } from "@/logger";

export function JoinGameComponent({
  code: inputCode,
}: {
  code?: string | undefined | null;
}) {
  const [gameCode, setGameCode] = useState(inputCode ?? "");
  const [error, setError] = useState("");
  const [gameTokenData, setGameTokenData] = useGameTokenData();

  const router = useRouter();

  const joinGameMutation = api.public.joinGame.useMutation({
    onSuccess: async (data) => {
      setGameTokenData({
        token: data.token!,
        code: gameCode,
        gameId: data.gameId,
      });

      router.push(`/game/${data.gameId}/user`);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleJoinGame = async () => {
    if (!gameCode) {
      setError("Game code is required");
      return;
    }

    joinGameMutation.mutate({
      gameCode,
      // find existing token if any
      token: gameTokenData.tokenStorage?.[gameCode],
    });
  };

  useEffect(() => {
    // Automatically attempt to join if the code is set in the input code.
    // which is defined from the search params.
    if (inputCode) {
      setGameCode(inputCode);
      handleJoinGame();
    }
  }, [inputCode]);

  return (
    <div>
      <p>Enter Game Code</p>
      <InputOTP
        maxLength={6}
        onChange={setGameCode}
        value={gameCode}
        pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
      >
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </InputOTP>
      {error && <p className="mb-4 text-red-500">{error}</p>}
      <Button
        onClick={handleJoinGame}
        className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
      >
        Join Game
      </Button>
    </div>
  );
}
