/**
 * Game Kit conformance (W22): a tiny synthetic mode, "Quiz Maze", defined
 * only here, runs through the shared runner against the real database with
 * no app changes. If a new mode needs a change outside its own module,
 * this test is where that shows up.
 */
import { randomUUID } from "node:crypto";

import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import {
  actInModeSession,
  discardModeDraft,
  handOffToBasic,
  modeHostData,
  saveModeDraft,
  startModeSession,
  undoInModeSession,
  type ModeModule,
} from "@/server/modes/gameKit";
import { MAX_DRAFT_BYTES, type ModeKind } from "@/utils/modes";

import { createGame, currentScores, db } from "../support/integration";

type Maze = { rooms: { id: string; points: number }[] };
type MazeState = { teams: string[]; visited: string[]; spent: string[] };
type MazeAction = { type: "enter"; room: string; team: string };
type MazeError = { kind: "wrongRoom" } | { kind: "visited" };

const maze: ModeModule<Maze, MazeState, MazeAction, MazeError> = {
  kind: "quizMaze" as ModeKind,
  parseDraft: (raw) => {
    const r = raw as Partial<Maze> | null;
    return Array.isArray(r?.rooms)
      ? ok({ rooms: r.rooms })
      : err(["rooms: required"]);
  },
  emptyDraft: () => ({ rooms: [] }),
  preflight: (c) => ({
    blocking: c.rooms.length === 0 ? ["Add a room."] : [],
    warnings: [],
  }),
  initialState: (teams) => ({ teams, visited: [], spent: [] }),
  withTeams: (s, _a, teams) => ({ ...s, teams }),
  apply: (c, s, a) => {
    const room = c.rooms.find((r) => r.id === a.room);
    if (!room || !s.teams.includes(a.team)) return err({ kind: "wrongRoom" });
    if (s.spent.includes(a.room)) return err({ kind: "visited" });
    return ok({
      state: {
        ...s,
        visited: [...s.visited, a.room],
        spent: [...s.spent, a.room],
      },
      scores: { [a.team]: room.points },
    });
  },
  // A visited room stays spent across undo, like every real mode.
  undo: (cur, prev) => ({
    ...prev,
    spent: [...new Set([...prev.spent, ...cur.spent])],
  }),
  // Rule errors surface through an existing variant; a real mode adds its own.
  ruleError: () => ({ kind: "gridRule", error: { kind: "cellUsed" } }),
};

const rid = () => randomUUID().replaceAll("-", "");

describe("Game Kit runner with a synthetic mode", () => {
  it("drafts, starts, acts once per request, refuses stale screens, undoes honestly and hands off", async () => {
    const { game, gameTeams, admin } = await createGame({ teams: 2 });
    const [a, b] = gameTeams.map((t) => t.id);
    const gameId = game.id;

    // Draft: preflight blocks an empty maze; conflicts are refused.
    await saveModeDraft(maze, {
      gameId,
      draft: { rooms: [] },
      expectedRevision: 0,
    });
    expect((await startModeSession(maze, gameId))._unsafeUnwrapErr().kind).toBe(
      "preflightBlocked",
    );
    const draft = {
      rooms: [
        { id: "hall", points: 7 },
        { id: "attic", points: 3 },
      ],
    };
    expect(
      (
        await saveModeDraft(maze, { gameId, draft, expectedRevision: 0 })
      )._unsafeUnwrapErr(),
    ).toMatchObject({ kind: "draftConflict", draftRevision: 1 });
    await saveModeDraft(maze, { gameId, draft, expectedRevision: 1 });

    // Start: the lobby game goes live.
    await startModeSession(maze, gameId);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: gameId } })).status,
    ).toBe("running");

    // Act: points land on the shared scoreboard; a retry is a no-op.
    const request = {
      gameId,
      actorUserId: game.createdById,
      action: { type: "enter" as const, room: "hall", team: a! },
      expectedStep: 1,
      requestId: rid(),
    };
    expect((await actInModeSession(maze, request))._unsafeUnwrap()).toEqual({
      step: 2,
      replayed: false,
    });
    expect(
      (await actInModeSession(maze, request))._unsafeUnwrap().replayed,
    ).toBe(true);
    expect((await currentScores(gameId))[a!]).toBe(7);

    // A stale screen is refused; a rule refusal changes nothing.
    expect(
      (
        await actInModeSession(maze, { ...request, requestId: rid() })
      )._unsafeUnwrapErr().kind,
    ).toBe("stepConflict");
    expect(
      (
        await actInModeSession(maze, {
          ...request,
          expectedStep: 2,
          requestId: rid(),
          action: { type: "enter" as const, room: "hall", team: b! },
        })
      ).isErr(),
    ).toBe(true);

    // Undo returns exactly the points; the room stays spent.
    await undoInModeSession(maze, {
      gameId,
      actorUserId: game.createdById,
      expectedStep: 2,
      requestId: rid(),
    });
    expect((await currentScores(gameId))[a!]).toBe(0);
    const data = await modeHostData(maze, gameId);
    expect(data.state?.spent).toEqual(["hall"]);
    expect(data.state?.visited).toEqual([]);

    // Another mode's draft can't be saved over it; discard only touches drafts.
    expect(
      await admin.rankedAnswers
        .saveDraft({
          draft: { rules: {}, boards: [] },
          expectedRevision: 0,
        })
        .catch((e: unknown) => e),
    ).toBeInstanceOf(Error);
    expect(
      (await discardModeDraft("quizMaze" as ModeKind, gameId))._unsafeUnwrap(),
    ).toEqual({
      changed: false,
    });

    // Handoff ends it for good and closes the buzzer.
    await admin.gameAdmin.startBuzzer();
    expect((await handOffToBasic(gameId, null))._unsafeUnwrap()).toEqual({
      changed: true,
    });
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: gameId } }))
        .isBuzzerListening,
    ).toBe(false);
    expect(
      (
        await actInModeSession(maze, {
          ...request,
          expectedStep: 3,
          requestId: rid(),
          action: { type: "enter" as const, room: "attic", team: b! },
        })
      )._unsafeUnwrapErr().kind,
    ).toBe("modeNotRunning");
  });

  it("refuses a draft over 1 MiB and keeps the saved one", async () => {
    const { game } = await createGame({ teams: 3 });
    const gameId = game.id;
    const room = (i: number, size: number) => ({
      id: `${i}-${"é".repeat(size)}`,
      points: 1,
    });
    // Just under the limit counting UTF-8 bytes ("é" is 2 bytes).
    const fits = { rooms: [room(0, 200_000), room(1, 300_000)] };
    expect(Buffer.byteLength(JSON.stringify(fits))).toBeLessThan(
      MAX_DRAFT_BYTES,
    );
    expect(
      (
        await saveModeDraft(maze, { gameId, draft: fits, expectedRevision: 0 })
      ).isOk(),
    ).toBe(true);

    const tooBig = { rooms: [room(0, 200_000), room(1, 330_000)] };
    expect(JSON.stringify(tooBig).length).toBeLessThan(MAX_DRAFT_BYTES);
    const refused = await saveModeDraft(maze, {
      gameId,
      draft: tooBig,
      expectedRevision: 1,
    });
    expect(refused._unsafeUnwrapErr()).toMatchObject({
      kind: "invalidContent",
      issues: [expect.stringContaining("the most is 1,024 KB")],
    });
    const saved = await db.gameMode.findUniqueOrThrow({ where: { gameId } });
    expect(saved.draftRevision).toBe(1);
  });
});
