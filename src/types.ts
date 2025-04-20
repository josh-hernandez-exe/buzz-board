import { Prisma } from "@prisma/client";
import type { Game, GameTeam, GameUser, User } from "@prisma/client";

export type BasicGameInfo = Prisma.GameGetPayload<{
  select: {
    id: true;
    name: true;
    format: true;
    code: true;
    isBuzzerListening: true;
  };
}>;

export type GameWithRelations = Prisma.GameGetPayload<{
  include: {
    gameUsers: true;
    gameTeams: true;
    gameAdmins: true;
  };
}>;

export type GameUserWithRelations = Prisma.GameUserGetPayload<{
  select: {
    id: true;
    name: true;
    index: true;
    data: true;
    gameId: true;
    gameTeamId: true;
    gameTeam: {
      select: {
        id: true;
        name: true;
        index: true;
      };
    };
    user: {
      select: {
        id: true;
        name: true;
        image: true;
      };
    };
  };
}>;

export type GameTeamWithRelations = Prisma.GameTeamGetPayload<{
  select: {
    id: true;
    name: true;
    index: true;
    gameId: true;
    gameUsers: {
      select: {
        id: true;
        name: true;
        index: true;
        user: {
          select: {
            id: true;
            name: true;
            image: true;
          };
        };
      };
    };
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
      index: GameUser["index"];
      image: User["image"] | undefined;
    }>;
    score: number;
  }>;
};

export type WhoBuzzedIn = {
  game: {
    id: Game["id"];
    format: Game["format"];
    isBuzzerListening: Game["isBuzzerListening"];
  };
  gameUser:
    | {
        id: GameUser["id"];
        name: GameUser["name"];
        index: GameUser["index"];
        gameTeam: {
          id: GameTeam["id"];
          name: GameTeam["name"];
        };
        image: User["image"] | undefined;
      }
    | undefined;
};
