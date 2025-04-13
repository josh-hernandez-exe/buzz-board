"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { useGameUserToken } from "@/app/_hooks/gameUserToken";
import { api, updateExtraHeaders } from "@/trpc/react";

import { logger } from "@/utils/logger";

export function JoinGameComponent() {
  const [gameCode, setGameCode] = useState("");
  const [error, setError] = useState("");
  const [gameUserToken, setGameUserToken] = useGameUserToken();

  const router = useRouter();

  const joinGameMutation = api.public.joinGame.useMutation({
    onSuccess: async (data) => {
      setGameUserToken(data.token);

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
      token: gameUserToken,
    });
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Enter Game Code"
        value={gameCode}
        onChange={(e) => setGameCode(e.target.value)}
        className="mb-4 rounded border border-gray-300 p-2"
      />
      {error && <p className="mb-4 text-red-500">{error}</p>}
      <button
        onClick={handleJoinGame}
        className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
      >
        Join Game
      </button>
    </div>
  );
}
