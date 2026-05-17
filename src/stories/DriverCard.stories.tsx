/**
 * DriverCard stories — Storybook 10 / CSF 3
 *
 * Covers the visual taxonomy editor card component exported from Settings.tsx.
 * The card lets mods edit a single contact driver: id, label, color, description,
 * and keywords (chip input). It is drag-sortable via @dnd-kit.
 */

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { DriverCard } from '../client/views/Settings.tsx';

// Minimal wrapper so the card's useSortable hook has the required context
function SortableWrapper({ children }: { children: React.ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}>
      <SortableContext items={[1]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

const meta: Meta<typeof DriverCard> = {
  title: 'Taxonomy/DriverCard',
  component: DriverCard,
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6 bg-neutral-900 min-h-screen">
        <SortableWrapper>
          <Story />
        </SortableWrapper>
      </div>
    ),
  ],
  args: {
    onUpdate: fn(),
    onDelete: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof DriverCard>;

export const BugDriver: Story = {
  args: {
    row: {
      _uid: 1,
      id: 'bug',
      label: 'Bug / Issue Report',
      color: '#f87171',
      description: 'Product defects, crashes, errors the user did not expect.',
      keywords: ['crash', 'broken', 'error', 'bug', 'not working'],
    },
  },
};

export const FeatureRequest: Story = {
  args: {
    row: {
      _uid: 1,
      id: 'feature',
      label: 'Feature Request',
      color: '#60a5fa',
      description: 'User asking for functionality that does not exist yet.',
      keywords: ['request', 'wish', 'add', 'would love'],
    },
  },
};

export const EmptyDriver: Story = {
  name: 'Empty (new driver)',
  args: {
    row: {
      _uid: 1,
      id: '',
      label: '',
      color: '#94a3b8',
      description: '',
      keywords: [],
    },
  },
};

export const ManyKeywords: Story = {
  name: 'With many keywords',
  args: {
    row: {
      _uid: 1,
      id: 'billing',
      label: 'Billing / Account',
      color: '#a78bfa',
      description: 'Questions or complaints about cost and subscription.',
      keywords: ['charge', 'refund', 'invoice', 'subscription', 'payment', 'price', 'cost', 'fee'],
    },
  },
};
