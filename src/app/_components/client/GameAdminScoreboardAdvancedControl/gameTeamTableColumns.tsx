import { type GameTeam, BuzzerState } from "@prisma/client";

import type { ColumnDef } from "@tanstack/react-table";

import { Check, X, SquareDashed } from "lucide-react";

import { Checkbox } from "@/app/_components/ui/checkbox";

export type GameTeamDataTableRow = {
  id: GameTeam["id"];
  name: GameTeam["name"];
  index: GameTeam["index"];
  score: number;
  buzzerState: GameTeam["buzzerState"];
};

export const columns: ColumnDef<GameTeamDataTableRow>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value: boolean) =>
          table.toggleAllPageRowsSelected(!!value)
        }
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value: boolean) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "index",
    header: "No.",
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: "Team Name",
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "buzzerState",
    header: "Buzzer",
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      if (row.getValue("buzzerState") === BuzzerState.selected) {
        return (
          <div className="flex items-center justify-center">
            <Check className="h-4 w-4 text-green-500" />
          </div>
        );
      } else if (row.getValue("buzzerState") === BuzzerState.rejected) {
        return (
          <div className="flex items-center justify-center">
            <X className="h-4 w-4 text-red-500" />
          </div>
        );
      } else if (row.getValue("buzzerState") === BuzzerState.available) {
        return (
          <div className="flex items-center justify-center">
            <SquareDashed className="h-4 w-4 text-gray-500" />
          </div>
        );
      }
    },
  },
  {
    accessorKey: "score",
    header: "Score",
    enableSorting: false,
    enableHiding: false,
  },
];
