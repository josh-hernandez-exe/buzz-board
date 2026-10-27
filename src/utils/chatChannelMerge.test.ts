import { describe, expect, it } from "vitest";

import { mergeChannelView, sinceFor } from "./chatChannelMerge";

const view = (
  seqs: number[],
  extra: Partial<{
    appendOnly: boolean;
    revision: number;
    hasOlder: boolean;
  }> = {},
) => ({
  appendOnly: false,
  revision: 1,
  hasOlder: false,
  messages: seqs.map((sequence) => ({ sequence })),
  ...extra,
});
const seqs = (v: { messages: { sequence: number }[] }) =>
  v.messages.map((m) => m.sequence);

describe("chat channel merge", () => {
  it("appends new messages, ignores ones already held, and keeps the window", () => {
    const held = view([1, 2, 3]);
    const merged = mergeChannelView(
      held,
      view([3, 4, 5], { appendOnly: true, revision: 3 }),
      4,
    );
    expect(seqs(merged)).toEqual([2, 3, 4, 5]);
    expect(merged).toMatchObject({
      appendOnly: false,
      revision: 3,
      hasOlder: true,
    });
  });

  it("replaces the held view with a full one", () => {
    const merged = mergeChannelView(
      view([1, 2]),
      view([5], { revision: 9 }),
      50,
    );
    expect(seqs(merged)).toEqual([5]);
  });

  it("asks for messages after the newest held, or everything for an empty view", () => {
    expect(sinceFor(view([4, 7], { revision: 5 }))).toEqual({
      revision: 5,
      afterSequence: 7,
    });
    expect(sinceFor(view([]))).toEqual({ revision: 1, afterSequence: 0 });
    expect(sinceFor(undefined)).toBeUndefined();
  });
});
