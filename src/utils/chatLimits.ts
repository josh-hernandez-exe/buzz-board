/** Chat limits, shared by the server, the chat UI and Help. */
export const CHAT_LIMITS = {
  /** Plain-text message size, in UTF-8 bytes. */
  maxMessageBytes: 2_000,
  /** Messages loaded when a channel opens. */
  initialMessages: 50,
  /** Most recent messages that can be scrolled back to in one channel. */
  recentWindow: 200,
  /** Default and maximum size of the staff "all recent channels" view. */
  mergedDefault: 100,
  mergedMax: 200,
  /** Per person: at most this many messages in a burst… */
  burstMessages: 5,
  burstSeconds: 10,
  /** …and at most this many per minute. */
  perMinute: 30,
  /** Accepted messages per game per second, across everyone. */
  gamePerSecond: 50,
  /** Message bodies are removed this long after sending. */
  retentionDays: 7,
  defaultMuteMinutes: 10,
  maxSlowModeSeconds: 600,
} as const;

/** UTF-8 size of a message, as the server counts it. */
export const chatByteLength = (text: string) =>
  new TextEncoder().encode(text.normalize("NFC").replace(/\r\n?/g, "\n").trim())
    .length;
