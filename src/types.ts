import { Prisma } from "@prisma/client";

export type GameWithRelations = Prisma.GameGetPayload<{
  include: {
    gameUsers: true;
    gameTeams: true;
    gameAdmins: true;
    scoreboard: true;
    scoreboardStates: true;
  };
}>;
