/**
 * The Help center's single source of truth. Each entry has a Markdown body in
 * `src/help/articles/<id>.md`. Landing pages, FAQ questions, search and
 * in-app links are all generated from this list and those bodies.
 *
 * Add an article only for a feature that has shipped. `tests/unit` checks
 * that IDs, bodies, anchors and every `helpHref` in the app stay in sync.
 */

export const HELP_AUDIENCES = {
  player: "Players",
  host: "Hosts and co-hosts",
} as const;
export type HelpAudience = keyof typeof HELP_AUDIENCES;

/** Fixed panels rendered beside an article from code constants. */
export type HelpFactPanel =
  | "gameLimits"
  | "nameLimits"
  | "teamAssignment"
  | "gameStatus"
  | "scoreLimits"
  | "staffRoles"
  | "recoveryLinks"
  | "chatLimits";

export type HelpArticle = {
  id: string;
  title: string;
  summary: string;
  audiences: readonly HelpAudience[];
  facts: readonly HelpFactPanel[];
};

export const HELP_ARTICLES = [
  {
    id: "join-and-resume",
    title: "Join a game and get back in",
    summary:
      "Join with a code or link and a nickname, no account needed. Resume after a reload, or leave a room on a shared device.",
    audiences: ["player"],
    facts: ["nameLimits"],
  },
  {
    id: "host-quickstart",
    title: "Host a game",
    summary:
      "Create a game, share the code, run the buzzer and scores, then finish, reopen, duplicate or delete it.",
    audiences: ["host"],
    facts: ["gameLimits", "gameStatus"],
  },
  {
    id: "buzzing",
    title: "Buzzing modes and undo",
    summary:
      "First buzz wins or a queue where everyone lines up, marking answers right or wrong, and undoing accidental presses.",
    audiences: ["host", "player"],
    facts: [],
  },
  {
    id: "helpers-and-roles",
    title: "Helpers: co-hosts and moderators",
    summary:
      "Invite co-hosts and moderators with a private link, what each role can do, and changing or removing helpers.",
    audiences: ["host"],
    facts: ["staffRoles"],
  },
  {
    id: "moderation",
    title: "Managing players",
    summary:
      "Rename players and teams and lock their renaming, move or remove players, and help a guest who lost their device get back in.",
    audiences: ["host"],
    facts: ["nameLimits", "recoveryLinks"],
  },
  {
    id: "teams-and-names",
    title: "Teams and names",
    summary:
      "How new players get a team, switching and freezing teams, team captains, changing names, and individual games.",
    audiences: ["player", "host"],
    facts: ["teamAssignment", "nameLimits"],
  },
  {
    id: "scoreboards-and-display",
    title: "Scores and the audience display",
    summary:
      "Show scores to your audience safely, control sound, and add, set, undo or redo scores.",
    audiences: ["host", "player"],
    facts: ["scoreLimits"],
  },
  {
    id: "chat",
    title: "Chat",
    summary:
      "Turn chat on, who can read each channel, why a message won't send, moderating chat, and how long messages are kept.",
    audiences: ["player", "host"],
    facts: ["chatLimits"],
  },
  {
    id: "ranked-answers",
    title: "Ranked Answers (family-feud style)",
    summary:
      "Set up boards of ranked answers, choose from nine rule sets for 2 to 50 teams (or fine-tune every rule), run each board, fix mistakes and go back to the buzzer.",
    audiences: ["host", "player"],
    facts: [],
  },
  {
    id: "category-grid",
    title: "Category Grid (quiz-show grid)",
    summary:
      "Set up a grid of categories and clues, run it with the buzzer, give the next pick, and fix mistakes with undo or void.",
    audiences: ["host", "player"],
    facts: [],
  },
  {
    id: "sequential-quiz",
    title: "Sequential Quiz (pub-quiz rounds)",
    summary:
      "Questions in order, answers typed by each team, marked by the host and revealed together. Set up, answer on a phone, mark and fix mistakes.",
    audiences: ["host", "player"],
    facts: [],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    summary:
      "What each buzzer message means, and what to do when joining, buzzing or saving doesn't work.",
    audiences: ["player", "host"],
    facts: [],
  },
] as const satisfies readonly HelpArticle[];

export type HelpArticleId = (typeof HELP_ARTICLES)[number]["id"];

export function getHelpArticle(id: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.id === id);
}

/** Lowercase, hyphenated heading anchor, matching how headings are rendered. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Link to a Help article, optionally to a heading within it. Help opens in a
 * new tab from inside a game so the game page and any typed input are kept.
 */
export function helpHref(id: HelpArticleId, anchor?: string): string {
  return anchor ? `/help/${id}#${anchor}` : `/help/${id}`;
}
