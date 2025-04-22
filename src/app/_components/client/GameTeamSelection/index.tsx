"use client";

import { useState } from "react";
import { GameFormat, type GameTeam } from "@prisma/client";

import { GenericCard } from "@/app/_components/GenericCard";

import { Button } from "@/app/_components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/app/_components/ui/drawer";

import { Label } from "@/app/_components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/app/_components/ui/radio-group";

import { api } from "@/trpc/react";

import { logger } from "@/logger";

export function GameTeamSelection({
  initialGameTeamId,
  gameTeams,
  onChange,
}: {
  initialGameTeamId: GameTeam["id"] | undefined | null;
  gameTeams: Array<Pick<GameTeam, "id" | "name" | "index">>;
  onChange?: (gameTeamId: GameTeam["id"]) => void;
}) {
  const utils = api.useUtils();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const initialGameTeam = gameTeams.find(
    (team) => team.id === initialGameTeamId,
  );
  const [selectedTeam, setSelectedTeam] = useState(initialGameTeam);
  const [gameTeamName, setGameTeamName] = useState(initialGameTeam?.name);

  const changeTeamMutation = api.gameUser.changeTeams.useMutation({
    onSuccess: async (updatedGameUser) => {
      utils.gameUser.getSelfInfo.invalidate();
      const updatedGameTeam = gameTeams.find(
        (team) => team.id === updatedGameUser.gameTeamId,
      );
      if (!updatedGameTeam) {
        logger.error(
          `GameTeamSelection: Failed to find updated game team with id ${updatedGameUser.gameTeamId}`,
        );
        return;
      }

      setIsDrawerOpen(false);
      logger.info(
        `GameTeamSelection: Successfully changed to team ${updatedGameTeam.name}`,
      );
      setGameTeamName(updatedGameTeam.name);
      onChange?.(updatedGameTeam.id);
    },
  });

  const changeTeamNameMutation = api.gameUser.changeTeamName.useMutation({
    onSuccess: async () => {
      utils.gameUser.getSelfInfo.invalidate();
    },
    onError: async () => {
      setGameTeamName(initialGameTeam?.name);
    },
  });

  return (
    <div className="flex flex-col items-center justify-center">
      <GenericCard
        title={
          <div className="flex items-center space-x-2">
            {gameTeamName && (
              <div className="flex items-center space-x-2">
                <span>{gameTeamName}</span>
              </div>
            )}
            {!gameTeamName && (
              <div className="flex items-center space-x-2">
                <span>Select your team</span>
              </div>
            )}
          </div>
        }
        content={
          <Drawer open={isDrawerOpen}>
            <DrawerTrigger asChild>
              <Button
                variant="outline"
                onClick={() => {
                  setIsDrawerOpen(true);
                }}
              >
                Change Team
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <div className="mx-auto w-full max-w-sm">
                <DrawerHeader>
                  <DrawerTitle>Select Team</DrawerTitle>
                  <DrawerDescription>
                    Select the team you want to join.
                  </DrawerDescription>
                </DrawerHeader>
                <div className="p-4 pb-0">
                  <RadioGroup
                    // We want to ensure that the value prop is always defined
                    value={selectedTeam?.id ?? ""}
                    onValueChange={(value: GameTeam["id"]) => {
                      const team = gameTeams.find((team) => team.id === value);
                      if (team) {
                        setSelectedTeam(team);
                      }
                    }}
                  >
                    {gameTeams.map((team) => (
                      <div
                        key={team.id}
                        className="flex items-center space-x-2"
                      >
                        <RadioGroupItem
                          value={team.id}
                          id={team.id}
                          className="h-6 w-6"
                        />
                        <Label htmlFor="r1">{team.name}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
                <DrawerFooter>
                  {/* TODO: Make this button close the drawer on success */}
                  <Button
                    disabled={!selectedTeam || changeTeamMutation.isPending}
                    onClick={() => {
                      logger.info(
                        `GameTeamSelection: Changing team to ${selectedTeam?.name}`,
                      );
                      if (selectedTeam) {
                        changeTeamMutation.mutate({
                          gameTeamId: selectedTeam.id,
                        });
                      }
                    }}
                  >
                    Submit
                  </Button>
                  <DrawerClose asChild>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsDrawerOpen(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </DrawerClose>
                </DrawerFooter>
              </div>
            </DrawerContent>
          </Drawer>
        }
      />
    </div>
  );
}
