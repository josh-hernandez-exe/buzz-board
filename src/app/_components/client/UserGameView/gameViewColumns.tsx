import { GameFormat, type Game } from "@prisma/client";
import type { DateTime } from "luxon";
import Link from "next/link";

import type { ColumnDef } from "@tanstack/react-table";

import { Button } from "@/app/_components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/app/_components/ui/tooltip";

import { env } from "@/env";

export type GameViewDataTableRow = {
  gameId: Game["id"];
  name: Game["name"];
  format: Game["format"];
  code: Game["code"];
  numTeams: number | undefined;
  numPlayers: number;
  createdAt: DateTime;
};

export function columnGenerator({
  onSelectClick,
}: {
  onSelectClick: (gameId: string) => void;
}): ColumnDef<GameViewDataTableRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Game Name",
      enableSorting: true,
      enableHiding: false,
    },
    {
      accessorKey: "format",
      header: () => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Format</TooltipTrigger>
            <TooltipContent>
              <p>Format of the game. Either team-based or individual.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      enableSorting: true,
      enableHiding: false,
    },
    {
      accessorKey: "code",
      header: () => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Code</TooltipTrigger>
            <TooltipContent>
              <p>
                Code used to join the game on the join page (when using{" "}
                {env.NEXT_PUBLIC_QRCODE_BASE_URL}/join).
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      enableSorting: false,
      enableHiding: true,
    },
    {
      accessorKey: "numTeams",
      header: () => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger># Teams</TooltipTrigger>
            <TooltipContent>
              <p>Number of Teams in game.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
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
      header: () => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger># Players</TooltipTrigger>
            <TooltipContent>
              <p>Number of players who have joined Game at any point.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      enableSorting: true,
      enableHiding: true,
    },
    {
      accessorKey: "createdAt",
      header: () => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Created At</TooltipTrigger>
            <TooltipContent>
              <p>The date and time when a game was created.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      enableSorting: true,
      enableHiding: true,
      cell: ({ row }) => {
        const createdAt: DateTime = row.getValue("createdAt");
        return <span suppressHydrationWarning>{createdAt.toFormat("ff")}</span>;
      },
    },
    {
      header: "Actions",
      accessorKey: "gameId",
      cell: ({ row }) => {
        const gameId: string = row.getValue("gameId");

        return (
          <div className="flex items-center gap-2">
            <Link
              className="text-blue-500"
              href={`/game/${gameId}/admin`}
              onNavigate={() => onSelectClick(gameId)}
            >
              Select
            </Link>
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
}
