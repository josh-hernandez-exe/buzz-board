/**
 * Invented sample content: a holiday trivia grid. Facts only, written for
 * this app, so hosts can see how a grid works and edit from there.
 */
import type { Bank, Column, Question } from "./content";

type Clue = [prompt: string, answer: string, accepted?: string[]];

const CATEGORIES: [string, Clue[]][] = [
  [
    "Winter Science",
    [
      ["How many sides does a typical snowflake have?", "Six", ["6"]],
      [
        "At what temperature in Celsius does pure water freeze at sea level?",
        "0 °C",
        ["zero", "0"],
      ],
      [
        "What is the shortest day of the year in the Northern Hemisphere called?",
        "The winter solstice",
        ["solstice"],
      ],
      [
        "What lights in the far northern sky are caused by particles from the Sun?",
        "The aurora borealis",
        ["northern lights", "aurora"],
      ],
      [
        "What is it called when snow turns straight into water vapour without melting?",
        "Sublimation",
      ],
    ],
  ],
  [
    "Holiday Food",
    [
      [
        "Which spiced cookies are often cut into the shape of little people?",
        "Gingerbread",
        ["gingerbread men"],
      ],
      [
        "Which red-and-white striped sweet is shaped like a shepherd's crook?",
        "A candy cane",
        ["candy cane"],
      ],
      [
        "In the UK, what is traditionally hidden inside a Christmas pudding for luck?",
        "A coin",
        ["sixpence", "silver coin"],
      ],
      [
        "Latkes, eaten at Hanukkah, are mostly made from which vegetable?",
        "Potato",
        ["potatoes"],
      ],
      [
        "Panettone, a sweet Christmas bread, comes from which country?",
        "Italy",
      ],
    ],
  ],
  [
    "Around the World",
    [
      ["How many nights is Hanukkah celebrated?", "Eight", ["8"]],
      [
        "Kwanzaa celebrates how many principles, one for each day?",
        "Seven",
        ["7"],
      ],
      [
        "In which country did decorating a Christmas tree first become popular?",
        "Germany",
      ],
      [
        "In Japan, which fast-food meal has become a popular Christmas tradition?",
        "Fried chicken",
        ["KFC"],
      ],
      [
        "What is the Swedish festival of light held on 13 December called?",
        "St Lucia's Day",
        ["Lucia", "Saint Lucy's Day"],
      ],
    ],
  ],
  [
    "Winter Words",
    [
      [
        "What is a dome-shaped house built from blocks of snow called?",
        "An igloo",
        ["igloo"],
      ],
      [
        "What are the hanging spikes of ice that form on roofs called?",
        "Icicles",
        ["icicle"],
      ],
      [
        "What word means to spend the winter in a deep sleep, as bears do?",
        "Hibernate",
        ["hibernation"],
      ],
      [
        "Which evergreen plant with white berries do people traditionally kiss under?",
        "Mistletoe",
      ],
      [
        "Which old midwinter festival gives its name to a log-shaped cake?",
        "Yule",
        ["yuletide"],
      ],
    ],
  ],
  [
    "Holiday Numbers",
    [
      [
        "How many days are in the song title 'The Twelve Days of Christmas'?",
        "Twelve",
        ["12"],
      ],
      [
        "How many reindeer pull Santa's sleigh in the classic poem, not counting Rudolph?",
        "Eight",
        ["8"],
      ],
      [
        "How many candle holders does a Hanukkah menorah have, including the helper candle?",
        "Nine",
        ["9"],
      ],
      [
        "In what year did the first commercial Christmas card go on sale in London?",
        "1843",
      ],
      [
        "How many gifts are given in total across all twelve days in 'The Twelve Days of Christmas'?",
        "364",
      ],
    ],
  ],
];

export function sampleBank(): Bank {
  const questions: Question[] = [];
  const columns: Column[] = CATEGORIES.map(([title, clues], ci) => ({
    id: `cat${ci + 1}`,
    title,
    cells: clues.map(([prompt, answer, accepted], ri) => {
      const id = `cat${ci + 1}-${ri + 1}`;
      questions.push({
        id,
        prompt: { text: prompt },
        answer: {
          text: answer,
          ...(accepted ? { acceptedAnswers: accepted } : {}),
        },
      });
      return {
        label: String((ri + 1) * 100),
        points: (ri + 1) * 100,
        questionId: id,
      };
    }),
  }));
  return {
    schemaVersion: 1,
    kind: "questionBank",
    title: "Holiday trivia",
    questions,
    modes: { categoryGrid: { columns } },
  };
}
