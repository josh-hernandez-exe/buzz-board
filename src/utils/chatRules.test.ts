import { describe, expect, it } from "vitest";

import { canMute, CHAT_LIMITS, normalizeChatBody } from "./chatRules";

describe("normalizeChatBody", () => {
  it("accepts exactly 2,000 UTF-8 bytes and rejects 2,001", () => {
    expect(normalizeChatBody("a".repeat(2_000)).isOk()).toBe(true);
    expect(normalizeChatBody("a".repeat(2_001))._unsafeUnwrapErr()).toEqual({
      kind: "tooLong",
      maxBytes: CHAT_LIMITS.maxMessageBytes,
    });
  });

  it("counts multibyte characters by their UTF-8 size", () => {
    // "é" is 2 bytes and "🦊" is 4 bytes in UTF-8.
    expect(normalizeChatBody("é".repeat(1_000)).isOk()).toBe(true);
    expect(normalizeChatBody(`${"é".repeat(1_000)}x`).isErr()).toBe(true);
    expect(normalizeChatBody("🦊".repeat(500)).isOk()).toBe(true);
    expect(normalizeChatBody(`${"🦊".repeat(500)}x`).isErr()).toBe(true);
  });

  it("keeps newlines and tabs, normalizes line endings, and trims", () => {
    expect(normalizeChatBody("  hi\r\nthere\tyou \n")._unsafeUnwrap()).toBe(
      "hi\nthere\tyou",
    );
  });

  it("applies NFC so the byte count matches what is stored", () => {
    expect(normalizeChatBody("Cafe\u0301")._unsafeUnwrap()).toBe("Café");
  });

  it.each([
    ["a null character", "a\u0000b"],
    ["an escape character", "a\u001bb"],
    ["a bidi override", "a\u202eb"],
    ["a bidi isolate", "a\u2066b"],
  ])("rejects %s", (_, body) => {
    expect(normalizeChatBody(body)._unsafeUnwrapErr()).toEqual({
      kind: "forbiddenCharacter",
    });
  });

  it("rejects blank messages", () => {
    expect(normalizeChatBody(" \n\t ")._unsafeUnwrapErr()).toEqual({
      kind: "empty",
    });
  });
});

describe("canMute", () => {
  it("lets every staff role mute players", () => {
    for (const role of ["owner", "cohost", "moderator"] as const) {
      expect(canMute(role, { kind: "player" }, false)).toBe(true);
    }
  });

  it("lets co-hosts and the owner mute helpers, but nobody mutes the owner", () => {
    expect(canMute("cohost", { kind: "staff", role: "moderator" }, false)).toBe(
      true,
    );
    expect(canMute("cohost", { kind: "staff", role: "cohost" }, false)).toBe(
      true,
    );
    expect(
      canMute("moderator", { kind: "staff", role: "moderator" }, false),
    ).toBe(false);
    for (const role of ["owner", "cohost", "moderator"] as const) {
      expect(canMute(role, { kind: "staff", role: "owner" }, false)).toBe(
        false,
      );
    }
  });

  it("never lets someone mute themselves", () => {
    expect(canMute("owner", { kind: "player" }, true)).toBe(false);
  });
});
