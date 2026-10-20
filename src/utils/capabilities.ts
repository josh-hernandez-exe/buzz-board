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
  /** Rename players and teams, and lock or unlock their own renaming. */
  moderateNames: "Rename players and teams, and lock their renaming",
  /** Remove chat messages, mute people, pin, clear and set chat modes. */
  moderateChat: "Moderate chat: remove messages, mute, pin and clear",
  /** Remove a player from the game at once. */
  removePlayers: "Remove a player from the game",
  /** Give a guest who lost their device a one-time link back in. */
  recoverGuests: "Give a guest a one-time link back in",
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
    "moderateNames",
    "moderateChat",
    "removePlayers",
    "recoverGuests",
    "manageHelpers",
    "deleteGame",
    "duplicateGame",
  ],
  cohost: [
    "runGame",
    "moveRoster",
    "moderateNames",
    "moderateChat",
    "removePlayers",
    "recoverGuests",
    "manageHelpers",
    "duplicateGame",
  ],
  moderator: ["moveRoster", "moderateNames", "moderateChat", "removePlayers"],
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
    "Can moderate chat, rename players and teams, lock renaming, move players between teams and remove players. Cannot run the buzzer, change scores or invite helpers.",
};

export const INVITE_LIFETIME_HOURS = 24;
export const RECOVERY_LINK_LIFETIME_MINUTES = 15;
