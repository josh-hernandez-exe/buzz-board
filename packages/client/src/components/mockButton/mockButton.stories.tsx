import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { MockButton } from ".";

type ExtraArgs = {
  label: string;
};

type StoryComponentType = (
  props: Parameters<typeof MockButton>[0] & ExtraArgs
) => ReturnType<typeof MockButton>;

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "MockButton",
  component: MockButton,
  parameters: {
    // Optional parameter to center the component in the Canvas. More info: https://storybook.js.org/docs/configure/story-layout
    layout: "centered",
  },
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
  // More on argTypes: https://storybook.js.org/docs/api/argtypes
  argTypes: {
    asChild: { control: "boolean" },
    variant: {
      control: "select",
      options: [
        "default",
        "destructive",
        "outline",
        "secondary",
        "ghost",
        "link",
      ],
    },
    size: {
      control: "select",
      options: ["default", "sm", "lg", "icon"],
    },
    label: {
      control: "text",
    },
  },
  // Use `fn` to spy on the onClick arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: {
    asChild: false,
    onClick: fn(),
    label: "Button",
  },
  render: ({ label, ...props }) => <MockButton {...props}>{label}</MockButton>,
} satisfies Meta<StoryComponentType>;

export default meta;
type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {
    // primary: true,
    // label: "Button",
  },
};
