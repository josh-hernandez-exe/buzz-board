"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useRef } from "react";

import { api, type RouterOutputs } from "@/trpc/react";
import { mergeChannelView, sinceFor } from "@/utils/chatChannelMerge";
import { CHAT_LIMITS } from "@/utils/chatLimits";
import { chatPulseChanges, type ChatPulseLike } from "@/utils/chatPulse";

type ChannelView = RouterOutputs["chat"]["channel"];
type ChannelInput = {
  as: "player" | "staff";
  channelKey: string;
  limit?: number;
};

/**
 * Opens the page's one chat stream and keeps cached chat queries current:
 * changed channels are re-fetched (with access checked again), channels the
 * viewer lost are dropped at once, and a name or role change refreshes open
 * channels' author headers. The stream never carries message text.
 *
 * Returns the latest pulse (posting state and channel list) and the stream
 * status for "reconnecting" notices.
 */
export function useChatLive(as: "player" | "staff", enabled = true) {
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const previous = useRef<ChatPulseLike | undefined>(undefined);
  const inFlight = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());

  /**
   * Brings this channel's cached views up to date with only the messages
   * that are new (src/utils/chatChannelMerge.ts). With many viewers, re-
   * fetching the whole recent window on every message was the busiest path
   * (docs/load-scaling.md). One fetch per channel at a time; a change that
   * arrives meanwhile triggers one more.
   */
  const extend = async (channelKey: string) => {
    if (inFlight.current.has(channelKey)) {
      dirty.current.add(channelKey);
      return;
    }
    inFlight.current.add(channelKey);
    try {
      do {
        dirty.current.delete(channelKey);
        const cached = queryClient.getQueriesData<ChannelView>({
          queryKey: getQueryKey(api.chat.channel, { as, channelKey }, "query"),
        });
        for (const [key, held] of cached) {
          const input = (key[1] as { input?: ChannelInput } | undefined)?.input;
          if (!input || !held) {
            void queryClient.invalidateQueries({ queryKey: key });
            continue;
          }
          const fetched = await utils.client.chat.channel.query({
            ...input,
            since: sinceFor(held),
          });
          queryClient.setQueryData<ChannelView>(key, (current) =>
            mergeChannelView(
              current,
              fetched,
              input.limit ?? CHAT_LIMITS.initialMessages,
            ),
          );
        }
      } while (dirty.current.has(channelKey));
    } catch {
      // Lost access, or a network error: fall back to a normal refetch,
      // which shows the error the usual way.
      void utils.chat.channel.invalidate({ as, channelKey });
    } finally {
      inFlight.current.delete(channelKey);
    }
  };

  const subscription = api.chat.live.useSubscription(
    { as },
    {
      enabled,
      onData(pulse) {
        const changes = chatPulseChanges(previous.current, pulse);
        previous.current = pulse;
        for (const channelKey of changes.drop) {
          void utils.chat.channel.reset({ as, channelKey });
        }
        for (const channelKey of changes.refetch) {
          // Names or roles changed: headers of held messages may be out of
          // date, so fetch whole views. Otherwise only what's new.
          if (changes.rosterChanged) {
            void utils.chat.channel.invalidate({ as, channelKey });
          } else {
            void extend(channelKey);
          }
        }
        // Every pulse means something this viewer can see changed (channels,
        // mute, read-only), so their status and staff lists are refreshed.
        void utils.chat.status.invalidate({ as });
        if (as === "staff") void utils.chat.moderation.invalidate();
      },
    },
  );

  return { pulse: subscription.data, status: subscription.status };
}
