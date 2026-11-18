/**
 * Load profiles and workload arithmetic for the mixed chat + buzzer runner.
 * Pure: used for dry runs, ceilings and the report.
 */

export type Stage = { bots: number; rampSeconds: number; holdSeconds: number };

export type Profile = {
  name: string;
  description: string;
  stages: Stage[];
  rampDownSeconds: number;
};

export const WORKLOAD = {
  teams: 6,
  /** Owner (coordinator), co-host, moderator and audience display. */
  staffClients: 4,
  messageEverySeconds: 30,
  teamChannelShare: 0.8,
  messageBytes: 128,
  buzzEverySeconds: 10,
  /** How long a buzzer window stays open before it's scored and reset. */
  buzzWindowSeconds: 3,
} as const;

export const PROFILES = {
  "smoke-10": {
    name: "smoke-10",
    description: "10 bots + 4 staff/display clients, 2 minutes. CI-sized.",
    stages: [{ bots: 10, rampSeconds: 15, holdSeconds: 90 }],
    rampDownSeconds: 15,
  },
  "mixed-100": {
    name: "mixed-100",
    description:
      "100 bots + 4 staff/display clients: 2-minute ramp, 10-minute hold, 2-minute ramp-down.",
    stages: [{ bots: 100, rampSeconds: 120, holdSeconds: 600 }],
    rampDownSeconds: 120,
  },
  "soak-100": {
    name: "soak-100",
    description: "Same as mixed-100 with a 60-minute hold. Before an event.",
    stages: [{ bots: 100, rampSeconds: 300, holdSeconds: 3_600 }],
    rampDownSeconds: 300,
  },
  // Scaling comparison: the same per-user workload and shape at 10, 100 and
  // 1,000 users, so per-user costs can be compared (docs/load-scaling.md).
  "scale-10": {
    name: "scale-10",
    description: "Scaling comparison: 10 bots, 1-minute ramp, 3-minute hold.",
    stages: [{ bots: 10, rampSeconds: 60, holdSeconds: 180 }],
    rampDownSeconds: 30,
  },
  "scale-100": {
    name: "scale-100",
    description: "Scaling comparison: 100 bots, 1-minute ramp, 3-minute hold.",
    stages: [{ bots: 100, rampSeconds: 60, holdSeconds: 180 }],
    rampDownSeconds: 30,
  },
  "scale-1000": {
    name: "scale-1000",
    description:
      "Scaling comparison: 1,000 bots, 3-minute ramp, 3-minute hold. Local research only.",
    stages: [{ bots: 1_000, rampSeconds: 180, holdSeconds: 180 }],
    rampDownSeconds: 30,
  },
  "capacity-1000-local": {
    name: "capacity-1000-local",
    description:
      "Optional local capacity research: 100 → 250 → 500 → 1,000 bots. Not a product promise.",
    stages: [
      { bots: 100, rampSeconds: 120, holdSeconds: 180 },
      { bots: 250, rampSeconds: 120, holdSeconds: 180 },
      { bots: 500, rampSeconds: 120, holdSeconds: 180 },
      { bots: 1_000, rampSeconds: 120, holdSeconds: 600 },
    ],
    rampDownSeconds: 180,
  },
} as const satisfies Record<string, Profile>;

export type ProfileName = keyof typeof PROFILES;

export function isProfileName(name: string): name is ProfileName {
  return name in PROFILES;
}

/** Scales every stage's hold (for short local trials); recorded in reports. */
export function withHoldScale(profile: Profile, scale: number): Profile {
  return {
    ...profile,
    stages: profile.stages.map((s) => ({
      ...s,
      holdSeconds: Math.max(10, Math.round(s.holdSeconds * scale)),
    })),
  };
}

/** Bots that should be connected `t` seconds after the start. */
export function botsAt(profile: Profile, t: number): number {
  let elapsed = 0;
  let previous = 0;
  for (const stage of profile.stages) {
    if (t < elapsed + stage.rampSeconds) {
      const fraction = (t - elapsed) / stage.rampSeconds;
      return Math.round(previous + (stage.bots - previous) * fraction);
    }
    elapsed += stage.rampSeconds;
    if (t < elapsed + stage.holdSeconds) return stage.bots;
    elapsed += stage.holdSeconds;
    previous = stage.bots;
  }
  if (t < elapsed + profile.rampDownSeconds) {
    const fraction = (t - elapsed) / profile.rampDownSeconds;
    return Math.round(previous * (1 - fraction));
  }
  return 0;
}

export function durationSeconds(profile: Profile): number {
  return (
    profile.stages.reduce((sum, s) => sum + s.rampSeconds + s.holdSeconds, 0) +
    profile.rampDownSeconds
  );
}

export function peakBots(profile: Profile): number {
  return Math.max(...profile.stages.map((s) => s.bots));
}

export type WorkloadEstimate = {
  durationSeconds: number;
  peakBots: number;
  peakClients: number;
  /** Live streams at peak: each bot and staff desk holds game + chat. */
  peakStreams: number;
  botSeconds: number;
  messages: number;
  messagesPerSecondAtPeak: number;
  /** Viewers notified per message, before coalescing. */
  deliveries: number;
  buzzWindows: number;
  buzzAttempts: number;
  /** HTTP requests: joins, sends, buzzes, channel fetches, coordinator. */
  requests: number;
  /** Rough bytes received by the runner, for cost/ceiling planning. */
  bytes: number;
};

/**
 * Expected traffic for a profile, before coalescing. Chat fan-out assumes an
 * even team split; every visible change makes each viewer fetch at most once.
 */
export function estimateWorkload(profile: Profile): WorkloadEstimate {
  const duration = durationSeconds(profile);
  let botSeconds = 0;
  for (let t = 0; t < duration; t++) botSeconds += botsAt(profile, t);
  const peak = peakBots(profile);
  const messages = botSeconds / WORKLOAD.messageEverySeconds;
  const avgBots = botSeconds / duration;
  const staffViewers = 3;
  const perMessageViewers =
    WORKLOAD.teamChannelShare * (avgBots / WORKLOAD.teams + staffViewers) +
    (1 - WORKLOAD.teamChannelShare) * (avgBots + staffViewers);
  const deliveries = messages * perMessageViewers;
  const buzzWindows = Math.floor(duration / WORKLOAD.buzzEverySeconds);
  const buzzAttempts = buzzWindows * avgBots;
  const coordinatorRequests = buzzWindows * 4;
  const requests =
    peak + messages + buzzAttempts + deliveries + coordinatorRequests;
  // Channel fetch ≈ 50 messages × ~400 bytes; game snapshot ≈ 150 bytes/player.
  const fetchBytes = deliveries * 50 * 400;
  const stateBytes = buzzWindows * 4 * (avgBots + 4) * (avgBots * 150);
  return {
    durationSeconds: duration,
    peakBots: peak,
    peakClients: peak + WORKLOAD.staffClients,
    peakStreams: peak * 2 + 3 * 2 + 1,
    botSeconds,
    messages: Math.round(messages),
    messagesPerSecondAtPeak: peak / WORKLOAD.messageEverySeconds,
    deliveries: Math.round(deliveries),
    buzzWindows,
    buzzAttempts: Math.round(buzzAttempts),
    requests: Math.round(requests),
    bytes: Math.round(fetchBytes + stateBytes),
  };
}
