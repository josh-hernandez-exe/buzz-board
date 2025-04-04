import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { DropDownSelection, type DropdownOption } from ".";

type StoryComponentType = typeof DropDownSelection;

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "DropDownSelection",
  component: DropDownSelection,
  parameters: {
    // Optional parameter to center the component in the Canvas. More info: https://storybook.js.org/docs/configure/story-layout
    layout: "centered",
  },
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
  // More on argTypes: https://storybook.js.org/docs/api/argtypes
  argTypes: {
    title: {
      controlType: "text",
    },
    options: {
      controlType: "object",
    },
  },
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: {
    onChange: fn(),
    title: "Title",
    options: [...Array(5)].map((_, idx) => {
      return {
        id: `${idx}`,
        name: `Option ${idx}`,
        data: idx,
      } as DropdownOption<number>;
    }),
  },
} satisfies Meta<StoryComponentType>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {},
};
