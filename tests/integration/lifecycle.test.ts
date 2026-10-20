/**
 * PR05: quick create, guest join/resume, team policy, and the basic game
 * lifecycle (W01, W05, W06, W17; T03, T06, T11).
 */
import { describe, expect, it } from "vitest";

import {
  callerFor,
  createGame,
  createUser,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

const rid = (label: string) =>
  `${label}-${Date.now()}-${Math.random()}`.replace(/[^A-Za-z0-9_-]/g, "");

async function freshHostGame(
  input: Partial<{
    name: string;
    format: "team" | "individual";
    teamCount: number;
    requestId: string;
  }> = {},
) {
  const host = await createUser();
  const caller = await callerFor({ user: host });
  const game = await caller.user.game.create({
    name: "Quiz night",
    format: "team",
    ...input,
  });
  return { host, game, admin: requestCaller({ gameId: game.id, user: host }) };
}

describe("create a game", () => {
  it("creates a lobby with two teams and automatic assignment by default", async () => {
    const { game } = await freshHostGame();

    expect(game).toMatchObject({
      status: "lobby",
      teamAssignment: "auto",
      joiningOpen: true,
    });
    const teams = await db.gameTeam.findMany({
      where: { gameId: game.id },
      orderBy: { index: "asc" },
    });
    expect(teams.map((t) => [t.index, t.name])).toEqual([
      [1, "Team 1"],
      [2, "Team 2"],
    ]);
  });

  it("creates the requested number of teams, and none for individual games", async () => {
    const six = await freshHostGame({ teamCount: 6 });
    const solo = await freshHostGame({ format: "individual", teamCount: 6 });

    expect(await db.gameTeam.count({ where: { gameId: six.game.id } })).toBe(6);
    expect(await db.gameTeam.count({ where: { gameId: solo.game.id } })).toBe(
      0,
    );
  });

  it.each([0, 9, 2.5])("rejects %s teams", async (teamCount) => {
    await expect(freshHostGame({ teamCount })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("normalizes the name and rejects a blank one", async () => {
    const { game } = await freshHostGame({ name: "  Pride Trivia  " });
    expect(game.name).toBe("Pride Trivia");

    await expect(freshHostGame({ name: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Game name can't be empty.",
    });
  });

  it("returns the same game for a retried request, even concurrently", async () => {
    const host = await createUser();
    const caller = await callerFor({ user: host });
    const requestId = rid("create");

    const games = await Promise.all(
      Array.from({ length: 5 }, () =>
        caller.user.game.create({
          name: "Once only",
          format: "team",
          teamCount: 3,
          requestId,
        }),
      ),
    );

    expect(new Set(games.map((g) => g.id)).size).toBe(1);
    expect(await db.game.count({ where: { createdById: host.id } })).toBe(1);
    expect(await db.gameTeam.count({ where: { gameId: games[0]!.id } })).toBe(
      3,
    );
  });

  it("does not share request IDs between hosts", async () => {
    const requestId = rid("shared");
    const a = await freshHostGame({ requestId });
    const b = await freshHostGame({ requestId });

    expect(a.game.id).not.toBe(b.game.id);
  });
});

describe("join and resume", () => {
  it("uses the chosen nickname, normalized", async () => {
    const { game } = await createGame();

    const { gameUser } = await joinAsGuest(game.code, "  Ada  ");

    expect(gameUser.name).toBe("Ada");
  });

  it("never publishes a signed-in player's account name", async () => {
    const { game } = await createGame();
    const account = await createUser("Real Account Name");

    const joined = await requestCaller({ user: account }).public.joinGame({
      gameCode: game.code,
    });

    expect(joined.gameUser.name).toBe("Player 1");
  });

  it("rejects an invalid nickname with a reason", async () => {
    const { game } = await createGame();

    await expect(joinAsGuest(game.code, "a".repeat(41))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Nickname can be at most 40 characters.",
    });
    await expect(joinAsGuest(game.code, "bad\u202ename")).rejects.toMatchObject(
      {
        code: "BAD_REQUEST",
      },
    );
  });

  it("resumes the same player and ignores a new nickname", async () => {
    const { game } = await createGame();
    const first = await joinAsGuest(game.code, "Ada");

    const again = await requestCaller({}).public.joinGame({
      gameCode: game.code,
      token: first.token,
      nickname: "Someone Else",
    });

    expect(again).toMatchObject({ resumed: true });
    expect(again.gameUser).toMatchObject({
      id: first.gameUser.id,
      name: "Ada",
    });
  });

  it("previews who a stored credential would resume as", async () => {
    const { game, gameTeams } = await createGame();
    const guest = await joinAsGuest(game.code, "Ada");
    await guest.player.gameUser.changeTeams({ gameTeamId: gameTeams[1]!.id });
    const other = await createGame();

    const preview = requestCaller({}).public.resumePreview;
    await expect(
      preview({ gameCode: game.code.toLowerCase(), token: guest.token }),
    ).resolves.toEqual({
      gameName: "Characterization Game",
      nickname: "Ada",
      teamName: "Team 2",
    });
    await expect(
      preview({ gameCode: other.game.code, token: guest.token }),
    ).resolves.toBeNull();
    await expect(
      preview({ gameCode: game.code, token: "not-a-token" }),
    ).resolves.toBeNull();
  });

  it("explains an unknown code", async () => {
    await expect(
      requestCaller({}).public.joinGame({ gameCode: "ZZZZZ9" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "No game has that code. Check it with your host.",
    });
  });
});

describe("team assignment", () => {
  it("balances concurrent joins across teams with distinct player numbers", async () => {
    const { game } = await createGame({ teams: 3, teamAssignment: "auto" });

    const joined = await Promise.all(
      Array.from({ length: 13 }, () => joinAsGuest(game.code)),
    );

    const counts = await db.gameTeam.findMany({
      where: { gameId: game.id },
      select: { _count: { select: { gameUsers: true } } },
    });
    const sizes = counts.map((t) => t._count.gameUsers);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(13);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(joined.map((j) => j.gameUser.index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 13 }, (_, i) => i + 1),
    );
  });

  it("does not rebalance a returning player", async () => {
    const { game, admin, gameTeams } = await createGame({
      teams: 2,
      teamAssignment: "auto",
    });
    const first = await joinAsGuest(game.code);
    await admin.gameAdmin.movePlayerToTeam({
      gameUserId: first.gameUser.id,
      targetGameTeamId: gameTeams[1]!.id,
    });
    await joinAsGuest(game.code);
    await joinAsGuest(game.code);

    const resumed = await requestCaller({}).public.joinGame({
      gameCode: game.code,
      token: first.token,
    });

    expect(resumed.gameUser.gameTeamId).toBe(gameTeams[1]!.id);
  });

  it("leaves players unassigned and blocks self-switching when staff assign teams", async () => {
    const { game, gameTeams } = await createGame({ teamAssignment: "staff" });

    const guest = await joinAsGuest(game.code);

    expect(guest.gameUser.gameTeamId).toBeNull();
    await expect(
      guest.player.gameUser.changeTeams({ gameTeamId: gameTeams[0]!.id }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Your host assigns teams in this game.",
    });
  });

  it("names an individual player's backing team after their nickname", async () => {
    const { game } = await createGame({ format: "individual" });

    const guest = await joinAsGuest(game.code, "Solo Star");

    const team = await db.gameTeam.findUniqueOrThrow({
      where: { id: guest.gameUser.gameTeamId! },
    });
    expect(team.name).toBe("Solo Star");
  });
});

describe("joining closed", () => {
  it("blocks new players with a clear message but lets existing players resume", async () => {
    const { game, admin } = await createGame();
    const existing = await joinAsGuest(game.code);

    await admin.gameAdmin.setJoiningOpen({ open: false });

    await expect(joinAsGuest(game.code)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Joining is closed for this game. Ask your host to open it.",
    });
    await expect(
      requestCaller({}).public.joinGame({
        gameCode: game.code,
        token: existing.token,
      }),
    ).resolves.toMatchObject({ resumed: true });

    await admin.gameAdmin.setJoiningOpen({ open: true });
    await expect(joinAsGuest(game.code)).resolves.toBeDefined();
  });
});

describe("lifecycle", () => {
  it("starts the game when the buzzer first opens", async () => {
    const { game, admin } = await freshHostGame();
    expect(game.status).toBe("lobby");

    await admin.gameAdmin.startBuzzer();

    expect(
      (await db.game.findUniqueOrThrow({ where: { id: game.id } })).status,
    ).toBe("running");
  });

  it("finishing closes play, joining, scoring and renames but keeps results", async () => {
    const { game, admin, gameTeams } = await createGame();
    const guest = await joinAsGuest(game.code);
    await guest.player.gameUser.changeTeams({ gameTeamId: gameTeams[0]!.id });
    await admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 5 });
    await admin.gameAdmin.startBuzzer();

    await admin.gameAdmin.finishGame();

    const finished = await db.game.findUniqueOrThrow({
      where: { id: game.id },
    });
    expect(finished).toMatchObject({
      status: "finished",
      isBuzzerListening: false,
    });
    expect(finished.finishedAt).toBeInstanceOf(Date);
    const finishedError = { code: "PRECONDITION_FAILED" };
    await expect(joinAsGuest(game.code)).rejects.toMatchObject({
      message: "This game has finished.",
    });
    await expect(guest.player.gameUser.buzzIn()).rejects.toMatchObject(
      finishedError,
    );
    await expect(admin.gameAdmin.startBuzzer()).rejects.toMatchObject(
      finishedError,
    );
    await expect(
      admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 1 }),
    ).rejects.toMatchObject(finishedError);
    await expect(admin.gameAdmin.undoScore()).rejects.toMatchObject(
      finishedError,
    );
    await expect(
      guest.player.gameUser.changeName({ name: "New" }),
    ).rejects.toMatchObject(finishedError);
    await expect(
      guest.player.gameUser.changeTeamName({ name: "New" }),
    ).rejects.toMatchObject(finishedError);
    await expect(
      guest.player.gameUser.changeTeams({ gameTeamId: gameTeams[1]!.id }),
    ).rejects.toMatchObject(finishedError);

    const results = await requestCaller({}).public.currentGameState({
      gameId: game.id,
    });
    expect(results.game.status).toBe("finished");
    expect(results.gameTeams[0]!.score).toBe(5);
  });

  it("reopens within 24 hours with the buzzer closed", async () => {
    const { game, admin, gameTeams } = await createGame();
    await admin.gameAdmin.startBuzzer();
    await admin.gameAdmin.finishGame();

    await admin.gameAdmin.reopenGame();

    expect(
      await db.game.findUniqueOrThrow({ where: { id: game.id } }),
    ).toMatchObject({
      status: "running",
      finishedAt: null,
      isBuzzerListening: false,
    });
    await expect(
      admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 2 }),
    ).resolves.toBeDefined();
  });

  it("refuses to reopen after 24 hours, or a game that is not finished", async () => {
    const { game, admin } = await createGame();
    await expect(admin.gameAdmin.reopenGame()).rejects.toMatchObject({
      message: "Only a finished game can be reopened.",
    });

    await admin.gameAdmin.finishGame();
    await db.game.update({
      where: { id: game.id },
      data: { finishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000) },
    });

    await expect(admin.gameAdmin.reopenGame()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Games can only be reopened within 24 hours of finishing. Duplicate it to play again.",
    });
  });
});

describe("delete", () => {
  async function addCoHost(gameId: string) {
    const coHost = await createUser("Co-host");
    await db.gameAdmin.create({ data: { userId: coHost.id, gameId } });
    return requestCaller({ gameId, user: coHost });
  }

  it("deletes a finished game and all its data after the name is typed", async () => {
    const { game, admin, gameTeams } = await createGame();
    await joinAsGuest(game.code);
    await admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 1 });
    await admin.gameAdmin.finishGame();

    await expect(
      admin.gameAdmin.deleteGame({ confirmName: "wrong" }),
    ).rejects.toMatchObject({
      message: "Type the game's name exactly to confirm.",
    });

    await admin.gameAdmin.deleteGame({ confirmName: game.name });

    expect(await db.game.count({ where: { id: game.id } })).toBe(0);
    for (const count of await Promise.all([
      db.gameUser.count({ where: { gameId: game.id } }),
      db.gameTeam.count({ where: { gameId: game.id } }),
      db.scoreboardState.count({ where: { gameId: game.id } }),
      db.gameOperation.count({ where: { gameId: game.id } }),
      db.scoreEffect.count({ where: { gameId: game.id } }),
    ])) {
      expect(count).toBe(0);
    }
  });

  it("deletes an unused lobby, but not a running game or a lobby with players", async () => {
    const unused = await freshHostGame();
    await unused.admin.gameAdmin.deleteGame({ confirmName: unused.game.name });
    expect(await db.game.count({ where: { id: unused.game.id } })).toBe(0);

    const withPlayer = await freshHostGame();
    await joinAsGuest(withPlayer.game.code);
    await expect(
      withPlayer.admin.gameAdmin.deleteGame({
        confirmName: withPlayer.game.name,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const running = await freshHostGame();
    await running.admin.gameAdmin.startBuzzer();
    await expect(
      running.admin.gameAdmin.deleteGame({ confirmName: running.game.name }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("is limited to the game's creator", async () => {
    const { game, admin } = await createGame();
    await admin.gameAdmin.finishGame();
    const coHost = await addCoHost(game.id);

    await expect(
      coHost.gameAdmin.deleteGame({ confirmName: game.name }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only the game's creator can do that.",
    });
  });
});

describe("duplicate", () => {
  it("copies setup but not players, scores or history, and the duplicator owns it", async () => {
    const { game, admin, gameTeams } = await createGame({ teams: 3 });
    await admin.gameAdmin.toggleFreezeTeams({ freeze: true });
    await admin.gameAdmin.setTeamAssignment({ teamAssignment: "staff" });
    await joinAsGuest(game.code);
    await admin.gameAdmin.addScore({ [gameTeams[0]!.id]: 9 });
    await db.gameTeam.update({
      where: { id: gameTeams[2]!.id },
      data: { name: "Quizzards" },
    });
    const coHostUser = await createUser("Co-host");
    await db.gameAdmin.create({
      data: { userId: coHostUser.id, gameId: game.id },
    });
    const coHost = requestCaller({ gameId: game.id, user: coHostUser });

    const { gameId } = await coHost.gameAdmin.duplicateGame({
      requestId: rid("dup"),
    });

    const copy = await db.game.findUniqueOrThrow({
      where: { id: gameId },
      include: {
        gameTeams: { orderBy: { index: "asc" } },
        gameAdmins: true,
        _count: { select: { gameUsers: true, operations: true } },
      },
    });
    expect(copy).toMatchObject({
      name: "Characterization Game (copy)",
      format: "team",
      status: "lobby",
      teamAssignment: "staff",
      settings: { freezeTeams: true },
      createdById: coHostUser.id,
      _count: { gameUsers: 0, operations: 0 },
    });
    expect(copy.code).not.toBe(game.code);
    expect(copy.gameTeams.map((t) => t.name)).toEqual([
      "Team 1",
      "Team 2",
      "Quizzards",
    ]);
    expect(copy.gameAdmins.map((a) => a.userId)).toEqual([coHostUser.id]);
  });
});

describe("dashboard", () => {
  it("lists games the user created or helps run, including games with several helpers", async () => {
    const { game, host } = await createGame();
    const coHost = await createUser("Co-host");
    await db.gameAdmin.create({ data: { userId: coHost.id, gameId: game.id } });

    const forHost = await (await callerFor({ user: host })).user.game.getAll();
    const forCoHost = await (
      await callerFor({ user: coHost })
    ).user.game.getAll();
    const stranger = await (
      await callerFor({ user: await createUser() })
    ).user.game.getAll();

    expect(forHost.map((g) => g.id)).toContain(game.id);
    expect(forCoHost.map((g) => g.id)).toContain(game.id);
    expect(stranger.map((g) => g.id)).not.toContain(game.id);
  });
});

describe("audience display state", () => {
  it("shows the join code only while new players can join", async () => {
    const { game, admin } = await createGame();
    const display = () =>
      requestCaller({}).public.currentGameState({ gameId: game.id });

    expect((await display()).game.joinCode).toBe(game.code);

    await admin.gameAdmin.setJoiningOpen({ open: false });
    expect((await display()).game.joinCode).toBeNull();

    await admin.gameAdmin.setJoiningOpen({ open: true });
    await admin.gameAdmin.finishGame();
    expect((await display()).game).toMatchObject({
      joinCode: null,
      status: "finished",
    });
  });

  it("reports an unknown game as not found", async () => {
    await expect(
      requestCaller({}).public.currentGameState({ gameId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
