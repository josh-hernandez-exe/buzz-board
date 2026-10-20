import { describe, expect, it } from "vitest";

import { NAME_LIMITS, nameErrorMessage, normalizeName } from "./displayName";

describe("normalizeName", () => {
  it("trims and applies NFC", () => {
    // "e" + combining acute accent becomes a single "é".
    expect(normalizeName("  Cafe\u0301  ")._unsafeUnwrap()).toBe("Café");
  });

  it("counts code points, accepting exactly 40 and rejecting 41", () => {
    expect(normalizeName("a".repeat(40)).isOk()).toBe(true);
    expect(normalizeName("a".repeat(41))._unsafeUnwrapErr()).toEqual({
      kind: "tooLong",
      max: 40,
    });
  });

  it("counts an astral emoji as one code point, not two UTF-16 units", () => {
    expect(normalizeName("🦊".repeat(40)).isOk()).toBe(true);
    expect(normalizeName("🦊".repeat(41)).isErr()).toBe(true);
  });

  it.each([
    ["ZWJ family emoji", "👩‍👩‍👧"],
    ["variation selector", "❤️ fans"],
    ["combining marks", "Zoë\u0301"],
    ["right-to-left letters", "שלום"],
    ["left-to-right mark", "Team\u200eA"],
  ])("keeps %s", (_, name) => {
    expect(normalizeName(name).isOk()).toBe(true);
  });

  it.each([
    ["a newline", "Bad\nName"],
    ["a tab", "Bad\tName"],
    ["a C1 control", "Bad\u0085Name"],
    ["a bidi override", "Bad\u202eemaN"],
    ["a bidi isolate", "Bad\u2067Name"],
  ])("rejects %s", (_, name) => {
    expect(normalizeName(name)._unsafeUnwrapErr()).toEqual({
      kind: "forbiddenCharacter",
    });
  });

  it("rejects blank names", () => {
    expect(normalizeName(" \u3000 ")._unsafeUnwrapErr()).toEqual({
      kind: "empty",
    });
  });

  it("supports a different limit for game names", () => {
    const sixty = "g".repeat(NAME_LIMITS.maxGameName);
    expect(normalizeName(sixty, NAME_LIMITS.maxGameName).isOk()).toBe(true);
    expect(normalizeName(`${sixty}g`, NAME_LIMITS.maxGameName).isErr()).toBe(
      true,
    );
  });
});

describe("nameErrorMessage", () => {
  it("explains each error", () => {
    expect(nameErrorMessage({ kind: "tooLong", max: 40 }, "Nickname")).toBe(
      "Nickname can be at most 40 characters.",
    );
    expect(nameErrorMessage({ kind: "empty" })).toBe("Name can't be empty.");
  });
});
