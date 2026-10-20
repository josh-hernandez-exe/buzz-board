/**
 * Mixed chat + buzzer load runner (PR12). Real bots over the app's real
 * HTTP/tRPC/SSE endpoints: each bot joins with its own token, holds the game
 * and chat streams a player page holds, chats through the real
 * invalidation-plus-fetch path, and buzzes when the buzzer opens.
 *
 *   bun run load -- --profile smoke-10 --dry-run
 *   bun run load -- --profile mixed-100 --start-server
 *
 * Local only: the app, PostgreSQL and Redis on this machine. See
 * docs/operations.md for setup, interlocks and how to read the report.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { parseArgs } from "node:util";

import { PrismaClient } from "@prisma/client";

import { assertDisposableDatabase } from "../../tests/support/testEnv";

import { TrpcError, TrpcHttp, type Counters } from "./client";
import {
  ceilingsFor,
  checkTarget,
  exceededCeiling,
  type Ceilings,
} from "./interlocks";
import {
  botsAt,
  durationSeconds,
  estimateWorkload,
  isProfileName,
  PROFILES,
  withHoldScale,
  WORKLOAD,
  type Profile,
} from "./profiles";
import {
  parseSyntheticTag,
  seededRandom,
  summarize,
  syntheticMessage,
} from "./stats";

// ---------------------------------------------------------------- options

const { values: args } = parseArgs({
  options: {
    profile: { type: "string", default: "smoke-10" },
    target: { type: "string", default: "http://localhost:3300" },
    seed: { type: "string", default: "1" },
    "hold-scale": { type: "string", default: "1" },
    "dry-run": { type: "boolean", default: false },
    "start-server": { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
    out: { type: "string", default: "load-results" },
    "allow-remote": { type: "boolean", default: false },
    "acknowledge-costs": { type: "boolean", default: false },
    "operator-approval": { type: "string" },
  },
  allowPositionals: true,
});

if (!isProfileName(args.profile)) {
  console.error(
    `Unknown profile ${args.profile}. One of: ${Object.keys(PROFILES).join(", ")}`,
  );
  process.exit(2);
}
const holdScale = Number(args["hold-scale"]);
const profile: Profile =
  holdScale === 1
    ? PROFILES[args.profile]
    : withHoldScale(PROFILES[args.profile], holdScale);
const seed = Number(args.seed);
const estimate = estimateWorkload(profile);
const ceilings: Ceilings = ceilingsFor(estimate);
const targetCheck = checkTarget({
  target: args.target,
  allowRemote: args["allow-remote"],
  acknowledgeCosts: args["acknowledge-costs"],
  allowlist: (process.env.LOAD_TARGET_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  operatorApproval: args["operator-approval"],
});

const plan = {
  profile: profile.name,
  holdScale,
  seed,
  target: args.target,
  estimate,
  ceilings,
};
console.log(JSON.stringify({ dryRun: plan }, null, 2));
if (targetCheck.isErr()) {
  console.error(targetCheck.error);
  process.exit(2);
}
if (args["dry-run"]) process.exit(0);
if (!targetCheck.value.local) {
  // The interlocks above are necessary but not sufficient: remote execution
  // also needs pre-created synthetic credentials, cost alerts and an
  // operator-run cleanup, none of which this repository automates.
  console.error(
    "Remote runs passed the interlocks but aren't implemented here. Run against a local server.",
  );
  process.exit(2);
}
const origin = targetCheck.value.origin;

// ---------------------------------------------------------------- setup

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set DATABASE_URL to the disposable test database.");
  process.exit(2);
}
assertDisposableDatabase(databaseUrl);
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const runId = randomBytes(4).toString("hex");
const random = seededRandom(seed);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const counters: Counters = {
  requests: 0,
  bytes: 0,
  streamsOpen: 0,
  streamsOpened: 0,
  streamEvents: 0,
};
const stop = new AbortController();
let stopReason: string | null = null;
function abortRun(reason: string) {
  if (stopReason) return;
  stopReason = reason;
  console.error(`Stopping: ${reason}`);
  stop.abort();
}
process.on("SIGINT", () => abortRun("interrupted"));

function startServer(): ChildProcess {
  const port = new URL(origin).port || "80";
  return spawn("bunx", ["next", "start", "--port", port], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "load-only-secret",
      AUTH_TRUST_HOST: "true",
      NEXTAUTH_URL: origin,
      AUTH_DISCORD_CLIENT_ID: process.env.AUTH_DISCORD_CLIENT_ID ?? "unused",
      AUTH_DISCORD_CLIENT_SECRET:
        process.env.AUTH_DISCORD_CLIENT_SECRET ?? "unused",
      AUTH_GOOGLE_CLIENT_ID: process.env.AUTH_GOOGLE_CLIENT_ID ?? "unused",
      AUTH_GOOGLE_CLIENT_SECRET:
        process.env.AUTH_GOOGLE_CLIENT_SECRET ?? "unused",
      NEXT_PUBLIC_QRCODE_BASE_URL: origin,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "ignore",
  });
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${origin}/join`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`No server at ${origin}`);
}

async function seedUser(name: string) {
  const sessionToken = randomBytes(32).toString("hex");
  const user = await db.user.create({
    data: {
      name,
      email: `load-${runId}-${randomUUID()}@example.test`,
      sessions: {
        create: { sessionToken, expires: new Date(Date.now() + 86_400_000) },
      },
    },
  });
  return { user, sessionToken };
}

async function seedGame() {
  const owner = await seedUser(`Load owner ${runId}`);
  const cohost = await seedUser(`Load co-host ${runId}`);
  const moderator = await seedUser(`Load moderator ${runId}`);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(
    randomBytes(6),
    (b) => alphabet[b % alphabet.length],
  ).join("");
  const game = await db.game.create({
    data: {
      name: `Load ${profile.name} ${runId}`,
      code,
      format: "team",
      chatEnabled: true,
      createdById: owner.user.id,
      scoreboard: { create: {} },
      gameAdmins: {
        create: [
          // As the app does: the owner also has a staff row.
          { userId: owner.user.id },
          { userId: cohost.user.id, role: "admin" },
          { userId: moderator.user.id, role: "moderator" },
        ],
      },
      gameTeams: {
        create: Array.from({ length: WORKLOAD.teams }, (_, i) => ({
          index: i + 1,
          name: `Team ${i + 1}`,
        })),
      },
    },
    include: { scoreboard: true, gameAdmins: true, gameTeams: true },
  });
  const state = await db.scoreboardState.create({
    data: { gameId: game.id, scoreboardId: game.scoreboard!.id },
  });
  await db.scoreboard.update({
    where: { id: game.scoreboard!.id },
    data: { currentStateId: state.id },
  });
  return { game, owner, cohost, moderator };
}

// ---------------------------------------------------------------- metrics

const metrics = {
  joins: [] as number[],
  sendAck: [] as number[],
  buzzAck: [] as number[],
  delivery: [] as number[],
  fetch: [] as number[],
  coordinatorAck: [] as number[],
  reconnectToState: [] as number[],
  sends: { accepted: 0, rateLimited: 0, muted: 0, unexpected: 0 },
  buzzes: {
    won: 0,
    teammateHeld: 0,
    notListening: 0,
    busy: 0,
    rejectedTeam: 0,
    unexpected: 0,
  },
  pulses: 0,
  streamReopens: 0,
  fetches: 0,
  fetchesCoalesced: 0,
  privacyProbes: { attempted: 0, refused: 0, leaked: 0 },
  muteProbe: { mutedSendsRefused: 0, mutedBuzzesProcessed: 0 },
  moveProbe: { pulseWithNewTeamMs: null as number | null },
  unexpectedErrors: [] as {
    at: number;
    where: string;
    code: string;
    message: string;
  }[],
  samples: [] as Record<string, number | null>[],
};
function unexpected(where: string, error: unknown) {
  const e =
    error instanceof TrpcError
      ? { code: error.code, message: error.message }
      : { code: "NETWORK", message: String(error) };
  metrics.unexpectedErrors.push({
    at: Math.round(now() - startedAt),
    where,
    ...e,
  });
}

/**
 * Holds a stream open like the browser client: if it ends or fails it is
 * reopened after a short pause. A permission error ends it for good.
 */
function keepStream<T>(
  http: TrpcHttp,
  path: string,
  input: unknown,
  onData: (value: T) => void,
  signal: AbortSignal,
  where: string,
) {
  void (async () => {
    while (!signal.aborted) {
      try {
        await http.subscribe<T>(path, input, onData, signal);
      } catch (e) {
        if (!signal.aborted) unexpected(where, e);
        if (
          e instanceof TrpcError &&
          ["FORBIDDEN", "UNAUTHORIZED"].includes(e.code)
        ) {
          return;
        }
      }
      if (signal.aborted) return;
      metrics.streamReopens++;
      await sleep(500);
    }
  })();
}

// Per message: send time, channel and who should see it.
const sent = new Map<
  string,
  { at: number; recipients: Set<number>; delivered: number; inHold: boolean }
>();
const acceptedRequestIds = new Set<string>();
const windowWins = new Map<number, number>();
let currentWindow = 0;

// ---------------------------------------------------------------- bots

type Pulse = {
  channels: { key: string; revision: number }[];
  muted: unknown;
};
type GameStateSnapshot = {
  game: { isBuzzerListening: boolean };
  gameUsers: Record<string, { gameTeamId: string | null }>;
};

type BuzzOutcome =
  | "won"
  | "teammateHeld"
  | "notListening"
  | "busy"
  | "rejectedTeam"
  | "unexpected"
  | "stopped";

class Bot {
  controller = new AbortController();
  http!: TrpcHttp;
  gameUserId = "";
  teamId: string | null = null;
  revisions = new Map<string, number>();
  channels: string[] = [];
  seen = new Set<string>();
  inFlight = new Set<string>();
  dirty = new Set<string>();
  listening = false;
  sequence = 0;
  active = false;
  timer?: ReturnType<typeof setTimeout>;
  onPulse?: (pulse: Pulse) => void;
  onState?: () => void;

  constructor(
    readonly index: number,
    private readonly gameId: string,
    private readonly code: string,
    private readonly teamIds: string[],
  ) {}

  async start() {
    const joiner = new TrpcHttp(
      origin,
      { forwardedFor: `10.77.${this.index >> 8}.${this.index & 255}` },
      counters,
    );
    const t0 = now();
    const joined = await joiner.mutation<{
      token: string;
      gameUser: { id: string; gameTeamId: string | null };
    }>("public.joinGame", {
      gameCode: this.code,
      nickname: `Bot ${this.index}`,
    });
    metrics.joins.push(now() - t0);
    this.gameUserId = joined.gameUser.id;
    this.teamId = joined.gameUser.gameTeamId;
    this.http = new TrpcHttp(
      origin,
      { gameId: this.gameId, gameUserToken: joined.token },
      counters,
    );
    this.active = true;
    this.openStreams();
    this.schedule(random() * WORKLOAD.messageEverySeconds * 1000);
    // One privacy probe per bot: another team's channel must be refused.
    void this.probePrivacy();
  }

  openStreams() {
    const signal = AbortSignal.any([this.controller.signal, stop.signal]);
    keepStream<GameStateSnapshot>(
      this.http,
      "gameGeneral.gameState",
      {},
      (state) => {
        this.teamId = state.gameUsers[this.gameUserId]?.gameTeamId ?? null;
        const open = state.game.isBuzzerListening;
        if (open && !this.listening) void this.buzz();
        this.listening = open;
        this.onState?.();
      },
      signal,
      "gameState stream",
    );
    keepStream<Pulse>(
      this.http,
      "chat.live",
      { as: "player" },
      (pulse) => this.pulse(pulse),
      signal,
      "chat stream",
    );
  }

  /** Drops and reopens both streams, like a phone that lost signal. */
  reconnect() {
    this.controller.abort();
    this.controller = new AbortController();
    this.listening = false;
    this.openStreams();
  }

  pulse(pulse: Pulse) {
    metrics.pulses++;
    this.channels = pulse.channels.map((c) => c.key);
    for (const { key, revision } of pulse.channels) {
      if (this.revisions.get(key) !== revision) {
        this.revisions.set(key, revision);
        void this.fetch(key);
      }
    }
    this.onPulse?.(pulse);
  }

  async fetch(key: string) {
    if (this.inFlight.has(key)) {
      this.dirty.add(key);
      metrics.fetchesCoalesced++;
      return;
    }
    this.inFlight.add(key);
    try {
      do {
        this.dirty.delete(key);
        const t0 = now();
        const view = await this.http.query<{
          messages: { body: string | null }[];
        }>("chat.channel", { as: "player", channelKey: key, limit: 50 });
        const at = now();
        metrics.fetch.push(at - t0);
        metrics.fetches++;
        for (const message of view.messages) {
          const tag = message.body ? parseSyntheticTag(message.body) : null;
          if (!tag || this.seen.has(tag)) continue;
          this.seen.add(tag);
          const record = sent.get(tag);
          const sender = Number(tag.split("|")[2]);
          // Only people in the channel when it was sent: a player who
          // moves team later sees older messages, which isn't a delivery.
          if (
            record &&
            sender !== this.index &&
            record.recipients.has(this.index)
          ) {
            record.delivered++;
            metrics.delivery.push(at - record.at);
          }
        }
      } while (this.dirty.has(key) && this.active);
    } catch (e) {
      if (this.active && !(e instanceof TrpcError && e.code === "NOT_FOUND")) {
        unexpected("chat.channel", e);
      }
    } finally {
      this.inFlight.delete(key);
    }
  }

  schedule(delayMs: number) {
    this.timer = setTimeout(() => {
      if (!this.active || stop.signal.aborted) return;
      void this.send();
      const jitter = (random() - 0.5) * 0.2;
      this.schedule(WORKLOAD.messageEverySeconds * 1000 * (1 + jitter));
    }, delayMs);
  }

  async send(): Promise<"accepted" | "muted" | "other"> {
    const team = this.teamId;
    const channelKey =
      team && random() < WORKLOAD.teamChannelShare ? `team:${team}` : "game";
    const body = syntheticMessage(
      runId,
      this.index,
      ++this.sequence,
      WORKLOAD.messageBytes,
    );
    const tag = parseSyntheticTag(body)!;
    const requestId = randomBytes(12).toString("hex");
    const audience = new Set(
      bots
        .filter(
          (b) =>
            b.active &&
            b !== this &&
            (channelKey === "game" || b.teamId === team),
        )
        .map((b) => b.index),
    );
    const t0 = now();
    try {
      await this.http.mutation("chat.send", {
        as: "player",
        channelKey,
        body,
        requestId,
      });
      metrics.sendAck.push(now() - t0);
      metrics.sends.accepted++;
      acceptedRequestIds.add(requestId);
      sent.set(tag, {
        at: t0,
        recipients: audience,
        delivered: 0,
        inHold: inHold(),
      });
      return "accepted";
    } catch (e) {
      if (e instanceof TrpcError && e.code === "TOO_MANY_REQUESTS") {
        metrics.sends.rateLimited++;
      } else if (e instanceof TrpcError && e.code === "FORBIDDEN") {
        metrics.sends.muted++;
        return "muted";
      } else if (this.active) {
        metrics.sends.unexpected++;
        unexpected("chat.send", e);
      }
      return "other";
    }
  }

  async buzz(): Promise<BuzzOutcome> {
    await sleep(random() * 100);
    if (!this.active) return "stopped";
    const window = currentWindow;
    const t0 = now();
    try {
      const result = await this.http.mutation<{
        accepted: boolean;
        replayed: boolean;
      }>("gameUser.buzzIn", { requestId: randomBytes(12).toString("hex") });
      metrics.buzzAck.push(now() - t0);
      if (result.replayed) {
        metrics.buzzes.teammateHeld++;
        return "teammateHeld";
      }
      metrics.buzzes.won++;
      windowWins.set(window, (windowWins.get(window) ?? 0) + 1);
      return "won";
    } catch (e) {
      metrics.buzzAck.push(now() - t0);
      const message = e instanceof Error ? e.message : "";
      if (/not listening/i.test(message)) {
        metrics.buzzes.notListening++;
        return "notListening";
      }
      if (/busy/i.test(message)) {
        metrics.buzzes.busy++;
        return "busy";
      }
      if (/already buzzed/i.test(message)) {
        metrics.buzzes.rejectedTeam++;
        return "rejectedTeam";
      }
      metrics.buzzes.unexpected++;
      unexpected("gameUser.buzzIn", e);
      return "unexpected";
    }
  }

  async probePrivacy() {
    const foreign = this.teamIds.find((id) => id !== this.teamId);
    if (!foreign) return;
    metrics.privacyProbes.attempted++;
    try {
      await this.http.query("chat.channel", {
        as: "player",
        channelKey: `team:${foreign}`,
      });
      metrics.privacyProbes.leaked++;
    } catch (e) {
      if (e instanceof TrpcError && e.code === "NOT_FOUND") {
        metrics.privacyProbes.refused++;
      } else unexpected("privacy probe", e);
    }
  }

  stopBot() {
    this.active = false;
    clearTimeout(this.timer);
    this.controller.abort();
  }
}

const bots: Bot[] = [];
let startedAt = now();
let holdStart = 0;
let holdEnd = 0;
const inHold = () => {
  const t = (now() - startedAt) / 1000;
  return t >= holdStart && t < holdEnd;
};

// ---------------------------------------------------------------- run

async function main() {
  let server: ChildProcess | undefined;
  if (args["start-server"]) {
    server = startServer();
    process.on("exit", () => server?.kill());
  }
  await waitForServer();
  const seeded = await seedGame();
  const { game } = seeded;
  const teamIds = seeded.game.gameTeams.map((t) => t.id);
  const owner = new TrpcHttp(
    origin,
    { gameId: game.id, sessionToken: seeded.owner.sessionToken },
    counters,
  );
  const cohost = new TrpcHttp(
    origin,
    { gameId: game.id, sessionToken: seeded.cohost.sessionToken },
    counters,
  );
  const moderator = new TrpcHttp(
    origin,
    { gameId: game.id, sessionToken: seeded.moderator.sessionToken },
    counters,
  );
  const display = new TrpcHttp(origin, {}, counters);
  const expectedScores = new Map<string, number>(teamIds.map((id) => [id, 0]));

  // Staff desks and the audience display hold their real streams.
  const ignore = () => undefined;
  for (const desk of [owner, cohost, moderator]) {
    keepStream(
      desk,
      "gameGeneral.gameState",
      {},
      ignore,
      stop.signal,
      "desk game stream",
    );
  }
  for (const desk of [owner, cohost]) {
    keepStream(
      desk,
      "chat.live",
      { as: "staff" },
      ignore,
      stop.signal,
      "desk chat stream",
    );
  }
  let moderatorFetching = false;
  keepStream(
    moderator,
    "chat.live",
    { as: "staff" },
    () => {
      if (moderatorFetching) return;
      moderatorFetching = true;
      void moderator
        .query("chat.moderation.recent")
        .catch((e) => unexpected("moderation feed", e))
        .finally(() => (moderatorFetching = false));
    },
    stop.signal,
    "moderator chat stream",
  );
  keepStream(
    display,
    "public.gameState",
    { gameId: game.id },
    ignore,
    stop.signal,
    "display stream",
  );

  const total = durationSeconds(profile);
  holdStart = profile.stages[0]!.rampSeconds;
  holdEnd = total - profile.rampDownSeconds;
  const holdLength = holdEnd - holdStart;
  startedAt = now();
  const elapsed = () => (now() - startedAt) / 1000;

  // Ramp: start or stop bots to follow the profile.
  const scheduler = (async () => {
    while (!stop.signal.aborted && elapsed() < total) {
      const want = botsAt(profile, elapsed());
      const active = bots.filter((b) => b.active);
      for (let i = active.length; i < want; i++) {
        const bot = new Bot(bots.length, game.id, game.code, teamIds);
        bots.push(bot);
        bot.active = true;
        void bot.start().catch((e) => {
          bot.active = false;
          unexpected("join", e);
        });
      }
      for (const bot of active.slice(want).reverse()) bot.stopBot();
      await sleep(250);
    }
  })();

  const control = async <T>(fn: () => Promise<T>, where: string) => {
    const t0 = now();
    try {
      const value = await fn();
      metrics.coordinatorAck.push(now() - t0);
      return value;
    } catch (e) {
      unexpected(where, e);
      return undefined;
    }
  };

  // Buzzer rounds every 10 seconds while bots are connected.
  const probes = new Set<string>();
  const coordinator = (async () => {
    await sleep(5_000);
    let lastWindow = 0;
    while (!stop.signal.aborted && elapsed() < total - 5) {
      const roundStart = now();
      await control(
        () => owner.mutation("gameAdmin.resetBuzzer"),
        "resetBuzzer",
      );
      currentWindow++;
      await control(
        () => owner.mutation("gameAdmin.startBuzzer"),
        "startBuzzer",
      );
      await sleep(WORKLOAD.buzzWindowSeconds * 1000);
      await control(
        () => owner.mutation("gameAdmin.pauseBuzzer"),
        "pauseBuzzer",
      );
      const claim = await db.buzzClaim.findFirst({
        where: { gameId: game.id, window: { gt: lastWindow } },
        orderBy: { window: "desc" },
      });
      if (claim) {
        lastWindow = claim.window;
        const scored = await control(
          () =>
            owner.mutation("gameAdmin.addScore", {
              requestId: `load${runId}w${claim.window}`,
              changes: { [claim.gameTeamId]: 1 },
            }),
          "addScore",
        );
        if (scored !== undefined) {
          expectedScores.set(
            claim.gameTeamId,
            (expectedScores.get(claim.gameTeamId) ?? 0) + 1,
          );
        }
      }

      // Probes run between windows, at fixed points in the hold.
      const f = (elapsed() - holdStart) / holdLength;
      const live = bots.filter((b) => b.active && b.gameUserId);
      const once = (name: string, from: number) =>
        f >= from && !probes.has(name) && live.length > 2 && probes.add(name);

      if (once("mute", 0.2)) {
        const target = live[0]!;
        await control(
          () =>
            moderator.mutation("chat.moderation.mute", {
              actorKey: `player:${target.gameUserId}`,
              minutes: null,
            }),
          "mute",
        );
        if ((await target.send()) === "muted") {
          metrics.muteProbe.mutedSendsRefused++;
        }
        await control(
          () => owner.mutation("gameAdmin.resetBuzzer"),
          "resetBuzzer",
        );
        currentWindow++;
        await control(
          () => owner.mutation("gameAdmin.startBuzzer"),
          "startBuzzer",
        );
        // Processed by the buzzer (won, held or beaten), not blocked by the mute.
        const outcome = await target.buzz();
        if (
          ["won", "teammateHeld", "notListening", "rejectedTeam"].includes(
            outcome,
          )
        ) {
          metrics.muteProbe.mutedBuzzesProcessed++;
        }
        await control(
          () => owner.mutation("gameAdmin.pauseBuzzer"),
          "pauseBuzzer",
        );
        await control(
          () =>
            moderator.mutation("chat.moderation.unmute", {
              actorKey: `player:${target.gameUserId}`,
            }),
          "unmute",
        );
      }
      if (once("rename", 0.35)) {
        const target = live[1]!;
        await control(
          () =>
            owner.mutation("gameAdmin.roster.renamePlayer", {
              gameUserId: target.gameUserId,
              name: `Renamed ${target.index}`,
              allowSelfRename: false,
            }),
          "rename+lock",
        );
        await control(
          () =>
            owner.mutation("gameAdmin.roster.renamePlayer", {
              gameUserId: target.gameUserId,
              allowSelfRename: true,
            }),
          "unlock",
        );
      }
      if (once("remove-message", 0.5)) {
        const recent = await control(
          () =>
            moderator.query<{ id: string; state: string }[]>(
              "chat.moderation.recent",
              { limit: 20 },
            ),
          "recent",
        );
        const visible = recent?.find((m) => m.state === "visible");
        if (visible) {
          await control(
            () =>
              moderator.mutation("chat.moderation.remove", {
                messageId: visible.id,
                reason: "other",
              }),
            "remove",
          );
        }
      }
      if (once("move", 0.6)) {
        const target = live[2]!;
        const to = teamIds.find((id) => id !== target.teamId)!;
        const t0 = now();
        target.onPulse = (pulse) => {
          if (pulse.channels.some((c) => c.key === `team:${to}`)) {
            metrics.moveProbe.pulseWithNewTeamMs ??= Math.round(now() - t0);
          }
        };
        await control(
          () =>
            owner.mutation("gameAdmin.movePlayerToTeam", {
              gameUserId: target.gameUserId,
              targetGameTeamId: to,
            }),
          "move",
        );
      }
      if (once("reconnect", 0.7)) {
        const target = live[3] ?? live[0]!;
        const t0 = now();
        target.onState = () => {
          metrics.reconnectToState.push(now() - t0);
          target.onState = undefined;
        };
        target.reconnect();
      }
      if (once("role-change", 0.8)) {
        const cohostRow = seeded.game.gameAdmins.find(
          (a) => a.userId === seeded.cohost.user.id,
        )!;
        await control(
          () =>
            owner.mutation("gameAdmin.staff.setRole", {
              gameAdminId: cohostRow.id,
              role: "moderator",
            }),
          "setRole",
        );
        await control(
          () =>
            owner.mutation("gameAdmin.staff.setRole", {
              gameAdminId: cohostRow.id,
              role: "cohost",
            }),
          "setRole back",
        );
      }

      const wait = WORKLOAD.buzzEverySeconds * 1000 - (now() - roundStart);
      if (wait > 0) await sleep(wait);
    }
  })();

  // Sampling and ceilings every 5 seconds.
  const serverPid = server?.pid;
  const sampler = (async () => {
    while (!stop.signal.aborted && elapsed() < total) {
      await sleep(5_000);
      const [pg] = await db.$queryRaw<
        { connections: bigint; lock_waits: bigint }[]
      >`SELECT count(*) AS connections,
               count(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_waits
        FROM pg_stat_activity WHERE datname = current_database()`;
      const usage = {
        seconds: elapsed(),
        requests: counters.requests,
        messages: metrics.sends.accepted,
        bytes: counters.bytes,
        unexpectedErrors: metrics.unexpectedErrors.length,
        clients: bots.filter((b) => b.active).length + WORKLOAD.staffClients,
      };
      metrics.samples.push({
        t: Math.round(usage.seconds),
        bots: usage.clients - WORKLOAD.staffClients,
        streamsOpen: counters.streamsOpen,
        requests: counters.requests,
        pgConnections: Number(pg?.connections ?? 0),
        pgLockWaits: Number(pg?.lock_waits ?? 0),
        ...processStats(serverPid),
        runnerRssMb: Math.round(process.memoryUsage().rss / 1_048_576),
      });
      const over = exceededCeiling(usage, ceilings);
      if (over) abortRun(`ceiling: ${over}`);
      process.stdout.write(
        `t=${Math.round(usage.seconds)}s bots=${usage.clients - WORKLOAD.staffClients} streams=${counters.streamsOpen} sent=${metrics.sends.accepted} errors=${metrics.unexpectedErrors.length}\n`,
      );
    }
  })();

  await Promise.all([scheduler, coordinator, sampler]);
  for (const bot of bots) bot.stopBot();
  // Let in-flight fetches land before checking deliveries.
  await sleep(2_000);
  stop.abort();

  // ------------------------------------------------------------ invariants

  const stored = await db.chatMessage.count({
    where: { gameId: game.id, requestId: { in: [...acceptedRequestIds] } },
  });
  const allSynthetic = await db.chatMessage.count({
    where: { gameId: game.id },
  });
  const claims = await db.buzzClaim.count({ where: { gameId: game.id } });
  const finalState = await display.query<{
    gameTeams: { id: string; name: string; score: number }[];
  }>("public.currentGameState", { gameId: game.id });
  const scoreMismatches = finalState.gameTeams
    .map((t) => ({
      team: t.name,
      expected: expectedScores.get(t.id) ?? 0,
      actual: t.score,
    }))
    .filter((t) => t.expected !== t.actual);
  const holdMessages = [...sent.values()].filter((m) => m.inHold);
  const expectedDeliveries = holdMessages.reduce(
    (s, m) => s + m.recipients.size,
    0,
  );
  const holdDeliveries = holdMessages.reduce((s, m) => s + m.delivered, 0);
  const multiWinWindows = [...windowWins.values()].filter((n) => n > 1).length;

  const invariants = {
    acceptedMessagesStored: stored === acceptedRequestIds.size,
    noUnexpectedMessages: allSynthetic === acceptedRequestIds.size,
    oneWinnerPerWindow: multiWinWindows === 0,
    winsMatchClaims: metrics.buzzes.won === claims,
    scoresReconcile: scoreMismatches.length === 0,
    noPrivateLeaks: metrics.privacyProbes.leaked === 0,
    mutedCanStillBuzz:
      !probes.has("mute") ||
      (metrics.muteProbe.mutedSendsRefused === 1 &&
        metrics.muteProbe.mutedBuzzesProcessed === 1),
  };

  const summaries = {
    joinMs: summarize(metrics.joins),
    chatSendAckMs: summarize(metrics.sendAck),
    buzzAckMs: summarize(metrics.buzzAck),
    chatVisibleDeliveryMs: summarize(metrics.delivery),
    channelFetchMs: summarize(metrics.fetch),
    coordinatorAckMs: summarize(metrics.coordinatorAck),
    reconnectToStateMs: summarize(metrics.reconnectToState),
  };
  const totalRequests = counters.requests;
  const unexpectedRate =
    metrics.unexpectedErrors.length / Math.max(1, totalRequests);
  const targets = {
    httpAndBuzzP95Under500:
      (summaries.buzzAckMs.p95 ?? 0) < 500 &&
      (summaries.chatSendAckMs.p95 ?? 0) < 500,
    chatP95Under1000: (summaries.chatVisibleDeliveryMs.p95 ?? 0) < 1_000,
    chatP99Under2000: (summaries.chatVisibleDeliveryMs.p99 ?? 0) < 2_000,
    unexpectedFailuresUnder0_1Percent: unexpectedRate < 0.001,
    reconnectUnder5s: (summaries.reconnectToStateMs.max ?? 0) < 5_000,
  };

  let sha = "unknown";
  try {
    sha = execFileSync("git", ["rev-parse", "--short", "HEAD"])
      .toString()
      .trim();
  } catch {
    // not a git checkout
  }
  const report = {
    runId,
    sha,
    startedAt: new Date(Date.now() - (now() - startedAt)).toISOString(),
    stopReason,
    plan,
    environment: {
      runtime: `bun ${process.versions.bun}`,
      cpus: cpus().length,
      cpuModel: cpus()[0]?.model,
      memoryGb: Math.round(totalmem() / 1_073_741_824),
      topology: "1 next start instance, local PostgreSQL + Redis",
      generator: "single bun process (runner), same machine as the server",
    },
    counts: {
      botsStarted: bots.length,
      peakStreamsOpen: Math.max(
        0,
        ...metrics.samples.map((s) => s.streamsOpen ?? 0),
      ),
      streamsOpened: counters.streamsOpened,
      streamEvents: counters.streamEvents,
      requests: totalRequests,
      bytesReceived: counters.bytes,
      sends: metrics.sends,
      buzzes: { ...metrics.buzzes, windows: currentWindow, claims },
      pulses: metrics.pulses,
      streamReopens: metrics.streamReopens,
      fetches: metrics.fetches,
      fetchesCoalesced: metrics.fetchesCoalesced,
      holdDeliveries: {
        expected: expectedDeliveries,
        observed: holdDeliveries,
      },
      privacyProbes: metrics.privacyProbes,
      muteProbe: metrics.muteProbe,
      moveProbe: metrics.moveProbe,
      probesRun: [...probes],
    },
    latency: summaries,
    targets,
    invariants,
    scoreMismatches,
    unexpectedErrors: {
      count: metrics.unexpectedErrors.length,
      rate: unexpectedRate,
      first: metrics.unexpectedErrors.slice(0, 20),
    },
    samples: metrics.samples,
  };

  mkdirSync(args.out, { recursive: true });
  const file = `${args.out}/${profile.name}-${runId}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        report: file,
        stopReason,
        counts: report.counts,
        latency: summaries,
        targets,
        invariants,
      },
      null,
      2,
    ),
  );

  // ------------------------------------------------------------ cleanup

  if (!args.keep) {
    await db.game.delete({ where: { id: game.id } });
    await db.user.deleteMany({
      where: {
        id: {
          in: [
            seeded.owner.user.id,
            seeded.cohost.user.id,
            seeded.moderator.user.id,
          ],
        },
      },
    });
  }
  await db.$disconnect();
  server?.kill();
  const ok = Object.values(invariants).every(Boolean) && !stopReason;
  process.exit(ok ? 0 : 1);
}

function processStats(pid: number | undefined): Record<string, number | null> {
  if (!pid) return { serverCpuPercent: null, serverRssMb: null };
  try {
    const rows = execFileSync("ps", ["-eo", "pid=,ppid=,pcpu=,rss="])
      .toString()
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    const tree = new Set([pid]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [p, pp] of rows) {
        if (!tree.has(p!) && tree.has(pp!)) {
          tree.add(p!);
          changed = true;
        }
      }
    }
    const mine = rows.filter(([p]) => tree.has(p!));
    return {
      serverCpuPercent: Math.round(mine.reduce((s, r) => s + r[2]!, 0)),
      serverRssMb: Math.round(mine.reduce((s, r) => s + r[3]!, 0) / 1024),
    };
  } catch {
    return { serverCpuPercent: null, serverRssMb: null };
  }
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
