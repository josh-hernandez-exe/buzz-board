import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { publicProcedure, router } from "./utils/trpc";
import { db, type CrudFactory } from "./db";
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

import {
  fullSchemas,
  paritalSchemas,
  dataSchemas,
  schemaUtils,
} from "./dataSchema";

function crudFactory<U, V extends U & HasCommonFields>({
  tableName,
}: {
  tableName: keyof typeof db;
}) {
  const crudObject = db[tableName]! as any as CrudFactory<U, V>;

  return {
    list: publicProcedure.query(async () => {
      logger.debug(`${tableName}-list`);
      const result = await crudObject.findAll();

      if (result.isErr()) {
        logger.error(result.error);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error.message,
          cause: result.error,
        });
      }

      return result.value;
    }),
    byId: publicProcedure.input(z.string()).query(async (opts) => {
      const { input } = opts;

      logger.debug(`${tableName}-byId`);

      // Retrieve the user with the given ID
      const result = await crudObject.findById(input);
      if (result.isErr()) {
        logger.error(result.error);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error.message,
          cause: result.error,
        });
      }

      return result.value;
    }),
    create: publicProcedure
      .input(paritalSchemas[tableName]!)
      .mutation(async (opts) => {
        const input = opts.input! as any as U & MayHaveIdField;

        logger.debug(`${tableName}-create`);

        const result = await crudObject.create(input);

        if (result.isErr()) {
          logger.error(result.error);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: result.error.message,
            cause: result.error,
          });
        }

        return result.value;
      }),
    update: publicProcedure
      .input(
        z.object({
          id: schemaUtils.idFieldSchema,
          data: dataSchemas[tableName]!,
        })
      )
      .mutation(async (opts) => {
        const id: string = opts.input.id;
        const data = opts.input.data as U;

        logger.debug(`${tableName}-create`);

        const result = await crudObject.update({ id, data });

        if (result.isErr()) {
          logger.error(result.error);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: result.error.message,
            cause: result.error,
          });
        }

        return result.value;
      }),
    delete: publicProcedure
      .input(schemaUtils.idFieldSchema)
      .mutation(async (opts) => {
        const id: string = opts.input;

        logger.debug(`${tableName}-create`);

        const result = await crudObject.delete(id);

        if (result.isErr()) {
          logger.error(result.error);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: result.error.message,
            cause: result.error,
          });
        }

        return result.value;
      }),
  };
}

export const appRouter = router({
  game: {
    ...crudFactory<GameData, Game>({ tableName: "Game" }),
  },
  user: {
    ...crudFactory<UserData, User>({ tableName: "User" }),
  },
  gameUser: {
    ...crudFactory<GameUserData, GameUser>({ tableName: "GameUser" }),
  },
  gameTeam: {
    ...crudFactory<GameTeamData, GameTeam>({ tableName: "GameTeam" }),
  },
  gameAdmin: {
    ...crudFactory<GameAdminData, GameAdmin>({ tableName: "GameAdmin" }),
  },
  scoreboard: {
    ...crudFactory<ScoreboardData, Scoreboard>({ tableName: "Scoreboard" }),
  },
  buzzerState: {
    ...crudFactory<BuzzerStateData, BuzzerState>({ tableName: "BuzzerState" }),
  },
});
