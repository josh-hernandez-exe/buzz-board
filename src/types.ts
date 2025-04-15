import { Prisma } from "@prisma/client";
import type { Game, GameTeam, GameUser } from "@prisma/client";

export type GameWithRelations = Prisma.GameGetPayload<{
  include: {
    gameUsers: true;
    gameTeams: true;
    gameAdmins: true;
    scoreboard: true;
    scoreboardStates: true;
  };
}>;

export type PublicGameState = {
  game: {
    id: Game["id"];
    name: Game["name"];
    format: Game["format"];
    isBuzzerListening: Game["isBuzzerListening"];
  };
  gameTeams: Array<{
    id: GameTeam["id"];
    name: GameTeam["name"];
    index: GameTeam["index"];
    buzzerState: GameTeam["buzzerState"];
    numPlayers: number;
    score: number;
  }>;
};

export type PrivateGameState = {
  game: {
    id: Game["id"];
    name: Game["name"];
    code: Game["code"];
    format: Game["format"];
    isBuzzerListening: Game["isBuzzerListening"];
  };
  gameTeams: Array<{
    id: GameTeam["id"];
    name: GameTeam["name"];
    index: GameTeam["index"];
    buzzerState: GameTeam["buzzerState"];
    gameUsers: Array<{
      id: GameUser["id"];
      name: GameUser["name"];
    }>;
    score: number;
  }>;
};

export type WhoBuzzedIn = {
  game: {
    id: Game["id"];
    format: Game["format"];
  };
  gameUser: {
    id: GameUser["id"];
    name: GameUser["name"];
    gameTeam: {
      id: GameTeam["id"];
      name: GameTeam["name"];
    };
  };
};
