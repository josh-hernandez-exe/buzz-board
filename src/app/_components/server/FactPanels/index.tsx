import { type HelpFactPanel } from "@/help/manifest";
import {
  CAPABILITIES,
  INVITE_LIFETIME_HOURS,
  RECOVERY_LINK_LIFETIME_MINUTES,
  ROLE_LABEL,
  STAFF_ROLES,
  capabilitiesOf,
} from "@/utils/capabilities";
import {
  ASSIGNMENT_DESCRIPTION,
  ASSIGNMENT_LABEL,
  GAME_LIMITS,
  NAME_LIMITS,
  REOPEN_WINDOW_HOURS,
  SCORE_LIMITS,
  STATUS_LABEL,
  type TeamAssignmentValue,
} from "@/utils/gameRules";

const n = (value: number) => value.toLocaleString("en-US");

type Fact = { label: string; value: string };

/** Facts come from the same constants the server enforces. */
export const FACTS: Record<HelpFactPanel, { title: string; facts: Fact[] }> = {
  gameLimits: {
    title: "Game rules",
    facts: [
      {
        label: "Teams in a new team game",
        value: `${GAME_LIMITS.minTeams} to ${GAME_LIMITS.maxTeams} (default ${GAME_LIMITS.defaultTeams})`,
      },
      {
        label: "Join code",
        value: `${GAME_LIMITS.joinCodeLength} letters and numbers`,
      },
      {
        label: "Reopen a finished game",
        value: `Within ${REOPEN_WINDOW_HOURS} hours of finishing`,
      },
      {
        label: "Game name",
        value: `Up to ${NAME_LIMITS.maxGameName} characters`,
      },
    ],
  },
  nameLimits: {
    title: "Names",
    facts: [
      {
        label: "Player and team names",
        value: `Up to ${NAME_LIMITS.maxDisplayName} characters, including emoji`,
      },
      {
        label: "Not allowed",
        value: "Line breaks and hidden control characters",
      },
    ],
  },
  teamAssignment: {
    title: "Team assignment settings",
    facts: (Object.keys(ASSIGNMENT_LABEL) as TeamAssignmentValue[]).map(
      (key) => ({
        label: ASSIGNMENT_LABEL[key],
        value: ASSIGNMENT_DESCRIPTION[key],
      }),
    ),
  },
  gameStatus: {
    title: "Game status",
    facts: [
      {
        label: STATUS_LABEL.lobby,
        value: "Players can join. Starting the buzzer goes live.",
      },
      { label: STATUS_LABEL.running, value: "The game is being played." },
      {
        label: STATUS_LABEL.finished,
        value: "Closed to joining and play. Scores stay visible.",
      },
    ],
  },
  staffRoles: {
    title: "What each role can do",
    facts: [
      ...STAFF_ROLES.map((role) => ({
        label: ROLE_LABEL[role],
        value: capabilitiesOf(role)
          .map((capability) => CAPABILITIES[capability])
          .join("; "),
      })),
      {
        label: "Invitation links",
        value: `Work once and expire after ${INVITE_LIFETIME_HOURS} hours`,
      },
    ],
  },
  recoveryLinks: {
    title: "Recovery links",
    facts: [
      {
        label: "Who can create one",
        value: "Owners and co-hosts, for guests not saved to an account",
      },
      {
        label: "How long it works",
        value: `Once, for ${RECOVERY_LINK_LIFETIME_MINUTES} minutes`,
      },
    ],
  },
  scoreLimits: {
    title: "Scores",
    facts: [
      {
        label: "Each add, subtract or set",
        value: `Whole numbers up to ${n(SCORE_LIMITS.maxAbsDelta)} at a time (set up to ${n(SCORE_LIMITS.maxAbsScore)})`,
      },
      {
        label: "Any team's score",
        value: `Between −${n(SCORE_LIMITS.maxAbsScore)} and ${n(SCORE_LIMITS.maxAbsScore)}`,
      },
    ],
  },
};

export function FactPanels({ panels }: { panels: readonly HelpFactPanel[] }) {
  if (panels.length === 0) return null;
  return (
    <aside
      aria-labelledby="facts-heading"
      className="rounded-xl border bg-slate-50 p-4 text-sm"
    >
      <h2 id="facts-heading" className="mb-2 font-bold">
        Rules at a glance
      </h2>
      {panels.map((panel) => (
        <section key={panel} className="mt-3" data-fact-panel={panel}>
          <h3 className="font-semibold">{FACTS[panel].title}</h3>
          <dl className="mt-1">
            {FACTS[panel].facts.map((fact) => (
              <div key={fact.label} className="py-1">
                <dt className="font-medium">{fact.label}</dt>
                <dd className="text-slate-700">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </aside>
  );
}
