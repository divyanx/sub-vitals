/**
 * StubPipelineCard stories — Storybook 10 / CSF 3
 *
 * The locked "coming soon" card for RedLattice Studio custom pipelines.
 */

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { StubPipelineCard } from '../client/views/Dashboard.tsx';

const meta: Meta<typeof StubPipelineCard> = {
  title: 'Pipelines/StubPipelineCard',
  component: StubPipelineCard,
  decorators: [
    (Story) => (
      <div className="max-w-sm p-6 bg-neutral-900 min-h-screen">
        <Story />
      </div>
    ),
  ],
  args: {
    onOpen: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof StubPipelineCard>;

export const Default: Story = {};

export const InGrid: Story = {
  name: 'Inside pipeline grid',
  decorators: [
    (Story) => (
      <div className="grid grid-cols-3 gap-4 p-6 bg-neutral-900 min-h-screen">
        {/* Simulate neighbour cards */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-xs text-neutral-400">
          Contact Drivers (active)
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-xs text-neutral-400">
          Sentiment scoring (active)
        </div>
        <Story />
      </div>
    ),
  ],
};
