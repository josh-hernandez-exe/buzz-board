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
        {
          useMutation: () => ({
            mutate,
            reset: vi.fn(),
            isPending: false,
            isError: false,
          }),
        },
      ]),
    ),
  },
}));

const { GameAdminScoreboardAdvancedControl } = await import("./index");

const anyString: unknown = expect.any(String);

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
  if (score) await userEvent.type(input, score);
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

    const requestId: unknown = expect.stringMatching(/^[0-9a-f]{32}$/);
    expect(mutations.addScore).toHaveBeenNthCalledWith(1, {
      requestId,
      changes: { t1: 10 },
    });
    expect(mutations.addScore).toHaveBeenNthCalledWith(2, {
      requestId,
      changes: { t1: -10 },
    });
    expect(mutations.setScore).toHaveBeenCalledWith({
      requestId,
      changes: { t1: 10 },
    });
    const ids = [
      ...mutations.addScore.mock.calls,
      ...mutations.setScore.mock.calls,
    ].map(([arg]) => (arg as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(3);
  });

  it("disables score buttons until a team is selected, and says why", () => {
    render(<GameAdminScoreboardAdvancedControl gameTeams={[...teams]} />);

    expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();
    expect(screen.getByText("Select at least one team.")).toBeInTheDocument();
  });

  it("allows setting a selected team to zero", async () => {
    await setup("0");

    await userEvent.click(screen.getByRole("button", { name: "Set" }));

    expect(mutations.setScore).toHaveBeenCalledWith({
      requestId: anyString,
      changes: { t1: 0 },
    });
  });

  it.each(["", "-", "1.5", "abc"])(
    "rejects %j as a score with a reason",
    async (text) => {
      await setup(text);

      expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
      expect(screen.getByText("Enter a whole number.")).toBeInTheDocument();
    },
  );

  it("accepts negative whole numbers", async () => {
    await setup("-4");

    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(mutations.addScore).toHaveBeenCalledWith({
      requestId: anyString,
      changes: { t1: -4 },
    });
  });
});
