/**
 * A unique ID for one user action, sent with mutations so the server can
 * recognise a retried request instead of applying it twice.
 *
 * Uses `crypto.getRandomValues`, which (unlike `crypto.randomUUID`) also works
 * on plain-http LAN addresses.
 */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
