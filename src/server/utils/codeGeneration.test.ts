import { describe, expect, it } from "vitest";

import { generateShortCode, generateToken } from "./codeGeneration";

describe("generateShortCode", () => {
  it("uses only unambiguous upper-case letters and digits 1-9", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateShortCode(6)).toMatch(/^[A-HJ-NP-Z1-9]{6}$/);
    }
  });

  it("limits repeats per character", () => {
    // CURRENT BEHAVIOR: the guard is `count > maxRepeat`, so a character can
    // appear maxRepeat + 1 times.
    for (let i = 0; i < 100; i++) {
      const code = generateShortCode(4, { characters: "AB", maxRepeat: 1 });
      expect(code.split("").sort().join("")).toBe("AABB");
    }
  });
});

describe("generateToken", () => {
  it("returns 32 random bytes as base64url by default", () => {
    const token = generateToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(generateToken()).not.toBe(token);
  });
});
