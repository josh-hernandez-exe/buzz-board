"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";

import { Button } from "@/app/_components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/app/_components/ui/input-otp";
import { useGameTokenData } from "@/app/_hooks/gameTokenData";
import { api } from "@/trpc/react";
import {
  NAME_LIMITS,
  nameErrorMessage,
  normalizeName,
} from "@/utils/displayName";

const CODE_LENGTH = 6;

/**
 * Join by code and nickname on one screen. A shared link pre-fills the code.
 * If this browser already played in that game, "Resume" is offered first and
 * joining as a new player is an explicit choice. Nothing joins automatically.
 */
export function JoinGameComponent({
  code: inputCode,
}: {
  code?: string | undefined | null;
}) {
  const router = useRouter();
  const [gameCode, setGameCode] = useState((inputCode ?? "").toUpperCase());
  const [nickname, setNickname] = useState("");
  const [formError, setFormError] = useState("");
  const [joinAsNew, setJoinAsNew] = useState(false);
  const [gameTokenData, setGameTokenData] = useGameTokenData();

  const codeComplete = gameCode.length === CODE_LENGTH;
  const storedToken = codeComplete
    ? gameTokenData.tokenStorage?.[gameCode]
    : undefined;
  const preview = api.public.resumePreview.useQuery(
    { gameCode, token: storedToken ?? "" },
    { enabled: !!storedToken && !joinAsNew, retry: false },
  );
  const resumable = !joinAsNew && preview.data ? preview.data : undefined;

  const join = api.public.joinGame.useMutation({
    onSuccess: (data) => {
      setGameTokenData({
        token: data.token,
        code: gameCode,
        gameId: data.gameId,
      });
      router.push(`/game/${data.gameId}/user`);
    },
  });

  const submitNew = () => {
    setFormError("");
    if (!codeComplete) {
      setFormError("Enter the 6-character game code.");
      return;
    }
    const name = normalizeName(nickname);
    if (name.isErr()) {
      setFormError(
        name.error.kind === "empty"
          ? "Choose a nickname."
          : nameErrorMessage(name.error, "Nickname"),
      );
      return;
    }
    join.mutate({ gameCode, nickname: name.value });
  };

  const error = formError || join.error?.message;

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="game-code" className="text-sm font-medium">
          Game code
        </label>
        <InputOTP
          id="game-code"
          maxLength={CODE_LENGTH}
          value={gameCode}
          onChange={(value) => {
            setGameCode(value.toUpperCase());
            setJoinAsNew(false);
          }}
          pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </div>

      {resumable ? (
        <div className="flex flex-col gap-3 rounded-xl bg-white/10 p-4">
          <p>
            Welcome back to <strong>{resumable.gameName}</strong>. You played as{" "}
            <strong>{resumable.nickname}</strong>
            {resumable.teamName && (
              <>
                {" "}
                on <strong>{resumable.teamName}</strong>
              </>
            )}
            .
          </p>
          <Button
            disabled={join.isPending}
            onClick={() =>
              join.mutate({ gameCode, token: storedToken ?? undefined })
            }
          >
            Resume as {resumable.nickname}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setJoinAsNew(true);
              join.reset();
            }}
          >
            Join as someone new
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitNew();
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            Nickname
            <input
              type="text"
              value={nickname}
              autoComplete="nickname"
              maxLength={NAME_LIMITS.maxDisplayName * 2}
              onChange={(e) => setNickname(e.target.value)}
              className="rounded-lg bg-white/10 px-3 py-2 text-base text-white"
            />
          </label>
          <p className="text-xs text-white/70">
            Shown to everyone in this game. No account needed.
          </p>
          <Button type="submit" disabled={join.isPending}>
            {join.isPending ? "Joining…" : "Join game"}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
