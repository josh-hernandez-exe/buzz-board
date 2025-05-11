"use client";

import { useEffect, useRef } from "react";

import * as QRCode from "qrcode";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/app/_components/ui/card";

import type { PrivateGameState } from "@/types";

import { logger } from "@/logger";

import { env } from "@/env";

type hidableFields =
  | "name"
  | "id"
  | "code"
  | "format"
  | "buzzerState"
  | "description";

export function GameBasicInfoCard({
  game,
  hideFields = [],
  extraContent,
}: {
  game: PrivateGameState["game"];
  hideFields: hidableFields[];
  extraContent?: JSX.Element;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameInfoContent: JSX.Element[] = [];

  useEffect(() => {
    const joinUrl = `${env.NEXT_PUBLIC_QRCODE_BASE_URL}/join?code=${game.code}`;
    if (canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        joinUrl,
        {
          errorCorrectionLevel: "L",
        },
        (error) => {
          if (error) {
            logger.error("Error generating QR code", error);
          } else {
            logger.info("QR code generated successfully");
          }
        },
      );
    }
  }, [game.code]);

  for (const field of ["name", "id", "code", "format", "buzzerState"]) {
    if (hideFields.includes(field)) {
      continue;
    }

    switch (field) {
      case "name":
        gameInfoContent.push(<p>Game Name: {game?.name}</p>);
        break;
      case "id":
        gameInfoContent.push(<p>Game Id: {game?.id}</p>);
        break;
      case "code":
        gameInfoContent.push(<p>Game Code: {game?.code}</p>);
        break;
      case "format":
        gameInfoContent.push(<p>Game Format: {game?.format}</p>);
        break;
      case "buzzerState":
        gameInfoContent.push(
          <p>
            Game Buzzer State :{" "}
            {game.isBuzzerListening ? "Listening" : "Not Listening"}
          </p>,
        );
        break;
      default:
        break;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Game Info</CardTitle>
        {!hideFields.includes("description") && (
          <CardDescription>Game related information</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="col-span-1">
            {gameInfoContent}
            {extraContent}
          </div>
          <div className="col-span-1">
            <p className="text-center text-sm">
              Scan the QR code to join the game
            </p>
            <div className="flex items-center justify-center">
              <canvas className="h-32 w-32" ref={canvasRef} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
