"use client";

import { useEffect, useRef, useCallback } from "react";
import { BuzzerState } from "@prisma/client";

import { api } from "@/trpc/react";

export interface GameSoundEffectsProps {
  gameTeamId?: string;
}

export function GameSoundEffects({ gameTeamId }: GameSoundEffectsProps) {
  const gameState = api.gameGeneral.gameState.useSubscription();
  const previousGameStateRef = useRef<typeof gameState.data>(undefined);

  // Audio references
  const buzzInAudioRef = useRef<HTMLAudioElement | null>(null);
  const wrongAnswerAudioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize audio elements
  useEffect(() => {
    buzzInAudioRef.current = new Audio("/sounds/buzz-in.mp3");
    wrongAnswerAudioRef.current = new Audio("/sounds/wrong-answer.mp3");

    // Set volume
    if (buzzInAudioRef.current) {
      buzzInAudioRef.current.volume = 0.5;
    }
    if (wrongAnswerAudioRef.current) {
      wrongAnswerAudioRef.current.volume = 0.4;
    }

    // Cleanup
    return () => {
      buzzInAudioRef.current = null;
      wrongAnswerAudioRef.current = null;
    };
  }, []);

  const playBuzzInSound = useCallback(() => {
    if (buzzInAudioRef.current) {
      buzzInAudioRef.current.currentTime = 0; // Reset to beginning
      buzzInAudioRef.current.play().catch((error) => {
        console.warn("Failed to play buzz-in sound:", error);
      });
    }
  }, []);

  const playWrongAnswerSound = useCallback(() => {
    if (wrongAnswerAudioRef.current) {
      wrongAnswerAudioRef.current.currentTime = 0; // Reset to beginning
      wrongAnswerAudioRef.current.play().catch((error) => {
        console.warn("Failed to play wrong answer sound:", error);
      });
    }
  }, []);

  useEffect(() => {
    if (!gameState.data) return;

    const currentGameState = gameState.data;
    const previousGameState = previousGameStateRef.current;

    // Update the ref for next comparison
    previousGameStateRef.current = currentGameState;

    // Skip the first render when there's no previous state
    if (!previousGameState) return;

    // Check each team for state changes
    currentGameState.gameTeams.forEach((currentTeam) => {
      const previousTeam = previousGameState.gameTeams.find(
        (team) => team.id === currentTeam.id,
      );

      if (!previousTeam) return;

      // If gameTeamId is specified, only process that team
      if (gameTeamId && currentTeam.id !== gameTeamId) return;

      // Check for buzz-in (available -> selected)
      if (
        previousTeam.buzzerState === BuzzerState.available &&
        currentTeam.buzzerState === BuzzerState.selected
      ) {
        playBuzzInSound();
      }

      // Check for wrong answer (selected -> rejected)
      if (
        previousTeam.buzzerState === BuzzerState.selected &&
        currentTeam.buzzerState === BuzzerState.rejected
      ) {
        playWrongAnswerSound();
      }
    });
  }, [gameState.data, gameTeamId, playBuzzInSound, playWrongAnswerSound]);

  // This component doesn't render anything visible
  return null;
}
