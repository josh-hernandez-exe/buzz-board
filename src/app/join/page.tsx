"use client";

import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";

import { useRouter } from "next/navigation";

import { useCookiesNext } from "cookies-next/client";

import { api, updateExtraHeaders } from "@/trpc/react";

import { logger } from "@/utils/logger";

export default function JoinGamePage() {
  const [gameCode, setGameCode] = useState("");
  const [error, setError] = useState("");
  const { setCookie } = useCookiesNext();
  const [guestToken, setGuestToken] = useLocalStorage(
    "buzz-board-guest-token",
    "",
    {
      serializer: (value) => value,
      deserializer: (value) => value,
    },
  );
  const [gameId, setGameId] = useLocalStorage("buzz-board-game-id", "", {
    serializer: (value) => value,
    deserializer: (value) => value,
  });
  const router = useRouter();

  if (guestToken.length > 0) {
    updateExtraHeaders({ guestToken });
    logger.info(`Set guest token: ${guestToken}`);
  }

  const joinGameMutation = api.guest.game.joinAsGuest.useMutation({
    onSuccess: async (data) => {
      setGuestToken(data.token);
      setGameId(data.gameId);
      updateExtraHeaders({
        guestToken: data.token,
        gameId: data.gameId,
      });

      setCookie("buzz-board-guest-token", data.token, {
        maxAge: 86400, // 1 day expiration
      });
      setCookie("buzz-board-game-id", data.gameId, {
        maxAge: 86400, // 1 day expiration
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
      token: guestToken || undefined,
      // gameTeamId: null,
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="flex min-h-screen flex-col items-center justify-center">
        <h1 className="mb-4 text-2xl font-bold">Join a Game</h1>
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
    </main>
  );
}
