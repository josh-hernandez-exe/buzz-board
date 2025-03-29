import { z } from "zod";
import { publicProcedure, router } from "./utils/trpc";
import { db } from "./db";
import { logger } from "./utils/logger";

export const appRouter = router({
  user: {
    list: publicProcedure.query(async () => {
      logger.debug("list");
      // Retrieve users from a datasource, this is an imaginary database
      const users = await db.user.findMany();

      return users;
    }),
    byId: publicProcedure.input(z.string()).query(async (opts) => {
      const { input } = opts;

      logger.debug("byId");

      // Retrieve the user with the given ID
      const result = await db.user.findById(input);
      if (result.isErr()) {
        return null;
      }

      return result.value;
    }),
    create: publicProcedure
      .input(z.object({ name: z.string() }))
      .mutation(async (opts) => {
        const { input } = opts;

        logger.debug("create");

        // Create a new user in the database
        const user = await db.user.create(input);

        return user;
      }),
  },
  examples: {
    iterable: publicProcedure.query(async function* () {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        yield i;
      }
    }),
  },
});
