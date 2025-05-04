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

export function GameBasicInfoCard({
  game,
}: {
  game: PrivateGameState["game"];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Game Info</CardTitle>
        <CardDescription>Game related information</CardDescription>
      </CardHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardContent className="col-span-1">
          <p>Game Name: {game?.name}</p>
          <p>Game Id: {game?.id}</p>
          <p>Game Code: {game?.code}</p>
          <p>Game Format: {game?.format}</p>
          <p>
            Game Buzzer State :{" "}
            {game.isBuzzerListening ? "Listening" : "Not Listening"}
          </p>
        </CardContent>
        <CardFooter className="col-span-1">
          <div className="flex flex-col items-center">
            <p className="text-center text-sm">
              Scan the QR code to join the game
            </p>
            <div className="flex items-center justify-center">
              <canvas className="h-32 w-32" ref={canvasRef} />
            </div>
          </div>
        </CardFooter>
      </div>
    </Card>
  );
}
