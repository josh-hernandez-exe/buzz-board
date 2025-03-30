import { v4 as uuidv4 } from "uuid";
import { DateTime } from "luxon";
import { okAsync, errAsync, ResultAsync, Result, ok, err } from "neverthrow";

import { logger } from "./utils/logger";
import type {
  MayHaveIdField,
  HasCommonFields,
  Game,
  GameData,
  User,
  UserData,
  GameUser,
  GameUserData,
  GameTeam,
  GameTeamData,
  GameAdmin,
  GameAdminData,
  Scoreboard,
  ScoreboardData,
  BuzzerState,
  BuzzerStateData,
} from "./dataTypes";

// const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const database: { [key: string]: Map<string, HasCommonFields> } = {
  Game: new Map<Game["id"], Game>(),
  User: new Map<User["id"], User>(),
  GameUser: new Map<GameUser["id"], GameUser>(),
  GameTeam: new Map<GameTeam["id"], GameTeam>(),
  GameAdmin: new Map<GameAdmin["id"], GameAdmin>(),
  Scoreboard: new Map<Scoreboard["id"], Scoreboard>(),
  BuzzerState: new Map<BuzzerState["id"], BuzzerState>(),
};

function create<U extends MayHaveIdField, V extends U & HasCommonFields>({
  data,
  tableName,
}: {
  readonly data: U;
  tableName: keyof typeof database;
}): ResultAsync<V, Error> {
  const table = database[tableName]! as Map<V["id"], V>;

  let insertData: any = {
    ...data,
    createdAt: DateTime.now().toISO(),
    updatedAt: DateTime.now().toISO(),
    deletedAt: null,
  };

  if (!data.hasOwnProperty("id")) {
    // insertData.id = uuidv4();
    insertData.id = `${table.size + 1}`;
  }
  insertData = insertData as V;

  if (table.has(insertData.id)) {
    return errAsync(
      new Error(`Database table ${tableName} already has key ${insertData.id}.`)
    );
  }
  table.set(insertData.id, insertData);

  return okAsync(insertData);
}

function findMany<T extends HasCommonFields>({
  ids,
  tableName,
}: {
  readonly ids: T["id"][] | undefined;
  tableName: keyof typeof database;
}): ResultAsync<T[], Error> {
  const table = database[tableName]! as Map<T["id"], T>;
  let data: T[];

  if (ids === undefined) {
    data = table.values().toArray();
  } else {
    data = ids.map((id) => table.get(id)).filter((item) => item !== undefined);
  }

  // remove all deleted items
  data = data.filter((item) => item.deletedAt == null);

  data = data as T[];

  return okAsync(data);
}

function findById<T extends HasCommonFields>({
  id,
  tableName,
}: {
  id: string;
  tableName: keyof typeof database;
}): ResultAsync<T, Error> {
  const table = database[tableName]! as Map<T["id"], T>;
  const item = table.get(id);

  if (item === undefined) {
    return errAsync(new Error(`id=${id} not found in table ${tableName}`));
  } else if (item.deletedAt !== null) {
    return errAsync(new Error(`id=${id} in table ${tableName} is deleted`));
  }
  return okAsync(item);
}

async function update<U, V extends U & HasCommonFields>({
  id,
  data,
  tableName,
}: {
  id: V["id"];
  readonly data: Partial<U>;
  tableName: keyof typeof database;
}): Promise<Result<V, Error>> {
  const table = database[tableName]! as Map<V["id"], V>;
  const serachResult = await findById<V>({ id, tableName });

  if (serachResult.isErr()) {
    return serachResult;
  }

  const originalItem = serachResult.value;
  const updatedItem: V = {
    ...originalItem, // load all the original data
    ...data, // overwrite any of the new data
    ...{
      // ensure that the original id and metadata
      id: originalItem.id,
      createdAt: originalItem.createdAt,
      // ensure that the updatedAt is updated to "now".
      updatedAt: DateTime.now(),
    },
  };

  table.set(id, updatedItem);

  return ok(updatedItem);
}

async function softDelete<V extends HasCommonFields>({
  id,
  tableName,
}: {
  id: V["id"];
  tableName: keyof typeof database;
}): Promise<Result<void, Error>> {
  const table = database[tableName]! as Map<V["id"], V>;

  const serachResult = await findById<V>({ id, tableName });

  if (serachResult.isErr()) {
    return err(serachResult.error);
  }

  const data: V = serachResult.value;

  if (data.deletedAt !== null) {
    logger.debug(`Entry ${id} from ${tableName} is already deleted`);
    return ok();
  }

  const updateResult = await update<V, V>({
    id,
    data: { ...data, deletedAt: DateTime.now().toISO() },
    tableName,
  });

  if (updateResult.isErr()) {
    return err(updateResult.error);
  }

  return ok();
}

type UpdateArgs<U, V extends U & HasCommonFields> = {
  id: V["id"];
  data: Partial<U>;
};

export type CrudFactory<U, V extends U & HasCommonFields> = {
  findAll: () => ReturnType<typeof findMany<V>>;
  findMany: (ids: V["id"][] | undefined) => ReturnType<typeof findMany<V>>;
  findById: (id: V["id"]) => ReturnType<typeof findById<V>>;
  create: (
    data: U & MayHaveIdField
  ) => ReturnType<typeof create<U & MayHaveIdField, V>>;
  update: (args: UpdateArgs<U, V>) => ReturnType<typeof update<U, V>>;
  delete: (id: V["id"]) => ReturnType<typeof softDelete<V>>;
};

function crudFactory<U, V extends U & HasCommonFields>({
  tableName,
}: {
  tableName: keyof typeof database;
}): CrudFactory<U, V> {
  return {
    findAll: () => findMany<V>({ ids: undefined, tableName }),
    findMany: (ids: V["id"][] | undefined) => findMany<V>({ ids, tableName }),
    findById: (id: V["id"]) => findById<V>({ id, tableName }),
    create: (data: U & MayHaveIdField) =>
      create<U & MayHaveIdField, V>({
        data,
        tableName,
      }),
    update: ({ id, data }: { id: V["id"]; data: Partial<U> }) =>
      update<U, V>({ id, data, tableName }),
    delete: (id: V["id"]) => softDelete<V>({ id, tableName }),
  };
}

export const db = {
  Game: {
    ...crudFactory<GameData, Game>({ tableName: "Game" }),
  },
  User: {
    ...crudFactory<UserData, User>({ tableName: "User" }),
  },
  GameUser: {
    ...crudFactory<GameUserData, GameUser>({ tableName: "GameUser" }),
  },
  GameTeam: {
    ...crudFactory<GameTeamData, GameTeam>({ tableName: "GameTeam" }),
  },
  GameAdmin: {
    ...crudFactory<GameAdminData, GameAdmin>({ tableName: "GameAdmin" }),
  },
  Scoreboard: {
    ...crudFactory<ScoreboardData, Scoreboard>({ tableName: "Scoreboard" }),
  },
  BuzzerState: {
    ...crudFactory<BuzzerStateData, BuzzerState>({ tableName: "BuzzerState" }),
  },
};
