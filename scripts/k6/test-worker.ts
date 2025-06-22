import { check, sleep } from "k6";
import http from "k6/http";

import type { GameUser, Game } from "@prisma/client";
import { GameFormat } from "@prisma/client";
import type {
  GameUserBasicInfo,
  GameTeamBasicInfo,
  PrivateGameState,
} from "@/types";
import { adjectives, nouns } from "./randomName";

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

function joinGame(trpcUrl: string, gameCode: string): JoinGameResult | null {
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
    return null;
  }
  return joinResult;
}

function getCurrentGameState(
  trpcUrl: string,
  authedHeaders: Record<string, string>,
): PrivateGameState | null {
  const gameStateUrl = `${trpcUrl}/gameGeneral.currentGameState`;
  const gameStateRes = http.get(gameStateUrl, {
    headers: authedHeaders,
  });
  check(gameStateRes, {
    "get game state status is 200": (r) => r.status === 200,
  });

  const gameState = gameStateRes.json(
    "result.data.json",
  ) as unknown as PrivateGameState | null;
  if (!gameState) {
    console.error("Could not get game state from response");
    console.error(gameStateRes.body);
    return null;
  }
  return gameState;
}

function getSelfInfo(
  trpcUrl: string,
  authedHeaders: Record<string, string>,
): GameUser | null {
  const getSelfInfoUrl = `${trpcUrl}/gameUser.getSelfInfo`;
  const getSelfInfoRes = http.get(getSelfInfoUrl, {
    headers: authedHeaders,
  });
  check(getSelfInfoRes, {
    "get self info status is 200": (r) => r.status === 200,
  });

  const currentGameUserInfo = getSelfInfoRes.json(
    "result.data.json",
  ) as unknown as GameUser | null;
  if (!currentGameUserInfo) {
    console.error("Could not get self info from response");
    console.error(getSelfInfoRes.body);
    return null;
  }
  return currentGameUserInfo;
}

function changeName(
  trpcUrl: string,
  authedHeaders: Record<string, string>,
  newName: string,
): GameUserBasicInfo | null {
  const changeNameUrl = `${trpcUrl}/gameUser.changeName`;
  const changeNamePayload = JSON.stringify({ json: { name: newName } });
  const changeNameRes = http.post(changeNameUrl, changeNamePayload, {
    headers: authedHeaders,
  });
  let updatedUser: GameUserBasicInfo | null = null;

  check(changeNameRes, {
    "change name status is 200": (r) => r.status === 200,
    "user name was updated": (r) => {
      updatedUser = r.json(
        "result.data.json",
      ) as unknown as GameUserBasicInfo | null;
      return updatedUser?.name === newName;
    },
  });

  return updatedUser;
}

function changeTeamName(
  trpcUrl: string,
  authedHeaders: Record<string, string>,
  newName: string,
): GameTeamBasicInfo | null {
  const changeTeamNameUrl = `${trpcUrl}/gameUser.changeTeamName`;
  const changeTeamNamePayload = JSON.stringify({ json: { name: newName } });
  const changeTeamNameRes = http.post(
    changeTeamNameUrl,
    changeTeamNamePayload,
    {
      headers: authedHeaders,
    },
  );
  let updatedTeam: GameTeamBasicInfo | null = null;

  check(changeTeamNameRes, {
    "change team name status is 200": (r) => r.status === 200,
    "team name was updated": (r) => {
      updatedTeam = r.json(
        "result.data.json",
      ) as unknown as GameTeamBasicInfo | null;
      return updatedTeam?.name === newName;
    },
  });

  return updatedTeam;
}

function changeTeam(
  trpcUrl: string,
  authedHeaders: Record<string, string>,
  gameState: PrivateGameState,
  currentGameUserInfo: GameUser,
) {
  const randomIndex = Math.floor(Math.random() * gameState.gameTeams.length);
  const teamId = gameState.gameTeams[randomIndex]?.id;

  if (!teamId) {
    throw new Error("Could not find a team to change to");
  }

  const changeTeamsUrl = `${trpcUrl}/gameUser.changeTeams`;
  const changeTeamsPayload = JSON.stringify({
    json: { gameTeamId: teamId },
  });
  const changeTeamResponse = http.post(changeTeamsUrl, changeTeamsPayload, {
    headers: authedHeaders,
  });

  check(changeTeamResponse, {
    "change team status is 200": (r) => r.status === 200,
    "game user changed teams": (r) => {
      const changedUser = r.json(
        "result.data.json",
      ) as unknown as GameUser | null;
      return changedUser?.gameTeamId !== currentGameUserInfo.gameTeamId;
    },
  });
}

function buzzIn(trpcUrl: string, authedHeaders: Record<string, string>) {
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
}

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
  const joinResult = joinGame(trpcUrl, gameCode);
  if (!joinResult) {
    return;
  }

  const { token: gameUserToken, gameId } = joinResult;

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

  // 1. Get current game stateGameState
  const gameState = getCurrentGameState(trpcUrl, authedHeaders);
  if (!gameState) {
    return;
  }

  sleep(1);

  // 2. Get self info
  const currentGameUserInfo = getSelfInfo(trpcUrl, authedHeaders);
  if (!currentGameUserInfo) {
    return;
  }

  sleep(1);

  // 3. Change name
  const randomUserAdjective =
    adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomUserNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomUserName = `User ${randomUserAdjective} ${randomUserNoun}`;
  changeName(trpcUrl, authedHeaders, randomUserName);

  sleep(1);

  if (gameState.game.format === GameFormat.team) {
    if (gameState.gameTeams?.length === 0) {
      throw new Error("No teams available to change to");
    }

    // 4. Change teams
    changeTeam(trpcUrl, authedHeaders, gameState, currentGameUserInfo);
    sleep(1);

    // 5. Change team name
    const randomTeamAdjective =
      adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomName = `Team ${randomTeamAdjective} ${randomNoun}`;
    changeTeamName(trpcUrl, authedHeaders, randomName);
    sleep(1);
  }

  // 6. Buzz in
  buzzIn(trpcUrl, authedHeaders);
  sleep(1);
}
