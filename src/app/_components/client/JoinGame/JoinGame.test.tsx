import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.fn();
let mutationOptions: { onError?: (err: { message: string }) => void } = {};

vi.mock("@/trpc/react", () => ({
  api: {
    public: {
      joinGame: {
        useMutation: (options: typeof mutationOptions) => {
          mutationOptions = options;
          return { mutate };
        },
      },
    },
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/app/_hooks/gameTokenData", () => ({
  useGameTokenData: () => [{ tokenStorage: {} }, vi.fn()],
}));

const { JoinGameComponent } = await import("./index");

describe("JoinGameComponent", () => {
  beforeEach(() => {
    mutate.mockReset();
    mutationOptions = {};
  });

  it("auto-joins once from a code in the link", () => {
    render(<JoinGameComponent code="ABC123" />);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      gameCode: "ABC123",
      token: undefined,
    });
  });

  it("does not retry a failed auto-join in a loop", async () => {
    const { rerender } = render(<JoinGameComponent code="BAD999" />);

    mutationOptions.onError?.({ message: "Game not found" });
    rerender(<JoinGameComponent code="BAD999" />);

    expect(await screen.findByText("Game not found")).toBeInTheDocument();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("lets the user retry with the Join button", async () => {
    render(<JoinGameComponent code="BAD999" />);
    mutationOptions.onError?.({ message: "Game not found" });

    await userEvent.click(screen.getByRole("button", { name: "Join Game" }));

    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("requires a code before joining", async () => {
    render(<JoinGameComponent />);

    await userEvent.click(screen.getByRole("button", { name: "Join Game" }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Game code is required")).toBeInTheDocument();
  });
});
