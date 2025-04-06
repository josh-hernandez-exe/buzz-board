"use client";

import { useState } from "react";

import { type Game, GameFormat } from "@prisma/client";
import { useRouter } from "next/navigation";

import {
  DropDownSelection,
  type DropdownOption,
} from "@/app/_components/DropDownSelection";

import { api } from "@/trpc/react";

type GameData = Pick<Game, "name" | "format">;

export function CreateGame() {
  const router = useRouter();
  const [gameFormat, setGameFormat] = useState<Game["format"]>(
    GameFormat.single,
  );
  const [gameName, setGameName] = useState<Game["name"]>("");
  const [isDataRead, setIsDataReady] = useState<boolean>(false);

  const utils = api.useUtils();
  const createGame = api.game.create.useMutation({
    onSuccess: async () => {
      await utils.game.getAll.invalidate();
      // reload the server side components that list game data
      router.refresh();
    },
  });

  const checkIsReady = () => {
    if (
      [
        gameName && gameName.length > 0,
        gameFormat && gameFormat.length > 0,
      ].every((x) => x)
    ) {
      setIsDataReady(true);
    }
    setIsDataReady(false);
  };

  return (
    <div className="w-full max-w-xs">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createGame.mutate({
            name: gameName!,
            format: gameFormat!,
          } as GameData);
        }}
        className="flex flex-col gap-2"
      >
        <DropDownSelection<Game["format"]>
          title="Game Format"
          options={[GameFormat.single, GameFormat.team].map((val) => {
            return {
              id: val,
              name: val,
              data: val,
            } as DropdownOption<Game["format"]>;
          })}
          defaultValue={GameFormat.single}
          onChange={(val) => {
            setGameFormat(val);
            checkIsReady();
          }}
        />
        <input
          type="text"
          placeholder="Game Name"
          value={gameName}
          onChange={(e) => {
            setGameName(e.target.value);
            checkIsReady();
          }}
          className="w-full rounded-full bg-white/10 px-4 py-2 text-white"
        />
        <button
          type="submit"
          className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
          disabled={createGame.isPending || isDataRead}
        >
          {createGame.isPending ? "Submitting..." : "Submit"}
        </button>
      </form>
    </div>
  );
}
