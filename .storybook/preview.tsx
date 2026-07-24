import type { Preview } from "@storybook/react-vite";

import "../src/styles.css";

const preview: Preview = {
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-4 text-foreground sm:p-6">
        <div className="mx-auto w-full max-w-5xl">
          <Story />
        </div>
      </div>
    ),
  ],
  parameters: {
    a11y: {
      test: "todo",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "fullscreen",
  },
  tags: ["autodocs"],
};

export default preview;
