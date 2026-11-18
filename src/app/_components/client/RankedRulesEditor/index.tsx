"use client";

import { useState } from "react";

import {
  LIMITS,
  PLAY_STYLES,
  PRESETS,
  STYLE_DESCRIPTION,
  STYLE_LABEL,
  STYLE_TEAM_RANGE,
  optionsFor,
  presetRules,
  resolveRules,
  type PresetId,
  type Rules,
} from "@/utils/rankedAnswers/content";

const field = "field px-2 py-1 text-sm";

/** The preset these rules match, or null if they've been customised. */
export function matchPreset(rules: Rules): PresetId | null {
  const current = resolveRules(rules);
  const shown = optionsFor(rules);
  for (const preset of PRESETS) {
    const r = resolveRules(presetRules(preset.id, 2));
    if (r.playStyle !== current.playStyle) continue;
    // Buzzer or secret is a detail; skipping the face-off is a different game.
    if ((r.faceOffMethod === "none") !== (current.faceOffMethod === "none"))
      continue;
    const same = (
      [
        "allowPass",
        "stealBy",
        "stealWinner",
        "stealReward",
        "scoring",
        "sharedAnswers",
        "raceLockout",
      ] as const
    ).every((k) => !shown[k] || r[k] === current[k]);
    if (same) return preset.id;
  }
  return null;
}

/** Applies a preset, keeping the host's points, multiplier, penalty and target. */
export function withPreset(
  rules: Rules,
  id: PresetId,
  teamCount: number,
): Rules {
  const base = presetRules(id, teamCount);
  return {
    ...base,
    pointValuesByRank: rules.pointValuesByRank,
    multiplier: rules.multiplier,
    strikes: rules.strikes,
    turnCycles: rules.turnCycles,
    allPlayRounds: rules.allPlayRounds,
    missPenalty: rules.missPenalty,
    endOnEmptyCycle: rules.endOnEmptyCycle,
    targetScore: rules.targetScore,
  };
}

const fits = (range: [number, number], teams: number | null) =>
  teams === null || (teams >= range[0] && teams <= range[1]);

export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input
        type="number"
        className={`${field} w-24`}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </label>
  );
}

export function PointsInput({
  value,
  onChange,
}: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));
  return (
    <label className="flex flex-col gap-1 text-sm">
      Points by rank (rank 1 first; used when a board has no points of its own)
      <input
        className={field}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const numbers = text
            .split(/[\s,]+/)
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0)
            .slice(0, LIMITS.maxAnswers);
          if (numbers.length > 0) onChange(numbers);
          else setText(value.join(", "));
        }}
      />
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <select
        className={field}
        value={value}
        onChange={(e) => {
          const next = options.find(([v]) => v === e.target.value);
          if (next) onChange(next[0]);
        }}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Ranked Answers rules: pick a preset (a named set of options), then adjust
 * any option. Used when creating a game and on the host desk before start.
 * `teamCount` is null when it isn't known yet (individual games).
 */
export function RankedRulesEditor({
  rules,
  teamCount,
  onChange,
}: {
  rules: Rules;
  teamCount: number | null;
  onChange: (rules: Rules) => void;
}) {
  const r = resolveRules(rules);
  const show = optionsFor(rules);
  const preset = matchPreset(rules);
  const set = (patch: Partial<Rules>) => onChange({ ...rules, ...patch });
  const range = STYLE_TEAM_RANGE[rules.playStyle];

  return (
    <div className="flex flex-col gap-4 text-sm">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">How boards are played</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => {
            const ok = fits(p.teams, teamCount);
            return (
              <label
                key={p.id}
                className={`border-border flex cursor-pointer items-start gap-2 rounded-lg border p-2 ${
                  preset === p.id ? "border-primary bg-accent-soft" : ""
                } ${ok ? "" : "opacity-60"}`}
              >
                <input
                  type="radio"
                  name="ranked-preset"
                  className="mt-1"
                  checked={preset === p.id}
                  onChange={() =>
                    onChange(withPreset(rules, p.id, teamCount ?? p.teams[0]))
                  }
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">
                    {p.label}{" "}
                    <span className="text-muted-foreground font-normal">
                      (
                      {p.teams[0] === p.teams[1]
                        ? p.teams[0]
                        : `${p.teams[0]}–${p.teams[1]}`}{" "}
                      teams)
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {p.summary}
                  </span>
                  {!ok && (
                    <span className="text-warning-text text-xs font-semibold">
                      Doesn&apos;t fit {teamCount} teams.
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {preset === null && (
          <p className="text-muted-foreground text-xs">
            Custom rules: you&apos;ve changed options below from any preset.
          </p>
        )}
      </fieldset>

      <details className="border-border rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 font-semibold">
          Fine-tune the rules
        </summary>
        <div className="flex flex-col gap-3 p-3 pt-1">
          <label className="flex flex-col gap-1">
            Play style
            <select
              className={field}
              value={rules.playStyle}
              onChange={(e) => {
                const style = PLAY_STYLES.find((s) => s === e.target.value);
                if (style) set({ playStyle: style });
              }}
            >
              {PLAY_STYLES.map((style) => (
                <option key={style} value={style}>
                  {STYLE_LABEL[style]}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground text-xs">
              {STYLE_DESCRIPTION[rules.playStyle]}
              {!fits(range, teamCount) &&
                ` This style needs ${range[0] === range[1] ? range[0] : `${range[0]}–${range[1]}`} teams.`}
            </span>
          </label>

          <div className="flex flex-wrap gap-3">
            {show.faceOffMethod && (
              <Choice
                label="Face-off"
                value={r.faceOffMethod}
                options={[
                  ["buzzer", "Buzzer: first to buzz answers"],
                  ["secret", "Secret: both answer, higher row wins"],
                  ["none", "None: teams take turns playing"],
                ]}
                onChange={(faceOffMethod) => set({ faceOffMethod })}
              />
            )}
            {show.allowPass && (
              <Choice
                label="Face-off winner"
                value={r.allowPass ? "pass" : "play"}
                options={[
                  ["pass", "Chooses to play or pass"],
                  ["play", "Always plays"],
                ]}
                onChange={(v) => set({ allowPass: v === "pass" })}
              />
            )}
            {show.scoring && (
              <Choice
                label="Points while playing"
                value={r.scoring}
                options={[
                  ["bank", "Bank: paid to the winner at the end"],
                  ["direct", "Direct: each row scores when found"],
                ]}
                onChange={(scoring) => set({ scoring })}
              />
            )}
            {show.strikes && (
              <NumberField
                label={
                  rules.playStyle === "buzzRace"
                    ? "Misses before sitting out"
                    : "Strikes"
                }
                value={rules.strikes}
                min={1}
                max={5}
                onChange={(strikes) => set({ strikes })}
              />
            )}
            {show.stealBy && (
              <Choice
                label="After the strikes, steal by"
                value={r.stealBy}
                options={[
                  ["opponent", "The face-off opponent"],
                  ["everyone", "Every other team at once"],
                  ["none", "Nobody: the board ends"],
                ]}
                onChange={(stealBy) => set({ stealBy })}
              />
            )}
            {show.stealReward && (
              <Choice
                label="A successful steal wins"
                value={r.stealReward}
                options={[
                  ["bankPlusRow", "The bank plus the row"],
                  ["rowOnly", "Just the row"],
                ]}
                onChange={(stealReward) => set({ stealReward })}
              />
            )}
            {show.stealWinner && (
              <Choice
                label="Several correct steals"
                value={r.stealWinner}
                options={[
                  ["bestRow", "Highest row takes the bank"],
                  ["allCorrect", "Every correct team takes the bank"],
                ]}
                onChange={(stealWinner) => set({ stealWinner })}
              />
            )}
            {show.turnCycles && (
              <NumberField
                label={
                  rules.playStyle === "passAlong"
                    ? "Turns per team per board"
                    : "Answers per team per board"
                }
                value={rules.turnCycles}
                min={1}
                max={4}
                onChange={(turnCycles) => set({ turnCycles })}
              />
            )}
            {show.endOnEmptyCycle && (
              <Choice
                label="A full round of turns with no new answer"
                value={r.endOnEmptyCycle ? "close" : "continue"}
                options={[
                  ["continue", "Keep going"],
                  ["close", "Closes the board"],
                ]}
                onChange={(v) => set({ endOnEmptyCycle: v === "close" })}
              />
            )}
            {show.allPlayRounds && (
              <NumberField
                label="Rounds per board"
                value={rules.allPlayRounds}
                min={1}
                max={8}
                onChange={(allPlayRounds) => set({ allPlayRounds })}
              />
            )}
            {show.sharedAnswers && (
              <Choice
                label="Same row found by several teams"
                value={r.sharedAnswers}
                options={[
                  ["full", "Each gets the full points"],
                  ["split", "They split the points"],
                  ["uniqueOnly", "Nobody scores it"],
                ]}
                onChange={(sharedAnswers) => set({ sharedAnswers })}
              />
            )}
            {show.raceLockout && (
              <Choice
                label="After a wrong answer"
                value={r.raceLockout}
                options={[
                  ["untilNextFind", "Sit out until the next row is found"],
                  ["afterStrikes", "Sit out the board after the misses"],
                  ["none", "No lockout"],
                ]}
                onChange={(raceLockout) => set({ raceLockout })}
              />
            )}
          </div>

          <PointsInput
            key={rules.pointValuesByRank.join()}
            value={rules.pointValuesByRank}
            onChange={(pointValuesByRank) => set({ pointValuesByRank })}
          />
          <div className="flex flex-wrap gap-3">
            <NumberField
              label="Points multiplier"
              value={rules.multiplier}
              min={1}
              max={LIMITS.maxMultiplier}
              onChange={(multiplier) => set({ multiplier })}
            />
            {show.missPenalty && (
              <NumberField
                label="Points lost for a miss"
                value={r.missPenalty}
                min={0}
                max={LIMITS.maxPoints}
                onChange={(missPenalty) => set({ missPenalty })}
              />
            )}
            <NumberField
              label="Target score (0 = none)"
              value={r.targetScore ?? 0}
              min={0}
              max={1_000_000}
              hint="Shown to everyone: first to reach it wins."
              onChange={(n) => set({ targetScore: n > 0 ? n : null })}
            />
          </div>
        </div>
      </details>
    </div>
  );
}
