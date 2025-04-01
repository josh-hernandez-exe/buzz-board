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
      name: "silly game",
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

  const gameUsersData: GameUserData[] = [...Array(8)].map((_, idx) => ({
    name: `user${idx}`,
    gameId: games[0]!.id,
  }));

  const gameUsers: GameUser[] = await _insertData({
    data: gameUsersData,
    table: db.GameUser,
  });

  const gameTeamsData: GameTeamData[] = _.chunk<GameUser>(gameUsers, 2).map(
    (teamUsers: GameUser[], idx: number) => ({
      name: `Team ${idx}`,
      gameId: games[0]!.id,
      gameUserIds: teamUsers.map((user) => user.id),
    })
  );

  const gameTeams: GameTeam[] = await _insertData({
    data: gameTeamsData,
    table: db.GameTeam,
  });

  const emptyScoreboard = new Map<GameTeam["id"], number>(
    gameTeams.map((gameTeam) => [gameTeam.id, 0])
  );
  const scoreboardsData: ScoreboardData[] = games.map((game) => ({
    gameId: game.id!,
    current: new Map<GameTeam["id"], number>(
      gameTeams
        .filter((gameTeam) => gameTeam.gameId === game.id)
        .map((gameTeam) => [gameTeam.id, 0])
    ),
    pastDeltas: [],
    futureDeltas: [],
  }));
  const scoreBoards: Scoreboard[] = await _insertData({
    data: scoreboardsData,
    table: db.Scoreboard,
  });

  const buzzerStatesData: BuzzerStateData[] = games.map((game) => ({
    gameId: game.id!,
    isListening: false,
    buzzers: new Map<GameTeam["id"], SingleBuzzerState>(
      gameTeams
        .filter((gameTeam) => gameTeam.gameId! === game.id!)
        .map((gameTeam) => [gameTeam.id, SingleBuzzerState.avilalble])
    ),
  }));
  const buzzerStates: BuzzerState[] = await _insertData({
    data: buzzerStatesData,
    table: db.BuzzerState,
  });
}
