import { useState, useEffect } from "react";
import { BuzzerState, type GameTeam } from "@prisma/client";

import {
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/_components/ui/table";

import { Button } from "@/app/_components/ui/button";

import type { GameTeamDataTableRow, columns } from "./gameTeamTableColumns";

interface DataTableProps {
  columns: typeof columns;
  data: GameTeamDataTableRow[];
  onChange?: (selectedTeams: Record<GameTeam["id"], boolean>) => void;
}

export function DataTable({ columns, data, onChange }: DataTableProps) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    state: {
      rowSelection, //pass the row selection state back to the table instance
    },
  });

  useEffect(() => {
    onChange?.(rowSelection);
  }, [rowSelection, onChange]);

  const handleSelectByBuzzerSelected = () => {
    const selectedTeamIds = data
      .filter((item) => item.buzzerState === BuzzerState.selected)
      .map((item) => item.id);

    const newRowSelection: RowSelectionState = {};
    selectedTeamIds.forEach((id) => {
      newRowSelection[id] = true;
    });

    setRowSelection(newRowSelection);
  };
  const handleSelectByBuzzerRejected = () => {
    const selectedTeamIds = data
      .filter((item) => item.buzzerState === BuzzerState.rejected)
      .map((item) => item.id);

    const newRowSelection: RowSelectionState = {};
    selectedTeamIds.forEach((id) => {
      newRowSelection[id] = true;
    });

    setRowSelection(newRowSelection);
  };

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-2 p-2">
        <span className="text-muted-foreground text-sm">Select teams:</span>
        <Button onClick={handleSelectByBuzzerSelected} variant="secondary">
          Buzzer Selected
        </Button>
        <Button onClick={handleSelectByBuzzerRejected} variant="secondary">
          Buzzer Rejected
        </Button>
      </div>
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
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
