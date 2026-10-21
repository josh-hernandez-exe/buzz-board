import { cn } from "@/app/_lib/utils";
import {
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

import { type GameViewDataTableRow, columnGenerator } from "./gameViewColumns";

// Secondary columns are hidden on phones; the Game cell repeats status and
// code there instead.
const WIDE_ONLY = new Set(["status", "code", "myRole", "createdAt"]);
const wideOnly = (columnId: string) =>
  WIDE_ONLY.has(columnId) ? "hidden md:table-cell" : undefined;

export function GameTeamUserTable({
  data,
  onSelectClick,
  deleteGame,
}: {
  data: GameViewDataTableRow[];
  onSelectClick: (gameId: string) => void;
  deleteGame: Parameters<typeof columnGenerator>[0]["deleteGame"];
}) {
  const columns = columnGenerator({ onSelectClick, deleteGame });
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "text-foreground",
                      wideOnly(header.column.id),
                    )}
                  >
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
                  <TableCell key={cell.id} className={wideOnly(cell.column.id)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No games yet. Create one above.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
