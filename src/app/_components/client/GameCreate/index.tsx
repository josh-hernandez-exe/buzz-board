"use client";

import { useRef, useState } from "react";

import { BuzzerMode, GameFormat } from "@prisma/client";
import { useRouter } from "next/navigation";

import { Button } from "@/app/_components/ui/button";
import { api } from "@/trpc/react";
import { NAME_LIMITS } from "@/utils/displayName";
import { GAME_LIMITS } from "@/utils/gameRules";
import { newRequestId } from "@/utils/requestId";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { RankedRulesEditor } from "@/app/_components/client/RankedRulesEditor";
import type { ModeKind } from "@/utils/modes";
import {
  presetRules,
  suggestedPreset,
  type Rules,
} from "@/utils/rankedAnswers/content";

const { minTeams: MIN_TEAMS, maxTeams: MAX_TEAMS } = GAME_LIMITS;

/**
 * One short form: name, format, (for team games) team count, how buzzing
 * works, and optionally a game mode (Ranked Answers, Category Grid or
 * Sequential Quiz) with its rules. Boards, clues, chat and everything else can be set up later
 * from the host desk.
 */
export function CreateGame() {
  const router = useRouter();
  const [name, setName] = useState("Trivia night");
  const [format, setFormat] = useState<GameFormat>(GameFormat.team);
  const [teamCount, setTeamCount] = useState<number>(GAME_LIMITS.defaultTeams);
  const [buzzerMode, setBuzzerMode] = useState<BuzzerMode>(BuzzerMode.first);
  const [captainsOnly, setCaptainsOnly] = useState(false);
  const [gameType, setGameType] = useState<"basic" | ModeKind>("basic");
  const ranked = gameType === "rankedAnswers";
  const gridGame = gameType === "categoryGrid";
  const quizGame = gameType === "sequentialQuiz";
  const [sampleQuiz, setSampleQuiz] = useState(true);
  const [quizPoints, setQuizPoints] = useState(1);
  const [sampleBoards, setSampleBoards] = useState(true);
  const [sampleGrid, setSampleGrid] = useState(true);
  const [gridLockout, setGridLockout] = useState(true);
  const [gridPenalty, setGridPenalty] = useState(false);
  // null until the host touches the rules: follows the team count till then.
  const [rules, setRules] = useState<Rules | null>(null);
  const knownTeams = format === GameFormat.team ? teamCount : null;
  const shownRules =
    rules ?? presetRules(suggestedPreset(knownTeams ?? 2), knownTeams ?? 2);
  // One ID per attempt: a double-click or a retried request after a slow
  // response returns the same game instead of creating a second room.
  const requestId = useRef(newRequestId());

  const createGame = api.user.game.create.useMutation({
    onSuccess: (game) => {
      requestId.current = newRequestId();
      router.push(`/game/${game.id}/admin`);
    },
  });

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !createGame.isPending;

  return (
    <form
      className={`flex w-full flex-col gap-4 ${ranked ? "max-w-2xl" : "max-w-sm"}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        createGame.mutate({
          name: trimmed,
          format,
          teamCount: format === GameFormat.team ? teamCount : undefined,
          buzzerMode,
          captainsOnly: format === GameFormat.team && captainsOnly,
          rankedAnswers: ranked
            ? { rules: shownRules, sampleBoards }
            : undefined,
          categoryGrid: gridGame
            ? {
                rules: {
                  wrongAnswerLockout: gridLockout,
                  wrongAnswerPenalty: gridPenalty ? "clueValue" : "none",
                },
                sampleGrid,
              }
            : undefined,
          sequentialQuiz: quizGame
            ? { pointsPerQuestion: quizPoints, sampleQuiz }
            : undefined,
          requestId: requestId.current,
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        Game name
        <input
          type="text"
          value={name}
          maxLength={NAME_LIMITS.maxGameName}
          onChange={(e) => setName(e.target.value)}
          className="field px-3 py-2 text-base"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Players compete</legend>
        {(
          [
            [GameFormat.team, "As teams"],
            [GameFormat.individual, "Individually"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              value={value}
              checked={format === value}
              onChange={() => setFormat(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {format === GameFormat.team && (
        <div className="flex flex-col gap-1">
          <span id="team-count-label" className="text-sm font-medium">
            Number of teams
          </span>
          <div
            className="flex items-center gap-3"
            role="group"
            aria-labelledby="team-count-label"
          >
            <Button
              type="button"
              variant="secondary"
              aria-label="Fewer teams"
              disabled={teamCount <= MIN_TEAMS}
              onClick={() => setTeamCount((n) => Math.max(MIN_TEAMS, n - 1))}
            >
              −
            </Button>
            <output aria-live="polite" className="w-6 text-center text-lg">
              {teamCount}
            </output>
            <Button
              type="button"
              variant="secondary"
              aria-label="More teams"
              disabled={teamCount >= MAX_TEAMS}
              onClick={() => setTeamCount((n) => Math.min(MAX_TEAMS, n + 1))}
            >
              +
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            New players are placed on the team with the fewest players. You can
            change this, and rename or add teams, from the host desk.
          </p>
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Buzzing</legend>
        {(
          [
            [
              BuzzerMode.first,
              "First buzz wins",
              "The fastest buzz answers. Reopen the buzzer if they're wrong.",
            ],
            [
              BuzzerMode.queue,
              "Queue",
              "Every buzz lines up in order. Mark answers right or wrong and the next in line answers.",
            ],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className="flex items-start gap-2">
            <input
              type="radio"
              name="buzzerMode"
              value={value}
              className="mt-1"
              checked={buzzerMode === value}
              onChange={() => setBuzzerMode(value)}
            />
            <span className="flex flex-col">
              {label}
              <span className="text-muted-foreground text-xs">{hint}</span>
            </span>
          </label>
        ))}
        <p className="text-muted-foreground text-xs">
          You can switch between questions from the host desk.
        </p>
        {format === GameFormat.team && (
          <label className="mt-1 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={captainsOnly}
              onChange={(e) => setCaptainsOnly(e.target.checked)}
            />
            <span className="flex flex-col">
              Only team captains can buzz and answer
              <span className="text-muted-foreground text-xs">
                Off: everyone on a team can. On: the first player to join each
                team is its captain (you or they can pass it on). You can change
                this later in the Room tab.
              </span>
            </span>
          </label>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Game</legend>
        {(
          [
            [
              "basic",
              "Buzzer and scoreboard",
              "Ask questions your own way; players buzz and you keep score.",
            ],
            [
              "rankedAnswers",
              "Ranked Answers (family-feud style)",
              "Boards of ranked answers, revealed as teams find them. Choose the rules now; add boards before you start.",
            ],
            [
              "categoryGrid",
              "Category Grid (jeopardy style)",
              "Categories across the top, clues worth more as you go down. Teams pick a clue and buzz in to answer.",
            ],
            [
              "sequentialQuiz",
              "Sequential Quiz (pub-quiz rounds)",
              "Questions in order. Every team types an answer on a phone; you mark them and reveal the answer to everyone at once. No buzzing.",
            ],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={label} className="flex items-start gap-2">
            <input
              type="radio"
              name="gameType"
              className="mt-1"
              checked={gameType === value}
              onChange={() => setGameType(value)}
            />
            <span className="flex flex-col">
              {label}
              <span className="text-muted-foreground text-xs">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {ranked && (
        <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
          <RankedRulesEditor
            rules={shownRules}
            teamCount={knownTeams}
            onChange={setRules}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sampleBoards}
              onChange={(e) => setSampleBoards(e.target.checked)}
            />
            Start with sample boards (you can edit or replace them)
          </label>
          <p className="text-muted-foreground text-xs">
            Every rule can still be changed on the host desk until you start
            Ranked Answers.
          </p>
        </div>
      )}

      {quizGame && (
        <div className="border-border flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <label className="flex items-center gap-2">
            Points per correct answer
            <input
              type="number"
              min={1}
              max={10_000}
              value={quizPoints}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (n >= 1 && n <= 10_000) setQuizPoints(n);
              }}
              className="field w-24 px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sampleQuiz}
              onChange={(e) => setSampleQuiz(e.target.checked)}
            />
            Start with sample questions (holiday trivia you can edit or replace)
          </label>
          <p className="text-muted-foreground text-xs">
            Write and order the questions on the host desk until you start the
            quiz.
          </p>
        </div>
      )}

      {gridGame && (
        <div className="border-border flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={gridLockout}
              onChange={(e) => setGridLockout(e.target.checked)}
            />
            A wrong answer locks the team out of that clue
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={gridPenalty}
              onChange={(e) => setGridPenalty(e.target.checked)}
            />
            Wrong answers lose the clue&apos;s value
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sampleGrid}
              onChange={(e) => setSampleGrid(e.target.checked)}
            />
            Start with the sample grid (holiday trivia you can edit or replace)
          </label>
          <p className="text-muted-foreground text-xs">
            Fill in the clues and change the rules on the host desk until you
            start the grid.
          </p>
        </div>
      )}

      <ErrorNotice
        error={createGame.error}
        className="text-destructive text-sm"
      />

      <Button type="submit" disabled={!canSubmit}>
        {createGame.isPending ? "Creating…" : "Create game"}
      </Button>
    </form>
  );
}
