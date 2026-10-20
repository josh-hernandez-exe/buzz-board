"use client";

import { useEffect, useRef, useCallback } from "react";
import { BuzzerState } from "@prisma/client";

import {
  useLiveGameState,
  usePublicLiveGameState,
} from "@/app/_components/client/LiveGameState";

export interface GameSoundEffectsProps {
  gameTeamId?: string;
}

type TeamBuzzerStates = Array<{ id: string; buzzerState: BuzzerState }>;

/** Sound cues for member pages (admin, player, member scoreboard). */
export function GameSoundEffects({ gameTeamId }: GameSoundEffectsProps) {
  const { data } = useLiveGameState();
  return <BuzzerSounds gameTeams={data?.gameTeams} gameTeamId={gameTeamId} />;
}

/** Sound cues for the anonymous public scoreboard. */
export function PublicGameSoundEffects() {
  const { data } = usePublicLiveGameState();
  return <BuzzerSounds gameTeams={data?.gameTeams} />;
}

function BuzzerSounds({
  gameTeams,
  gameTeamId,
}: {
  gameTeams: TeamBuzzerStates | undefined;
  gameTeamId?: string;
}) {
  const previousGameTeamsRef = useRef<TeamBuzzerStates | undefined>(undefined);

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
    if (!gameTeams) return;

    const previousGameTeams = previousGameTeamsRef.current;

    // Update the ref for next comparison
    previousGameTeamsRef.current = gameTeams;

    // Skip the first render when there's no previous state
    if (!previousGameTeams) return;

    // Check each team for state changes
    gameTeams.forEach((currentTeam) => {
      const previousTeam = previousGameTeams.find(
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
  }, [gameTeams, gameTeamId, playBuzzInSound, playWrongAnswerSound]);

  // This component doesn't render anything visible
  return null;
}
