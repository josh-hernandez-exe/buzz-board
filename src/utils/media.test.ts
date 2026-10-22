import { describe, expect, it } from "vitest";

import {
  mediaProblems,
  mediaSchema,
  safeMediaList,
  safeMediaUrl,
  youtubeEmbedUrl,
  youtubeId,
} from "./media";

describe("safeMediaUrl", () => {
  it("accepts only absolute https without credentials", () => {
    expect(safeMediaUrl("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    for (const bad of [
      "http://example.com/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://user:pw@example.com/a.png",
      "file:///etc/passwd",
      "/relative.png",
      "https://localhost/a.png",
      "",
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      expect(safeMediaUrl(bad), bad).toBeNull();
    }
  });
});

describe("youtubeId", () => {
  const id = "dQw4w9WgXcQ";
  it("recognises the approved link forms and strips tracking", () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${id}&si=tracking&t=30`,
      `https://youtube.com/watch?v=${id}`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
    ]) {
      expect(youtubeId(link), link).toBe(id);
    }
  });

  it("refuses lookalikes, playlists and bad IDs", () => {
    for (const link of [
      `https://youtube.com.evil.example/watch?v=${id}`,
      `https://evil-youtube.com/watch?v=${id}`,
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/watch?v=short",
      `http://www.youtube.com/watch?v=${id}`,
      `https://www.youtube.com/watch?v=${id}x`,
    ]) {
      expect(youtubeId(link), link).toBeNull();
    }
  });

  it("builds the privacy-enhanced embed", () => {
    expect(youtubeEmbedUrl(id, 42)).toBe(
      `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&start=42`,
    );
  });
});

describe("media items", () => {
  it("needs alt text and labels, and safe links, to start", () => {
    expect(
      mediaProblems({ type: "image", url: "https://x.example/a.png", alt: "" }),
    ).toEqual(["An image needs a description (alt text)."]);
    expect(
      mediaProblems({
        type: "audio",
        url: "http://x.example/a.mp3",
        label: "Song",
      }),
    ).toHaveLength(1);
    expect(
      mediaProblems({
        type: "youtube",
        url: "https://vimeo.com/1",
        label: "Clip",
      }),
    ).toHaveLength(1);
    expect(
      safeMediaList([
        { type: "image", url: "https://x.example/a.png", alt: "A tree" },
        { type: "image", url: "javascript:alert(1)", alt: "x" },
      ]),
    ).toHaveLength(1);
  });

  it("refuses unknown types and fields (no direct video)", () => {
    expect(
      mediaSchema.safeParse({ type: "video", url: "https://x.example/a.mp4" })
        .success,
    ).toBe(false);
    expect(
      mediaSchema.safeParse({
        type: "image",
        url: "https://x.example/a.png",
        alt: "x",
        html: "<b>",
      }).success,
    ).toBe(false);
  });
});
