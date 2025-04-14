"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { api } from "@/trpc/react";

import { logger } from "@/utils/logger";

export function JoinGameComponent() {
  const [gameCode, setGameCode] = useState("");
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

      router.push(`/game/${data.gameId}`);
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

  return (
    <div>
      <Input
        type="text"
        placeholder="Enter Game Code"
        value={gameCode}
        onChange={(e) => setGameCode(e.target.value)}
        className="mb-4 rounded border border-gray-300 p-2"
      />
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
