import { TRPCError } from "@trpc/server";

import { type GameTransactionError } from "@/server/db/gameTransaction";

/** Maps game transaction failures to the API's standard typed errors. */
export function gameTransactionErrorToTRPC(
  error: GameTransactionError,
): TRPCError {
  switch (error.kind) {
    case "gameNotFound":
      return new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
    case "busy":
      return new TRPCError({
        code: "CONFLICT",
        message: "The game is busy with another change. Please try again.",
        cause: error.cause,
      });
  }
}
