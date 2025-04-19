import { GameFormat, type Game } from "@prisma/client";
import type { DateTime } from "luxon";

import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/app/_components/ui/button";

export type GameViewDataTableRow = {
  id: Game["id"];
  name: Game["name"];
  format: Game["format"];
  code: Game["code"];
  numTeams: number | undefined;
  numPlayers: number;
  createdAt: DateTime;
};

export const columns: ColumnDef<GameViewDataTableRow>[] = [
  {
    accessorKey: "name",
    header: "Game Name",
    enableSorting: true,
    enableHiding: false,
  },
  {
    accessorKey: "format",
    header: "Game Format",
    enableSorting: true,
    enableHiding: false,
  },
  {
    accessorKey: "code",
    header: "Game Code",
    enableSorting: false,
    enableHiding: true,
  },
  {
    accessorKey: "numTeams",
    header: "Num of Teams",
    enableSorting: true,
    enableHiding: true,
    cell: ({ row }) => {
      const numTeams: GameViewDataTableRow["numTeams"] =
        row.getValue("numTeams");
      const format = row.getValue("format");

      if (numTeams === undefined || numTeams === null) {
        return <span>N/A</span>;
      }
      if (format === GameFormat.individual) {
        return <span>N/A</span>;
      }
      if (numTeams < 0) {
        return <span>N/A</span>;
      }

      return <span>{numTeams}</span>;
    },
  },
  {
    accessorKey: "numPlayers",
    header: "Num of Players",
    enableSorting: true,
    enableHiding: true,
  },
  {
    accessorKey: "createdAt",
    header: "Created At",
    enableSorting: true,
    enableHiding: true,
    cell: ({ row }) => {
      const createdAt: DateTime = row.getValue("createdAt");
      return <span>{createdAt.toFormat("ff")}</span>;
    },
  },
  {
    header: "Actions",
    cell: ({ row }) => {
      // const url = `/admin/${row.getValue("id")}`;
      return (
        <div className="flex items-center gap-2">
          <Button className="text-blue-500">Edit</Button>
          <Button className="text-red-500" disabled={true}>
            Delete
          </Button>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
