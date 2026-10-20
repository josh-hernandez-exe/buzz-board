"use client";

import { useState } from "react";

import { GenericCard } from "@/app/_components/GenericCard";
import { ErrorNotice } from "@/app/_components/client/ErrorNotice";
import { Button } from "@/app/_components/ui/button";
import { env } from "@/env";
import { api } from "@/trpc/react";
import { helpHref } from "@/help/manifest";
import {
  INVITABLE_ROLES,
  INVITE_LIFETIME_HOURS,
  ROLE_LABEL,
  ROLE_SUMMARY,
  can,
  type InvitableRole,
} from "@/utils/capabilities";

/**
 * Who helps run the game, and inviting more helpers. Owners and co-hosts can
 * invite, re-role and remove helpers; the owner can never be changed.
 */
export function HelpersPanel() {
  const utils = api.useUtils();
  const staff = api.gameAdmin.staff.list.useQuery();
  const refresh = () => utils.gameAdmin.staff.list.invalidate();
  const createInvite = api.gameAdmin.staff.createInvite.useMutation({
    onSuccess: refresh,
  });
  const revoke = api.gameAdmin.staff.revokeInvite.useMutation({
    onSuccess: refresh,
  });
  const setRole = api.gameAdmin.staff.setRole.useMutation({
    onSuccess: refresh,
  });
  const remove = api.gameAdmin.staff.remove.useMutation({ onSuccess: refresh });
  const [inviteRole, setInviteRole] = useState<InvitableRole>("cohost");
  const [copied, setCopied] = useState(false);

  if (!staff.data) {
    return (
      <GenericCard
        title="Helpers"
        content={
          staff.error ? <ErrorNotice error={staff.error} /> : <p>Loading…</p>
        }
      />
    );
  }
  const { owner, helpers, pendingInvites, myRole, myUserId } = staff.data;
  const canManage = can(myRole, "manageHelpers");
  const inviteUrl = createInvite.data
    ? `${env.NEXT_PUBLIC_QRCODE_BASE_URL}${createInvite.data.path}`
    : undefined;

  return (
    <GenericCard
      title="Helpers"
      description="Co-hosts run the event with you. Moderators help with players."
      footer={
        <a
          href={helpHref("helpers-and-roles")}
          target="_blank"
          rel="noopener"
          className="text-sm underline"
        >
          About helpers and roles
        </a>
      }
      content={
        <div className="flex flex-col gap-6">
          <section aria-labelledby="staff-heading">
            <h3 id="staff-heading" className="mb-2 font-semibold">
              People helping run this game
            </h3>
            <ul className="flex list-none flex-col gap-2">
              <li
                className="ml-0 flex flex-wrap items-center justify-between gap-2"
                data-testid="staff-owner"
              >
                <span>
                  {owner.name}
                  {owner.userId === myUserId && " (you)"}
                </span>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">
                  {ROLE_LABEL.owner}
                </span>
              </li>
              {helpers.map((helper) => (
                <li
                  key={helper.gameAdminId}
                  className="ml-0 flex flex-wrap items-center justify-between gap-2"
                  data-testid="staff-helper"
                >
                  <span>
                    {helper.name}
                    {helper.userId === myUserId && " (you)"}
                  </span>
                  {canManage ? (
                    <span className="flex items-center gap-2">
                      <select
                        aria-label={`Role for ${helper.name}`}
                        className="rounded-md border px-2 py-1 text-sm"
                        value={helper.role}
                        disabled={setRole.isPending}
                        onChange={(e) =>
                          setRole.mutate({
                            gameAdminId: helper.gameAdminId,
                            role: e.target.value as InvitableRole,
                          })
                        }
                      >
                        {INVITABLE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() =>
                          remove.mutate({ gameAdminId: helper.gameAdminId })
                        }
                      >
                        Remove
                      </Button>
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">
                      {ROLE_LABEL[helper.role]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <ErrorNotice error={setRole.error ?? remove.error} />
          </section>

          {canManage && (
            <section
              aria-labelledby="invite-heading"
              className="flex flex-col gap-3"
            >
              <h3 id="invite-heading" className="font-semibold">
                Invite a helper
              </h3>
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Role</legend>
                {INVITABLE_ROLES.map((role) => (
                  <label key={role} className="flex gap-2 text-sm">
                    <input
                      type="radio"
                      name="invite-role"
                      aria-label={ROLE_LABEL[role]}
                      checked={inviteRole === role}
                      onChange={() => setInviteRole(role)}
                    />
                    <span>
                      <strong>{ROLE_LABEL[role]}</strong>: {ROLE_SUMMARY[role]}
                    </span>
                  </label>
                ))}
              </fieldset>
              <Button
                className="self-start"
                disabled={createInvite.isPending}
                onClick={() => {
                  setCopied(false);
                  createInvite.mutate({ role: inviteRole });
                }}
              >
                Create invitation link
              </Button>
              {inviteUrl && (
                <div className="flex flex-col gap-2 rounded-md bg-slate-100 p-3 text-sm">
                  <label htmlFor="invite-url" className="font-medium">
                    Send this link privately. It works once and expires in{" "}
                    {INVITE_LIFETIME_HOURS} hours.
                  </label>
                  <input
                    id="invite-url"
                    readOnly
                    value={inviteUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="rounded border px-2 py-1 font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(inviteUrl)
                        .then(() => setCopied(true))
                        .catch(() => setCopied(false))
                    }
                  >
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                </div>
              )}
              <ErrorNotice error={createInvite.error} />
            </section>
          )}

          {canManage && pendingInvites.length > 0 && (
            <section aria-labelledby="pending-heading">
              <h3 id="pending-heading" className="mb-2 font-semibold">
                Unused invitations
              </h3>
              <ul className="flex list-none flex-col gap-2">
                {pendingInvites.map((invite) => (
                  <li
                    key={invite.inviteId}
                    className="ml-0 flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {ROLE_LABEL[invite.role]}, expires{" "}
                      {new Date(invite.expiresAt).toLocaleString()}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() =>
                        revoke.mutate({ inviteId: invite.inviteId })
                      }
                    >
                      Cancel invitation
                    </Button>
                  </li>
                ))}
              </ul>
              <ErrorNotice error={revoke.error} />
            </section>
          )}
        </div>
      }
    />
  );
}
