/**
 * Storybook stories for the PipelineCard component.
 * Pipeline shape mirrors the canonical Pipeline type from `src/shared/types.ts`.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { PipelineCard } from '../client/views/Dashboard.js';

const qc = new QueryClient();

const pipelineMeta: Meta<typeof PipelineCard> = {
  title: 'Pipelines/PipelineCard',
  component: PipelineCard,
  decorators: [
    (Story: React.ComponentType) => (
      <QueryClientProvider client={qc}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  parameters: {
    layout: 'centered',
    backgrounds: { default: 'dark' },
  },
  args: {
    onOpenSettings: () => {},
    onOpenDrawer: () => {},
  },
};

export default pipelineMeta;
type PipelineStory = StoryObj<typeof PipelineCard>;

export const Drivers: PipelineStory = {
  args: {
    pipeline: {
      id: 'intent',
      name: 'Drivers',
      description: 'Classifies each post into a contact-driver category.',
      kind: 'categorical',
      trigger: 'post-create',
      outputSchema: 'single-label',
      source: 'builtin',
      enabled: true,
      logic: 'Lexicon → AI',
      showIn: ['insights', 'pipelines'],
    },
  },
};

export const Sentiment: PipelineStory = {
  args: {
    pipeline: {
      id: 'sentiment',
      name: 'Sentiment',
      description: 'Scores sentiment on every post and comment.',
      kind: 'ordinal',
      trigger: 'post-create',
      outputSchema: 'single-label',
      source: 'builtin',
      enabled: true,
      logic: 'AFINN lexicon → AI judge for ambiguous',
      labels: ['positive', 'neutral', 'negative'],
      showIn: ['insights', 'pipelines'],
    },
  },
};

export const ImpostorDetection: PipelineStory = {
  args: {
    pipeline: {
      id: 'impostor',
      name: 'Impostor detection',
      description: 'Flags non-verified users claiming to represent the brand.',
      kind: 'boolean',
      trigger: 'comment-create',
      outputSchema: 'boolean',
      source: 'builtin',
      enabled: true,
      logic: 'Regex pre-filter → AI judge',
      showIn: ['pipelines', 'audit'],
    },
  },
};

export const CrisisDetection: PipelineStory = {
  args: {
    pipeline: {
      id: 'crisis',
      name: 'Crisis detection',
      description: 'Auto-groups negative-sentiment spikes into incidents.',
      kind: 'cluster',
      trigger: 'comment-create',
      outputSchema: 'cluster',
      source: 'builtin',
      enabled: true,
      logic: 'Hourly volume + negative-share thresholds',
      showIn: ['pipelines', 'incidents'],
    },
  },
};

export const Themes: PipelineStory = {
  name: 'Themes (no settings link)',
  args: {
    pipeline: {
      id: 'themes',
      name: 'Themes',
      description: 'AI-clusters negative posts into emerging themes daily.',
      kind: 'cluster',
      trigger: 'scheduled',
      outputSchema: 'cluster',
      source: 'builtin',
      enabled: true,
      logic: 'AI clustering of negative posts',
      showIn: ['insights', 'pipelines'],
    },
  },
};
