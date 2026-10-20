import { err, ok, type Result } from "neverthrow";

export const NAME_LIMITS = {
  /** Player and team names, in Unicode code points after normalization. */
  maxDisplayName: 40,
  /** Game (room) names. */
  maxGameName: 60,
} as const;

export type NameError =
  | { kind: "empty" }
  | { kind: "tooLong"; max: number }
  | { kind: "forbiddenCharacter" };

// Newlines and other C0/C1 controls, plus explicit bidi embedding, override
// and isolate controls, which can make a name render as something else.
// Ordinary letters, combining marks, emoji, variation selectors and ZWJ
// sequences are kept.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

/**
 * Normalizes a user-chosen name: trims, applies NFC, and enforces a length in
 * code points (not UTF-16 units or visible glyphs). It does not NFKC-fold or
 * reject duplicates.
 */
export function normalizeName(
  raw: string,
  max: number = NAME_LIMITS.maxDisplayName,
): Result<string, NameError> {
  const name = raw.normalize("NFC").trim();
  if (name.length === 0) return err({ kind: "empty" });
  if (FORBIDDEN.test(name)) return err({ kind: "forbiddenCharacter" });
  if ([...name].length > max) return err({ kind: "tooLong", max });
  return ok(name);
}

export function nameErrorMessage(error: NameError, what = "Name"): string {
  switch (error.kind) {
    case "empty":
      return `${what} can't be empty.`;
    case "tooLong":
      return `${what} can be at most ${error.max} characters.`;
    case "forbiddenCharacter":
      return `${what} can't contain line breaks or hidden control characters.`;
  }
}
