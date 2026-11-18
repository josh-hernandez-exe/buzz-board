"use client";

import { useState } from "react";

import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { useLiveGameState } from "@/app/_components/client/LiveGameState";
import { Button } from "@/app/_components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/app/_components/ui/dialog";
import { Switch } from "@/app/_components/ui/switch";
import { api } from "@/trpc/react";
import type { GameSettings } from "@/types";
import { newRequestId } from "@/utils/requestId";

/*
 * Team setup for hosts (owner and co-hosts), used inside the roster's Teams
 * panel: adding teams, whether players may switch, and deleting a team.
 */

export function AddTeamButton() {
  const { data } = useLiveGameState();
  const addTeam = api.gameAdmin.addTeam.useMutation();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={() => addTeam.mutate()}
        disabled={addTeam.isPending || data?.game.status === "finished"}
      >
        Add team
      </Button>
      <ErrorNotice error={addTeam.error} />
    </div>
  );
}

export function TeamSwitchingToggle() {
  const { data } = useLiveGameState();
  const freeze = api.gameAdmin.toggleFreezeTeams.useMutation();
  const settings = data?.game.settings as GameSettings | undefined;
  const frozen = settings?.freezeTeams ?? false;
  return (
    <div className="bg-surface-sunken flex flex-col gap-1 rounded-lg p-3">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="team-switching" className="flex flex-col">
          <span className="font-semibold">Players can switch teams</span>
          <span className="text-muted-foreground text-sm">
            {frozen
              ? "Teams are locked. Hosts and moderators can still move players."
              : "Players pick and change their own team."}
          </span>
        </label>
        <Switch
          id="team-switching"
          checked={!frozen}
          onCheckedChange={(checked: boolean) =>
            freeze.mutate({ freeze: !checked })
          }
          disabled={freeze.isPending || data?.game.status === "finished"}
          aria-label="Toggle team switching"
        />
      </div>
      <ErrorNotice error={freeze.error} />
    </div>
  );
}

export function RandomizeTeamsControl() {
  const { data } = useLiveGameState();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [lockTeams, setLockTeams] = useState(true);
  const [requestId, setRequestId] = useState(newRequestId);
  const assign = api.gameAdmin.randomizeTeams.useMutation({
    onSuccess: () => setOpen(false),
  });
  const players = Object.keys(data?.gameUsers ?? {}).length;
  const teams = data?.gameTeams.length ?? 0;
  const blocked =
    data?.game.status === "finished"
      ? "This game has finished."
      : !teams
        ? "Add a team first."
        : !players
          ? "Wait for players to join."
          : data?.game.isBuzzerListening ||
              data?.gameTeams.some(
                (team) => team.buzzerState !== "available",
              ) ||
              data?.mode?.status === "running"
            ? "Close and reset the buzzer with Next question, and end any running game mode first."
            : undefined;

  return (
    <div className="flex flex-col items-start gap-2 py-3">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (assign.isPending) return;
          setOpen(next);
          if (next) {
            assign.reset();
            setConfirmed(false);
            setLockTeams(true);
            setRequestId(newRequestId());
          }
        }}
      >
        <DialogTrigger asChild>
          <Button variant="secondary" disabled={!!blocked || assign.isPending}>
            Randomly assign teams
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Randomly assign all players?</DialogTitle>
            <DialogDescription>
              Randomly distribute all {players} current players across {teams}{" "}
              existing teams, with team sizes differing by at most one. This
              includes players without a team. Scores and history stay with
              their teams. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lockTeams}
              disabled={assign.isPending}
              onChange={(event) => setLockTeams(event.target.checked)}
            />
            Lock player team switching after assignment
          </label>
          <p className="text-muted-foreground text-sm">
            Unchecked keeps the current switching setting. You can change
            Players can switch teams beside this action afterwards. Host assigns
            still takes precedence.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={assign.isPending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I understand this replaces everyone&apos;s current team.
          </label>
          <ErrorNotice error={assign.error} />
          {blocked && <p role="status">{blocked}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={assign.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={!confirmed || !!blocked || assign.isPending}
              onClick={() => assign.mutate({ requestId, lockTeams })}
            >
              {assign.isPending ? "Assigning..." : "Assign randomly"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {blocked && <p className="text-muted-foreground text-sm">{blocked}</p>}
      {assign.isSuccess && <p role="status">Teams assigned randomly.</p>}
    </div>
  );
}

export function DeleteTeamButton({
  team,
  players,
}: {
  team: { id: string; name: string };
  players: number;
}) {
  const { data } = useLiveGameState();
  const removeTeam = api.gameAdmin.removeTeam.useMutation();
  return (
    <>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={removeTeam.isPending || data?.game.status === "finished"}
            aria-label={`Delete ${team.name}`}
          >
            Delete…
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {team.name}?</DialogTitle>
            <DialogDescription>
              {players > 0
                ? `Its ${players} ${players === 1 ? "player is" : "players are"} left without a team and its score is lost. `
                : "Its score is lost. "}
              This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Keep team</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button
                variant="destructive"
                onClick={() => removeTeam.mutate({ gameTeamId: team.id })}
              >
                Delete team
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ErrorNotice error={removeTeam.error} />
    </>
  );
}
