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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { processTree, ResourceSampler } from "./resources";
import { mergeChannelView, sinceFor } from "../../src/utils/chatChannelMerge";
import {
  applyRosterUpdate,
  type LiveRoster,
  type PrivateGameStateUpdate,
} from "../../src/utils/liveRoster";
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
    /** "queue": every buzz lines up; the host judges wrong then right. */
    "buzzer-mode": { type: "string", default: "first" },
    /** Server instances to start (ports target, target+1, ...); bots are spread across them. */
    instances: { type: "string", default: "1" },
    /** Pin the started server(s) to these CPUs (taskset list, e.g. "0" or "0-1"). */
    "server-cpus": { type: "string" },
    /**
     * Seconds between a bot's chat messages (default: the profile's 30).
     * 0 turns bot chat posting off, to measure buzzing and live state alone.
     */
    "chat-every": { type: "string" },
    /** Write a V8 CPU profile of each started server into this folder. */
    "server-profile": { type: "string" },
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
const queueMode = args["buzzer-mode"] === "queue";
if (!["first", "queue"].includes(args["buzzer-mode"])) {
  console.error("--buzzer-mode is first or queue");
  process.exit(2);
}
const estimate = estimateWorkload(profile);
// Bun's fetch allows only 256 requests at once by default, and every bot
// holds two streams open: without a higher limit the generator, not the
// server, becomes the bottleneck (requests queue inside the runner).
const fetchLimit = Number(process.env.BUN_CONFIG_MAX_HTTP_REQUESTS ?? 256);
if (fetchLimit < estimate.peakStreams + estimate.peakClients + 100) {
  console.error(
    `BUN_CONFIG_MAX_HTTP_REQUESTS is ${fetchLimit}, too low for ${estimate.peakStreams} streams: requests would queue in the runner. Use \`bun run load\`, which sets it.`,
  );
  process.exit(2);
}
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
  chatEverySeconds: args["chat-every"] ?? String(WORKLOAD.messageEverySeconds),
  buzzerMode: queueMode ? "queue" : "first",
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
const instanceCount = Math.max(1, Math.min(4, Number(args.instances) || 1));
/** One origin per server instance; bot i uses origins[i % n]. */
const origins = Array.from({ length: instanceCount }, (_, i) => {
  const u = new URL(origin);
  u.port = String(Number(u.port || "80") + i);
  return u.origin;
});
const originFor = (index: number) => origins[index % origins.length]!;
const chatEverySeconds =
  args["chat-every"] === undefined
    ? WORKLOAD.messageEverySeconds
    : Math.max(0, Number(args["chat-every"]));

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

function startServer(instanceOrigin: string): ChildProcess {
  const port = new URL(instanceOrigin).port || "80";
  const command = ["bunx", "next", "start", "--port", port];
  const pinned = args["server-cpus"]
    ? ["taskset", "-c", args["server-cpus"], ...command]
    : command;
  // Bun loads .env.development.local into this runner; the development-only
  // sign-in must never reach a production server (it refuses to start).
  const { DEV_LOGIN: _devLogin, ...inherited } = process.env;
  return spawn(pinned[0]!, pinned.slice(1), {
    // Its own process group, so the whole tree (bunx and next-server) can
    // be stopped together: a surviving next-server keeps the port, and the
    // next run would silently measure that old server instead of its own.
    detached: true,
    env: {
      ...inherited,
      ...(args["server-profile"]
        ? {
            NODE_OPTIONS: `--cpu-prof --cpu-prof-dir=${args["server-profile"]}`,
          }
        : {}),
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "load-only-secret",
      AUTH_TRUST_HOST: "true",
      NEXTAUTH_URL: instanceOrigin,
      AUTH_DISCORD_CLIENT_ID: process.env.AUTH_DISCORD_CLIENT_ID ?? "unused",
      AUTH_DISCORD_CLIENT_SECRET:
        process.env.AUTH_DISCORD_CLIENT_SECRET ?? "unused",
      AUTH_GOOGLE_CLIENT_ID: process.env.AUTH_GOOGLE_CLIENT_ID ?? "unused",
      AUTH_GOOGLE_CLIENT_SECRET:
        process.env.AUTH_GOOGLE_CLIENT_SECRET ?? "unused",
      NEXT_PUBLIC_QRCODE_BASE_URL: instanceOrigin,
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "ignore",
  });
}

async function answering(instanceOrigin: string) {
  try {
    await fetch(`${instanceOrigin}/join`, {
      redirect: "manual",
      signal: AbortSignal.timeout(2_000),
    });
    return true;
  } catch {
    return false;
  }
}

/** Stops a started server's whole process group. */
function stopServer(server: ChildProcess) {
  if (!server.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

async function waitForServer(instanceOrigin: string) {
  // Up to 3 minutes: a cold start right after a build can take over one.
  for (let i = 0; i < 360; i++) {
    try {
      const res = await fetch(`${instanceOrigin}/join`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`No server at ${instanceOrigin}`);
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
      buzzerMode: queueMode ? "queue" : "first",
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
  /** Fetches answered with only new messages (see chatChannelMerge.ts). */
  fetchesAppendOnly: 0,
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
  /** The same latencies, steady state only (the hold, not ramps). */
  hold: {
    joins: [] as number[],
    sendAck: [] as number[],
    buzzAck: [] as number[],
    delivery: [] as number[],
    probe: [] as number[],
  },
  probe: { all: [] as number[], failures: 0, lagMax: 0 },
  /** Player-list updates the bots received, by kind (see liveRoster.ts). */
  rosterUpdates: { full: 0, delta: 0, same: 0 },
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
const queueStats = { rounds: 0, entries: 0, correct: 0, ruleViolations: 0 };
let currentWindow = 0;

// ---------------------------------------------------------------- bots

type Pulse = {
  channels: { key: string; revision: number }[];
  muted: unknown;
};
type GameStateSnapshot = PrivateGameStateUpdate;

type BotChannelView = {
  appendOnly: boolean;
  revision: number;
  hasOlder: boolean;
  messages: { sequence: number; body: string | null }[];
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
  roster: LiveRoster | null = null;
  views = new Map<string, BotChannelView>();
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
      originFor(this.index),
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
    if (inHold()) metrics.hold.joins.push(now() - t0);
    this.gameUserId = joined.gameUser.id;
    this.teamId = joined.gameUser.gameTeamId;
    this.http = new TrpcHttp(
      originFor(this.index),
      { gameId: this.gameId, gameUserToken: joined.token },
      counters,
    );
    this.active = true;
    this.openStreams();
    if (chatEverySeconds > 0) {
      this.schedule(random() * chatEverySeconds * 1000);
    }
    // One privacy probe per bot: another team's channel must be refused.
    void this.probePrivacy();
  }

  openStreams() {
    const signal = AbortSignal.any([this.controller.signal, stop.signal]);
    keepStream<GameStateSnapshot>(
      this.http,
      "gameGeneral.gameState",
      {},
      (update) => {
        // As the page does: the player list comes whole, then as changes.
        metrics.rosterUpdates[update.roster.kind]++;
        // Bots only need players, not team member lists.
        this.roster = applyRosterUpdate(this.roster, update, { teams: false });
        if (this.roster) {
          this.teamId =
            this.roster.state.gameUsers[this.gameUserId]?.gameTeamId ?? null;
        }
        const open = update.game.isBuzzerListening;
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
    // As a page does after reconnecting: whole views again.
    this.views.clear();
    this.revisions.clear();
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
        // As the page does: only the messages after the view held.
        const held = this.views.get(key);
        const fetched = await this.http.query<BotChannelView>("chat.channel", {
          as: "player",
          channelKey: key,
          limit: 50,
          since: sinceFor(held),
        });
        if (fetched.appendOnly) metrics.fetchesAppendOnly++;
        const view = mergeChannelView(held, fetched, 50);
        this.views.set(key, view);
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
            if (record.inHold) metrics.hold.delivery.push(at - record.at);
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
      this.schedule(chatEverySeconds * 1000 * (1 + jitter));
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
      if (inHold()) metrics.hold.sendAck.push(now() - t0);
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
      if (inHold()) metrics.hold.buzzAck.push(now() - t0);
      if (result.replayed) {
        metrics.buzzes.teammateHeld++;
        return "teammateHeld";
      }
      metrics.buzzes.won++;
      windowWins.set(window, (windowWins.get(window) ?? 0) + 1);
      return "won";
    } catch (e) {
      metrics.buzzAck.push(now() - t0);
      if (inHold()) metrics.hold.buzzAck.push(now() - t0);
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
  const servers: ChildProcess[] = [];
  if (args["start-server"]) {
    for (const o of origins) {
      if (await answering(o)) {
        console.error(
          `Something is already listening at ${o}: stop it first (an old load server would be measured instead of this build).`,
        );
        process.exit(2);
      }
    }
    for (const o of origins) servers.push(startServer(o));
    process.on("exit", () => servers.forEach(stopServer));
  }
  for (const o of origins) await waitForServer(o);
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

  /**
   * Queue mode: check the line's rules, mark the first team wrong (the next
   * answers) and the next one right, then score it like a first-buzz win.
   */
  const judgeQueueRound = async () => {
    const g = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    const entries = await db.buzzQueueEntry.findMany({
      where: { gameId: game.id, window: g.buzzerWindow },
      orderBy: { position: "asc" },
    });
    queueStats.rounds++;
    queueStats.entries += entries.length;
    const active = entries.filter(
      (e) => e.status === "waiting" || e.status === "answering",
    );
    if (
      entries.filter((e) => e.status === "answering").length > 1 ||
      new Set(entries.map((e) => e.position)).size !== entries.length ||
      new Set(active.map((e) => e.gameTeamId)).size !== active.length ||
      (active.length > 0 && active[0]!.status !== "answering")
    ) {
      queueStats.ruleViolations++;
    }
    const judge = (entryId: string, verdict: "correct" | "wrong") =>
      control(
        () => owner.mutation("gameAdmin.buzzer.judge", { entryId, verdict }),
        `judge ${verdict}`,
      );
    let answering = active[0];
    if (answering && active.length > 1) {
      await judge(answering.id, "wrong");
      answering = active[1];
    }
    if (!answering) return;
    await judge(answering.id, "correct");
    const scored = await control(
      () =>
        owner.mutation("gameAdmin.addScore", {
          requestId: `load${runId}q${g.buzzerWindow}`,
          changes: { [answering.gameTeamId]: 1 },
        }),
      "addScore",
    );
    if (scored !== undefined) {
      queueStats.correct++;
      expectedScores.set(
        answering.gameTeamId,
        (expectedScores.get(answering.gameTeamId) ?? 0) + 1,
      );
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
      if (queueMode) {
        await judgeQueueRound();
      }
      const claim = queueMode
        ? null
        : await db.buzzClaim.findFirst({
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

  // Latency probe in its own process (see probe.ts).
  const probe = spawn("bun", ["scripts/load/probe.ts", origins[0]!, game.id], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  process.on("exit", () => probe.kill());
  let probeBuffer = "";
  probe.stdout?.on("data", (chunk: Buffer) => {
    probeBuffer += chunk.toString();
    let nl;
    while ((nl = probeBuffer.indexOf("\n")) >= 0) {
      const line = probeBuffer.slice(0, nl);
      probeBuffer = probeBuffer.slice(nl + 1);
      try {
        const p = JSON.parse(line) as { ms: number; lag: number; ok: boolean };
        // Counted like any request, so per-request costs include it.
        counters.requests++;
        if (!p.ok) metrics.probe.failures++;
        metrics.probe.all.push(p.ms);
        if (inHold()) metrics.hold.probe.push(p.ms);
        metrics.probe.lagMax = Math.max(metrics.probe.lagMax, p.lag);
      } catch {
        // partial line
      }
    }
  });

  // Sampling and ceilings every 5 seconds.
  const resources = new ResourceSampler(
    servers.map((s) => s.pid).filter((p): p is number => !!p),
  );
  const pgCounters = async () => {
    const [row] = await db.$queryRaw<
      { xacts: bigint; rows: bigint }[]
    >`SELECT xact_commit + xact_rollback AS xacts,
             tup_returned + tup_fetched + tup_inserted + tup_updated + tup_deleted AS rows
      FROM pg_stat_database WHERE datname = current_database()`;
    return { xacts: Number(row?.xacts ?? 0), rows: Number(row?.rows ?? 0) };
  };
  let lastPg = await pgCounters();
  let lastSampleRequests = counters.requests;
  let lastSampleEvents = counters.streamEvents;
  let lastSampleBytes = counters.bytes;
  const sampler = (async () => {
    while (!stop.signal.aborted && elapsed() < total) {
      await sleep(5_000);
      const [pg] = await db.$queryRaw<
        { connections: bigint; lock_waits: bigint }[]
      >`SELECT count(*) AS connections,
               count(*) FILTER (WHERE wait_event_type = 'Lock') AS lock_waits
        FROM pg_stat_activity WHERE datname = current_database()`;
      const pgNow = await pgCounters();
      const res = resources.sample();
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
        hold: inHold() ? 1 : 0,
        ...res,
        dRequests: counters.requests - lastSampleRequests,
        dStreamEvents: counters.streamEvents - lastSampleEvents,
        dBytes: counters.bytes - lastSampleBytes,
        dPgXacts: pgNow.xacts - lastPg.xacts,
        dPgRows: pgNow.rows - lastPg.rows,
        serverRssMb: serverRss(servers),
        runnerRssMb: Math.round(process.memoryUsage().rss / 1_048_576),
      });
      lastPg = pgNow;
      lastSampleRequests = counters.requests;
      lastSampleEvents = counters.streamEvents;
      lastSampleBytes = counters.bytes;
      const over = exceededCeiling(usage, ceilings);
      if (over) abortRun(`ceiling: ${over}`);
      process.stdout.write(
        `t=${Math.round(usage.seconds)}s bots=${usage.clients - WORKLOAD.staffClients} streams=${counters.streamsOpen} sent=${metrics.sends.accepted} errors=${metrics.unexpectedErrors.length}\n`,
      );
    }
  })();

  await Promise.all([scheduler, coordinator, sampler]);
  resources.stop();
  probe.kill();
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
  const claims = queueMode
    ? await db.buzzQueueEntry.count({ where: { gameId: game.id } })
    : await db.buzzClaim.count({ where: { gameId: game.id } });
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
  // Wins as the runner saw them: labelled with the window open when the buzz
  // was sent. When acknowledgements take longer than a window, a buzz can be
  // accepted in the next window and be counted twice here, so this is a
  // latency diagnostic, not the correctness check.
  const lateAttributedWindows = [...windowWins.values()].filter(
    (n) => n > 1,
  ).length;
  // The correctness check: stored claims, at most one per server window.
  const claimsPerWindow = queueMode
    ? []
    : await db.buzzClaim.groupBy({
        by: ["window"],
        where: { gameId: game.id },
        _count: { _all: true },
      });
  const multiWinWindows = claimsPerWindow.filter(
    (w) => w._count._all > 1,
  ).length;

  const invariants = {
    acceptedMessagesStored: stored === acceptedRequestIds.size,
    noUnexpectedMessages: allSynthetic === acceptedRequestIds.size,
    // First-buzz: one winner per window. Queue: the line kept its rules
    // (one answering, unique places, one place per team) every round.
    oneWinnerPerWindow: queueMode
      ? queueStats.ruleViolations === 0
      : multiWinWindows === 0,
    // Every win a bot was told about is a stored claim, and vice versa.
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
    probeMs: summarize(metrics.probe.all),
  };
  const holdLatency = {
    joinMs: summarize(metrics.hold.joins),
    chatSendAckMs: summarize(metrics.hold.sendAck),
    buzzAckMs: summarize(metrics.hold.buzzAck),
    chatVisibleDeliveryMs: summarize(metrics.hold.delivery),
    probeMs: summarize(metrics.hold.probe),
  };
  const resourceSummary = summarizeResources(metrics.samples);
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
      topology: `${instanceCount} next start instance(s)${args["server-cpus"] ? ` pinned to CPUs ${args["server-cpus"]}` : ""}, local PostgreSQL + Redis`,
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
      buzzes: {
        ...metrics.buzzes,
        windows: currentWindow,
        claims,
        ...(queueMode ? { queue: queueStats } : {}),
      },
      pulses: metrics.pulses,
      lateAttributedWindows,
      rosterUpdates: metrics.rosterUpdates,
      streamReopens: metrics.streamReopens,
      fetches: metrics.fetches,
      fetchesAppendOnly: metrics.fetchesAppendOnly,
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
    holdLatency,
    resources: resourceSummary,
    /** Requests, bytes and stream events per API path (whole run). */
    paths: counters.paths,
    probe: {
      failures: metrics.probe.failures,
      timerLagMaxMs: metrics.probe.lagMax,
    },
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
        holdLatency,
        resources: resourceSummary,
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
  servers.forEach(stopServer);
  const ok = Object.values(invariants).every(Boolean) && !stopReason;
  process.exit(ok ? 0 : 1);
}

function serverRss(servers: ChildProcess[]): number | null {
  let kb = 0;
  for (const server of servers) {
    if (!server.pid) continue;
    for (const pid of processTree(server.pid)) {
      try {
        const m = /VmRSS:\s+(\d+)/.exec(
          readFileSync(`/proc/${pid}/status`, "utf8"),
        );
        kb += Number(m?.[1] ?? 0);
      } catch {
        // exited
      }
    }
  }
  return servers.length > 0 ? Math.round(kb / 1024) : null;
}

/**
 * Steady-state (hold) averages of the resource samples, and the cost per
 * unit of work. If per-request or per-delivery costs stay flat as users
 * grow, the application scales linearly and any slowdown is the machine; if
 * they grow, the application does more work per user as the game grows.
 */
function summarizeResources(samples: Record<string, number | null>[]) {
  const hold = samples.filter((s) => s.hold === 1);
  const rows = hold.length > 0 ? hold : samples;
  const num = (s: Record<string, number | null>, key: string) => {
    const v = s[key];
    return typeof v === "number" ? v : null;
  };
  const avg = (key: string) => {
    const vals = rows
      .map((s) => num(s, key))
      .filter((v): v is number => v !== null);
    return vals.length
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
      : null;
  };
  const max = (key: string) =>
    Math.max(0, ...rows.map((s) => num(s, key) ?? 0));
  const sum = (key: string) => rows.reduce((a, s) => a + (num(s, key) ?? 0), 0);
  const seconds = Math.max(1, rows.length * 5);
  const serverCpuMs = (avg("serverCores") ?? 0) * seconds * 1000;
  const pgCpuMs = (avg("postgresCores") ?? 0) * seconds * 1000;
  const runnerCpuMs = (avg("runnerCores") ?? 0) * seconds * 1000;
  const requests = Math.max(1, sum("dRequests"));
  const events = Math.max(1, sum("dStreamEvents"));
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    samplesInHold: hold.length,
    average: {
      hostBusyPercent: avg("hostBusyPercent"),
      hostStealPercent: avg("hostStealPercent"),
      runQueue: avg("runQueue"),
      serverCores: avg("serverCores"),
      serverMainThreadCores: avg("serverMainThreadCores"),
      runnerCores: avg("runnerCores"),
      postgresCores: avg("postgresCores"),
      redisCores: avg("redisCores"),
      requestsPerSecond: Math.round((sum("dRequests") / seconds) * 10) / 10,
      streamEventsPerSecond:
        Math.round((sum("dStreamEvents") / seconds) * 10) / 10,
      receivedKbPerSecond: Math.round(sum("dBytes") / seconds / 1024),
      pgTransactionsPerSecond:
        Math.round((sum("dPgXacts") / seconds) * 10) / 10,
    },
    peak: {
      hostBusyPercent: max("hostBusyPercent"),
      runQueue: max("runQueue"),
      serverMainThreadCores: max("serverMainThreadCores"),
      runnerLoopLagMaxMs: max("runnerLoopLagMaxMs"),
      runnerLoopLagP99Ms: max("runnerLoopLagP99Ms"),
      serverRssMb: max("serverRssMb"),
      runnerRssMb: max("runnerRssMb"),
      pgConnections: max("pgConnections"),
      pgLockWaits: max("pgLockWaits"),
    },
    perUnit: {
      serverCpuMsPerRequest: r3(serverCpuMs / requests),
      serverCpuMsPerStreamEvent: r3(serverCpuMs / events),
      postgresCpuMsPerRequest: r3(pgCpuMs / requests),
      pgTransactionsPerRequest: r3(sum("dPgXacts") / requests),
      pgRowsPerRequest: r3(sum("dPgRows") / requests),
      runnerCpuMsPerStreamEvent: r3(runnerCpuMs / events),
      receivedBytesPerStreamEvent: Math.round(sum("dBytes") / events),
    },
  };
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
