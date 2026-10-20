import { TRPCError } from "@trpc/server";

import {
  type BuzzError,
  type BuzzerControlError,
} from "@/server/buzzer/buzzerService";
import { type GameTransactionError } from "@/server/db/gameTransaction";
import { type GameServiceError } from "@/server/games/gameService";
import { type ScoreCommandError } from "@/server/scores/scoreService";
import { nameErrorMessage } from "@/utils/displayName";
import { SCORE_LIMITS } from "@/server/scores/scoreMath";
import { helpHref } from "@/help/manifest";

export type ServiceError =
  | GameTransactionError
  | GameServiceError
  | BuzzError
  | BuzzerControlError
  | ScoreCommandError;

const number = (n: number) => n.toLocaleString("en-US");

/** A TRPCError that also names the Help article explaining it. */
export class HelpfulTRPCError extends TRPCError {
  readonly help: string;
  constructor(
    opts: ConstructorParameters<typeof TRPCError>[0] & { help: string },
  ) {
    super(opts);
    this.help = opts.help;
  }
}

/** Help for each expected error, so error messages can link to it. */
const ERROR_HELP: Partial<Record<ServiceError["kind"], string>> = {
  gameNotFound: helpHref("join-and-resume", "why-cant-i-join"),
  joiningClosed: helpHref("troubleshooting", "joining-is-closed"),
  gameFinished: helpHref("troubleshooting", "this-game-has-finished"),
  busy: helpHref("troubleshooting", "the-game-is-busy"),
  invalidName: helpHref(
    "teams-and-names",
    "how-do-i-change-my-name-or-my-teams-name",
  ),
  notListening: helpHref("troubleshooting", "why-cant-i-buzz"),
  teamRejected: helpHref("troubleshooting", "why-cant-i-buzz"),
  notOnTeam: helpHref("teams-and-names", "how-do-players-get-a-team"),
  invalidAmount: helpHref("scoreboards-and-display", "how-do-i-change-scores"),
  scoreOutOfRange: helpHref(
    "scoreboards-and-display",
    "how-do-i-change-scores",
  ),
  reopenExpired: helpHref("host-quickstart", "can-i-run-the-same-game-again"),
  cannotDeleteActiveGame: helpHref("host-quickstart", "how-do-i-delete-a-game"),
};

/**
 * Maps every service error to the API's standard typed errors, with a message
 * a player or host can act on.
 */
export function toTRPCError(error: ServiceError): TRPCError {
  const base = baseError(error);
  const help = ERROR_HELP[error.kind];
  return help
    ? new HelpfulTRPCError({
        code: base.code,
        message: base.message,
        cause: base.cause,
        help,
      })
    : base;
}

function baseError(error: ServiceError): TRPCError {
  switch (error.kind) {
    case "gameNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "No game has that code. Check it with your host.",
      });
    case "busy":
      return new TRPCError({
        code: "CONFLICT",
        message: "The game is busy with another change. Please try again.",
        cause: error.cause,
      });
    case "gameFinished":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This game has finished.",
      });
    case "joiningClosed":
      return new TRPCError({
        code: "FORBIDDEN",
        message: "Joining is closed for this game. Ask your host to open it.",
      });
    case "invalidName":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: nameErrorMessage(
          error.error,
          error.field === "game" ? "Game name" : "Nickname",
        ),
      });
    case "invalidTeamCount":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose between 1 and 8 teams.",
      });
    case "notFinished":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Only a finished game can be reopened.",
      });
    case "reopenExpired":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Games can only be reopened within 24 hours of finishing. Duplicate it to play again.",
      });
    case "notOwner":
      return new TRPCError({
        code: "FORBIDDEN",
        message: "Only the game's creator can do that.",
      });
    case "cannotDeleteActiveGame":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Finish the game before deleting it. Only finished games or unused lobbies can be deleted.",
      });
    case "confirmationMismatch":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "Type the game's name exactly to confirm.",
      });
    case "teamsNotSupported":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "Game format does not support teams",
      });
    case "participantNotFound":
      return new TRPCError({
        code: "UNAUTHORIZED",
        message: "Not a valid game user for this game.",
      });
    case "notOnTeam":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "Game user is not part of a team",
      });
    case "notListening":
      return new TRPCError({
        code: "CONFLICT",
        message: "Game is not listening for buzzers",
      });
    case "teamRejected":
      return new TRPCError({
        code: "CONFLICT",
        message: "Game team has already buzzed in.",
      });
    case "requestIdReused":
      return new TRPCError({
        code: "CONFLICT",
        message: "This request ID was already used for a different change.",
      });
    case "scoreboardNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "Scoreboard not found",
      });
    case "unknownTeams":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "Game teams not found",
      });
    case "noChanges":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose at least one team",
      });
    case "invalidAmount":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `Scores must be whole numbers between -${number(SCORE_LIMITS.maxAbsDelta)} and ${number(SCORE_LIMITS.maxAbsDelta)} per change (got ${error.value}).`,
      });
    case "scoreOutOfRange":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `That change would put a score outside ±${number(SCORE_LIMITS.maxAbsScore)}.`,
      });
    case "nothingToUndo":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "No past states to undo",
      });
    case "nothingToRedo":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "No past states to redo",
      });
    case "historyCorrupt":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Score history is inconsistent; the change was not applied.",
      });
  }
}
