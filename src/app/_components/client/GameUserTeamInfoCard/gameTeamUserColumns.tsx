import type { GameUser, User } from "@prisma/client";

import type { ColumnDef } from "@tanstack/react-table";

import { GameUserAvatar } from "@/app/_components/client/GameUserAvatar";

export type GameTeamUserTableRow = {
  id: GameUser["id"];
  name: GameUser["name"];
  index: GameUser["index"];
  image: User["image"] | undefined | null;
};

export const columns: ColumnDef<GameTeamUserTableRow>[] = [
  {
    accessorKey: "image",
    header: "",
    cell: ({ row }) => (
      <GameUserAvatar
        image={row.getValue("image")}
        index={row.getValue("index")}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "index",
    header: "Player No.",
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: "Player Name",
    enableSorting: false,
    enableHiding: false,
  },
];
