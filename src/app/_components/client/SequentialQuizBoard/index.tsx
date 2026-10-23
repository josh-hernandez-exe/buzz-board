"use client";

import { useEffect, useState } from "react";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { MediaBlock } from "@/app/_components/client/MediaBlock";
import { Button } from "@/app/_components/ui/button";
import { Notice } from "@/app/_components/ui/page";
import { cn } from "@/app/_lib/utils";
import { api } from "@/trpc/react";
import { QUIZ_LIMITS } from "@/utils/sequentialQuiz/content";
import type { PublicQuizView } from "@/utils/sequentialQuiz/projection";

type Team = { id: string; name: string };

/** The one-line status everyone sees above the question. */
export function quizStatusLine(view: PublicQuizView, teamCount: number) {
  if (view.status === "ended") return "Back to the buzzer";
  if (view.finished) return "That's the end of the quiz!";
  switch (view.phase) {
    case "ready":
      return "Get ready for the first question";
    case "open":
      return `Answer on your phones! ${view.answered.length} of ${teamCount} answered`;
    case "locked":
      return view.question?.answer != null
        ? "Checking the answers again"
        : "Answers are locked";
    case "revealed":
      if (view.voided) return "That question doesn't count";
      return view.correct.length === 0
        ? "Nobody got it"
        : `${view.correct.length} ${view.correct.length === 1 ? "team" : "teams"} got it!`;
    case "finished":
      return "That's the end of the quiz!";
  }
}

/**
 * The quiz as everyone sees it: the question in large type, which teams
 * have answered (never what they typed), and after the reveal the answer
 * and who got it. `hostAnswer` (host desk only) shows the answer dimmed
 * before it's revealed.
 */
export function SequentialQuizBoard({
  view,
  teams,
  size = "normal",
  hostAnswer,
}: {
  view: PublicQuizView;
  teams: Team[];
  size?: "normal" | "large";
  hostAnswer?: string;
}) {
  const large = size === "large";
  const q = view.question;
  const answered = new Set(view.answered);
  const correct = new Set(view.correct);
  const revealed = view.phase === "revealed" && !view.voided;
  const showTeams =
    !!q && (view.phase === "open" || view.phase === "locked" || revealed);

  return (
    <section
      aria-label="Sequential Quiz"
      data-testid="quiz-board"
      className="stage bg-stage text-stage-foreground border-stage-tile-border/40 flex flex-col gap-3 rounded-2xl border p-3 shadow-lg sm:p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={cn("font-extrabold", large ? "text-4xl" : "text-lg")}>
          {view.title}
        </h2>
        <p
          role="status"
          data-testid="quiz-status"
          className={cn("text-stage-muted", large ? "text-2xl" : "text-sm")}
        >
          {quizStatusLine(view, teams.length)}
        </p>
      </header>

      {q ? (
        <div
          data-testid="quiz-question"
          className="bg-stage-tile border-stage-tile-border flex flex-col items-center gap-3 rounded-xl border-2 p-4 text-center sm:p-6"
        >
          <p
            className={cn(
              "text-stage-highlight font-bold tracking-wide uppercase",
              large ? "text-2xl" : "text-sm",
            )}
          >
            Question {view.number} of {view.total}
          </p>
          <p
            data-testid="quiz-prompt"
            className={cn(
              "font-display max-w-4xl font-extrabold text-balance",
              large ? "text-5xl leading-tight" : "text-2xl",
            )}
          >
            {q.prompt}
          </p>
          <MediaBlock media={q.promptMedia} large={large} />
          {q.answer !== null ? (
            <>
              <p
                data-testid="quiz-answer"
                className={cn(
                  "bg-stage-highlight text-accent-foreground rounded-lg px-4 py-2 font-extrabold",
                  large ? "text-4xl" : "text-xl",
                )}
              >
                {q.answer}
              </p>
              <MediaBlock media={q.answerMedia} large={large} />
            </>
          ) : view.voided ? (
            <p className="text-stage-muted font-bold">Voided: no points</p>
          ) : (
            hostAnswer && (
              <p className="text-stage-muted italic">
                Answer (hidden from players): {hostAnswer}
              </p>
            )
          )}
        </div>
      ) : (
        !view.finished &&
        view.status === "running" && (
          <p
            className={cn(
              "text-stage-muted py-6 text-center",
              large ? "text-3xl" : "text-base",
            )}
          >
            {view.total} {view.total === 1 ? "question" : "questions"},{" "}
            {view.points} {view.points === 1 ? "point" : "points"} each. Every
            team answers every question.
          </p>
        )
      )}

      {showTeams && teams.length > 0 && (
        <ul
          aria-label={revealed ? "Who got it" : "Teams that have answered"}
          className={cn(
            "flex flex-wrap justify-center gap-2",
            large ? "text-2xl" : "text-sm",
          )}
        >
          {teams.map((t) => {
            const done = answered.has(t.id);
            const got = correct.has(t.id);
            return (
              <li
                key={t.id}
                data-testid="quiz-team"
                data-answered={done}
                className={cn(
                  "rounded-full border-2 px-3 py-0.5 font-bold",
                  revealed
                    ? got
                      ? "border-stage-highlight text-stage-highlight"
                      : "border-stage-tile-border/40 text-stage-muted"
                    : done
                      ? "border-stage-highlight text-stage-foreground"
                      : "border-stage-tile-border/40 text-stage-muted border-dashed",
                )}
              >
                {revealed
                  ? `${got ? "✓" : "✕"} ${t.name}`
                  : `${done ? "✓" : "…"} ${t.name}`}
                <span className="sr-only">
                  {revealed
                    ? got
                      ? ": correct"
                      : ": not correct"
                    : done
                      ? ": answered"
                      : ": not answered yet"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The quiz on a player page: the question and the team's answer box. */
export function LiveSequentialQuiz() {
  const { data } = useLiveGameState();
  if (data?.mode?.kind !== "sequentialQuiz" || data.mode.status !== "running") {
    return null;
  }
  const teams = data.gameTeams.map((t) => ({ id: t.id, name: t.name }));
  const captainKey = `${data.game.captainsOnly}|${data.gameTeams
    .map((t) => t.captainId)
    .join(",")}`;
  return (
    <div className="flex flex-col gap-3">
      <SequentialQuizBoard view={data.mode} teams={teams} />
      <QuizAnswerBox
        view={data.mode}
        solo={data.game.format === "individual"}
        captainKey={captainKey}
      />
    </div>
  );
}

type Draft = { key: string; text: string; base: number };

/**
 * The team's answer to the open question. Anyone on the team can save or
 * replace it; a teammate's newer answer is shown before it's replaced.
 */
export function QuizAnswerBox({
  view,
  solo = false,
  captainKey = "",
}: {
  view: PublicQuizView;
  /** An individual game: each player is their own team. */
  solo?: boolean;
  /**
   * Changes when the captains-only rule or this team's captain changes,
   * so who may answer is re-read at once.
   */
  captainKey?: string;
}) {
  const yours = solo ? "Your" : "Your team's";
  const you = solo ? "You" : "Your team";
  const utils = api.useUtils();
  const query = api.sequentialQuiz.myAnswer.useQuery();
  const key = view.question?.key ?? null;
  // A new question, a phase change or any team's save: re-read ours.
  const refreshKey = `${key}|${view.phase}|${view.answerVersion}|${captainKey}`;
  useEffect(() => {
    void utils.sequentialQuiz.myAnswer.invalidate();
  }, [refreshKey, utils]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const submit = api.sequentialQuiz.submitAnswer.useMutation();

  const mine = query.data;
  if (!key || mine?.questionKey !== key) return null;

  const saved = mine.answer;
  const active = draft?.key === key ? draft : null;
  const text = active?.text ?? saved?.text ?? "";
  const dirty = !!active && active.text.trim() !== (saved?.text ?? "");
  // A teammate saved since this player started typing.
  const overtaken =
    !!saved && !!active && dirty && saved.revision > active.base;

  if (!mine.onTeam) {
    return (
      <Notice tone="info">
        Join a team to answer. Your host can put you on one.
      </Notice>
    );
  }

  if (view.phase === "revealed") {
    if (view.voided) {
      return (
        <Notice tone="neutral" role="status">
          This question was voided: no points for anyone.
        </Notice>
      );
    }
    return (
      <Notice
        role="status"
        tone={mine.verdict === "correct" ? "success" : "neutral"}
      >
        <span data-testid="quiz-verdict">
          {mine.verdict === "correct"
            ? `✓ ${you} got it! +${view.points}`
            : mine.verdict === "incorrect"
              ? "✕ Not this time."
              : `${you} didn't answer this one.`}
        </span>
        {saved && mine.verdict !== "correct" && (
          <> Your answer: &ldquo;{saved.text}&rdquo;</>
        )}
      </Notice>
    );
  }

  if (view.phase === "locked") {
    return (
      <Notice role="status" tone="neutral">
        <strong>Answers are locked.</strong>{" "}
        {saved ? (
          <>
            {yours} answer: &ldquo;{saved.text}&rdquo;
            {solo ? "" : ` (saved by ${saved.savedBy})`}
          </>
        ) : (
          `${you} didn't answer.`
        )}
        {dirty && <> Your last change wasn&apos;t saved.</>}
      </Notice>
    );
  }

  if (view.phase !== "open") return null;

  if (mine.answeredByCaptain) {
    return (
      <Notice role="status" tone="neutral">
        <span data-testid="quiz-captain-answers">
          ★ Your captain, <strong>{mine.answeredByCaptain}</strong>, answers for
          the team.
        </span>{" "}
        {saved ? (
          <>
            Saved: &ldquo;{saved.text}&rdquo; (by {saved.savedBy})
          </>
        ) : (
          "Nothing saved yet."
        )}
      </Notice>
    );
  }

  const save = () => {
    const base = overtaken
      ? saved.revision
      : (active?.base ?? saved?.revision ?? 0);
    submit.mutate(
      { questionKey: key, text, baseRevision: base },
      {
        onSuccess: (saved) => {
          // Show what was saved at once, not the old answer until the
          // refetch lands (editing then would start from a stale revision).
          utils.sequentialQuiz.myAnswer.setData(undefined, (old) =>
            old?.questionKey === key ? { ...old, answer: saved } : old,
          );
          setDraft(null);
        },
        // On a conflict the refetch shows the teammate's answer above this
        // draft ("Saving yours replaces it"); nothing is lost either way.
        onSettled: () => void utils.sequentialQuiz.myAnswer.invalidate(),
      },
    );
  };

  return (
    <form
      aria-label="Answer this question"
      data-testid="quiz-answer-box"
      className="bg-surface border-border flex flex-col gap-2 rounded-xl border p-3 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && text.trim() && !submit.isPending) save();
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {solo ? "Your answer" : "Team answer"}
        <input
          className="field px-3 py-2 text-base font-normal"
          value={text}
          maxLength={QUIZ_LIMITS.maxAnswerLength}
          autoComplete="off"
          enterKeyHint="send"
          placeholder={solo ? "Type your answer" : "Type your team's answer"}
          onChange={(e) =>
            setDraft({
              key,
              text: e.target.value,
              base: active?.base ?? saved?.revision ?? 0,
            })
          }
        />
      </label>
      {overtaken && (
        <Notice tone="warning" role="status">
          {saved.savedBy} just saved &ldquo;{saved.text}&rdquo;. Saving yours
          replaces it.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setDraft(null)}
          >
            Keep theirs
          </button>
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={!dirty || !text.trim() || submit.isPending}
        >
          {submit.isPending
            ? "Saving…"
            : saved
              ? "Replace answer"
              : "Save answer"}
        </Button>
        <span
          role="status"
          data-testid="quiz-answer-state"
          className={cn(
            "text-sm",
            dirty ? "text-warning-text" : "text-muted-foreground",
          )}
        >
          {dirty
            ? "Not saved yet"
            : saved
              ? `✓ Saved${solo ? "" : ` by ${saved.savedBy}`} at ${new Date(saved.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : "Nothing saved yet"}
        </span>
      </div>
      <ErrorNotice error={submit.error} />
    </form>
  );
}
