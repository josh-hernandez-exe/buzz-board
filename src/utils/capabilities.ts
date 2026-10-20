/**
 * Who may do what in a game. This fixed table is the only source of staff
 * authority: the server checks it on every request, and the UI and Help
 * describe it from here. There is no custom permission builder.
 *
 * The owner is always the game's creator. Co-host is stored as the `admin`
 * staff role. A participant (player) is not staff.
 */
export const STAFF_ROLES = ["owner", "cohost", "moderator"] as const;
export type StaffRoleName = (typeof STAFF_ROLES)[number];

export const ROLE_LABEL: Record<StaffRoleName, string> = {
  owner: "Owner",
  cohost: "Co-host",
  moderator: "Moderator",
};

export const CAPABILITIES = {
  /** Buzzer, scores, teams, game settings and lifecycle. */
  runGame:
    "Run the buzzer and scores, manage teams, settings and the game's status",
  /** Move a player between existing teams. */
  moveRoster: "Move players between teams",
  /** Invite, re-role or remove co-hosts and moderators (never the owner). */
  manageHelpers: "Invite helpers and change or remove their roles",
  /** Permanently delete the game. */
  deleteGame: "Delete the game permanently",
  /** Make a copy of the game's setup. */
  duplicateGame: "Duplicate the game",
} as const;
export type Capability = keyof typeof CAPABILITIES;

const GRANTS: Record<StaffRoleName, readonly Capability[]> = {
  owner: [
    "runGame",
    "moveRoster",
    "manageHelpers",
    "deleteGame",
    "duplicateGame",
  ],
  cohost: ["runGame", "moveRoster", "manageHelpers", "duplicateGame"],
  moderator: ["moveRoster"],
};

export function can(role: StaffRoleName | null, capability: Capability) {
  return role !== null && GRANTS[role].includes(capability);
}

export function capabilitiesOf(role: StaffRoleName): Capability[] {
  return [...GRANTS[role]];
}

/** Roles that an invitation can grant. Ownership is never granted. */
export const INVITABLE_ROLES = ["cohost", "moderator"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** Higher rank wins: an invitation never lowers an existing role. */
export const ROLE_RANK: Record<StaffRoleName, number> = {
  moderator: 1,
  cohost: 2,
  owner: 3,
};

export const ROLE_SUMMARY: Record<InvitableRole, string> = {
  cohost:
    "Can run the event like the owner: buzzer, scores, teams, settings and helpers. Cannot delete the game or change the owner.",
  moderator:
    "Can move players between teams and help keep things friendly. Cannot run the buzzer, change scores or invite helpers.",
};

export const INVITE_LIFETIME_HOURS = 24;
