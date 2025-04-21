"use client";

import { type GameTeam } from "@prisma/client";
import { useState } from "react";

import { api } from "@/trpc/react";

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
import { GenericCard } from "@/app/_components/GenericCard";
import { logger } from "@/logger";

type BasicGameTeamInfo = Pick<GameTeam, "id" | "name">;

export function GameAdminTeamControl({
  gameTeams: initialGameTeams,
}: {
  gameTeams?: BasicGameTeamInfo[] | undefined;
}) {
  logger.debug(`GameAdminTeamControl`);

  const [teamIdToDelete, setTeamIdToDelete] = useState<string | undefined>();
  const addTeamMutation = api.gameAdmin.addTeam.useMutation();
  const removeTeamMutation = api.gameAdmin.removeTeam.useMutation();
  const gameStateSub = api.gameGeneral.gameState.useSubscription();

  const gameTeamsFromState = gameStateSub.data?.gameTeams as
    | BasicGameTeamInfo[]
    | undefined;

  const gameTeams = gameStateSub.data?.gameTeams ?? initialGameTeams;

  return (
    <GenericCard
      title="Admin Team Control"
      description="Control team creation"
      content={
        <div>
          <div>
            <Button
              onClick={() => addTeamMutation.mutate()}
              disabled={addTeamMutation.isPending}
              className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
            >
              Add Team
            </Button>
          </div>
          <div>
            <Select value={teamIdToDelete} onValueChange={setTeamIdToDelete}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select a team to delete" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Team</SelectLabel>
                  {gameTeams &&
                    gameTeams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Dialog>
              <DialogTrigger>
                <Button className="bg-red-500">Delete Team</Button>
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
                    className="rounded bg-red-500 px-4 py-2 text-white hover:bg-blue-600"
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
