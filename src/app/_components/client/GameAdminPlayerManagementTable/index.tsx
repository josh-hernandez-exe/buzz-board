"use client";

import { useState } from "react";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
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
  const allPlayers = Object.values(gameState.gameUsers);

  const [sorting, setSorting] = useState<SortingState>([
    {
      id: "teamIndex",
      desc: false, // sort by name in descending order by default
    },
    {
      id: "playerIndex",
      desc: false, // sort by name in descending order by default
    },
  ]); // can set initial sorting state here
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
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
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
