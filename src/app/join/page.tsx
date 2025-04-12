"use client";

import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";

import { useRouter } from "next/navigation";

import { api, updateExtraHeaders } from "@/trpc/react";

import { logger } from "@/utils/logger";

export default function JoinGamePage() {
  const utils = api.useUtils();
  const [gameCode, setGameCode] = useState("");
  const [error, setError] = useState("");
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
    utils.gameUser.ping.invalidate();
    logger.info(`Set guest token: ${guestToken}`);
  }

  const joinGameMutation = api.guest.game.joinAsGuest.useMutation({
    onSuccess: (data) => {
      setGuestToken(data.token);
      setGameId(data.gameId);
      updateExtraHeaders({
        guestToken: data.token,
        gameId: data.gameId,
      });
      utils.gameUser.ping.invalidate();

      // TODO change page
      //router.push(`/game/${gameCode}`);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const pingQuery = api.gameUser.ping.useQuery();

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
        {guestToken && gameId && (
          <button
            onClick={() => pingQuery.refetch()}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Ping
          </button>
        )}
      </div>
    </main>
  );
}
