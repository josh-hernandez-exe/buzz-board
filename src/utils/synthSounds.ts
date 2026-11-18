/**
 * Small sounds made in the browser (Web Audio), so the app needs no sound
 * files with their own licences: a chime for a revealed answer, a brighter
 * one for a right answer, and a low buzz for a strike.
 */
import type { ModeCue } from "@/utils/modeSounds";

let context: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

function tone(
  ctx: AudioContext,
  {
    frequency,
    start,
    length,
    type = "sine",
    volume = 0.25,
  }: {
    frequency: number;
    start: number;
    length: number;
    type?: OscillatorType;
    volume?: number;
  },
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  const t = ctx.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

/** Plays a cue. Call after a user gesture has allowed sound on the page. */
export function playCue(cue: ModeCue) {
  const ctx = audio();
  if (!ctx) return;
  if (cue === "reveal") {
    tone(ctx, { frequency: 880, start: 0, length: 0.35 });
    tone(ctx, { frequency: 1320, start: 0.12, length: 0.5 });
  } else if (cue === "correct") {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(ctx, { frequency: f, start: i * 0.09, length: 0.45, volume: 0.2 }),
    );
  } else {
    tone(ctx, {
      frequency: 110,
      start: 0,
      length: 0.6,
      type: "sawtooth",
      volume: 0.18,
    });
    tone(ctx, {
      frequency: 116,
      start: 0,
      length: 0.6,
      type: "sawtooth",
      volume: 0.18,
    });
  }
}

/** Wakes audio during a click, so later cues can play. */
export function unlockAudio() {
  audio();
}
