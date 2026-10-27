/**
 * Roster versions for the live game-state stream (see src/utils/liveRoster.ts).
 *
 * Every viewer of a game in this process receives the same snapshot objects
 * from the shared feed, so the roster comparison is done once per snapshot,
 * not once per viewer: each snapshot gets a version (a new number only when
 * the roster changed) and the changes from the version before.
 *
 * A stream only ever holds the newest snapshot, so under load it skips
 * versions. A short history of change lists lets it catch up with the
 * changes it missed (chained once per snapshot, shared by every stream that
 * is equally far behind) instead of receiving the whole roster again.
 */
import type { PrivateGameState } from "@/types";
import { rosterDiff, type RosterUpdate } from "@/utils/liveRoster";

type Delta = Extract<RosterUpdate, { kind: "delta" }>;
type Player = PrivateGameState["gameUsers"][string];

type Described = { version: number };

type GameHistory = {
  snapshot: PrivateGameState;
  version: number;
  /** Change lists in order, each from the version before it. */
  deltas: Delta[];
};

/** Games tracked at once; the least recently used is forgotten beyond this. */
const MAX_GAMES = 500;
/** Change lists kept per game. A stream further behind gets the full roster. */
const MAX_HISTORY = 256;

/** One change list covering several in a row. */
export function chainDeltas(deltas: Delta[]): Delta {
  const upsert: Record<string, Player> = {};
  const removed = new Set<string>();
  for (const d of deltas) {
    for (const [id, player] of Object.entries(d.upsert)) {
      upsert[id] = player;
      removed.delete(id);
    }
    for (const id of d.remove) {
      delete upsert[id];
      removed.add(id);
    }
  }
  return {
    kind: "delta",
    from: deltas[0]!.from,
    version: deltas.at(-1)!.version,
    upsert,
    remove: [...removed],
  };
}

export class RosterTracker {
  /**
   * Versions come from one counter that only increases, so a game that was
   * forgotten and seen again never reuses a version an open stream holds.
   */
  private counter = 0;
  private readonly described = new WeakMap<PrivateGameState, Described>();
  private readonly games = new Map<string, GameHistory>();
  /** Catch-up change lists per snapshot, by the version they start from. */
  private readonly chained = new WeakMap<
    PrivateGameState,
    Map<number, Delta | null>
  >();

  describe(gameId: string, snapshot: PrivateGameState): Described {
    const known = this.described.get(snapshot);
    if (known) return known;
    const prev = this.games.get(gameId);
    let result: Described;
    const deltas = prev?.deltas ?? [];
    if (!prev) {
      result = { version: ++this.counter };
    } else {
      const diff = rosterDiff(prev.snapshot, snapshot);
      if (!diff) {
        result = { version: prev.version };
      } else {
        const version = ++this.counter;
        deltas.push({ kind: "delta", from: prev.version, version, ...diff });
        if (deltas.length > MAX_HISTORY) deltas.shift();
        result = { version };
      }
    }
    this.described.set(snapshot, result);
    this.games.delete(gameId);
    this.games.set(gameId, {
      snapshot,
      version: result.version,
      deltas,
    });
    if (this.games.size > MAX_GAMES) {
      this.games.delete(this.games.keys().next().value!);
    }
    return result;
  }

  /** The changes from `from` to this snapshot's version, if still known. */
  private catchUp(
    gameId: string,
    snapshot: PrivateGameState,
    from: number,
    version: number,
  ): Delta | null {
    let byFrom = this.chained.get(snapshot);
    if (!byFrom) {
      byFrom = new Map();
      this.chained.set(snapshot, byFrom);
    }
    if (byFrom.has(from)) return byFrom.get(from)!;
    const deltas = this.games.get(gameId)?.deltas ?? [];
    const start = deltas.findIndex((d) => d.from === from);
    const end = deltas.findIndex((d) => d.version === version);
    const run =
      start >= 0 && end >= start ? deltas.slice(start, end + 1) : null;
    // Only a gapless run of change lists can be chained.
    const ok = !!run?.every(
      (d, i) => i === 0 || d.from === run[i - 1]!.version,
    );
    const result = run && ok ? chainDeltas(run) : null;
    byFrom.set(from, result);
    return result;
  }

  /**
   * What one stream should send, given the roster version it last sent
   * (null before its first update).
   */
  updateFor(
    gameId: string,
    snapshot: PrivateGameState,
    sentVersion: number | null,
  ): RosterUpdate {
    const { version } = this.describe(gameId, snapshot);
    if (sentVersion === version) return { kind: "same", version };
    if (sentVersion !== null) {
      const delta = this.catchUp(gameId, snapshot, sentVersion, version);
      if (delta) return delta;
    }
    return {
      kind: "full",
      version,
      gameUsers: snapshot.gameUsers,
    };
  }
}

export const rosterTracker = new RosterTracker();
