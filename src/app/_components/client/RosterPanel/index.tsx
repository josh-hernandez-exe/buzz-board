"use client";

import { useEffect, useMemo, useState } from "react";

import { GameFormat } from "@prisma/client";

import { GenericCard } from "@/app/_components/GenericCard";
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
import { env } from "@/env";
import { helpHref } from "@/help/manifest";
import { api } from "@/trpc/react";
import {
  RECOVERY_LINK_LIFETIME_MINUTES,
  can,
  type StaffRoleName,
} from "@/utils/capabilities";
import { NAME_LIMITS } from "@/utils/displayName";

type Player = {
  id: string;
  name: string;
  index: number;
  gameTeamId: string | null;
  allowSelfRename: boolean;
  nameVersion: number;
};

/** Rename (with an optional lock) for a player or a team. */
function RenameDialog({
  label,
  currentName,
  locked,
  lockLabel,
  onSave,
  error,
  pending,
}: {
  label: string;
  currentName: string;
  locked: boolean;
  lockLabel: string;
  onSave: (input: { name: string; lock: boolean }) => Promise<unknown>;
  error: { message: string; data?: { help?: string | null } | null } | null;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [lock, setLock] = useState(locked);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(currentName);
          setLock(locked);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Rename ${label}`}>
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {label}</DialogTitle>
          <DialogDescription>
            Points and history stay the same. Everyone sees the new name
            straight away.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({ name, lock }).then(
              () => setOpen(false),
              () => undefined,
            );
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            New name
            <input
              className="rounded-md border px-2 py-1 text-base"
              value={name}
              maxLength={NAME_LIMITS.maxDisplayName * 2}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={lock}
              onChange={(e) => setLock(e.target.checked)}
            />
            {lockLabel}
          </label>
          <ErrorNotice error={error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Player management for staff: search the roster, rename players and teams
 * (and lock their renaming), move players, remove them, and give a guest who
 * lost their device a one-time link back in.
 */
export function RosterPanel({ staffRole }: { staffRole: StaffRoleName }) {
  const { data: live } = useLiveGameState();
  const roster = api.gameAdmin.roster.list.useQuery();
  const utils = api.useUtils();
  const refresh = () => utils.gameAdmin.roster.list.invalidate();
  const renamePlayer = api.gameAdmin.roster.renamePlayer.useMutation({
    onSuccess: refresh,
  });
  const renameTeam = api.gameAdmin.roster.renameTeam.useMutation();
  const move = api.gameAdmin.movePlayerToTeam.useMutation({
    onSuccess: refresh,
  });
  const remove = api.gameAdmin.roster.removePlayer.useMutation({
    onSuccess: refresh,
  });
  const recovery = api.gameAdmin.roster.createRecoveryLink.useMutation();
  const [query, setQuery] = useState("");

  const isTeamGame = live?.game.format === GameFormat.team;
  const teams = live?.gameTeams ?? [];
  const canRecover = can(staffRole, "recoverGuests");

  // Names, teams and locks come from the live game state, so changes made at
  // another desk appear at once. The roster query only adds whether a player
  // is saved to an account, and is refetched when the set of players changes.
  const playerKey = live ? Object.keys(live.gameUsers).sort().join(",") : "";
  useEffect(() => {
    if (playerKey) void utils.gameAdmin.roster.list.invalidate();
  }, [playerKey, utils]);

  const players = useMemo(() => {
    const linked = new Set(
      (roster.data?.players ?? []).filter((p) => p.isLinked).map((p) => p.id),
    );
    const all: (Player & { isLinked: boolean })[] = Object.values(
      live?.gameUsers ?? {},
    )
      .map((p) => ({
        id: p.id,
        name: p.name,
        index: p.index,
        gameTeamId: p.gameTeamId,
        allowSelfRename: p.allowSelfRename,
        nameVersion: p.nameVersion,
        isLinked: linked.has(p.id),
      }))
      .sort((a, b) => a.index - b.index);
    const q = query.trim().toLowerCase();
    return q
      ? all.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || String(p.index).includes(q),
        )
      : all;
  }, [live, roster.data, query]);

  if (!live) return null;
  const teamName = (id: string | null) =>
    teams.find((t) => t.id === id)?.name ?? "No team";
  const recoveryUrl = recovery.data
    ? `${env.NEXT_PUBLIC_QRCODE_BASE_URL}${recovery.data.path}`
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      {isTeamGame && (
        <GenericCard
          title="Teams"
          description="Rename a team or stop its members renaming it."
          content={
            <ul className="flex list-none flex-col gap-2">
              {teams.map((team) => (
                <li
                  key={team.id}
                  className="ml-0 flex flex-wrap items-center justify-between gap-2"
                  data-testid="roster-team"
                >
                  <span>
                    {team.index}. {team.name}
                    {!team.allowMemberRename && (
                      <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs">
                        Name locked
                      </span>
                    )}
                  </span>
                  <RenameDialog
                    label={team.name}
                    currentName={team.name}
                    locked={!team.allowMemberRename}
                    lockLabel="Stop team members renaming it"
                    error={renameTeam.error}
                    pending={renameTeam.isPending}
                    onSave={({ name, lock }) =>
                      renameTeam.mutateAsync({
                        gameTeamId: team.id,
                        name,
                        allowMemberRename: !lock,
                        expectedNameVersion: team.nameVersion,
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          }
        />
      )}

      <GenericCard
        title={`Players (${Object.keys(live.gameUsers).length})`}
        description={
          live.game.isBuzzerListening
            ? "Moving players waits while the buzzer is open. Removing works at any time."
            : undefined
        }
        footer={
          <a
            href={helpHref("moderation")}
            target="_blank"
            rel="noopener"
            className="text-sm underline"
          >
            About managing players
          </a>
        }
        content={
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Find a player
              <input
                type="search"
                className="rounded-md border px-2 py-1 text-base"
                placeholder="Name or player number"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <ErrorNotice error={move.error ?? remove.error ?? recovery.error} />
            {recoveryUrl && recovery.data && (
              <div className="flex flex-col gap-2 rounded-md bg-slate-100 p-3 text-sm">
                <label htmlFor="recovery-url" className="font-medium">
                  Send this link privately to {recovery.data.nickname}. It works
                  once, for {RECOVERY_LINK_LIFETIME_MINUTES} minutes, and signs
                  out their old device.
                </label>
                <input
                  id="recovery-url"
                  readOnly
                  value={recoveryUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="rounded border px-2 py-1 font-mono text-xs"
                />
              </div>
            )}
            <ul className="flex list-none flex-col divide-y">
              {players.map((player) => (
                <li
                  key={player.id}
                  className="ml-0 flex flex-col gap-2 py-2"
                  data-testid="roster-player"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{player.name}</span>
                    <span className="text-xs text-slate-600">
                      #{player.index}
                      {isTeamGame && ` · ${teamName(player.gameTeamId)}`}
                    </span>
                    {!player.allowSelfRename && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">
                        Name locked
                      </span>
                    )}
                    {player.isLinked && (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">
                        Saved to account
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RenameDialog
                      label={player.name}
                      currentName={player.name}
                      locked={!player.allowSelfRename}
                      lockLabel="Stop this player renaming themselves"
                      error={renamePlayer.error}
                      pending={renamePlayer.isPending}
                      onSave={({ name, lock }) =>
                        renamePlayer.mutateAsync({
                          gameUserId: player.id,
                          name,
                          allowSelfRename: !lock,
                          expectedNameVersion: player.nameVersion,
                        })
                      }
                    />
                    {isTeamGame && (
                      <select
                        aria-label={`Team for ${player.name}`}
                        className="rounded-md border px-2 py-1 text-sm"
                        value={player.gameTeamId ?? ""}
                        disabled={move.isPending}
                        onChange={(e) =>
                          move.mutate({
                            gameUserId: player.id,
                            targetGameTeamId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">No team</option>
                        {teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {canRecover && !player.isLinked && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={recovery.isPending}
                        onClick={() =>
                          recovery.mutate({ gameUserId: player.id })
                        }
                      >
                        Recovery link
                      </Button>
                    )}
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Remove ${player.name}`}
                        >
                          Remove
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Remove {player.name}?</DialogTitle>
                          <DialogDescription>
                            They are signed out of this game at once and
                            can&apos;t come back as this player. A buzz they
                            already won and their team&apos;s points stay.
                            Closing joining stops them joining again as someone
                            new.
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <DialogClose asChild>
                            <Button variant="secondary">Cancel</Button>
                          </DialogClose>
                          <DialogClose asChild>
                            <Button
                              variant="destructive"
                              onClick={() =>
                                remove.mutate({ gameUserId: player.id })
                              }
                            >
                              Remove player
                            </Button>
                          </DialogClose>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </li>
              ))}
              {players.length === 0 && (
                <li className="ml-0 py-2 text-slate-600">
                  {query ? "No players match." : "No players have joined yet."}
                </li>
              )}
            </ul>
            {!!roster.data?.removedCount && (
              <p className="text-sm text-slate-600">
                {roster.data.removedCount} removed{" "}
                {roster.data.removedCount === 1 ? "player" : "players"} not
                shown.
              </p>
            )}
          </div>
        }
      />
    </div>
  );
}
