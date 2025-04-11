"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { api } from "@/trpc/react";

import { logger } from "@/utils/logger";

export default function JoinGamePage() {
  const [gameCode, setGameCode] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const joinGameMutation = api.guest.game.joinAsGuest.useMutation({
    onSuccess: (data) => {
      if (data.token) {
        localStorage.setItem("guestToken", data.token);
      }
      // TODO change page
      //router.push(`/game/${gameCode}`);
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
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100">
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
