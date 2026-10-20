import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Preview = { gameName: string; nickname: string; teamName: string | null };

const mutate = vi.fn();
const reset = vi.fn();
const push = vi.fn();
let joinError: { message: string } | null = null;
let preview: Preview | null = null;
let tokenStorage: Record<string, string> = {};
let previewInput: unknown;
const resumeLinked = vi.fn();
let linked: {
  gameUserId: string;
  nickname: string;
  gameName: string;
  teamName: string | null;
}[] = [];

vi.mock("@/trpc/react", () => ({
  api: {
    public: {
      joinGame: {
        useMutation: () => ({
          mutate,
          reset,
          isPending: false,
          error: joinError,
        }),
      },
      linkedPlayers: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => ({
          data: options.enabled ? linked : undefined,
        }),
      },
      resumeLinked: {
        useMutation: () => ({
          mutate: resumeLinked,
          isPending: false,
          error: null,
        }),
      },
      resumePreview: {
        useQuery: (input: unknown, options: { enabled: boolean }) => {
          previewInput = options.enabled ? input : undefined;
          return { data: options.enabled ? preview : undefined };
        },
      },
    },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/_hooks/gameTokenData", () => ({
  useGameTokenData: () => [{ tokenStorage }, vi.fn(), vi.fn()],
}));

const { JoinGameComponent } = await import("./index");

describe("JoinGameComponent", () => {
  beforeEach(() => {
    mutate.mockReset();
    reset.mockReset();
    joinError = null;
    preview = null;
    tokenStorage = {};
    previewInput = undefined;
    linked = [];
    resumeLinked.mockReset();
  });

  it("pre-fills the code from a link but never joins automatically", () => {
    render(<JoinGameComponent code="abc123" />);

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Join game" })).toBeVisible();
  });

  it("joins with the code and chosen nickname", async () => {
    render(<JoinGameComponent code="ABC123" />);

    await userEvent.type(screen.getByLabelText("Nickname"), "  Ada ");
    await userEvent.click(screen.getByRole("button", { name: "Join game" }));

    expect(mutate).toHaveBeenCalledWith({
      gameCode: "ABC123",
      nickname: "Ada",
    });
  });

  it("asks for a nickname before joining", async () => {
    render(<JoinGameComponent code="ABC123" />);

    await userEvent.click(screen.getByRole("button", { name: "Join game" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a nickname.");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("asks for the complete code before joining", async () => {
    render(<JoinGameComponent code="ABC" />);

    await userEvent.type(screen.getByLabelText("Nickname"), "Ada");
    await userEvent.click(screen.getByRole("button", { name: "Join game" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the 6-character game code.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("explains an invalid nickname before sending it", async () => {
    render(<JoinGameComponent code="ABC123" />);

    await userEvent.type(screen.getByLabelText("Nickname"), "a".repeat(41));
    await userEvent.click(screen.getByRole("button", { name: "Join game" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nickname can be at most 40 characters.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows a server error and does not retry by itself", () => {
    joinError = { message: "Joining is closed for this game." };

    render(<JoinGameComponent code="ABC123" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Joining is closed for this game.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("offers to resume a stored player, then joins with that credential", async () => {
    tokenStorage = { ABC123: "stored-token" };
    preview = { gameName: "Quiz", nickname: "Ada", teamName: "Owls" };

    render(<JoinGameComponent code="ABC123" />);

    expect(previewInput).toEqual({ gameCode: "ABC123", token: "stored-token" });
    expect(screen.getByText(/You played as/)).toHaveTextContent(
      "You played as Ada on Owls.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Resume as Ada" }),
    );
    expect(mutate).toHaveBeenCalledWith({
      gameCode: "ABC123",
      token: "stored-token",
    });
  });

  it("lets a person on a shared device join as someone new", async () => {
    tokenStorage = { ABC123: "stored-token" };
    preview = { gameName: "Quiz", nickname: "Ada", teamName: null };
    render(<JoinGameComponent code="ABC123" />);

    await userEvent.click(
      screen.getByRole("button", { name: "Join as someone new" }),
    );
    await userEvent.type(screen.getByLabelText("Nickname"), "Bo");
    await userEvent.click(screen.getByRole("button", { name: "Join game" }));

    expect(mutate).toHaveBeenCalledWith({ gameCode: "ABC123", nickname: "Bo" });
  });

  it("offers a signed-in player their saved player on a new device", async () => {
    linked = [
      { gameUserId: "u1", nickname: "Ada", gameName: "Quiz", teamName: "Owls" },
    ];

    render(<JoinGameComponent code="ABC123" signedIn />);

    await userEvent.click(
      screen.getByRole("button", { name: "Resume as Ada" }),
    );
    expect(resumeLinked).toHaveBeenCalledWith({
      gameCode: "ABC123",
      gameUserId: "u1",
    });
  });

  it("does not look up saved players when signed out", () => {
    linked = [
      { gameUserId: "u1", nickname: "Ada", gameName: "Quiz", teamName: null },
    ];

    render(<JoinGameComponent code="ABC123" />);

    expect(screen.queryByRole("button", { name: "Resume as Ada" })).toBeNull();
  });
});
