import { Result, ok, err } from "neverthrow";
import _ from "lodash";

import { db, type CrudFactory } from "@/db";

import type {
  GameData,
  UserData,
  GameUserData,
  GameTeamData,
  GameAdminData,
  ScoreboardData,
  BuzzerStateData,
  Game,
  User,
  GameUser,
  GameTeam,
  GameAdmin,
  Scoreboard,
  BuzzerState,
} from "@/dataTypes";

// import { enums } from "@/dataSchema";
import { GameFormat, SingleBuzzerState } from "@/enums";

import { logger } from "@/utils/logger";

async function _insertData({
  data,
  table,
}: {
  readonly data: any[];
  table: (typeof db)[keyof typeof db];
}): Promise<any[]> {
  const results: Result<any, Error>[] = await Promise.all(
    data.map((item) => table.create(item))
  );

  return results.map((res) => {
    if (res.isErr()) {
      throw new Error("could not insert data");
    }
    return res.value;
  });
}

export async function seedDb() {
  const usersData: UserData[] = [
    {
      name: "somename",
    },
  ];
  // const users: User = await db.User.create.
  const users: User[] = await _insertData({ data: usersData, table: db.User });

  const gamesData: GameData[] = [
    {
      name: "silly game with teams 1",
      format: GameFormat.team,
      settings: {},
    },
    {
      name: "silly game with teams 2",
      format: GameFormat.team,
      settings: {},
    },
  ];

  const games: Game[] = await _insertData({ data: gamesData, table: db.Game });

  const gameAdminsData: GameAdminData[] = games.map((game, idx) => ({
    name: `Game Admin ${idx}`,
    gameId: game.id,
    userId: users[0]!.id,
    settings: {},
  }));
  const gameAdmins: GameAdmin[] = await _insertData({
    data: gameAdminsData,
    table: db.GameAdmin,
  });

  const gameUsers: { [key: Game["id"]]: GameUser[] } = {};
  const gameTeams: { [key: Game["id"]]: GameTeam[] } = {};

  await Promise.all(
    games.map(async (game, gameIdx) => {
      const gameUsersData: GameUserData[] = [...Array(8)].map((_, idx) => ({
        name: `user ${gameIdx} - ${idx}`,
        gameId: game!.id,
      }));

      const currGameUsers: GameUser[] = await _insertData({
        data: gameUsersData,
        table: db.GameUser,
      });

      gameUsers[game!.id] = currGameUsers;

      if (game.format === GameFormat.team) {
        const gameTeamsData: GameTeamData[] = _.chunk<GameUser>(
          currGameUsers,
          2
        ).map((teamUsers: GameUser[], idx: number) => ({
          name: `Team ${gameIdx} - ${idx}`,
          gameId: game!.id,
          gameUserIds: teamUsers.map((user) => user.id),
        }));

        const curGameTeams: GameTeam[] = await _insertData({
          data: gameTeamsData,
          table: db.GameTeam,
        });
        gameTeams[game!.id] = curGameTeams;

        await Promise.all(
          curGameTeams.map(async (gameTeam) => {
            const teamMates = currGameUsers.filter((gameUser) =>
              gameTeam.gameUserIds.includes(gameUser.id)
            );
            return await Promise.all(
              teamMates.map(async (gameUser) => {
                return db.GameUser.update({
                  id: gameUser.id,
                  data: {
                    ...gameUser,
                    gameTeamId: gameTeam.id,
                  },
                });
              })
            );
          })
        );

        const scoreboardData: ScoreboardData = {
          gameId: game.id!,
          current: Object.fromEntries(
            curGameTeams
              .filter((gameTeam) => gameTeam.gameId === game.id)
              .map((gameTeam) => [gameTeam.id, 0])
          ),
          pastDeltas: [],
          futureDeltas: [],
        };

        const scoreBoards: Scoreboard[] = await _insertData({
          data: [scoreboardData],
          table: db.Scoreboard,
        });

        const buzzerStatesData: BuzzerStateData = {
          gameId: game.id!,
          isListening: false,
          buzzers: Object.fromEntries(
            curGameTeams
              .filter((gameTeam) => gameTeam.gameId! === game.id!)
              .map((gameTeam) => [gameTeam.id, SingleBuzzerState.avilalble])
          ),
        };
        const buzzerStates: BuzzerState[] = await _insertData({
          data: [buzzerStatesData],
          table: db.BuzzerState,
        });
      }
    })
  );
}
