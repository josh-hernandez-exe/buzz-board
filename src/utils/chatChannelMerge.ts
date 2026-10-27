/**
 * Merging an incremental chat fetch into the view a client holds. Pure, so
 * the page and the load runner's bots share it.
 *
 * A refetch passes `since` (the held view's revision and newest message).
 * If only new messages arrived, the server returns just those
 * (`appendOnly`); otherwise a complete view, which replaces the held one.
 */
type Message = { sequence: number };
export type MergeableView<M extends Message> = {
  appendOnly: boolean;
  revision: number;
  hasOlder: boolean;
  messages: M[];
};

/** What to send as `since` for the view held, if it can be extended. */
export function sinceFor(
  view: Pick<MergeableView<Message>, "revision" | "messages"> | undefined,
): { revision: number; afterSequence: number } | undefined {
  if (!view) return undefined;
  return {
    revision: view.revision,
    afterSequence: view.messages.at(-1)?.sequence ?? 0,
  };
}

/**
 * The view after a fetch. Appended messages go after the held ones, keeping
 * at most `limit` (older ones scroll out of the window, so `hasOlder`).
 */
export function mergeChannelView<V extends MergeableView<Message>>(
  held: V | undefined,
  fetched: V,
  limit: number,
): V {
  if (!fetched.appendOnly) return fetched;
  if (!held) return { ...fetched, appendOnly: false };
  const known = new Set(held.messages.map((m) => m.sequence));
  const added = fetched.messages.filter((m) => !known.has(m.sequence));
  const all = [...held.messages, ...added].sort(
    (a, b) => a.sequence - b.sequence,
  );
  const messages = all.slice(-limit);
  return {
    ...fetched,
    appendOnly: false,
    messages,
    hasOlder: held.hasOlder || messages.length < all.length,
  };
}
