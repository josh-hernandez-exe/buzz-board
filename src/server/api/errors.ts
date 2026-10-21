import { TRPCError } from "@trpc/server";

import {
  type BuzzError,
  type BuzzerControlError,
} from "@/server/buzzer/buzzerService";
import { type GameTransactionError } from "@/server/db/gameTransaction";
import { type GameServiceError } from "@/server/games/gameService";
import { type ScoreCommandError } from "@/server/scores/scoreService";
import { type StaffError } from "@/server/staff/staffService";
import { type RosterError } from "@/server/roster/rosterService";
import { type IdentityError } from "@/server/identity/identityService";
import { type ChatError } from "@/server/chat/chatService";
import { type ModeError } from "@/server/modes/rankedAnswersService";
import { type EngineError } from "@/utils/rankedAnswers/engine";
import { type GridModeError } from "@/server/modes/categoryGridService";
import { type GridError } from "@/utils/categoryGrid/engine";
import { nameErrorMessage } from "@/utils/displayName";
import { SCORE_LIMITS } from "@/server/scores/scoreMath";
import { helpHref } from "@/help/manifest";

export type ServiceError =
  | GameTransactionError
  | GameServiceError
  | BuzzError
  | BuzzerControlError
  | ScoreCommandError
  | StaffError
  | RosterError
  | IdentityError
  | ChatError
  | ModeError
  | GridModeError;

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
  renameLocked: helpHref(
    "teams-and-names",
    "how-do-i-change-my-name-or-my-teams-name",
  ),
  nameChanged: helpHref(
    "teams-and-names",
    "how-do-i-change-my-name-or-my-teams-name",
  ),
  buzzerOpen: helpHref("teams-and-names", "can-i-switch-teams"),
  teamSwitchingOff: helpHref("teams-and-names", "can-i-switch-teams"),
  hostAssignsTeams: helpHref("teams-and-names", "can-i-switch-teams"),
  playerLinked: helpHref(
    "join-and-resume",
    "i-lost-my-device-or-cleared-my-browser-can-i-get-my-player-back",
  ),
  accountHasOtherPlayer: helpHref(
    "join-and-resume",
    "can-i-save-my-player-to-an-account",
  ),
  teamRejected: helpHref("troubleshooting", "why-cant-i-buzz"),
  notOnTeam: helpHref("teams-and-names", "how-do-players-get-a-team"),
  invalidAmount: helpHref("scoreboards-and-display", "how-do-i-change-scores"),
  scoreOutOfRange: helpHref(
    "scoreboards-and-display",
    "how-do-i-change-scores",
  ),
  reopenExpired: helpHref("host-quickstart", "can-i-run-the-same-game-again"),
  cannotDeleteActiveGame: helpHref("host-quickstart", "how-do-i-delete-a-game"),
  inviteNotFound: helpHref(
    "helpers-and-roles",
    "why-does-my-invitation-say-it-cant-be-used",
  ),
  inviteUsed: helpHref(
    "helpers-and-roles",
    "why-does-my-invitation-say-it-cant-be-used",
  ),
  inviteRevoked: helpHref(
    "helpers-and-roles",
    "why-does-my-invitation-say-it-cant-be-used",
  ),
  inviteExpired: helpHref(
    "helpers-and-roles",
    "why-does-my-invitation-say-it-cant-be-used",
  ),
  cannotChangeOwner: helpHref("helpers-and-roles", "who-can-help-run-a-game"),
  chatDisabled: helpHref("chat", "why-cant-i-send-a-message"),
  chatClosed: helpHref("chat", "why-cant-i-send-a-message"),
  channelStaffOnly: helpHref("chat", "why-cant-i-send-a-message"),
  muted: helpHref("chat", "why-cant-i-send-a-message"),
  slowMode: helpHref("chat", "why-cant-i-send-a-message"),
  chatTooFast: helpHref("chat", "why-cant-i-send-a-message"),
  chatBusy: helpHref("chat", "why-cant-i-send-a-message"),
  chatUnavailable: helpHref("chat", "why-cant-i-send-a-message"),
  invalidMessage: helpHref("chat", "why-cant-i-send-a-message"),
  cannotMute: helpHref("chat", "how-do-i-moderate-chat"),
  preflightBlocked: helpHref("ranked-answers", "how-do-i-set-up-boards"),
  stepConflict: helpHref("ranked-answers", "running-a-board"),
  queueEntryNotFound: helpHref("buzzing", "how-does-the-queue-work"),
  queueEntryNotActive: helpHref("buzzing", "how-does-the-queue-work"),
  buzzerOpenModeChange: helpHref(
    "buzzing",
    "can-i-change-the-buzzing-mode-during-a-game",
  ),
  nothingToUndoBuzzer: helpHref("buzzing", "how-do-undo-and-redo-work"),
  nothingToRedoBuzzer: helpHref("buzzing", "how-do-undo-and-redo-work"),
  gridRule: helpHref("category-grid", "running-the-grid"),
  otherMode: helpHref("category-grid", "how-do-i-go-back-to-the-buzzer"),
};

/** "about 3 more minutes", from server time, so device clocks don't matter. */
function mutedFor(until: Date) {
  const minutes = Math.max(
    1,
    Math.ceil((until.getTime() - Date.now()) / 60_000),
  );
  return minutes === 1
    ? "about 1 more minute"
    : `about ${minutes} more minutes`;
}

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
          error.field === "game"
            ? "Game name"
            : error.field === "team"
              ? "Team name"
              : "Nickname",
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
          "This game is still in play or has players. Confirm that you want to end it for everyone, then delete it.",
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
    case "inviteNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "This invitation link isn't valid. Ask for a new one.",
      });
    case "inviteUsed":
      return new TRPCError({
        code: "CONFLICT",
        message:
          "This invitation has already been used. Ask the host for a new link.",
      });
    case "inviteRevoked":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This invitation was cancelled. Ask the host for a new link.",
      });
    case "inviteExpired":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This invitation has expired. Ask the host for a new link.",
      });
    case "cannotChangeOwner":
      return new TRPCError({
        code: "FORBIDDEN",
        message: "The game's owner can't be changed or removed.",
      });
    case "staffNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "That helper is no longer part of this game.",
      });
    case "playerNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "That player is no longer in this game.",
      });
    case "teamNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "That team is no longer in this game.",
      });
    case "renameLocked":
      return new TRPCError({
        code: "FORBIDDEN",
        message:
          error.target === "player"
            ? "Your host has locked name changes for you. Ask them if it needs changing."
            : "Your host has locked this team's name. Ask them if it needs changing.",
      });
    case "nameChanged":
      return new TRPCError({
        code: "CONFLICT",
        message:
          "This name was changed by someone else while you were editing. Your text is kept; check it and save again.",
      });
    case "notTeamMember":
      return new TRPCError({
        code: "FORBIDDEN",
        message: "Only players on this team can rename it.",
      });
    case "buzzerOpen":
      return new TRPCError({
        code: "CONFLICT",
        message:
          "Players can't change teams while the buzzer is open. Pause it first, then try again.",
      });
    case "teamSwitchingOff":
      return new TRPCError({
        code: "FORBIDDEN",
        message: "Team switching is currently disabled",
      });
    case "hostAssignsTeams":
      return new TRPCError({
        code: "FORBIDDEN",
        message: "Your host assigns teams in this game.",
      });
    case "playerLinked":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This player is saved to an account. They can get back in by signing in to that account.",
      });
    case "linkedToOtherAccount":
      return new TRPCError({
        code: "CONFLICT",
        message: "This player is already saved to a different account.",
      });
    case "accountHasOtherPlayer":
      return new TRPCError({
        code: "CONFLICT",
        message: `Your account already has a player in this game (${error.playerName}). Join as that player instead, or keep playing as a guest.`,
      });
    case "chatDisabled":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Chat is turned off for this game.",
      });
    case "chatClosed":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This game has finished, so chat is read-only.",
      });
    case "channelNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "You can't see that chat.",
      });
    case "channelStaffOnly":
      return new TRPCError({
        code: "FORBIDDEN",
        message: "Only organizers can post here right now.",
      });
    case "muted":
      return new TRPCError({
        code: "FORBIDDEN",
        message: error.until
          ? `You're muted in chat for ${mutedFor(error.until)}. You can still play.`
          : "You're muted in chat until an organizer unmutes you. You can still play.",
      });
    case "slowMode":
      return new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Slow mode is on. Wait ${error.retryAfterSeconds} seconds before your next message.`,
      });
    case "chatTooFast":
      return new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `You're sending messages too quickly. Wait ${error.retryAfterSeconds} seconds.`,
      });
    case "chatBusy":
      return new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Chat is very busy right now. Try again in a moment.",
      });
    case "chatUnavailable":
      return new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message:
          "Chat is temporarily unavailable. Your message wasn't sent; the game itself still works.",
      });
    case "invalidMessage":
      return new TRPCError({
        code: "BAD_REQUEST",
        message:
          error.error.kind === "empty"
            ? "Type a message first."
            : error.error.kind === "tooLong"
              ? `Messages can be up to ${number(error.error.maxBytes)} bytes (fewer characters if you use emoji or accents).`
              : "Messages can't contain hidden control characters.",
      });
    case "messageNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "That message is no longer available.",
      });
    case "muteTargetNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "That person is no longer in this game.",
      });
    case "cannotMute":
      return new TRPCError({
        code: "FORBIDDEN",
        message: "Your role can't mute that person.",
      });
    case "historyCorrupt":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Score history is inconsistent; the change was not applied.",
      });
    case "invalidContent":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `The boards couldn't be saved: ${error.issues.join("; ")}`,
      });
    case "draftConflict":
      return new TRPCError({
        code: "CONFLICT",
        message:
          "Someone else saved these boards while you were editing. Your changes are still here: copy them (Export), reload, and apply them again.",
      });
    case "otherMode":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `This game is set up for ${error.mode === "categoryGrid" ? "Category Grid" : "Ranked Answers"}. Discard that setup first to use this game mode instead.`,
      });
    case "modeAlreadyStarted":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This game mode has already started, so its boards can't be changed.",
      });
    case "modeNotRunning":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The game mode isn't running.",
      });
    case "preflightBlocked":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Fix these before starting: ${error.problems.join(" ")}`,
      });
    case "stepConflict":
      return new TRPCError({
        code: "CONFLICT",
        message:
          "Another host changed the board first. Your screen has been updated; check it and try again.",
      });
    case "modeRule":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: engineMessage(error.error),
      });
    case "gridRule":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: gridMessage(error.error),
      });
    case "queueEntryNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "That buzz isn't in the current question's queue any more.",
      });
    case "queueEntryNotActive":
      return new TRPCError({
        code: "CONFLICT",
        message:
          "That team isn't answering right now. The queue has been updated; check it and try again.",
      });
    case "buzzerOpenModeChange":
      return new TRPCError({
        code: "CONFLICT",
        message: "Close the buzzer before switching how buzzing works.",
      });
    case "nothingToUndoBuzzer":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "There's no buzzer action to undo.",
      });
    case "nothingToRedoBuzzer":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "There's no buzzer action to redo.",
      });
    case "nothingToUndoInMode":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "There's nothing to undo.",
      });
  }
}

function gridMessage(error: GridError): string {
  switch (error.kind) {
    case "gridWrongPhase":
      return error.phase === "board"
        ? "Open a clue first."
        : error.phase === "finished"
          ? "The grid is finished."
          : "Finish the current clue first.";
    case "unknownCell":
      return "That tile isn't on the grid.";
    case "cellUsed":
      return "That clue has already been played.";
    case "unknownTeam":
      return "That team isn't in this game.";
    case "teamLockedOut":
      return "That team already answered this clue wrongly.";
  }
}

function engineMessage(error: EngineError): string {
  switch (error.kind) {
    case "wrongPhase":
      return "That can't be done at this point in the board.";
    case "unknownBoard":
      return "That board doesn't exist.";
    case "boardAlreadyPlayed":
      return "That board has already been played.";
    case "unknownAnswer":
      return "That isn't one of this board's answers.";
    case "unknownTeam":
      return "That team can't answer right now.";
    case "teamLockedOut":
      return "That team is sitting out until another answer is found.";
    case "answerShown":
      return "That answer is already on the board.";
    case "badTeams":
      return "Choose at least two different teams from this game.";
  }
}
