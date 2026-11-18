"use client";

import { useState } from "react";

import { Button } from "@/app/_components/ui/button";
import { cn } from "@/app/_lib/utils";
import {
  safeMediaUrl,
  youtubeEmbedUrl,
  youtubeId,
  youtubeWatchUrl,
  type Media,
} from "@/utils/media";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/**
 * A clue's or answer's media, one item at a time. Nothing loads until the
 * clue is open (this only renders then). GIFs wait for Play, audio uses
 * native controls with no preload, YouTube loads on click from the
 * privacy-enhanced domain. Failures say so, with Retry and Open original.
 */
export function MediaBlock({
  media,
  large = false,
  preview = false,
}: {
  media: Media[];
  large?: boolean;
  /** Editor preview: audio starts muted. */
  preview?: boolean;
}) {
  const [active, setActive] = useState(0);
  if (media.length === 0) return null;
  const current = media[Math.min(active, media.length - 1)]!;
  return (
    <div
      data-media
      data-testid="media-block"
      className="flex w-full flex-col items-center gap-2"
    >
      {media.length > 1 && (
        <div
          role="tablist"
          aria-label="Media"
          className="flex flex-wrap justify-center gap-1"
        >
          {media.map((m, i) => (
            <Button
              key={i}
              role="tab"
              size="sm"
              variant={i === active ? "default" : "secondary"}
              aria-selected={i === active}
              onClick={() => setActive(i)}
            >
              {i + 1}. {m.type === "image" ? m.alt.slice(0, 24) : m.label}
            </Button>
          ))}
        </div>
      )}
      {/* Keyed, so switching items unmounts (and stops) the previous one. */}
      <MediaItem
        key={`${active}-${current.url}`}
        media={current}
        large={large}
        preview={preview}
      />
      {current.credit && <p className="text-xs opacity-70">{current.credit}</p>}
    </div>
  );
}

function Failed({
  url,
  label,
  onRetry,
}: {
  url: string;
  label: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-stage-strike flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center"
    >
      <p className="font-semibold">Couldn&apos;t load {label}.</p>
      <div className="flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        )}
        <Button size="sm" variant="secondary" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open original
          </a>
        </Button>
      </div>
    </div>
  );
}

function MediaItem({
  media,
  large,
  preview,
}: {
  media: Media;
  large: boolean;
  preview: boolean;
}) {
  const [failed, setFailed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const maxH = large ? "max-h-[55vh]" : "max-h-72";

  if (media.type === "youtube") {
    const id = youtubeId(media.url);
    if (!id) return <Failed url={media.url} label={media.label} />;
    return (
      <div className="flex w-full max-w-3xl flex-col items-center gap-1">
        {playing ? (
          <iframe
            title={media.label}
            src={youtubeEmbedUrl(id, media.startSeconds)}
            className="aspect-video w-full rounded-lg border-0"
            allow="encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        ) : (
          <Button
            variant="secondary"
            size={large ? "lg" : "default"}
            onClick={() => setPlaying(true)}
          >
            ▶ Load video: {media.label}
          </Button>
        )}
        <p className="text-xs opacity-70">
          Plays from youtube-nocookie.com ·{" "}
          <a
            className="underline"
            href={youtubeWatchUrl(id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on YouTube
          </a>
        </p>
        <Transcript text={media.transcript} />
      </div>
    );
  }

  const url = safeMediaUrl(media.url);
  if (!url) return <Failed url={media.url} label="this media" />;

  if (media.type === "audio") {
    return (
      <div className="flex w-full max-w-xl flex-col items-center gap-1">
        <p className="text-sm font-semibold">{media.label}</p>
        {failed > 0 ? (
          <Failed url={url} label={media.label} onRetry={() => setFailed(0)} />
        ) : (
          <audio
            controls
            preload="none"
            muted={preview}
            src={url}
            className="w-full"
            onError={() => setFailed((n) => n + 1)}
            onLoadedMetadata={(e) => {
              if (media.startSeconds) {
                e.currentTarget.currentTime = media.startSeconds;
              }
            }}
          >
            {media.label}
          </audio>
        )}
        <p className="text-xs opacity-70">Plays from {hostOf(url)}</p>
        <Transcript text={media.transcript} />
      </div>
    );
  }

  // Images and GIFs. A GIF shows its poster (or a placeholder) until Play.
  const poster = media.posterUrl ? safeMediaUrl(media.posterUrl) : null;
  const showAnimation = !media.animated || playing;
  return (
    <figure className="flex flex-col items-center gap-1">
      {failed > 0 ? (
        <Failed
          url={url}
          label={`the picture "${media.alt}"`}
          onRetry={() => setFailed(0)}
        />
      ) : showAnimation ? (
        // External media is loaded by the browser directly, never proxied.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={media.alt}
          referrerPolicy="no-referrer"
          className={cn("w-auto max-w-full rounded-lg object-contain", maxH)}
          onError={() => setFailed((n) => n + 1)}
        />
      ) : poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt={`${media.alt} (paused)`}
          referrerPolicy="no-referrer"
          className={cn("w-auto max-w-full rounded-lg object-contain", maxH)}
        />
      ) : (
        <div className="bg-stage-tile flex h-40 w-64 items-center justify-center rounded-lg p-4 text-center text-sm">
          {media.alt}
        </div>
      )}
      {media.animated && failed === 0 && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "■ Stop animation" : "▶ Play animation"}
        </Button>
      )}
    </figure>
  );
}

function Transcript({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <details className="w-full text-left text-sm">
      <summary className="cursor-pointer">Transcript</summary>
      <p className="whitespace-pre-wrap">{text}</p>
    </details>
  );
}
