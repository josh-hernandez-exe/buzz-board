import type { EnumType } from "typescript";
import { z, type EnumLike } from "zod";

enum GameFormat {
  single,
  team,
}

enum SingleBuzzerState {
  avilalble,
  selected,
  rejected,
}

// const idFieldSchema = z.string().uuid();
const idFieldSchema = z.string();

const mayHaveIdField = z.object({ id: z.optional(z.string()) });

const hasIdField = z.object({ id: z.string() });
const metaData = z.object({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.nullable(z.string().datetime()),
});
const hasCommonFields = hasIdField.merge(metaData);

const gameData = z.object({
  name: z.string(),
  format: z.nativeEnum(GameFormat),
  settings: z.object({}),
});

const userData = z.object({
  name: z.string(),
});

const gameUserData = z.object({
  name: z.string(),
  gameId: idFieldSchema,
  userId: z.optional(idFieldSchema),
});

const gameTeamData = z.object({
  name: z.string(),
  gameId: idFieldSchema,
  gameUsers: z.array(idFieldSchema),
});

const gameAdminData = z.object({
  name: z.string(),
  gameId: idFieldSchema,
  userId: z.optional(idFieldSchema),
  settings: z.object({}),
});

const scoreboardState = z.map(z.string(), z.number());
const scoreboardDelta = z.map(z.string(), z.number());

const scoreboardData = z.object({
  gameId: idFieldSchema,
  current: scoreboardState,
  pastDeltas: z.array(scoreboardDelta),
  futureDeltas: z.array(scoreboardDelta),
});

const buzzerStateData = z.object({
  gameId: idFieldSchema,
  isListening: z.boolean(),
  buzzers: z.map(z.string(), z.nativeEnum(SingleBuzzerState)),
});

const game = gameData.merge(hasCommonFields);
const user = userData.merge(hasCommonFields);
const gameUser = gameUserData.merge(hasCommonFields);
const gameTeam = gameTeamData.merge(hasCommonFields);
const gameAdmin = gameAdminData.merge(hasCommonFields);
const scoreboard = scoreboardData.merge(hasCommonFields);
const buzzerState = buzzerStateData.merge(hasCommonFields);

export const enums: { [key: string]: EnumLike } = {
  GameFormat,
  SingleBuzzerState,
};

export const schemaUtils = {
  mayHaveIdField,
  hasCommonFields,
  idFieldSchema,
};

export const dataSchemas = {
  Game: gameData,
  User: userData,
  GameUser: gameUserData,
  GameTeam: gameTeamData,
  GameAdmin: gameAdminData,
  Scoreboard: scoreboardData,
  BuzzerState: buzzerStateData,
};

export const paritalSchemas = Object.fromEntries(
  Object.entries(dataSchemas).map(([key, value]) => [
    key,
    value.merge(mayHaveIdField),
  ])
);

export const fullSchemas = {
  Game: game,
  User: user,
  GameUser: gameUser,
  GameTeam: gameTeam,
  GameAdmin: gameAdmin,
  Scoreboard: scoreboard,
  BuzzerState: buzzerState,
};
