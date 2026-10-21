import { describe, expect, it } from "vitest";

import { ordinal, standings, winnerLine } from "./standings";

describe("standings", () => {
  it("orders by score with ties sharing a place", () => {
    const table = standings([
      { id: "a", name: "Owls", score: 10 },
      { id: "b", name: "Foxes", score: 30 },
      { id: "c", name: "Bears", score: 10 },
      { id: "d", name: "Deer", score: -5 },
    ]);
    expect(table.map((t) => [t.name, t.place, t.tied])).toEqual([
      ["Foxes", 1, false],
      ["Bears", 2, true],
      ["Owls", 2, true],
      ["Deer", 4, false],
    ]);
    expect(winnerLine(table)).toBe("Foxes wins!");
  });

  it("announces a tie for first", () => {
    const table = standings([
      { id: "a", name: "Owls", score: 5 },
      { id: "b", name: "Foxes", score: 5 },
      { id: "c", name: "Bears", score: 5 },
    ]);
    expect(winnerLine(table)).toBe("Bears, Foxes and Owls tie for first!");
    expect(winnerLine([])).toBeNull();
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
    ]);
  });
});
