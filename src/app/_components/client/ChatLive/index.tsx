"use client";

import { useRef } from "react";

import { api } from "@/trpc/react";
import { chatPulseChanges, type ChatPulseLike } from "@/utils/chatPulse";

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
  const previous = useRef<ChatPulseLike | undefined>(undefined);

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
          void utils.chat.channel.invalidate({ as, channelKey });
        }
        if (changes.refetch.length > 0 || changes.drop.length > 0) {
          void utils.chat.status.invalidate({ as });
          if (as === "staff") void utils.chat.moderation.recent.invalidate();
        }
      },
    },
  );

  return { pulse: subscription.data, status: subscription.status };
}
