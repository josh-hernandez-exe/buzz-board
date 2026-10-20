"use client";

import { useState } from "react";

import { GameFormat } from "@prisma/client";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Label } from "@/app/_components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/app/_components/ui/sheet";
import { api } from "@/trpc/react";
import { NAME_LIMITS } from "@/utils/displayName";

const LOCKED_SELF =
  "Your host has locked name changes for you. Ask them if it needs changing.";
const LOCKED_TEAM =
  "Your host has locked this team's name. Ask them if it needs changing.";

/**
 * "My game profile": the player's name in this game (not their account) and,
 * in team games, their team's name. Locked fields say who controls them, and
 * a refused save keeps what was typed.
 */
export function GameUserEditSheet() {
  const { data } = useLiveGameState();
  const self = api.gameUser.getSelfInfo.useQuery();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState("");
  // Versions loaded when the sheet opened, so a newer name isn't overwritten.
  const [loaded, setLoaded] = useState({ name: 0, team: 0 });
  const [saved, setSaved] = useState(false);

  const changeName = api.gameUser.changeName.useMutation();
  const changeTeamName = api.gameUser.changeTeamName.useMutation();

  const selfId = self.data?.id;
  const player = selfId ? data?.gameUsers[selfId] : undefined;
  const team = data?.gameTeams.find((t) => t.id === player?.gameTeamId);
  const isTeamGame = data?.game.format === GameFormat.team;
  const finished = data?.game.status === "finished";
  if (!data || !player) return null;

  const nameLocked = !player.allowSelfRename;
  const teamLocked = !!team && !team.allowMemberRename;

  const openSheet = (next: boolean) => {
    setOpen(next);
    if (next) {
      setName(player.name);
      setTeamName(team?.name ?? "");
      setLoaded({ name: player.nameVersion, team: team?.nameVersion ?? 0 });
      setSaved(false);
      changeName.reset();
      changeTeamName.reset();
    }
  };

  const save = async () => {
    setSaved(false);
    const tasks: Promise<unknown>[] = [];
    if (!nameLocked && name.trim() !== player.name) {
      tasks.push(
        changeName.mutateAsync({ name, expectedNameVersion: loaded.name }),
      );
    }
    if (isTeamGame && team && !teamLocked && teamName.trim() !== team.name) {
      tasks.push(
        changeTeamName.mutateAsync({
          name: teamName,
          expectedNameVersion: loaded.team,
        }),
      );
    }
    const results = await Promise.allSettled(tasks);
    // Keep the sheet open with the typed text when anything was refused.
    if (results.every((r) => r.status === "fulfilled")) {
      setSaved(true);
      setOpen(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={openSheet}>
      <SheetTrigger asChild>
        <Button variant="outline" disabled={finished}>
          Edit my game profile
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>My game profile</SheetTitle>
          <SheetDescription>
            How you appear in this game only. Your account isn&apos;t changed.
          </SheetDescription>
        </SheetHeader>
        <form
          className="grid gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="player-name">Your name</Label>
            <Input
              id="player-name"
              value={name}
              maxLength={NAME_LIMITS.maxDisplayName * 2}
              disabled={nameLocked}
              aria-describedby={nameLocked ? "player-name-locked" : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {nameLocked && (
              <p id="player-name-locked" className="text-sm text-slate-600">
                {LOCKED_SELF}
              </p>
            )}
            <ErrorNotice error={changeName.error} />
          </div>
          {isTeamGame && team && (
            <div className="grid gap-1">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                value={teamName}
                maxLength={NAME_LIMITS.maxDisplayName * 2}
                disabled={teamLocked}
                aria-describedby={teamLocked ? "team-name-locked" : undefined}
                onChange={(e) => setTeamName(e.target.value)}
              />
              {teamLocked && (
                <p id="team-name-locked" className="text-sm text-slate-600">
                  {LOCKED_TEAM}
                </p>
              )}
              <ErrorNotice error={changeTeamName.error} />
            </div>
          )}
          <SheetFooter className="p-0">
            <Button
              type="submit"
              disabled={
                changeName.isPending ||
                changeTeamName.isPending ||
                (nameLocked && (teamLocked || !team || !isTeamGame))
              }
            >
              Save changes
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
      {saved && (
        <span role="status" className="sr-only">
          Profile saved
        </span>
      )}
    </Sheet>
  );
}
