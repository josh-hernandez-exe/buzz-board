/**
 * T03/T06/T01 characterization (PR01): guest join, resume, rosters and game
 * scoping as they behave today. See scoreboard.test.ts for the `it.fails`
 * convention; "CURRENT BEHAVIOR" tests pin behavior a later PR may change on
 * purpose.
 */
import { describe, expect, it } from "vitest";

import {
  createGame,
  createUser,
  db,
  joinAsGuest,
  requestCaller,
} from "../support/integration";

describe("guest join and resume", () => {
  it("joins with a case-insensitive code and no account", async () => {
    const { game } = await createGame();

    const joined = await joinAsGuest(game.code.toLowerCase());

    expect(joined.gameId).toBe(game.id);
    expect(joined.token).toEqual(expect.any(String));
    expect(joined.gameUser).toMatchObject({
      name: "Player 1",
      gameTeamId: null,
      userId: null,
    });
    expect(await joined.player.gameUser.ping()).toBe("pong");
  });

  it("numbers guests in join order", async () => {
    const { game } = await createGame();

    const first = await joinAsGuest(game.code);
    const second = await joinAsGuest(game.code);

    expect([first.gameUser.name, second.gameUser.name]).toEqual([
      "Player 1",
      "Player 2",
    ]);
  });

  it("resumes the same participant when the token is presented", async () => {
    const { game } = await createGame();
    const joined = await joinAsGuest(game.code);

    const resumed = await requestCaller({
      gameId: game.id,
      gameUserToken: joined.token,
    }).public.joinGame({ gameCode: game.code, token: joined.token });

    expect(resumed.gameUser.id).toBe(joined.gameUser.id);
    expect(await db.gameUser.count({ where: { gameId: game.id } })).toBe(1);
  });

  it("returns NOT_FOUND for an unknown code", async () => {
    await expect(
      requestCaller({}).public.joinGame({ gameCode: "ZZZZZ9" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates a backing team per player in individual games", async () => {
    const { game } = await createGame({ format: "individual" });

    const joined = await joinAsGuest(game.code);

    const team = await db.gameTeam.findFirstOrThrow({
      where: { gameId: game.id },
      include: { gameUsers: true },
    });
    expect(team.name).toBe(joined.gameUser.name);
    expect(team.gameUsers.map((u) => u.id)).toEqual([joined.gameUser.id]);
  });

  it("keeps an individual player's backing team name in sync on rename", async () => {
    const { game } = await createGame({ format: "individual" });
    const joined = await joinAsGuest(game.code);

    await joined.player.gameUser.changeName({ name: "Alex" });

    const user = await db.gameUser.findUniqueOrThrow({
      where: { id: joined.gameUser.id },
      include: { gameTeam: true },
    });
    expect([user.name, user.gameTeam?.name]).toEqual(["Alex", "Alex"]);
  });

  it("CURRENT BEHAVIOR: a signed-in user presenting a guest token is silently linked to it", async () => {
    const { game } = await createGame();
    const joined = await joinAsGuest(game.code);
    const account = await createUser("Signed In Player");

    await requestCaller({
      gameId: game.id,
      gameUserToken: joined.token,
      user: account,
    }).gameUser.ping();

    // The plan (invariant 5 / PR08) requires explicit linking instead.
    const gameUser = await db.gameUser.findUniqueOrThrow({
      where: { id: joined.gameUser.id },
    });
    expect(gameUser.userId).toBe(account.id);
  });
});

describe("teams", () => {
  it("lets a player switch teams until the host freezes them", async () => {
    const { admin, game, gameTeams } = await createGame();
    const [a, b] = gameTeams.map((t) => t.id) as [string, string];
    const { player, gameUser } = await joinAsGuest(game.code);

    await player.gameUser.changeTeams({ gameTeamId: a });
    await admin.gameAdmin.toggleFreezeTeams({ freeze: true });

    await expect(
      player.gameUser.changeTeams({ gameTeamId: b }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The host can still move players while teams are frozen.
    await admin.gameAdmin.movePlayerToTeam({
      gameUserId: gameUser.id,
      targetGameTeamId: b,
    });
    expect(
      (await db.gameUser.findUniqueOrThrow({ where: { id: gameUser.id } }))
        .gameTeamId,
    ).toBe(b);
  });

  it("does not let a player join a team from another game", async () => {
    const { game } = await createGame();
    const other = await createGame();
    const { player } = await joinAsGuest(game.code);

    await expect(
      player.gameUser.changeTeams({ gameTeamId: other.gameTeams[0]!.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("renames a team for everyone on it", async () => {
    const { game, gameTeams } = await createGame();
    const { player } = await joinAsGuest(game.code);
    await player.gameUser.changeTeams({ gameTeamId: gameTeams[0]!.id });

    await player.gameUser.changeTeamName({ name: "Quizzards" });

    const state = await requestCaller({}).public.currentGameState({
      gameId: game.id,
    });
    expect(state.gameTeams.map((t) => [t.name, t.numPlayers])).toEqual([
      ["Quizzards", 1],
      ["Team 2", 0],
    ]);
  });

  it("removes a team, unassigns its players and re-indexes the rest", async () => {
    const { admin, game, gameTeams } = await createGame({ teams: 3 });
    const { player, gameUser } = await joinAsGuest(game.code);
    await player.gameUser.changeTeams({ gameTeamId: gameTeams[0]!.id });

    await admin.gameAdmin.removeTeam({ gameTeamId: gameTeams[0]!.id });

    const remaining = await db.gameTeam.findMany({
      where: { gameId: game.id },
      orderBy: { index: "asc" },
    });
    expect(remaining.map((t) => [t.id, t.index])).toEqual([
      [gameTeams[1]!.id, 1],
      [gameTeams[2]!.id, 2],
    ]);
    expect(
      (await db.gameUser.findUniqueOrThrow({ where: { id: gameUser.id } }))
        .gameTeamId,
    ).toBeNull();
  });
});

describe("game scoping", () => {
  it("does not give players admin procedures", async () => {
    const { game } = await createGame();
    const { player } = await joinAsGuest(game.code);

    await expect(player.gameAdmin.startBuzzer()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("does not let a host administer another host's game", async () => {
    const mine = await createGame();
    const theirs = await createGame();

    const crossGame = requestCaller({
      gameId: theirs.game.id,
      user: mine.host,
    });

    await expect(crossGame.gameAdmin.startBuzzer()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("does not accept a participant token for a different game", async () => {
    const first = await createGame();
    const second = await createGame();
    const joined = await joinAsGuest(first.game.code);

    const wrongGame = requestCaller({
      gameId: second.game.id,
      gameUserToken: joined.token,
    });

    await expect(wrongGame.gameUser.ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("requires a signed-in account to create a game", async () => {
    await expect(
      requestCaller({}).user.game.create({ name: "x", format: "team" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("uses the tab's game, not the shared cookie from a more recent tab", async () => {
    const first = await createGame();
    const second = await createGame({ teams: 3 });

    // Host opened `second` in another tab, so the shared cookie points there.
    const firstTab = requestCaller({
      gameId: first.game.id,
      user: first.host,
      cookies: { "buzz-board-game-id": second.game.id },
    });

    const state = await firstTab.gameGeneral.currentGameState();
    expect(state.game.id).toBe(first.game.id);
    await firstTab.gameAdmin.addTeam();
    expect(await db.gameTeam.count({ where: { gameId: first.game.id } })).toBe(
      3,
    );
    expect(await db.gameTeam.count({ where: { gameId: second.game.id } })).toBe(
      3,
    );
  });

  it("does not use another game's player cookie in a tab scoped to this game", async () => {
    const mine = await createGame();
    const other = await createGame();
    const otherGuest = await joinAsGuest(other.game.code);

    const tab = requestCaller({
      gameId: mine.game.id,
      cookies: { "buzz-board-game-user-token": otherGuest.token },
    });

    await expect(tab.gameUser.ping()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("falls back to cookies for server-rendered requests without headers", async () => {
    const { game } = await createGame();
    const guest = await joinAsGuest(game.code);

    const serverRender = requestCaller({
      cookies: {
        "buzz-board-game-id": game.id,
        "buzz-board-game-user-token": guest.token,
      },
    });

    expect(await serverRender.gameUser.ping()).toBe("pong");
  });

  it("returns no game session for an unknown game id", async () => {
    const { host } = await createGame();

    await expect(
      requestCaller({
        gameId: "missing-game",
        user: host,
      }).gameGeneral.currentGameState(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
