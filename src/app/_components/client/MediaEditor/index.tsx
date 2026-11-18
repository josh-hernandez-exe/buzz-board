"use client";

import { Button } from "@/app/_components/ui/button";
import { MediaBlock } from "@/app/_components/client/MediaBlock";
import {
  MEDIA_LIMITS,
  mediaProblems,
  youtubeId,
  type Media,
} from "@/utils/media";

const field = "field px-2 py-1 text-sm";

const blank = (type: Media["type"]): Media =>
  type === "image" ? { type, url: "", alt: "" } : { type, url: "", label: "" };

/**
 * Edits a clue's or answer's media (up to four): pictures and GIFs, audio
 * and YouTube links. Problems are shown as you type; nothing is uploaded,
 * the links are used as they are.
 */
export function MediaEditor({
  label,
  media,
  onChange,
}: {
  label: string;
  media: Media[];
  onChange: (media: Media[]) => void;
}) {
  const set = (i: number, m: Media) =>
    onChange(media.map((x, j) => (j === i ? m : x)));
  const remove = (i: number) => onChange(media.filter((_x, j) => j !== i));
  const move = (i: number, by: number) => {
    const next = [...media];
    const [m] = next.splice(i, 1);
    next.splice(i + by, 0, m!);
    onChange(next);
  };

  return (
    <fieldset className="border-border flex flex-col gap-2 rounded-md border p-2">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      {media.map((m, i) => {
        const problems = m.url ? mediaProblems(m) : [];
        return (
          <div
            key={i}
            data-testid="media-row"
            className="bg-surface-sunken flex flex-col gap-2 rounded-md p-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Media ${i + 1} type`}
                className={field}
                value={m.type}
                onChange={(e) =>
                  set(i, {
                    ...blank(e.target.value as Media["type"]),
                    url: m.url,
                  })
                }
              >
                <option value="image">Picture or GIF</option>
                <option value="audio">Audio</option>
                <option value="youtube">YouTube video</option>
              </select>
              <input
                aria-label={`Media ${i + 1} link`}
                placeholder={
                  m.type === "youtube"
                    ? "https://www.youtube.com/watch?v=…"
                    : "https://…"
                }
                className={`${field} min-w-48 flex-1`}
                maxLength={MEDIA_LIMITS.url}
                value={m.url}
                onChange={(e) => {
                  const url = e.target.value;
                  set(i, {
                    ...m,
                    url,
                    // A .gif link is animated: it waits for Play.
                    ...(m.type === "image" && /\.gif($|\?)/i.test(url)
                      ? { animated: true }
                      : {}),
                  });
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={i === 0}
                aria-label="Move up"
                onClick={() => move(i, -1)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => remove(i)}
              >
                Remove
              </Button>
            </div>
            {m.type === "image" ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Media ${i + 1} description`}
                  placeholder="Describe the picture (don't give the answer away)"
                  className={`${field} min-w-48 flex-1`}
                  maxLength={MEDIA_LIMITS.alt}
                  value={m.alt}
                  onChange={(e) => set(i, { ...m, alt: e.target.value })}
                />
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={m.animated ?? false}
                    onChange={(e) =>
                      set(i, { ...m, animated: e.target.checked || undefined })
                    }
                  />
                  Animated (GIF)
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Media ${i + 1} label`}
                  placeholder={
                    m.type === "audio" ? "Song or sound name" : "Video name"
                  }
                  className={`${field} min-w-48 flex-1`}
                  maxLength={MEDIA_LIMITS.label}
                  value={m.label}
                  onChange={(e) => set(i, { ...m, label: e.target.value })}
                />
                <label className="flex items-center gap-1 text-sm">
                  Start at (seconds)
                  <input
                    type="number"
                    min={0}
                    className={`${field} w-20`}
                    value={m.startSeconds ?? 0}
                    onChange={(e) => {
                      const n = Math.max(0, Math.round(Number(e.target.value)));
                      set(i, { ...m, startSeconds: n > 0 ? n : undefined });
                    }}
                  />
                </label>
              </div>
            )}
            <input
              aria-label={`Media ${i + 1} credit`}
              placeholder="Credit (optional)"
              className={field}
              maxLength={MEDIA_LIMITS.credit}
              value={m.credit ?? ""}
              onChange={(e) =>
                set(i, { ...m, credit: e.target.value || undefined })
              }
            />
            {problems.length > 0 ? (
              <ul className="text-destructive ml-5 list-disc text-xs">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              m.url &&
              (m.type !== "youtube" || youtubeId(m.url)) && (
                <details className="text-sm">
                  <summary className="cursor-pointer">Preview</summary>
                  <div className="stage bg-stage text-stage-foreground mt-1 rounded-md p-2">
                    <MediaBlock media={[m]} preview />
                  </div>
                </details>
              )
            )}
          </div>
        );
      })}
      {media.length < MEDIA_LIMITS.perBlock && (
        <div className="flex flex-wrap gap-2">
          {(["image", "audio", "youtube"] as const).map((type) => (
            <Button
              key={type}
              size="sm"
              variant="secondary"
              onClick={() => onChange([...media, blank(type)])}
            >
              +{" "}
              {type === "image"
                ? "Picture"
                : type === "audio"
                  ? "Audio"
                  : "YouTube"}
            </Button>
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Links load straight from where they&apos;re hosted, on every screen that
        shows them. Use only media you have the right to share, and check it
        plays on the computer that shares the display.
      </p>
    </fieldset>
  );
}
