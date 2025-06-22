import { check, sleep } from "k6";
import http from "k6/http";

import type { GameUser, Game } from "@prisma/client";

// k6 configuration
export const options = {
  stages: [
    { duration: "10s", target: 1 }, // ramp up to 10 virtual users
    { duration: "10s", target: 1 }, // stay at 10 virtual users
    { duration: "10s", target: 0 }, // ramp down to 0
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"], // 95% of requests must complete below 500ms
  },
};

const getBaseUrl = () => {
  return __ENV.BASE_URL ?? "http://localhost:3000";
};

interface JoinGameResult {
  token: GameUser["token"];
  gameId: Game["id"];
  gameUser: GameUser;
}

interface GameState {
  gameTeams: { id: string }[];
}

interface BuzzInError {
  message: string;
}

type BuzzInResponse = [
  {
    error?: {
      json: BuzzInError;
    };
    result?: unknown;
  },
];

export default function testWorker() {
  // Get credentials from environment variables
  const gameCode = __ENV.GAME_CODE;

  if (!gameCode) {
    console.error("GAME_CODE must be provided");
    return;
  }

  const baseUrl = getBaseUrl();
  const trpcUrl = `${baseUrl}/api/trpc`;

  // Join game
  const joinGameUrl = `${trpcUrl}/public.joinGame`;
  const joinGamePayload = JSON.stringify({ json: { gameCode } });
  const joinGameParams = {
    headers: {
      "Content-Type": "application/json",
      "x-trpc-source": "k6-client",
    },
  };
  const joinGameRes = http.post(joinGameUrl, joinGamePayload, joinGameParams);

  check(joinGameRes, {
    "join game status is 200": (r) => r.status === 200,
  });

  const joinResult = joinGameRes.json(
    "result.data.json",
  ) as unknown as JoinGameResult | null;
  if (!joinResult) {
    console.error("Could not parse join game response");
    console.error(joinGameRes.body);
    return;
  }

  const { gameUser, token: gameUserToken, gameId } = joinResult;

  if (!gameId || !gameUserToken) {
    console.error(
      "GAME_ID and GAME_USER_TOKEN must be provided from joinGame response",
    );
    return;
  }

  const authedHeaders = {
    "Content-Type": "application/json",
    "x-trpc-source": "k6-client",
    "x-buzz-board-game-id": gameId,
    "x-buzz-board-game-user-token": gameUserToken,
  };

  // 1. Get current game state
  const gameStateUrl = `${trpcUrl}/gameGeneral.currentGameState`;
  const gameStateRes = http.get(gameStateUrl, {
    headers: authedHeaders,
  });
  check(gameStateRes, {
    "get game state status is 200": (r) => r.status === 200,
  });

  const gameState = gameStateRes.json(
    "result.data.json",
  ) as unknown as GameState | null;
  if (!gameState) {
    console.error("Could not get game state from response");
    console.error(gameStateRes.body);
    return;
  }

  sleep(1);

  // 2. Change teams
  if (gameState.gameTeams?.length > 0) {
    const randomIndex = Math.floor(Math.random() * gameState.gameTeams.length);
    const teamId = gameState.gameTeams[randomIndex]?.id;
    if (teamId) {
      const changeTeamsUrl = `${trpcUrl}/gameUser.changeTeams`;
      const changeTeamsPayload = JSON.stringify({
        json: { gameTeamId: teamId },
      });
      const changeTeamResponse = http.post(changeTeamsUrl, changeTeamsPayload, {
        headers: authedHeaders,
      });

      const changedUser = changeTeamResponse.json(
        "result.data.json",
      ) as unknown as GameUser | null;

      check(changedUser, {
        "game user changed teams": (user) =>
          user?.gameTeamId !== gameUser.gameTeamId,
      });
    }
    sleep(1);
  }

  // 3. Buzz in
  const buzzInUrl = `${trpcUrl}/gameUser.buzzIn`;
  const buzzInPayload = JSON.stringify({});
  const buzzInRes = http.post(buzzInUrl, buzzInPayload, {
    headers: authedHeaders,
  });

  check(buzzInRes, {
    "buzz-in request has expected result": (r) =>
      [
        r.status === 200,
        r.status >= 400 &&
          r.status <= 499 &&
          r.json("error.json.message") === "Game is not listening for buzzers",
        r.status >= 400 &&
          r.status <= 499 &&
          r.json("error.json.message") === "Game team has already buzzed in.",
      ].some(Boolean),
  });

  sleep(1);
}
