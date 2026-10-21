import { GameFormat } from "@prisma/client";
import type { ColumnDef } from "@tanstack/react-table";
import { DateTime } from "luxon";
import Link from "next/link";

import { DeleteGameDialog } from "@/app/_components/client/DeleteGameDialog";
import type { DashboardGame } from "@/types";
import { ROLE_LABEL } from "@/utils/capabilities";
import { STATUS_LABEL } from "@/utils/gameRules";

export type GameViewDataTableRow = DashboardGame;

type DeleteMutation = {
  mutate: (input: {
    gameId: string;
    confirmName: string;
    finishFirst?: boolean;
  }) => void;
  isPending: boolean;
  error: { message: string } | null;
  variables?: { gameId: string };
};

const STATUS_STYLE: Record<DashboardGame["status"], string> = {
  lobby: "bg-amber-100 text-amber-900",
  running: "bg-green-100 text-green-800",
  finished: "bg-gray-200 text-gray-800",
};

export function columnGenerator({
  onSelectClick,
  deleteGame,
}: {
  onSelectClick: (gameId: string) => void;
  deleteGame: DeleteMutation;
}): ColumnDef<GameViewDataTableRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Game",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-semibold">{row.original.name}</span>
          <span className="text-xs text-gray-300">
            {row.original.format === GameFormat.team
              ? `${row.original.numTeams} teams`
              : "Individual"}{" "}
            · {row.original.numPlayers}{" "}
            {row.original.numPlayers === 1 ? "player" : "players"}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <span
          data-testid="dashboard-status"
          className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_STYLE[row.original.status]}`}
        >
          {STATUS_LABEL[row.original.status]}
        </span>
      ),
    },
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.status === "finished" ? "—" : row.original.code}
        </span>
      ),
    },
    {
      accessorKey: "myRole",
      header: "Your role",
      cell: ({ row }) => ROLE_LABEL[row.original.myRole],
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => (
        <span suppressHydrationWarning className="whitespace-nowrap">
          {DateTime.fromJSDate(new Date(row.original.createdAt)).toFormat(
            "d LLL yyyy, HH:mm",
          )}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const game = row.original;
        const pendingHere =
          deleteGame.isPending && deleteGame.variables?.gameId === game.id;
        return (
          <div className="flex items-center gap-2">
            <Link
              className="rounded bg-white/10 px-3 py-1 font-semibold hover:bg-white/20"
              href={`/game/${game.id}/admin`}
              onNavigate={() => onSelectClick(game.id)}
              aria-label={`Open ${game.name}`}
            >
              Open
            </Link>
            {game.myRole === "owner" && (
              <DeleteGameDialog
                game={{
                  name: game.name,
                  status: game.status,
                  playerCount: game.numPlayers,
                }}
                triggerLabel="Delete…"
                triggerAriaLabel={`Delete ${game.name}`}
                onDelete={(input) =>
                  deleteGame.mutate({ gameId: game.id, ...input })
                }
                isPending={pendingHere}
                error={
                  deleteGame.variables?.gameId === game.id
                    ? deleteGame.error
                    : null
                }
              />
            )}
          </div>
        );
      },
    },
  ];
}
