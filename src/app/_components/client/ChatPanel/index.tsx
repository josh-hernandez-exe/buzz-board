"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { useChatLive } from "@/app/_components/client/ChatLive";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { Button } from "@/app/_components/ui/button";
import { helpHref } from "@/help/manifest";
import { api, type RouterOutputs } from "@/trpc/react";
import { can, type StaffRoleName } from "@/utils/capabilities";
import { CHAT_LIMITS, chatByteLength } from "@/utils/chatLimits";

type As = "player" | "staff";
type ChannelView = RouterOutputs["chat"]["channel"];
type Message = ChannelView["messages"][number];

const SLOW_MODE_CHOICES = [0, 10, 30, 60] as const;

function newRequestId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const time = (date: Date) =>
  new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Game chat for a player page (`as="player"`) or a host desk
 * (`as="staff"`). Staff with `moderateChat` also get moderation controls and
 * an "All channels" view; owners and co-hosts can turn chat on and off.
 * The live chat stream is open only while this panel is shown.
 */
export function ChatPanel({
  as,
  staffRole,
}: {
  as: As;
  staffRole?: StaffRoleName;
}) {
  const { pulse, status: liveStatus } = useChatLive(as);
  const statusQuery = api.chat.status.useQuery({ as });
  const [selected, setSelected] = useState("game");
  const [showAll, setShowAll] = useState(false);

  const canModerate =
    as === "staff" && !!staffRole && can(staffRole, "moderateChat");
  const canToggle = as === "staff" && !!staffRole && can(staffRole, "runGame");

  const status = statusQuery.data;
  const enabled = pulse?.enabled ?? status?.enabled ?? false;
  const channels = status?.channels ?? [];
  // A player moved to another team falls back to Everyone at once.
  const channelKey = channels.some((c) => c.key === selected)
    ? selected
    : "game";
  const channel = channels.find((c) => c.key === channelKey);

  if (statusQuery.error) return <ErrorNotice error={statusQuery.error} />;
  if (!status)
    return <p className="text-muted-foreground text-sm">Loading chat…</p>;

  const readOnly = pulse?.readOnly ?? status.readOnly;
  const muted = pulse ? pulse.muted : status.muted;
  const blocked = readOnly
    ? "This game has finished, so chat is read-only."
    : muted
      ? "You're muted in chat. You can still play."
      : channel?.staffOnly && as === "player"
        ? "Only organizers can post here right now."
        : null;

  return (
    <section
      aria-label="Chat"
      className="bg-surface border-border flex w-full flex-col gap-3 rounded-xl border p-4 shadow-sm"
    >
      {canToggle && <ChatToggle enabled={enabled} />}
      {!enabled ? (
        <p data-testid="chat-off">
          Chat is turned off for this game.
          {canToggle ? "" : " The host can turn it on."}{" "}
          <a
            className="underline"
            href={helpHref("chat", "how-do-i-turn-chat-on")}
            target="_blank"
            rel="noopener"
          >
            About chat
          </a>
        </p>
      ) : (
        <>
          {liveStatus === "connecting" && pulse && (
            <p role="status" className="text-warning-text text-sm">
              Reconnecting… chat may be out of date.
            </p>
          )}
          <div
            role="tablist"
            aria-label="Chat channels"
            className="flex flex-wrap gap-2"
          >
            {channels.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={!showAll && c.key === channelKey}
                onClick={() => {
                  setShowAll(false);
                  setSelected(c.key);
                }}
                className={`rounded-full px-3 py-1 text-sm ${
                  !showAll && c.key === channelKey
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-sunken hover:bg-muted"
                }`}
              >
                {c.label}
              </button>
            ))}
            {canModerate && (
              <button
                type="button"
                role="tab"
                aria-selected={showAll}
                onClick={() => setShowAll(true)}
                className={`rounded-full px-3 py-1 text-sm ${
                  showAll
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-sunken hover:bg-muted"
                }`}
              >
                All channels
              </button>
            )}
          </div>
          {showAll && canModerate ? (
            <AllChannels />
          ) : (
            <>
              {canModerate && channel && (
                <ChannelControls
                  channelKey={channelKey}
                  staffOnly={channel.staffOnly}
                  slowModeSeconds={channel.slowModeSeconds}
                />
              )}
              <ChannelMessages
                as={as}
                channelKey={channelKey}
                canModerate={canModerate}
              />
              <Composer
                key={channelKey}
                as={as}
                channelKey={channelKey}
                blocked={blocked}
                slowModeSeconds={
                  as === "player" ? (channel?.slowModeSeconds ?? 0) : 0
                }
              />
            </>
          )}
          {canModerate && <MuteList />}
        </>
      )}
    </section>
  );
}

function ChatToggle({ enabled }: { enabled: boolean }) {
  const utils = api.useUtils();
  const [saving, setSaving] = useState<boolean | null>(null);
  const setEnabled = api.chat.setEnabled.useMutation({
    onSuccess: () => utils.chat.status.invalidate(),
    onSettled: () => setSaving(null),
  });
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={saving ?? enabled}
          disabled={saving !== null}
          onChange={(e) => {
            setSaving(e.target.checked);
            setEnabled.mutate({ enabled: e.target.checked });
          }}
        />
        Chat for this game
      </label>
      <ErrorNotice error={setEnabled.error} />
    </div>
  );
}

function ChannelControls({
  channelKey,
  staffOnly,
  slowModeSeconds,
}: {
  channelKey: string;
  staffOnly: boolean;
  slowModeSeconds: number;
}) {
  const utils = api.useUtils();
  const refresh = () => utils.chat.status.invalidate();
  const [savingStaffOnly, setSavingStaffOnly] = useState<boolean | null>(null);
  const setPolicy = api.chat.moderation.setPolicy.useMutation({
    onSuccess: refresh,
    onSettled: () => setSavingStaffOnly(null),
  });
  const clear = api.chat.moderation.clear.useMutation({ onSuccess: refresh });
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={savingStaffOnly ?? staffOnly}
          disabled={setPolicy.isPending}
          onChange={(e) => {
            setSavingStaffOnly(e.target.checked);
            setPolicy.mutate({ channelKey, staffOnly: e.target.checked });
          }}
        />
        Staff only
      </label>
      <label className="flex items-center gap-2">
        Slow mode
        <select
          className="field px-2 py-1"
          value={slowModeSeconds}
          disabled={setPolicy.isPending}
          onChange={(e) =>
            setPolicy.mutate({
              channelKey,
              slowModeSeconds: Number(e.target.value),
            })
          }
        >
          {[...new Set<number>([...SLOW_MODE_CHOICES, slowModeSeconds])].map(
            (seconds) => (
              <option key={seconds} value={seconds} className="text-foreground">
                {seconds === 0 ? "Off" : `${seconds} seconds`}
              </option>
            ),
          )}
        </select>
      </label>
      {confirmClear ? (
        <span className="flex items-center gap-2">
          Hide every message in this channel so far?
          <Button
            size="sm"
            variant="destructive"
            onClick={() =>
              clear.mutate(
                { channelKey },
                { onSettled: () => setConfirmClear(false) },
              )
            }
          >
            Clear history
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setConfirmClear(false)}
          >
            Keep
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setConfirmClear(true)}
        >
          Clear history…
        </Button>
      )}
      <ErrorNotice error={setPolicy.error ?? clear.error} />
    </div>
  );
}

function ChannelMessages({
  as,
  channelKey,
  canModerate,
}: {
  as: As;
  channelKey: string;
  canModerate: boolean;
}) {
  const [limit, setLimit] = useState<number>(CHAT_LIMITS.initialMessages);
  const query = api.chat.channel.useQuery({ as, channelKey, limit });
  const end = useRef<HTMLLIElement>(null);
  const newest = query.data?.messages.at(-1)?.sequence;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [newest]);

  if (query.error) return <ErrorNotice error={query.error} />;
  const view = query.data;
  if (!view)
    return <p className="text-muted-foreground text-sm">Loading messages…</p>;

  return (
    <div className="flex flex-col gap-2">
      {view.pinned && (
        <div
          data-testid="chat-pinned"
          className="border-accent bg-accent-soft rounded border p-2 text-sm"
        >
          <span className="font-semibold">Pinned: </span>
          <MessageBody message={view.pinned} />
          {canModerate && (
            <ModerationActions
              message={view.pinned}
              channelKey={channelKey}
              pinned
            />
          )}
        </div>
      )}
      {view.hasOlder &&
        (limit < CHAT_LIMITS.recentWindow ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setLimit(CHAT_LIMITS.recentWindow)}
          >
            Show older messages
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">
            Only the newest {CHAT_LIMITS.recentWindow} messages are shown.
          </p>
        ))}
      <ol
        aria-label="Messages"
        aria-live="polite"
        className="flex max-h-96 flex-col gap-2 overflow-y-auto"
      >
        {view.messages.length === 0 && (
          <li className="text-muted-foreground text-sm">No messages yet.</li>
        )}
        {view.messages.map((message) => (
          <li
            key={message.id}
            data-testid="chat-message"
            className={`rounded p-2 ${message.isOwn ? "bg-muted" : "bg-surface-sunken"}`}
          >
            <Author message={message} channelKey={channelKey} />
            <MessageBody message={message} />
            {canModerate && message.state === "visible" && (
              <ModerationActions
                message={message}
                channelKey={channelKey}
                pinned={view.pinned?.id === message.id}
              />
            )}
          </li>
        ))}
        <li ref={end} aria-hidden className="h-0" />
      </ol>
    </div>
  );
}

function Author({
  message,
  channelKey,
}: {
  message: Message;
  channelKey?: string;
}) {
  const { author } = message;
  return (
    <div className="text-muted-foreground flex flex-wrap items-baseline gap-2 text-xs">
      <span className="text-foreground font-semibold">
        {author.name}
        {message.isOwn && " (you)"}
      </span>
      {author.roleLabel && (
        <span className="bg-accent text-accent-foreground rounded px-1">
          {author.roleLabel}
        </span>
      )}
      {author.teamName && channelKey !== undefined && channelKey === "game" && (
        <span>{author.teamName}</span>
      )}
      <time dateTime={new Date(message.createdAt).toISOString()}>
        {time(message.createdAt)}
      </time>
    </div>
  );
}

function MessageBody({ message }: { message: Message }) {
  if (message.state === "removed") {
    return (
      <p className="text-muted-foreground text-sm italic">
        Message removed by an organizer.
      </p>
    );
  }
  if (message.state === "expired") {
    return (
      <p className="text-muted-foreground text-sm italic">Message expired.</p>
    );
  }
  return (
    <p className="text-sm break-words whitespace-pre-wrap">{message.body}</p>
  );
}

function ModerationActions({
  message,
  channelKey,
  pinned,
}: {
  message: Message;
  channelKey: string;
  pinned: boolean;
}) {
  const utils = api.useUtils();
  const refresh = () =>
    Promise.all([
      utils.chat.channel.invalidate(),
      utils.chat.moderation.invalidate(),
    ]);
  const remove = api.chat.moderation.remove.useMutation({ onSuccess: refresh });
  const pin = api.chat.moderation.pin.useMutation({ onSuccess: refresh });
  const mute = api.chat.moderation.mute.useMutation({ onSuccess: refresh });
  const who = message.author.name;
  const canMuteAuthor =
    !!message.actorKey &&
    !message.isOwn &&
    message.author.roleLabel !== "Owner";

  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {message.state === "visible" && (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Remove message from ${who}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate({ messageId: message.id })}
        >
          Remove
        </Button>
      )}
      <Button
        size="sm"
        variant="secondary"
        aria-label={pinned ? "Unpin message" : `Pin message from ${who}`}
        disabled={pin.isPending}
        onClick={() =>
          pin.mutate({ channelKey, messageId: pinned ? null : message.id })
        }
      >
        {pinned ? "Unpin" : "Pin"}
      </Button>
      {canMuteAuthor && (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Mute ${who} for ${CHAT_LIMITS.defaultMuteMinutes} minutes`}
          disabled={mute.isPending}
          onClick={() => mute.mutate({ actorKey: message.actorKey! })}
        >
          Mute {CHAT_LIMITS.defaultMuteMinutes} min
        </Button>
      )}
      <ErrorNotice error={remove.error ?? pin.error ?? mute.error} />
    </div>
  );
}

function AllChannels() {
  const recent = api.chat.moderation.recent.useQuery();
  if (recent.error) return <ErrorNotice error={recent.error} />;
  if (!recent.data)
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  return (
    <ol
      aria-label="All channels"
      className="flex max-h-96 flex-col gap-2 overflow-y-auto"
    >
      {recent.data.length === 0 && (
        <li className="text-muted-foreground text-sm">No messages yet.</li>
      )}
      {recent.data.map((message) => (
        <li
          key={message.id}
          data-testid="chat-message"
          className="bg-surface-sunken rounded p-2"
        >
          <span className="bg-muted rounded px-1 text-xs">
            {message.channelLabel}
          </span>
          <Author message={message} />
          <MessageBody message={message} />
          {message.state === "visible" && (
            <ModerationActions
              message={message}
              channelKey={message.channelKey}
              pinned={false}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function MuteList() {
  const utils = api.useUtils();
  const mutes = api.chat.moderation.mutes.useQuery();
  const unmute = api.chat.moderation.unmute.useMutation({
    onSuccess: () => utils.chat.moderation.mutes.invalidate(),
  });
  if (!mutes.data?.length) return null;
  return (
    <div className="text-sm">
      <p className="font-semibold">Muted</p>
      <ul className="flex flex-col gap-1">
        {mutes.data.map((mute) => (
          <li
            key={mute.actorKey}
            data-testid="chat-mute"
            className="flex items-center gap-2"
          >
            <span>
              {mute.name}{" "}
              {mute.until ? `until ${time(mute.until)}` : "until unmuted"}
            </span>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Unmute ${mute.name}`}
              disabled={unmute.isPending}
              onClick={() => unmute.mutate({ actorKey: mute.actorKey })}
            >
              Unmute
            </Button>
          </li>
        ))}
      </ul>
      <ErrorNotice error={unmute.error} />
    </div>
  );
}

function Composer({
  as,
  channelKey,
  blocked,
  slowModeSeconds,
}: {
  as: As;
  channelKey: string;
  blocked: string | null;
  slowModeSeconds: number;
}) {
  const utils = api.useUtils();
  const [text, setText] = useState("");
  // One ID per draft: retrying the same text can't post it twice.
  const requestId = useRef<string | null>(null);
  const send = api.chat.send.useMutation({
    onSuccess: () => {
      setText("");
      requestId.current = null;
      void utils.chat.channel.invalidate({ as, channelKey });
    },
  });
  const bytes = chatByteLength(text);
  const tooLong = bytes > CHAT_LIMITS.maxMessageBytes;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || tooLong || send.isPending) return;
    requestId.current ??= newRequestId();
    send.mutate({ as, channelKey, body: text, requestId: requestId.current });
  };

  if (blocked) {
    return (
      <p data-testid="chat-blocked" className="text-muted-foreground text-sm">
        {blocked}{" "}
        <a
          className="underline"
          href={helpHref("chat", "why-cant-i-send-a-message")}
          target="_blank"
          rel="noopener"
        >
          Why?
        </a>
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <label htmlFor={`chat-input-${channelKey}`} className="sr-only">
        Message
      </label>
      <textarea
        id={`chat-input-${channelKey}`}
        value={text}
        rows={2}
        placeholder="Write a message"
        className="field w-full p-2 text-sm"
        onChange={(e) => {
          setText(e.target.value);
          requestId.current = null;
          send.reset();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) submit(e);
        }}
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className={tooLong ? "text-destructive" : "text-muted-foreground"}
        >
          {tooLong
            ? `Too long by ${bytes - CHAT_LIMITS.maxMessageBytes} bytes`
            : slowModeSeconds > 0
              ? `Slow mode: one message every ${slowModeSeconds} seconds`
              : ""}
        </span>
        <Button
          type="submit"
          size="sm"
          disabled={!text.trim() || tooLong || send.isPending}
        >
          {send.isPending ? "Sending…" : "Send"}
        </Button>
      </div>
      <ErrorNotice error={send.error} className="text-destructive text-sm" />
    </form>
  );
}
