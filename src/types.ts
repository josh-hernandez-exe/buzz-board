import type { Prisma } from "@prisma/client";
import type { Game, GameTeam, GameUser, User } from "@prisma/client";

export type GameSettings = {
  freezeTeams?: boolean;
};

export type BasicGameInfo = Prisma.GameGetPayload<{
  select: {
    id: true;
    name: true;
    format: true;
    code: true;
    isBuzzerListening: true;
    settings: true;
  };
}>;

export type GameWithRelations = Prisma.GameGetPayload<{
  include: {
    gameUsers: true;
    gameTeams: true;
    gameAdmins: true;
  };
}>;

export type GameUserBasicInfo = Prisma.GameUserGetPayload<{
  select: {
    id: true;
    name: true;
    index: true;
    gameId: true;
    gameTeamId: true;
    userId: true;
  };
}>;

export type GameTeamBasicInfo = Prisma.GameTeamGetPayload<{
  select: {
    id: true;
    name: true;
    index: true;
    gameId: true;
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

export type GameUserFromTeamWithRelations =
  GameTeamWithRelations["gameUsers"][number];

export type PublicGameState = {
  game: {
    id: Game["id"];
    name: Game["name"];
    format: Game["format"];
    isBuzzerListening: Game["isBuzzerListening"];
    status: Game["status"];
    /** Only while new players may join; null otherwise. */
    joinCode: Game["code"] | null;
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

export type GameTeamFromPublicState = PublicGameState["gameTeams"][number];
export type GameUserFromPrivateState = PrivateGameState["gameUsers"][string];

export type PrivateGameState = {
  game: {
    id: Game["id"];
    name: Game["name"];
    code: Game["code"];
    format: Game["format"];
    isBuzzerListening: Game["isBuzzerListening"];
    settings: Game["settings"] & GameSettings;
    status: Game["status"];
    finishedAt: Game["finishedAt"];
    joiningOpen: Game["joiningOpen"];
    teamAssignment: Game["teamAssignment"];
  };
  gameTeams: Array<{
    id: GameTeam["id"];
    name: GameTeam["name"];
    index: GameTeam["index"];
    buzzerState: GameTeam["buzzerState"];
    allowMemberRename: GameTeam["allowMemberRename"];
    nameVersion: GameTeam["nameVersion"];
    gameUsers: Array<GameUser["id"]>;
    score: number;
  }>;
  gameUsers: Record<
    GameUser["id"],
    {
      id: GameUser["id"];
      name: GameUser["name"];
      index: GameUser["index"];
      gameTeamId: GameUser["gameTeamId"];
      allowSelfRename: GameUser["allowSelfRename"];
      nameVersion: GameUser["nameVersion"];
      image: User["image"] | undefined;
    }
  >;
  /**
   * The current buzzer window's winner, from the durable claim. The team is
   * the one the claim was made for. `gameUserId` is null only for a team
   * selected before claims were recorded.
   */
  buzzWinner: {
    gameUserId: GameUser["id"] | null;
    gameTeamId: GameTeam["id"];
  } | null;
};

export type GameTeamFromPrivateState = PrivateGameState["gameTeams"][number];

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
