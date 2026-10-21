/**
 * Final places from scores, with ties sharing a place ("1, 1, 3"), as on
 * a sports table. Pure, so it's tested without a game.
 */
export type Standing = {
  id: string;
  name: string;
  score: number;
  place: number;
  tied: boolean;
};

export function standings(
  teams: { id: string; name: string; score: number }[],
): Standing[] {
  const sorted = [...teams].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
  return sorted.map((t) => {
    const place = sorted.findIndex((x) => x.score === t.score) + 1;
    const tied = sorted.filter((x) => x.score === t.score).length > 1;
    return { ...t, place, tied };
  });
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "Owls win!", "Owls and Foxes tie for first!", or null with no teams. */
export function winnerLine(table: Standing[]): string | null {
  const top = table.filter((t) => t.place === 1);
  if (top.length === 0) return null;
  if (top.length === 1) return `${top[0]!.name} wins!`;
  const names = top.map((t) => t.name);
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} tie for first!`;
}
