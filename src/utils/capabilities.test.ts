import { describe, expect, it } from "vitest";

import { can, capabilitiesOf, CAPABILITIES, ROLE_RANK } from "./capabilities";

describe("capabilities", () => {
  it("gives the owner everything", () => {
    expect(capabilitiesOf("owner").sort()).toEqual(
      Object.keys(CAPABILITIES).sort(),
    );
  });

  it("lets co-hosts run the game and manage helpers but not delete it", () => {
    expect(can("cohost", "runGame")).toBe(true);
    expect(can("cohost", "manageHelpers")).toBe(true);
    expect(can("cohost", "deleteGame")).toBe(false);
  });

  it("keeps moderators away from gameplay, helpers and deletion", () => {
    expect(capabilitiesOf("moderator")).toEqual([
      "moveRoster",
      "moderateNames",
      "removePlayers",
    ]);
    for (const capability of [
      "runGame",
      "recoverGuests",
      "manageHelpers",
      "deleteGame",
      "duplicateGame",
    ] as const) {
      expect(can("moderator", capability)).toBe(false);
    }
  });

  it("grants nothing to non-staff", () => {
    for (const capability of Object.keys(CAPABILITIES)) {
      expect(can(null, capability as keyof typeof CAPABILITIES)).toBe(false);
    }
  });

  it("ranks owner over co-host over moderator", () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.cohost);
    expect(ROLE_RANK.cohost).toBeGreaterThan(ROLE_RANK.moderator);
  });
});
