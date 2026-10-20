import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutations = {
  addScore: vi.fn(),
  setScore: vi.fn(),
  undoScore: vi.fn(),
  redoScore: vi.fn(),
};

vi.mock("@/trpc/react", () => ({
  api: {
    gameAdmin: Object.fromEntries(
      Object.entries(mutations).map(([name, mutate]) => [
        name,
        { useMutation: () => ({ mutate }) },
      ]),
    ),
  },
}));

const { GameAdminScoreboardAdvancedControl } = await import("./index");

const teams = [
  { id: "t1", name: "Team 1", index: 1, buzzerState: "available", score: 5 },
  { id: "t2", name: "Team 2", index: 2, buzzerState: "selected", score: 0 },
] as const;

async function setup(score: string) {
  render(<GameAdminScoreboardAdvancedControl gameTeams={[...teams]} />);
  const [firstRow] = screen.getAllByRole("checkbox", { name: "Select row" });
  await userEvent.click(firstRow!);
  const input = screen.getByPlaceholderText("Enter Score");
  await userEvent.clear(input);
  await userEvent.type(input, score);
}

describe("GameAdminScoreboardAdvancedControl", () => {
  beforeEach(() => {
    Object.values(mutations).forEach((m) => m.mockReset());
  });

  it("adds, subtracts and sets the entered value for selected teams", async () => {
    await setup("10");

    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.click(screen.getByRole("button", { name: "Subtract" }));
    await userEvent.click(screen.getByRole("button", { name: "Set" }));

    expect(mutations.addScore).toHaveBeenNthCalledWith(1, { t1: 10 });
    expect(mutations.addScore).toHaveBeenNthCalledWith(2, { t1: -10 });
    expect(mutations.setScore).toHaveBeenCalledWith({ t1: 10 });
  });

  it("disables score buttons until a team is selected", () => {
    render(<GameAdminScoreboardAdvancedControl gameTeams={[...teams]} />);

    expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();
  });

  it.fails("KNOWN DEFECT: allows setting a selected team to zero", async () => {
    await setup("0");

    // `isScoreReady` is `numAffectedTeams > 0 && score`, so 0 is "not ready".
    expect(screen.getByRole("button", { name: "Set" })).toBeEnabled();
  });
});
