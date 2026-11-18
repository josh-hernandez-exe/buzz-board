"use client";

import { useState } from "react";

import { MediaEditor } from "@/app/_components/client/MediaEditor";
import { Button } from "@/app/_components/ui/button";
import { GRID_LIMITS, type Question } from "@/utils/categoryGrid/content";

const field = "field px-2 py-1 text-sm";

/**
 * One question from the bank: the clue (text and media) everyone sees, the
 * answer (text and media), wordings to accept and private host notes.
 * Shared by Category Grid and Sequential Quiz.
 */
export function QuestionEditor({
  title,
  question,
  onChange,
  onClose,
}: {
  title: string;
  question: Question;
  onChange: (q: Question) => void;
  onClose: () => void;
}) {
  const accepted = question.answer.acceptedAnswers ?? [];
  const [acceptedText, setAcceptedText] = useState(accepted.join(", "));
  const withMedia = <T extends { media?: Question["prompt"]["media"] }>(
    block: T,
    media: NonNullable<T["media"]>,
  ): T => {
    const { media: _old, ...rest } = block;
    return (media.length > 0 ? { ...rest, media } : rest) as T;
  };
  return (
    <section
      aria-label="Edit question"
      className="border-primary flex flex-col gap-3 rounded-lg border-2 p-3 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
      <label className="flex flex-col gap-1">
        Clue (what everyone sees)
        <textarea
          className={`${field} min-h-16`}
          maxLength={GRID_LIMITS.maxText}
          value={question.prompt.text}
          onChange={(e) =>
            onChange({
              ...question,
              prompt: { ...question.prompt, text: e.target.value },
            })
          }
        />
      </label>
      <MediaEditor
        label="Clue media (shown when the clue opens)"
        media={question.prompt.media ?? []}
        onChange={(media) =>
          onChange({ ...question, prompt: withMedia(question.prompt, media) })
        }
      />
      <label className="flex flex-col gap-1">
        Answer
        <input
          className={field}
          maxLength={GRID_LIMITS.maxText}
          value={question.answer.text}
          onChange={(e) =>
            onChange({
              ...question,
              answer: { ...question.answer, text: e.target.value },
            })
          }
        />
      </label>
      <MediaEditor
        label="Answer media (shown with the answer)"
        media={question.answer.media ?? []}
        onChange={(media) =>
          onChange({ ...question, answer: withMedia(question.answer, media) })
        }
      />
      <label className="flex flex-col gap-1">
        Also accept (comma-separated, private to hosts)
        <input
          className={field}
          value={acceptedText}
          onChange={(e) => setAcceptedText(e.target.value)}
          onBlur={() => {
            const list = acceptedText
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
              .slice(0, GRID_LIMITS.maxAccepted);
            const { acceptedAnswers: _old, ...rest } = question.answer;
            onChange({
              ...question,
              answer:
                list.length > 0 ? { ...rest, acceptedAnswers: list } : rest,
            });
          }}
        />
      </label>
      <label className="flex flex-col gap-1">
        Host notes (private)
        <textarea
          className={`${field} min-h-12`}
          maxLength={GRID_LIMITS.maxText}
          value={question.hostNotes ?? ""}
          onChange={(e) => {
            const { hostNotes: _old, ...rest } = question;
            onChange(
              e.target.value ? { ...rest, hostNotes: e.target.value } : rest,
            );
          }}
        />
      </label>
    </section>
  );
}
