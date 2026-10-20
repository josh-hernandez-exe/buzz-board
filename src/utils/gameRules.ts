/**
 * Public game rules and labels. These are the single source for the server,
 * the UI and the Help center's fact panels, so a limit is never restated in
 * prose. Keep this module free of database, auth and server-only imports:
 * public Help pages render it without a game or a database.
 */
import { SCORE_LIMITS } from "@/server/scores/scoreMath";
import { NAME_LIMITS } from "@/utils/displayName";

export { NAME_LIMITS, SCORE_LIMITS };

export const GAME_LIMITS = {
  minTeams: 1,
  maxTeams: 8,
  defaultTeams: 2,
  /** How long after finishing a game can be reopened to correct results. */
  reopenWindowMs: 24 * 60 * 60 * 1000,
  joinCodeLength: 6,
} as const;

export const REOPEN_WINDOW_HOURS =
  GAME_LIMITS.reopenWindowMs / (60 * 60 * 1000);

export type GameStatusValue = "lobby" | "running" | "finished";
export type TeamAssignmentValue = "auto" | "choose" | "staff";

export const STATUS_LABEL: Record<GameStatusValue, string> = {
  lobby: "Lobby: not started",
  running: "Live",
  finished: "Finished",
};

export const ASSIGNMENT_LABEL: Record<TeamAssignmentValue, string> = {
  auto: "Automatic: fewest players first",
  choose: "Players choose their team",
  staff: "Host assigns teams",
};

export const ASSIGNMENT_DESCRIPTION: Record<TeamAssignmentValue, string> = {
  auto: "Each new player is placed on the team with the fewest players. Returning players keep their team.",
  choose: "Players pick a team themselves after joining.",
  staff: "New players wait without a team until a host moves them.",
};
