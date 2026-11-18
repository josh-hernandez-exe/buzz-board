"use client";

import type { JSX } from "react";

import { JoinQrCode, joinUrl } from "@/app/_components/client/JoinQrCode";
import { Panel } from "@/app/_components/ui/page";
import { env } from "@/env";
import type { PrivateGameState } from "@/types";
import { STATUS_LABEL } from "@/utils/gameRules";

type HidableField = "name" | "id" | "code" | "format" | "buzzerState" | "qr";

/** The game's basics: format, buzzing, status, and how to join. */
export function GameBasicInfoCard({
  game,
  hideFields = [],
  extraContent,
}: {
  game: PrivateGameState["game"];
  hideFields?: HidableField[];
  extraContent?: JSX.Element;
}) {
  const show = (field: HidableField) => !hideFields.includes(field);
  const rows: [string, string][] = [];
  if (show("name")) rows.push(["Game", game.name]);
  if (show("format"))
    rows.push([
      "Players compete",
      game.format === "team" ? "As teams" : "Individually",
    ]);
  rows.push([
    "Buzzing",
    game.buzzerMode === "queue"
      ? "Queue: everyone lines up"
      : "First buzz wins",
  ]);
  if (show("buzzerState"))
    rows.push(["Buzzer", game.isBuzzerListening ? "Open" : "Closed"]);
  rows.push(["Status", STATUS_LABEL[game.status]]);
  if (show("code")) rows.push(["Join code", game.code]);
  if (show("id") && env.NEXT_PUBLIC_SHOW_DEBUG_INFO)
    rows.push(["Game ID", game.id]);

  return (
    <Panel title="About this game">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {show("qr") && (
          <figure className="flex flex-col items-center gap-1">
            <div className="bg-qr rounded-lg p-1.5">
              <JoinQrCode code={game.code} className="h-28 w-28" />
            </div>
            <figcaption className="text-muted-foreground text-xs">
              Scan to join
            </figcaption>
          </figure>
        )}
      </div>
      {show("code") && (
        <p className="text-muted-foreground text-sm break-all">
          Join link: {joinUrl(game.code)}
        </p>
      )}
      {extraContent}
    </Panel>
  );
}
