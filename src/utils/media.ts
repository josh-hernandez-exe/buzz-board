/**
 * Question media (Question Bank v1): images and GIFs, audio, and YouTube.
 * Pure and browser-safe. Media is loaded straight from its URL by the
 * viewer's browser: the app never fetches, proxies or stores it.
 */
import { z } from "zod";

export const MEDIA_LIMITS = {
  perBlock: 4,
  url: 2_048,
  alt: 1_000,
  label: 200,
  transcript: 4_000,
  credit: 500,
} as const;

const text = (max: number) => z.string().trim().max(max);
const url = z.string().trim().max(MEDIA_LIMITS.url);
const start = z.number().int().min(0).max(86_400).optional();

export const mediaSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("image"),
      url,
      alt: text(MEDIA_LIMITS.alt),
      /** GIFs: shows the poster (or a placeholder) until Play. */
      animated: z.boolean().optional(),
      posterUrl: url.optional(),
      credit: text(MEDIA_LIMITS.credit).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("audio"),
      url,
      label: text(MEDIA_LIMITS.label),
      transcript: text(MEDIA_LIMITS.transcript).optional(),
      startSeconds: start,
      credit: text(MEDIA_LIMITS.credit).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("youtube"),
      url,
      label: text(MEDIA_LIMITS.label),
      transcript: text(MEDIA_LIMITS.transcript).optional(),
      startSeconds: start,
      credit: text(MEDIA_LIMITS.credit).optional(),
    })
    .strict(),
]);

export type Media = z.infer<typeof mediaSchema>;
export const mediaListSchema = z.array(mediaSchema).max(MEDIA_LIMITS.perBlock);

/**
 * A URL that's safe to load in a viewer's browser: absolute HTTPS, no
 * embedded credentials, no other scheme. Returns the normalised URL or null.
 */
export function safeMediaUrl(raw: string): string | null {
  if (raw.length === 0 || raw.length > MEDIA_LIMITS.url) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname.includes(".")) return null;
  return parsed.toString();
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);

/**
 * The 11-character video ID from a recognised YouTube link, or null. Exact
 * hosts only (no lookalikes); playlist-only links are refused.
 */
export function youtubeId(raw: string): string | null {
  const safe = safeMediaUrl(raw);
  if (!safe) return null;
  const u = new URL(safe);
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    id = u.pathname.slice(1).split("/")[0] ?? null;
  } else if (WATCH_HOSTS.has(host)) {
    const [, first, second] = u.pathname.split("/");
    if (first === "watch") id = u.searchParams.get("v");
    else if (first === "shorts" || first === "embed" || first === "live") {
      id = second ?? null;
    }
  } else if (host === "www.youtube-nocookie.com") {
    const [, first, second] = u.pathname.split("/");
    if (first === "embed") id = second ?? null;
  }
  return id && YT_ID.test(id) ? id : null;
}

/** The privacy-enhanced embed for a video, starting at `startSeconds`. */
export function youtubeEmbedUrl(id: string, startSeconds?: number) {
  const params = new URLSearchParams({ rel: "0", playsinline: "1" });
  if (startSeconds) params.set("start", String(startSeconds));
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

/** The plain watch link, for "Open original". */
export const youtubeWatchUrl = (id: string) =>
  `https://www.youtube.com/watch?v=${id}`;

/** Problems that stop a game starting, for one media item. */
export function mediaProblems(m: Media): string[] {
  const problems: string[] = [];
  if (m.type === "youtube") {
    if (!youtubeId(m.url)) {
      problems.push(`"${m.url || "(empty)"}" isn't a YouTube video link.`);
    }
  } else if (!safeMediaUrl(m.url)) {
    problems.push(
      `"${m.url || "(empty)"}" isn't a safe link: use a full https:// address.`,
    );
  }
  if (m.type === "image") {
    if (!m.alt) problems.push("An image needs a description (alt text).");
    if (m.posterUrl && !safeMediaUrl(m.posterUrl)) {
      problems.push(`The poster "${m.posterUrl}" isn't a safe https:// link.`);
    }
  } else if (!m.label) {
    problems.push(`${m.type === "audio" ? "Audio" : "A video"} needs a label.`);
  }
  return problems;
}

/** Only media that's safe to show; anything else is dropped from views. */
export function safeMediaList(list: Media[] | undefined): Media[] {
  return (list ?? []).filter((m) => mediaProblems(m).length === 0);
}
