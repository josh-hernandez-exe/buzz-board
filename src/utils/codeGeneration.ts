import _ from "lodash";

import { logger } from "@/utils/logger";

export function generateShortCode(
  length: number,
  { characters, maxRepeat }: { characters: string; maxRepeat: number } = {
    characters: ["ABCDEFGHIJKLMNPQRSTUVWXYZ", "123456789"].join(""),
    maxRepeat: 3,
  },
): string {
  const choices = new Map<string, number>(
    Array.from(characters).map((char) => [char, 0]),
  );
  for (let i = 0; i < length; i++) {
    let selected;
    while (selected === undefined) {
      selected = characters.charAt(
        Math.floor(Math.random() * characters.length),
      );

      if (choices.has(selected) && choices.get(selected)! > maxRepeat) {
        selected = undefined;
      }
    }

    choices.set(selected, choices.get(selected)! + 1);
  }

  const selectedChars: string[] = [];

  choices.forEach((count, char) => {
    for (let i = 0; i < count; i++) {
      selectedChars.push(char);
    }
  });

  return _.shuffle(selectedChars).join("");
}
