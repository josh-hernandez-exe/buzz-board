import { z } from "zod";

// NOTE: any imports related to CREATING the app router must be
//       relative imports. Otherwise type checking on the client side
//       is affected
import { dataSchemas, fullSchemas, schemaUtils } from "./dataSchema";

export type MayHaveIdField = z.infer<typeof schemaUtils.mayHaveIdField>;
export type HasCommonFields = z.infer<typeof schemaUtils.hasCommonFields>;

export type GameData = z.infer<typeof dataSchemas.Game>;
export type UserData = z.infer<typeof dataSchemas.User>;
export type GameUserData = z.infer<typeof dataSchemas.GameUser>;
export type GameTeamData = z.infer<typeof dataSchemas.GameTeam>;
export type GameAdminData = z.infer<typeof dataSchemas.GameAdmin>;
export type ScoreboardData = z.infer<typeof dataSchemas.Scoreboard>;
export type BuzzerStateData = z.infer<typeof dataSchemas.BuzzerState>;

export type GenericData =
  | GameData
  | UserData
  | GameUserData
  | GameTeamData
  | GameAdminData
  | ScoreboardData
  | BuzzerStateData;

export type Game = z.infer<typeof fullSchemas.Game>;
export type User = z.infer<typeof fullSchemas.User>;
export type GameUser = z.infer<typeof fullSchemas.GameUser>;
export type GameTeam = z.infer<typeof fullSchemas.GameTeam>;
export type GameAdmin = z.infer<typeof fullSchemas.GameAdmin>;
export type Scoreboard = z.infer<typeof fullSchemas.Scoreboard>;
export type BuzzerState = z.infer<typeof fullSchemas.BuzzerState>;

export type GenericTable = GenericData & HasCommonFields;
