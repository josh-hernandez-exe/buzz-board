import { v4 as uuidv4 } from "uuid";
import { DateTime } from "luxon";
import { Result, ok, err } from "neverthrow";

import { logger } from "@/utils/logger";
import type {
  MayHaveIdField,
  HasCommonFields,
  HasGameId,
  GenericData,
  GenericTable,
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
} from "../dataTypes";

type CrudUpdateArgs<U, V extends U & HasCommonFields> = {
  id: V["id"];
  data: Partial<U>;
};

export type CrudFactory<
  U extends GenericData,
  V extends U & HasCommonFields,
> = {
  findAll: () => ReturnType<typeof findMany<V>>;
  findMany: (ids: V["id"][] | undefined) => ReturnType<typeof findMany<V>>;
  findById: (id: V["id"]) => ReturnType<typeof findById<V>>;
  create: (
    data: U & MayHaveIdField
  ) => ReturnType<typeof create<U & MayHaveIdField, V>>;
  update: (args: CrudUpdateArgs<U, V>) => ReturnType<typeof update<U, V>>;
  delete: (id: V["id"]) => ReturnType<typeof softDelete<V>>;
};

export type FindByGameIdFactory<U extends GenericTable & HasGameId> = {
  findByGameId: (gameId: U["gameId"]) => ReturnType<typeof findByGameId<U>>;
};

const database: { [key: string]: Map<string, GenericTable> } = {
  Game: new Map<Game["id"], Game>(),
  User: new Map<User["id"], User>(),
  GameUser: new Map<GameUser["id"], GameUser>(),
  GameTeam: new Map<GameTeam["id"], GameTeam>(),
  GameAdmin: new Map<GameAdmin["id"], GameAdmin>(),
  Scoreboard: new Map<Scoreboard["id"], Scoreboard>(),
  BuzzerState: new Map<BuzzerState["id"], BuzzerState>(),
};

async function create<U extends MayHaveIdField, V extends U & HasCommonFields>({
  data,
  tableName,
}: {
  readonly data: U;
  tableName: keyof typeof database;
}): Promise<Result<V, Error>> {
  const table = database[tableName]! as Map<V["id"], V>;

  let insertData: any = {
    ...data,
    createdAt: DateTime.now().toISO(),
    updatedAt: DateTime.now().toISO(),
    deletedAt: null,
  };

  if (!data.hasOwnProperty("id")) {
    insertData.id = uuidv4();
    // insertData.id = `${table.size + 1}`;
  }
  insertData = insertData as V;

  if (table.has(insertData.id)) {
    return err(
      new Error(`Database table ${tableName} already has key ${insertData.id}.`)
    );
  }
  table.set(insertData.id, insertData);

  return ok(insertData);
}

async function findMany<T extends HasCommonFields>({
  ids,
  tableName,
}: {
  readonly ids: T["id"][] | undefined;
  readonly tableName: keyof typeof database;
}): Promise<Result<T[], Error>> {
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

  return ok(data);
}

async function findById<T extends HasCommonFields>({
  id,
  tableName,
}: {
  readonly id: string;
  readonly tableName: keyof typeof database;
}): Promise<Result<T, Error>> {
  const table = database[tableName]! as Map<T["id"], T>;
  const item = table.get(id);

  if (item === undefined) {
    return err(new Error(`id=${id} not found in table ${tableName}`));
  } else if (item.deletedAt !== null) {
    return err(new Error(`id=${id} in table ${tableName} is deleted`));
  }
  return ok(item);
}

async function update<U, V extends U & HasCommonFields>({
  id,
  data,
  tableName,
}: {
  readonly id: V["id"];
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
      updatedAt: DateTime.now().toISO(),
    },
  };

  table.set(id, updatedItem);

  return ok(updatedItem);
}

async function softDelete<V extends HasCommonFields>({
  id,
  tableName,
}: {
  readonly id: V["id"];
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

async function findByGameId<U extends GenericTable & HasGameId>({
  gameId,
  tableName,
}: {
  readonly gameId: U["gameId"];
  readonly tableName: keyof typeof database;
}): Promise<Result<U[], Error>> {
  const table = database[tableName]! as Map<U["id"], U>;

  const data = Array.from(
    table.values().filter((item) => item.gameId === gameId)
  );

  return ok(data);
}

function crudFactory<U extends GenericData, V extends U & HasCommonFields>({
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

function findByGameIdFactory<U extends GenericTable & HasGameId>({
  tableName,
}: {
  tableName: keyof typeof database;
}): FindByGameIdFactory<U> {
  return {
    findByGameId: (gameId: U["gameId"]) => findByGameId({ gameId, tableName }),
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
    ...findByGameIdFactory<GameUser>({ tableName: "GameUser" }),
  },
  GameTeam: {
    ...crudFactory<GameTeamData, GameTeam>({ tableName: "GameTeam" }),
    ...findByGameIdFactory<GameTeam>({ tableName: "GameTeam" }),
  },
  GameAdmin: {
    ...crudFactory<GameAdminData, GameAdmin>({ tableName: "GameAdmin" }),
    ...findByGameIdFactory<GameAdmin>({ tableName: "GameAdmin" }),
  },
  Scoreboard: {
    ...crudFactory<ScoreboardData, Scoreboard>({ tableName: "Scoreboard" }),
    ...findByGameIdFactory<Scoreboard>({ tableName: "Scoreboard" }),
  },
  BuzzerState: {
    ...crudFactory<BuzzerStateData, BuzzerState>({ tableName: "BuzzerState" }),
    ...findByGameIdFactory<BuzzerState>({ tableName: "BuzzerState" }),
  },
};
