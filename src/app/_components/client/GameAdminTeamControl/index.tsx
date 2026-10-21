"use client";

import { type GameTeam } from "@prisma/client";
import { useState } from "react";

import { api } from "@/trpc/react";

import { X } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/app/_components/ui/dialog";

import { Button } from "@/app/_components/ui/button";
import { Switch } from "@/app/_components/ui/switch";
import { GenericCard } from "@/app/_components/GenericCard";

import type { GameSettings } from "@/types";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";

type BasicGameTeamInfo = Pick<GameTeam, "id" | "name" | "index">;

export function GameAdminTeamControl({
  gameTeams: initialGameTeams,
}: {
  gameTeams?: BasicGameTeamInfo[] | undefined;
}) {
  const [selectRootKey, setSelectRootKey] = useState(0);
  const [teamIdToDelete, setTeamIdToDelete] = useState<string | undefined>();
  const addTeamMutation = api.gameAdmin.addTeam.useMutation();
  const removeTeamMutation = api.gameAdmin.removeTeam.useMutation();
  const toggleFreezeTeamsMutation =
    api.gameAdmin.toggleFreezeTeams.useMutation();
  const gameStateSub = useLiveGameState();

  const gameTeamsFromState = gameStateSub.data?.gameTeams as
    | BasicGameTeamInfo[]
    | undefined;

  const gameFromState = gameStateSub.data?.game;
  const settings = gameFromState?.settings as GameSettings | undefined;
  const isTeamsFrozen = settings?.freezeTeams ?? false;

  const gameTeams = gameTeamsFromState ?? initialGameTeams;

  gameTeams?.sort((a, b) => a.index - b.index);

  return (
    <GenericCard
      title="Admin Team Control"
      description="Control team creation"
      content={
        <div className="space-y-4">
          {/* Freeze Teams Control */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <h4 className="font-medium">Team Switching</h4>
              <p className="text-muted-foreground text-sm">
                {isTeamsFrozen
                  ? "Team switching is currently disabled"
                  : "Players can switch teams freely"}
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-muted-foreground text-sm font-medium">
                {isTeamsFrozen ? "Off" : "On"}
              </span>
              <Switch
                checked={!isTeamsFrozen}
                onCheckedChange={(checked: boolean) => {
                  toggleFreezeTeamsMutation.mutate({ freeze: !checked });
                }}
                disabled={toggleFreezeTeamsMutation.isPending}
                aria-label="Toggle team switching"
              />
            </div>
          </div>

          {/* Add Team Control */}
          <div>
            <Button
              onClick={() => addTeamMutation.mutate()}
              disabled={addTeamMutation.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-md px-4 py-2 font-semibold"
            >
              Add Team
            </Button>
          </div>

          {/* Delete Team Control */}
          <div className="inline-flex items-center justify-between">
            <Select
              key={selectRootKey}
              value={teamIdToDelete ?? ""}
              onValueChange={setTeamIdToDelete}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select a team to delete" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Team</SelectLabel>
                  {gameTeams?.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setTeamIdToDelete(undefined);
                // Increament key of the root select to force a re-render
                // This is a workaround for to deselect the select value
                setSelectRootKey((prev) => prev + 1);
              }}
            >
              <X />
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" disabled={!teamIdToDelete}>
                  Delete Team
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Are you absolutely sure?</DialogTitle>
                  <DialogDescription>
                    This action cannot be undone. This will permanently delete
                    the team and remove all players off that team.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    onClick={() => {
                      if (!teamIdToDelete) return;

                      return removeTeamMutation.mutate({
                        gameTeamId: teamIdToDelete,
                      });
                    }}
                    disabled={removeTeamMutation.isPending || !teamIdToDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md px-4 py-2 font-semibold"
                  >
                    Delete Team
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      }
    />
  );
}
