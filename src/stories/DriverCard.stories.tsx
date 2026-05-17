/**
 * DriverCard stories — Storybook 10 / CSF 3
 *
 * NOTE (Sprint 11 IA refactor): The DriverCard component was replaced by the
 * hierarchical DriverTreeRow inside DriversConfig.tsx. DriverTreeRow is an
 * internal component — stories for the new tree editor will be added in a
 * follow-up task (post-hackathon).
 *
 * This file is kept as a placeholder so Storybook's file-scan doesn't error.
 */

import type { Meta, StoryObj } from '@storybook/react';

function PlaceholderCard() {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-xs text-neutral-400">
      DriverCard was removed in Sprint 11. See DriversConfig.tsx for the new hierarchical tree
      editor.
    </div>
  );
}

const meta: Meta<typeof PlaceholderCard> = {
  title: 'Taxonomy/DriverCard',
  component: PlaceholderCard,
};

export default meta;
type Story = StoryObj<typeof PlaceholderCard>;

export const Placeholder: Story = {};
