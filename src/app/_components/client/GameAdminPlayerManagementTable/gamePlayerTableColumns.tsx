"use client";

import type { GameUser, GameTeam, User } from "@prisma/client";
import type { ColumnDef } from "@tanstack/react-table";
import { api } from "@/trpc/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select"; // Assuming you have a Select component

import { GameUserAvatar } from "@/app/_components/client/GameUserAvatar";

export type GamePlayerDataTableRow = {
  id: GameUser["id"];
  name: GameUser["name"];
  index: GameUser["index"];
  gameTeamId: GameUser["gameTeamId"];
  image: User["image"] | undefined | null;
  allGameTeams: Pick<GameTeam, "id" | "name" | "index">[]; // To populate the dropdown
};

export const columns: ColumnDef<GamePlayerDataTableRow>[] = [
  {
    accessorKey: "image",
    header: "",
    cell: ({ row }) => (
      <GameUserAvatar
        image={row.getValue("image")}
        index={row.original.index}
      />
    ),
    enableSorting: false,
  },
  {
    id: "teamIndex",
    accessorKey: "gameTeamId",
    header: "Team No.",
    cell: ({ row }) => {
      const player = row.original;
      const currentTeam = player.allGameTeams.find(
        (team) => team.id === player.gameTeamId,
      );
      return currentTeam ? currentTeam.index : "";
    },
    sortUndefined: "first", //force undefined values to the front
    sortingFn: (rowA, rowB) => {
      const playerA = rowA.original;
      const playerB = rowB.original;
      const teamA = playerA.allGameTeams.find(
        (team) => team.id === playerA.gameTeamId,
      );
      const teamB = playerB.allGameTeams.find(
        (team) => team.id === playerB.gameTeamId,
      );
      const teamAIndex = teamA?.index ?? 0;
      const teamBIndex = teamB?.index ?? 0;

      return teamAIndex - teamBIndex;
    },
  },
  {
    id: "playerIndex",
    accessorKey: "index",
    header: "Player No.",
    sortingFn: (rowA, rowB) => {
      const playerA = rowA.original;
      const playerB = rowB.original;

      return playerA.index - playerB.index;
    },
  },
  {
    accessorKey: "name",
    header: "Player Name",
    sortingFn: "alphanumeric",
  },
  {
    id: "teamName",
    accessorKey: "gameTeamId",
    header: "Current Team",
    sortingFn: "alphanumeric",
    cell: ({ row }) => {
      const player = row.original;
      const currentTeam = player.allGameTeams.find(
        (team) => team.id === player.gameTeamId,
      );
      return currentTeam ? currentTeam.name : "No Team";
    },
  },
  {
    id: "moveTeam",
    header: "Move to Team",
    enableSorting: false,
    cell: ({ row }) => {
      const player = row.original;
      const movePlayerMutation = api.gameAdmin.movePlayerToTeam.useMutation();

      const handleTeamChange = (newTeamIdFromDropdown: string) => {
        const newTeamId =
          newTeamIdFromDropdown === "null" ? undefined : newTeamIdFromDropdown;

        // Determine current team ID for comparison (null if no team)
        const currentDbTeamId = player.gameTeamId;
        // Determine new team ID for comparison (null if "No Team" is selected)

        if (newTeamId && currentDbTeamId !== newTeamId) {
          movePlayerMutation.mutate({
            gameUserId: player.id,
            targetGameTeamId: newTeamId,
          });
        }
      };

      return (
        <Select
          defaultValue={player.gameTeamId ?? "null"}
          onValueChange={handleTeamChange}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select team" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="null">No Team</SelectItem>
            {player.allGameTeams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    },
  },
];
