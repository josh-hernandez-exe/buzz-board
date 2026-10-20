import { describe, expect, it } from "vitest";

import { chatPulseChanges } from "./chatPulse";

const pulse = (channels: Record<string, number>, rosterRevision = "r1") => ({
  channels: Object.entries(channels).map(([key, revision]) => ({
    key,
    revision,
  })),
  rosterRevision,
});

describe("chatPulseChanges", () => {
  it("re-fetches everything after connecting or reconnecting", () => {
    expect(
      chatPulseChanges(undefined, pulse({ game: 3, "team:a": 1 })),
    ).toEqual({ refetch: ["game", "team:a"], drop: [], rosterChanged: true });
  });

  it("re-fetches only channels whose revision changed", () => {
    expect(
      chatPulseChanges(
        pulse({ game: 3, "team:a": 1 }),
        pulse({ game: 4, "team:a": 1 }),
      ),
    ).toEqual({ refetch: ["game"], drop: [], rosterChanged: false });
  });

  it("drops a channel the viewer lost and loads the new one", () => {
    expect(
      chatPulseChanges(
        pulse({ game: 3, "team:a": 1 }),
        pulse({ game: 3, "team:b": 7 }),
      ),
    ).toEqual({ refetch: ["team:b"], drop: ["team:a"], rosterChanged: false });
  });

  it("re-fetches every open channel when names or roles change", () => {
    expect(
      chatPulseChanges(pulse({ game: 3 }), pulse({ game: 3 }, "r2")),
    ).toEqual({ refetch: ["game"], drop: [], rosterChanged: true });
  });
});
