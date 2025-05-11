"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import type { PrivateGameState } from "@/types";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/_components/ui/table";

import { columns } from "./gamePlayerTableColumns";

export function GamePlayerManagementTable({
  gameState,
}: {
  gameState: PrivateGameState;
}) {
  const allTeams = gameState.gameTeams;
  const allPlayers = gameState.gameUsers;

  allPlayers.sort((a, b) => {
    const teamA = allTeams.find((team) => team.id === a.gameTeamId);
    const teamB = allTeams.find((team) => team.id === b.gameTeamId);
    const teamAIndex = teamA?.index ?? 0;
    const teamBIndex = teamB?.index ?? 0;
    const delta = teamAIndex - teamBIndex;

    if (delta !== 0) {
      return delta;
    }
    // If teams are the same, sort by player index
    return a.index - b.index;
  });

  const table = useReactTable({
    data: allPlayers.map((player) => ({
      id: player.id,
      name: player.name,
      index: player.index,
      gameTeamId: player.gameTeamId,
      image: player.image,
      allGameTeams: allTeams,
    })),
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  if (!allPlayers) {
    return undefined;
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No players in this game.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
