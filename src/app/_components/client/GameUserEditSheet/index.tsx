"use client";

import { useState } from "react";

import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Label } from "@/app/_components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/app/_components/ui/sheet";

import { api } from "@/trpc/react";

export function GameUserEditSheet() {
  const utils = api.useUtils();
  const gameSelfInfo = api.gameUser.getSelfInfo.useQuery();
  const [gameUserName, setGameUserName] = useState<string | undefined>();
  const [gameTeamName, setGameTeamName] = useState<string | undefined>();

  const changeNameMutation = api.gameUser.changeName.useMutation({
    onSuccess: async () => {
      void utils.gameUser.getSelfInfo.invalidate();
    },
    onError: async () => {
      if (gameSelfInfo.data?.name) {
        setGameUserName(gameSelfInfo.data?.name);
      }
    },
  });

  const changeTeamNameMutation = api.gameUser.changeTeamName.useMutation({
    onSuccess: async () => {
      return Promise.all([
        utils.gameUser.getSelfInfo.invalidate(),
        utils.gameUser.getSelfTeamInfo.invalidate(),
      ]);
    },
    onError: async () => {
      if (gameSelfInfo.data?.gameTeam?.name) {
        setGameTeamName(gameSelfInfo.data?.gameTeam?.name);
      }
    },
  });

  if (gameSelfInfo.isLoading) {
    return <div>Loading...</div>;
  }

  const onSubmit = () => {
    if (
      typeof gameUserName === "string" &&
      gameUserName !== gameSelfInfo.data?.name
    ) {
      void changeNameMutation.mutate({
        name: gameUserName,
      });
    }
    if (
      typeof gameTeamName === "string" &&
      gameTeamName !== gameSelfInfo.data?.gameTeam?.name
    ) {
      void changeTeamNameMutation.mutate({
        name: gameTeamName,
      });
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Edit</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit profile</SheetTitle>
          <SheetDescription>
            <p className="text-muted-foreground text-sm">
              Make changes to your profile here. Click save when you&apos;re
              done.
            </p>
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="player-name" className="text-right">
              Player Name
            </Label>
            <Input
              id="player-name"
              defaultValue={gameSelfInfo.data?.name}
              value={gameUserName}
              onChange={(e) => setGameUserName(e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="team-name" className="text-right">
              Team Name
            </Label>
            <Input
              id="team-name"
              defaultValue={gameSelfInfo.data?.gameTeam?.name}
              value={gameTeamName}
              onChange={(e) => setGameTeamName(e.target.value)}
              className="col-span-3"
            />
          </div>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button onClick={onSubmit}>Save changes</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
