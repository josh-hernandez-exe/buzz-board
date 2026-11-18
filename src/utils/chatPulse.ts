/** The live chat signal a viewer receives (see `chat.live`). */
export type ChatPulseLike = {
  channels: { key: string; revision: number }[];
  rosterRevision: string;
};

export type ChatPulseChanges = {
  /** Channels whose messages, pin or settings changed: re-fetch them. */
  refetch: string[];
  /** Channels the viewer can no longer read: drop cached messages at once. */
  drop: string[];
  /** Names, teams or roles changed: re-fetch open channels for new headers. */
  rosterChanged: boolean;
};

/**
 * What a client must do after a new pulse. The first pulse after connecting
 * or reconnecting (`previous` undefined) re-fetches every channel, because
 * changes may have been missed while disconnected.
 */
export function chatPulseChanges(
  previous: ChatPulseLike | undefined,
  next: ChatPulseLike,
): ChatPulseChanges {
  if (!previous) {
    return {
      refetch: next.channels.map((c) => c.key),
      drop: [],
      rosterChanged: true,
    };
  }
  const before = new Map(previous.channels.map((c) => [c.key, c.revision]));
  const after = new Set(next.channels.map((c) => c.key));
  const rosterChanged = previous.rosterRevision !== next.rosterRevision;
  return {
    refetch: next.channels
      .filter((c) => rosterChanged || before.get(c.key) !== c.revision)
      .map((c) => c.key),
    drop: previous.channels.map((c) => c.key).filter((k) => !after.has(k)),
    rosterChanged,
  };
}
