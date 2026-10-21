import { type Content, defaultRules } from "./content";

const answers = (rows: [string, number, string[]?][]) =>
  rows.map(([text, points, aliases], i) => ({
    id: `a${i + 1}`,
    text,
    aliases: aliases ?? [],
    points,
  }));

/**
 * Invented boards to try the mode with (counts are made up, not survey
 * results). Hosts load it from the editor and replace it with their own.
 */
export function sampleContent(teamCount: number): Content {
  return {
    rules: defaultRules(teamCount),
    boards: [
      {
        id: "practice",
        role: "practice",
        prompt: "Things you find in a kitchen drawer",
        answers: answers([
          ["Spoons", 31, ["cutlery"]],
          ["Batteries", 24],
          ["Rubber bands", 18],
          ["Takeout menus", 12],
          ["Scissors", 9],
        ]),
      },
      {
        id: "tree",
        role: "main",
        prompt: "Things people hang on a holiday tree",
        answers: answers([
          ["Lights", 35, ["fairy lights"]],
          ["Ornaments", 27, ["baubles"]],
          ["Tinsel", 14],
          ["Star", 10, ["angel"]],
          ["Candy canes", 7],
          ["Popcorn garland", 4],
        ]),
      },
      {
        id: "dinner",
        role: "main",
        prompt: "Foods at a holiday dinner",
        answers: answers([
          ["Turkey", 38, ["roast turkey"]],
          ["Mashed potatoes", 22, ["potatoes"]],
          ["Stuffing", 14, ["dressing"]],
          ["Pie", 11, ["pumpkin pie"]],
          ["Gravy", 8],
          ["Bread rolls", 4, ["rolls"]],
        ]),
      },
      {
        id: "regift",
        role: "main",
        prompt: "Gifts people secretly regift",
        multiplier: 2,
        answers: answers([
          ["Candles", 29],
          ["Socks", 21],
          ["Gift cards", 16],
          ["Fruitcake", 12],
          ["Mugs", 9],
          ["Bath sets", 6, ["soap"]],
        ]),
      },
      {
        id: "spare",
        role: "spare",
        prompt: "Things you wear in the snow",
        answers: answers([
          ["Gloves", 33, ["mittens"]],
          ["Hat", 26, ["beanie"]],
          ["Scarf", 19],
          ["Boots", 13],
        ]),
      },
    ],
  };
}
