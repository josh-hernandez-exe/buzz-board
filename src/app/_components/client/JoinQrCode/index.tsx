"use client";

import { useEffect, useRef } from "react";

import * as QRCode from "qrcode";

import { env } from "@/env";
import { logger } from "@/logger";

export function joinUrl(code: string) {
  return `${env.NEXT_PUBLIC_QRCODE_BASE_URL}/join?code=${code}`;
}

export function JoinQrCode({
  code,
  className = "h-32 w-32",
}: {
  code: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(
      canvasRef.current,
      joinUrl(code),
      { errorCorrectionLevel: "L" },
      (error) => {
        if (error) logger.error("Error generating QR code", error);
      },
    );
  }, [code]);
  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={`QR code to join with code ${code}`}
    />
  );
}
