import { describe, expect, it } from "vitest";

import { chainDeltas, RosterTracker } from "@/server/live/rosterTracker";
import type { PrivateGameState } from "@/types";
import {
  applyRosterUpdate,
  rosterDiff,
  withoutRoster,
  type LiveRoster,
} from "@/utils/liveRoster";

/** A seeded random number generator, for repeatable runs. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function state(
  players: { id: string; name: string; team: string | null }[],
  teams = ["t1", "t2", "t3"],
  listening = false,
): PrivateGameState {
  return {
    game: {
      id: "g",
      name: "Game",
      code: "ABC123",
      format: "team",
      isBuzzerListening: listening,
      buzzerMode: "first",
      settings: {},
      status: "running",
      finishedAt: null,
      joiningOpen: true,
      teamAssignment: "auto",
      chatEnabled: false,
      captainsOnly: false,
    },
    gameTeams: teams.map((id, i) => ({
      id,
      name: `Team ${i + 1}`,
      index: i + 1,
      buzzerState: "available",
      allowMemberRename: true,
      nameVersion: 0,
      captainId: null,
      gameUsers: players.filter((p) => p.team === id).map((p) => p.id),
      score: 0,
    })),
    gameUsers: Object.fromEntries(
      players.map((p, i) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          index: i + 1,
          gameTeamId: p.team,
          allowSelfRename: true,
          nameVersion: 0,
          image: undefined,
        },
      ]),
    ),
    buzzWinner: null,
    buzzQueue: [],
    mode: null,
  };
}

describe("live roster", () => {
  it("sends the roster once, then only changes or nothing", () => {
    const tracker = new RosterTracker();
    const a = state([{ id: "p1", name: "Ana", team: "t1" }]);
    const first = tracker.updateFor("g", a, null);
    expect(first.kind).toBe("full");

    // A buzzer change: the roster isn't resent.
    const b = state([{ id: "p1", name: "Ana", team: "t1" }], undefined, true);
    expect(tracker.updateFor("g", b, first.version)).toEqual({
      kind: "same",
      version: first.version,
    });

    // A join: only the new player (team lists follow from players' teams).
    const c = state(
      [
        { id: "p1", name: "Ana", team: "t1" },
        { id: "p2", name: "Ben", team: "t2" },
      ],
      undefined,
      true,
    );
    const delta = tracker.updateFor("g", c, first.version);
    expect(delta).toMatchObject({
      kind: "delta",
      from: first.version,
      remove: [],
    });
    expect(Object.keys((delta as { upsert: object }).upsert)).toEqual(["p2"]);

    // A stream that missed the change, or a new one, gets the full roster.
    expect(tracker.updateFor("g", c, null).kind).toBe("full");
    expect(tracker.updateFor("g", c, 12345).kind).toBe("full");

    const wire = withoutRoster(c, delta);
    expect(wire).not.toHaveProperty("gameUsers");
    expect(wire.gameTeams[0]).not.toHaveProperty("gameUsers");
  });

  it("a stream that missed versions catches up with the changes, not the whole list", () => {
    const tracker = new RosterTracker();
    const p = (id: string, name: string, team: string) => ({ id, name, team });
    const a = state([p("p1", "Ana", "t1")]);
    const sent = tracker.updateFor("g", a, null).version;
    // Three changes this stream never saw (another stream did).
    const b = state([p("p1", "Ana", "t1"), p("p2", "Ben", "t2")]);
    tracker.updateFor("g", b, null);
    const c = state([p("p1", "Ana", "t3"), p("p2", "Ben", "t2")]);
    tracker.updateFor("g", c, null);
    const d = state([p("p1", "Ana", "t3")]);
    const update = tracker.updateFor("g", d, sent);
    expect(update).toMatchObject({
      kind: "delta",
      from: sent,
      remove: ["p2"],
    });
    // p2 joined then left: not sent as a player at all.
    expect(Object.keys((update as { upsert: object }).upsert)).toEqual(["p1"]);
    const live = applyRosterUpdate(
      { state: a, version: sent },
      withoutRoster(d, update),
    );
    expect(live!.state.gameUsers).toEqual(d.gameUsers);
    expect(live!.state.gameTeams).toEqual(d.gameTeams);
  });

  it("chains change lists: a player removed and added again ends up present", () => {
    const player = state([{ id: "p1", name: "Ana", team: "t1" }]).gameUsers.p1!;
    const chained = chainDeltas([
      {
        kind: "delta",
        from: 1,
        version: 2,
        upsert: {},
        remove: ["p1"],
      },
      {
        kind: "delta",
        from: 2,
        version: 3,
        upsert: { p1: player },
        remove: [],
      },
    ]);
    expect(chained).toEqual({
      kind: "delta",
      from: 1,
      version: 3,
      upsert: { p1: player },
      remove: [],
    });
  });

  it("refuses changes for a roster the client doesn't have", () => {
    const a = state([{ id: "p1", name: "Ana", team: "t1" }]);
    const update = withoutRoster(a, { kind: "same", version: 7 });
    expect(applyRosterUpdate(null, update)).toBeNull();
    const held: LiveRoster = { state: a, version: 6 };
    expect(applyRosterUpdate(held, update)).toBeNull();
  });

  it("finds no changes when nothing changed", () => {
    const players = [{ id: "p1", name: "Ana", team: "t1" }];
    expect(rosterDiff(state(players), state(players, undefined, true))).toBe(
      null,
    );
  });

  it("every stream always ends up with exactly the server's roster", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rng(seed);
      const tracker = new RosterTracker();
      let players: { id: string; name: string; team: string | null }[] = [];
      let nextId = 1;
      const teams = ["t1", "t2", "t3"];
      // Several streams; each may skip snapshots (slow) or reconnect.
      const streams = Array.from({ length: 4 }, () => ({
        sent: null as number | null,
        client: null as LiveRoster | null,
      }));
      for (let step = 0; step < 80; step++) {
        const r = random();
        if (r < 0.3 || players.length === 0) {
          players = [
            ...players,
            {
              id: `p${nextId++}`,
              name: "New",
              team: teams[Math.floor(random() * 3)]!,
            },
          ];
        } else if (r < 0.45) {
          const i = Math.floor(random() * players.length);
          players = players.filter((_p, j) => j !== i);
        } else if (r < 0.6) {
          const i = Math.floor(random() * players.length);
          players = players.map((p, j) =>
            j === i ? { ...p, team: teams[Math.floor(random() * 3)]! } : p,
          );
        } else if (r < 0.7) {
          const i = Math.floor(random() * players.length);
          players = players.map((p, j) =>
            j === i ? { ...p, name: `Renamed ${step}` } : p,
          );
        }
        // Otherwise a non-roster change (buzzer).
        const snapshot = state(players, teams, random() < 0.5);
        for (const stream of streams) {
          const roll = random();
          if (roll < 0.2) continue; // slow: skips this snapshot
          if (roll < 0.25) {
            // reconnect: a new stream
            stream.sent = null;
          }
          const lagging = stream.sent !== null;
          const update = tracker.updateFor("g", snapshot, stream.sent);
          // Behind, but connected: catches up with changes, never the whole list.
          if (lagging) expect(update.kind).not.toBe("full");
          stream.sent = update.version;
          const next = applyRosterUpdate(
            stream.client,
            withoutRoster(snapshot, update),
          );
          expect(next, `seed ${seed} step ${step}`).not.toBeNull();
          stream.client = next;
          expect(next!.state.gameUsers).toEqual(snapshot.gameUsers);
          expect(next!.state.gameTeams).toEqual(snapshot.gameTeams);
          expect(next!.state.game).toEqual(snapshot.game);
        }
      }
    }
  }, 30_000);
});
