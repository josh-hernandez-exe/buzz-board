import type { Meta, StoryObj } from "@storybook/react";

import { GenericCard } from ".";

type StoryParameterProps = {
  title: string;
  description?: string;
  /** parameters are overriden to string. */
  content?: string;
  /** parameters are overriden to string. */
  footer?: string;
};

const WrappedGenericCard = ({
  title,
  description,
  content,
  footer,
  ...props
}: StoryParameterProps) => {
  return (
    <GenericCard
      title={title}
      description={description}
      content={<p>{content}</p>}
      footer={<p>{footer}</p>}
      {...props}
    />
  );
};

type StoryComponentType = typeof WrappedGenericCard;

// More on how to set up stories at: https://storybook.js.org/docs/writing-stories#default-export
const meta = {
  title: "GenericCard",
  component: WrappedGenericCard,
  parameters: {
    // Optional parameter to center the component in the Canvas. More info: https://storybook.js.org/docs/configure/story-layout
    layout: "centered",
    docs: {
      description: {
        component: [
          "Generic card component.",
          "The `content` and `footer` have been overriden to strings for story book testing.",
        ].join(""),
      },
    },
  },
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ["autodocs"],
  // More on argTypes: https://storybook.js.org/docs/api/argtypes
  argTypes: {
    title: {
      controlType: "text",
    },
    description: {
      controlType: "text",
    },
    content: {
      controlType: "text",
    },
    footer: {
      controlType: "text",
    },
  },
  args: {
    title: "Title",
    description: "Description",
    content: "Content",
    footer: "Footer",
  },
} satisfies Meta<StoryComponentType>;

export default meta;

type Story = StoryObj<typeof meta>;

// More on writing stories with args: https://storybook.js.org/docs/writing-stories/args
export const Primary: Story = {
  args: {},
};
