/**
 * The player list ("roster") on the live game-state stream.
 *
 * Most changes during play (buzzer, scores, queue, game mode) don't touch the
 * roster, but it's the biggest part of the state and grows with every player.
 * Sending it whole in every update made each update cost O(players) for each
 * of O(players) viewers. So each stream sends it in full once, then only the
 * players that changed, or nothing when nothing did. Team member lists are
 * never sent: they follow from each player's team (docs/load-scaling.md).
 *
 * Pure and browser-safe: the server builds updates, the page and the load
 * runner apply them.
 */
import type { PrivateGameState } from "@/types";

type Player = PrivateGameState["gameUsers"][string];
type Team = PrivateGameState["gameTeams"][number];

export type RosterUpdate =
  | { kind: "full"; version: number; gameUsers: Record<string, Player> }
  | {
      kind: "delta";
      /** The version this applies to; the result is `version`. */
      from: number;
      version: number;
      upsert: Record<string, Player>;
      remove: string[];
    }
  | { kind: "same"; version: number };

/** What the stream sends: the state without the roster, plus the roster update. */
export type PrivateGameStateUpdate = Omit<
  PrivateGameState,
  "gameUsers" | "gameTeams"
> & {
  gameTeams: Omit<Team, "gameUsers">[];
  roster: RosterUpdate;
};

export type LiveRoster = { state: PrivateGameState; version: number };

/** Each team's members, by player number: the same order the server uses. */
export function teamMembers(
  gameUsers: Record<string, Player>,
): Record<string, string[]> {
  const members: Record<string, string[]> = {};
  const players = Object.values(gameUsers).sort(
    (a, b) => a.index - b.index || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const player of players) {
    if (player.gameTeamId) (members[player.gameTeamId] ??= []).push(player.id);
  }
  return members;
}

const samePlayer = (a: Player, b: Player) =>
  a.id === b.id &&
  a.name === b.name &&
  a.index === b.index &&
  a.gameTeamId === b.gameTeamId &&
  a.allowSelfRename === b.allowSelfRename &&
  a.nameVersion === b.nameVersion &&
  a.image === b.image;

/** The players that changed from one roster to the next, or null if none. */
export function rosterDiff(
  prev: PrivateGameState,
  next: PrivateGameState,
): { upsert: Record<string, Player>; remove: string[] } | null {
  const upsert: Record<string, Player> = {};
  for (const [id, player] of Object.entries(next.gameUsers)) {
    const before = prev.gameUsers[id];
    if (!before || !samePlayer(before, player)) upsert[id] = player;
  }
  const remove = Object.keys(prev.gameUsers).filter(
    (id) => !(id in next.gameUsers),
  );
  return Object.keys(upsert).length > 0 || remove.length > 0
    ? { upsert, remove }
    : null;
}

/** The state with its roster left out, for the stream. */
export function withoutRoster(
  state: PrivateGameState,
  roster: RosterUpdate,
): PrivateGameStateUpdate {
  const { gameUsers: _players, gameTeams, ...rest } = state;
  return {
    ...rest,
    gameTeams: gameTeams.map(({ gameUsers: _members, ...team }) => team),
    roster,
  };
}

/**
 * The full state after an update, or null if the update can't be applied
 * (changes for a version this client doesn't have: reconnect to get the
 * full roster again). `teams: false` skips rebuilding team member lists, for
 * callers that only need the players (the load runner's bots).
 */
export function applyRosterUpdate(
  prev: LiveRoster | null,
  update: PrivateGameStateUpdate,
  { teams = true }: { teams?: boolean } = {},
): LiveRoster | null {
  const { roster, gameTeams, ...rest } = update;
  let gameUsers: Record<string, Player>;
  if (roster.kind === "full") {
    gameUsers = roster.gameUsers;
  } else {
    if (!prev) return null;
    const from = roster.kind === "delta" ? roster.from : roster.version;
    if (prev.version !== from) return null;
    if (roster.kind === "same") {
      gameUsers = prev.state.gameUsers;
    } else {
      gameUsers = { ...prev.state.gameUsers, ...roster.upsert };
      for (const id of roster.remove) delete gameUsers[id];
    }
  }
  // Unchanged roster: reuse the member lists already built.
  const members = !teams
    ? null
    : roster.kind === "same" && prev
      ? Object.fromEntries(prev.state.gameTeams.map((t) => [t.id, t.gameUsers]))
      : teamMembers(gameUsers);
  return {
    version: roster.version,
    state: {
      ...rest,
      gameUsers,
      gameTeams: gameTeams.map((team) => ({
        ...team,
        gameUsers: members?.[team.id] ?? [],
      })),
    },
  };
}
