import {
  bankSchema,
  emptyBank,
  gridOf,
  type Bank,
  type GridRules,
} from "@/utils/categoryGrid/content";
import { sampleBank } from "@/utils/categoryGrid/sample";
import type { ModeKind } from "@/utils/modes";
import {
  contentSchema,
  type Content,
  type Rules,
} from "@/utils/rankedAnswers/content";
import { sampleContent } from "@/utils/rankedAnswers/sample";
import {
  type BuzzerMode,
  GameFormat,
  GameStatus,
  Prisma,
  TeamAssignment,
  type Game,
  type GameUser,
} from "@prisma/client";
import { err, ok, type Result } from "neverthrow";

import { db } from "@/server/db";
import {
  withGameLock,
  type GameTransactionError,
  type GameTx,
  lockChatGate,
} from "@/server/db/gameTransaction";
import {
  generateShortCode,
  generateToken,
} from "@/server/utils/codeGeneration";
import {
  NAME_LIMITS,
  normalizeName,
  type NameError,
} from "@/utils/displayName";
import { GAME_LIMITS } from "@/utils/gameRules";

export { GAME_LIMITS };

export type GameServiceError =
  | GameTransactionError
  | { kind: "invalidName"; field: "game" | "nickname"; error: NameError }
  | { kind: "invalidTeamCount" }
  | { kind: "gameFinished" }
  | { kind: "joiningClosed" }
  | { kind: "notFinished" }
  | { kind: "reopenExpired" }
  | { kind: "notOwner" }
  | { kind: "cannotDeleteActiveGame" }
  | { kind: "confirmationMismatch" }
  | { kind: "teamsNotSupported" };

type Created = { game: Game; replayed: boolean };

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function findByRequestId(ownerId: string, requestId: string) {
  return db.game.findUnique({
    where: {
      createdById_creationRequestId: {
        createdById: ownerId,
        creationRequestId: requestId,
      },
    },
  });
}

/**
 * Creates a game with its initial teams and empty scoreboard in one
 * transaction. A retried `requestId` returns the game it already created.
 */
async function insertGame(data: {
  ownerId: string;
  name: string;
  format: GameFormat;
  teamNames: string[];
  settings?: Prisma.InputJsonValue;
  teamAssignment?: TeamAssignment;
  buzzerMode?: BuzzerMode;
  /** A Ranked Answers draft (rules and boards) to set up with the game. */
  /** A game mode draft (Ranked Answers or Category Grid) to set up with the game. */
  modeDraft?: { kind: ModeKind; draft: Content | Bank };
  requestId?: string;
}): Promise<Created> {
  if (data.requestId) {
    const existing = await findByRequestId(data.ownerId, data.requestId);
    if (existing) return { game: existing, replayed: true };
  }

  for (let attempt = 0; ; attempt++) {
    try {
      const game = await db.$transaction(async (tx) => {
        const created = await tx.game.create({
          data: {
            name: data.name,
            code: generateShortCode(6),
            format: data.format,
            settings: data.settings ?? {},
            teamAssignment: data.teamAssignment,
            buzzerMode: data.buzzerMode,
            creationRequestId: data.requestId,
            createdById: data.ownerId,
            gameAdmins: { create: { userId: data.ownerId } },
            scoreboard: { create: {} },
            gameTeams: {
              create: data.teamNames.map((name, i) => ({
                index: i + 1,
                name,
              })),
            },
          },
          include: { scoreboard: true },
        });
        const state = await tx.scoreboardState.create({
          data: { gameId: created.id, scoreboardId: created.scoreboard!.id },
        });
        if (data.modeDraft) {
          await tx.gameMode.create({
            data: {
              gameId: created.id,
              kind: data.modeDraft.kind,
              draft: data.modeDraft.draft,
              draftRevision: 1,
            },
          });
        }
        await tx.scoreboard.update({
          where: { id: created.scoreboard!.id },
          data: { currentStateId: state.id },
        });
        const { scoreboard: _scoreboard, ...game } = created;
        return game;
      });
      return { game, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 5) throw error;
      if (data.requestId) {
        // A concurrent retry of the same request won the race.
        const existing = await findByRequestId(data.ownerId, data.requestId);
        if (existing) return { game: existing, replayed: true };
      }
      // Otherwise the random join code collided; try another.
    }
  }
}

export async function createGame({
  ownerId,
  name,
  format,
  teamCount = GAME_LIMITS.defaultTeams,
  buzzerMode,
  rankedAnswers,
  categoryGrid,
  requestId,
}: {
  ownerId: string;
  name: string;
  format: GameFormat;
  teamCount?: number;
  buzzerMode?: BuzzerMode;
  /** Set the game up for Ranked Answers with these rules. */
  rankedAnswers?: { rules: Rules; sampleBoards?: boolean };
  /** Or set it up for Category Grid with these rules. */
  categoryGrid?: { rules: GridRules; sampleGrid?: boolean };
  requestId?: string;
}): Promise<Result<Created, GameServiceError>> {
  if (requestId) {
    const existing = await findByRequestId(ownerId, requestId);
    if (existing) return ok({ game: existing, replayed: true });
  }

  const normalized = normalizeName(name, NAME_LIMITS.maxGameName);
  if (normalized.isErr()) {
    return err({ kind: "invalidName", field: "game", error: normalized.error });
  }
  if (
    format === GameFormat.team &&
    (!Number.isInteger(teamCount) ||
      teamCount < GAME_LIMITS.minTeams ||
      teamCount > GAME_LIMITS.maxTeams)
  ) {
    return err({ kind: "invalidTeamCount" });
  }

  return ok(
    await insertGame({
      ownerId,
      name: normalized.value,
      format,
      teamNames:
        format === GameFormat.team
          ? Array.from({ length: teamCount }, (_, i) => `Team ${i + 1}`)
          : [],
      buzzerMode,
      modeDraft: rankedAnswers
        ? {
            kind: "rankedAnswers",
            draft: contentSchema.parse({
              rules: rankedAnswers.rules,
              boards: rankedAnswers.sampleBoards
                ? sampleContent(teamCount).boards
                : [],
            }),
          }
        : categoryGrid
          ? {
              kind: "categoryGrid",
              draft: bankSchema.parse(
                withGridRules(
                  categoryGrid.sampleGrid ? sampleBank() : emptyBank(),
                  categoryGrid.rules,
                ),
              ),
            }
          : undefined,
      requestId,
    }),
  );
}

/**
 * Copies a game's name, format, settings, team policy, buzzing mode, team
 * names and Ranked Answers rules and boards into a new lobby game owned by
 * `ownerId`. Players, credentials, scores, history and helpers are not copied.
 */
export async function duplicateGame({
  gameId,
  ownerId,
  requestId,
}: {
  gameId: string;
  ownerId: string;
  requestId?: string;
}): Promise<Result<Created, GameServiceError>> {
  const source = await db.game.findUnique({
    where: { id: gameId },
    include: { gameTeams: { orderBy: { index: "asc" } }, gameMode: true },
  });
  if (!source) return err({ kind: "gameNotFound", gameId });

  const name = [...`${source.name} (copy)`]
    .slice(0, NAME_LIMITS.maxGameName)
    .join("");
  return ok(
    await insertGame({
      ownerId,
      name,
      format: source.format,
      settings: source.settings ?? {},
      teamAssignment: source.teamAssignment,
      buzzerMode: source.buzzerMode,
      // Ranked Answers rules and boards come along, ready to play again.
      // Game mode rules and content come along, ready to play again.
      modeDraft: source.gameMode
        ? source.gameMode.kind === "categoryGrid"
          ? {
              kind: "categoryGrid",
              draft: bankSchema.parse(
                source.gameMode.content ?? source.gameMode.draft,
              ),
            }
          : {
              kind: "rankedAnswers",
              draft: contentSchema.parse(
                source.gameMode.content ?? source.gameMode.draft,
              ),
            }
        : undefined,
      teamNames:
        source.format === GameFormat.team
          ? source.gameTeams.map((team) => team.name)
          : [],
      requestId,
    }),
  );
}

export type JoinResult = {
  gameUser: GameUser;
  token: string;
  gameId: string;
  /** True when an existing credential was used instead of creating a player. */
  resumed: boolean;
};

/** The team with the fewest players; ties go to the lowest team number. */
async function leastPopulatedTeam(tx: GameTx, gameId: string) {
  const teams = await tx.gameTeam.findMany({
    where: { gameId },
    select: {
      id: true,
      index: true,
      _count: { select: { gameUsers: { where: { removedAt: null } } } },
    },
    orderBy: { index: "asc" },
  });
  let best: (typeof teams)[number] | undefined;
  for (const team of teams) {
    if (!best || team._count.gameUsers < best._count.gameUsers) best = team;
  }
  return best?.id ?? null;
}

/**
 * Joins a game by code, or resumes the player that `token` belongs to.
 *
 * New players get the nickname they chose (never an account name) or a
 * neutral "Player N", and are guests: joining while signed in does not save
 * the player to the account. Placement and numbering happen under the game lock, so
 * concurrent joins get distinct numbers and automatic assignment stays
 * balanced. A resumed player keeps their name and team.
 */
export async function joinGame({
  gameCode,
  token,
  nickname,
}: {
  gameCode: string;
  token?: string;
  nickname?: string;
}): Promise<Result<JoinResult, GameServiceError>> {
  const game = await db.game.findUnique({
    where: { code: gameCode.toUpperCase() },
  });
  if (!game) return err({ kind: "gameNotFound", gameId: gameCode });

  if (token) {
    const existing = await db.gameUser.findUnique({ where: { token } });
    if (existing?.gameId === game.id && !existing.removedAt) {
      return ok({ gameUser: existing, token, gameId: game.id, resumed: true });
    }
  }

  let chosenName: string | undefined;
  if (nickname !== undefined && nickname.trim() !== "") {
    const normalized = normalizeName(nickname);
    if (normalized.isErr()) {
      return err({
        kind: "invalidName",
        field: "nickname",
        error: normalized.error,
      });
    }
    chosenName = normalized.value;
  }

  const outcome = await withGameLock(
    game.id,
    async (tx): Promise<Result<JoinResult, GameServiceError>> => {
      const current = await tx.game.findUniqueOrThrow({
        where: { id: game.id },
      });
      if (current.status === GameStatus.finished) {
        return err({ kind: "gameFinished" });
      }
      if (!current.joiningOpen) return err({ kind: "joiningClosed" });

      const { _max } = await tx.gameUser.aggregate({
        _max: { index: true },
        where: { gameId: game.id },
      });
      const index = (_max.index ?? 0) + 1;
      const name = chosenName ?? `Player ${index}`;

      let gameTeamId: string | null = null;
      if (current.format === GameFormat.individual) {
        const { _max: teamMax } = await tx.gameTeam.aggregate({
          _max: { index: true },
          where: { gameId: game.id },
        });
        const team = await tx.gameTeam.create({
          data: {
            gameId: game.id,
            name,
            index: (teamMax.index ?? 0) + 1,
          },
        });
        gameTeamId = team.id;
      } else if (current.teamAssignment === TeamAssignment.auto) {
        gameTeamId = await leastPopulatedTeam(tx, game.id);
      }

      const newToken = generateToken();
      const gameUser = await tx.gameUser.create({
        data: {
          gameId: game.id,
          name,
          index,
          token: newToken,
          gameTeamId,
        },
      });
      return ok({
        gameUser,
        token: newToken,
        gameId: game.id,
        resumed: false,
      });
    },
  );
  return outcome.isErr() ? err(outcome.error) : outcome.value;
}

/** What "Resume" would restore, shown before the player confirms. */
export async function resumePreview({
  gameCode,
  token,
}: {
  gameCode: string;
  token: string;
}) {
  const gameUser = await db.gameUser.findUnique({
    where: { token },
    include: {
      game: { select: { code: true, name: true, format: true } },
      gameTeam: { select: { name: true } },
    },
  });
  if (gameUser?.game.code !== gameCode.toUpperCase()) return null;
  return {
    gameName: gameUser.game.name,
    nickname: gameUser.name,
    teamName:
      gameUser.game.format === GameFormat.team
        ? (gameUser.gameTeam?.name ?? null)
        : null,
  };
}

/** Shared guard: participants and scores cannot change after finish. */
export async function assertGameNotFinished(
  tx: GameTx,
  gameId: string,
): Promise<Result<Game, GameServiceError>> {
  const game = await tx.game.findUniqueOrThrow({ where: { id: gameId } });
  return game.status === GameStatus.finished
    ? err({ kind: "gameFinished" })
    : ok(game);
}

function flatten<T>(
  result: Result<Result<T, GameServiceError>, GameTransactionError>,
): Result<T, GameServiceError> {
  return result.isErr() ? err(result.error) : result.value;
}

/** Closes joining and play. Scores and history stay readable. */
export async function finishGame(gameId: string) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<{ changed: boolean }, GameServiceError>> => {
        // Chat closes for players at the same moment (see lockChatGate).
        await lockChatGate(tx, gameId, "exclusive");
        const game = await tx.game.findUniqueOrThrow({
          where: { id: gameId },
        });
        if (game.status === GameStatus.finished) {
          return ok({ changed: false });
        }
        await tx.game.update({
          where: { id: gameId },
          data: {
            status: GameStatus.finished,
            finishedAt: new Date(),
            isBuzzerListening: false,
          },
        });
        return ok({ changed: true });
      },
    ),
  );
}

/**
 * Reopens a finished game to correct results, within 24 hours of finishing.
 * The buzzer stays closed until the host opens it.
 */
export async function reopenGame(gameId: string, now = new Date()) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<{ changed: boolean }, GameServiceError>> => {
        const game = await tx.game.findUniqueOrThrow({
          where: { id: gameId },
        });
        if (game.status !== GameStatus.finished) {
          return err({ kind: "notFinished" });
        }
        if (
          !game.finishedAt ||
          now.getTime() - game.finishedAt.getTime() > GAME_LIMITS.reopenWindowMs
        ) {
          return err({ kind: "reopenExpired" });
        }
        await tx.game.update({
          where: { id: gameId },
          data: {
            status: GameStatus.running,
            finishedAt: null,
            isBuzzerListening: false,
          },
        });
        return ok({ changed: true });
      },
    ),
  );
}

export async function setJoiningOpen(gameId: string, open: boolean) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<{ changed: boolean }, GameServiceError>> => {
        const { count } = await tx.game.updateMany({
          where: { id: gameId, joiningOpen: !open },
          data: { joiningOpen: open },
        });
        return ok({ changed: count > 0 });
      },
    ),
  );
}

export async function setTeamAssignment(
  gameId: string,
  teamAssignment: TeamAssignment,
) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<{ changed: boolean }, GameServiceError>> => {
        const game = await tx.game.findUniqueOrThrow({
          where: { id: gameId },
        });
        if (game.format !== GameFormat.team) {
          return err({ kind: "teamsNotSupported" });
        }
        const { count } = await tx.game.updateMany({
          where: { id: gameId, teamAssignment: { not: teamAssignment } },
          data: { teamAssignment },
        });
        return ok({ changed: count > 0 });
      },
    ),
  );
}

/**
 * Permanently deletes a game. Only the owner may do this, only after typing
 * the game's name, and only for a finished game or an unused lobby, unless
 * `finishFirst` is set: then a game still in play is finished and deleted in
 * one step (the owner confirmed they're ending it for everyone).
 */
export async function deleteGame({
  gameId,
  actorUserId,
  confirmName,
  finishFirst = false,
}: {
  gameId: string;
  actorUserId: string;
  confirmName: string;
  finishFirst?: boolean;
}) {
  return flatten(
    await withGameLock(
      gameId,
      async (tx): Promise<Result<{ deleted: true }, GameServiceError>> => {
        const game = await tx.game.findUniqueOrThrow({
          where: { id: gameId },
          include: {
            _count: { select: { gameUsers: true, operations: true } },
          },
        });
        if (game.createdById !== actorUserId) return err({ kind: "notOwner" });
        if (confirmName.trim() !== game.name) {
          return err({ kind: "confirmationMismatch" });
        }
        const unusedLobby =
          game.status === GameStatus.lobby &&
          game._count.gameUsers === 0 &&
          game._count.operations === 0;
        if (
          game.status !== GameStatus.finished &&
          !unusedLobby &&
          !finishFirst
        ) {
          return err({ kind: "cannotDeleteActiveGame" });
        }
        await tx.game.delete({ where: { id: gameId } });
        return ok({ deleted: true as const });
      },
    ),
  );
}

function withGridRules(bank: Bank, rules: GridRules): Bank {
  return {
    ...bank,
    modes: {
      ...bank.modes,
      categoryGrid: { ...gridOf(bank), rules },
    },
  };
}
