/**
 * PipelineCard stories — Storybook 10 / CSF 3
 *
 * Covers both PipelineCard and StubPipelineCard exported from Dashboard.tsx.
 */

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PipelineCard } from '../client/views/Dashboard.tsx';

function QueryWrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// PipelineCard
// ---------------------------------------------------------------------------

const pipelineMeta: Meta<typeof PipelineCard> = {
  title: 'Pipelines/PipelineCard',
  component: PipelineCard,
  decorators: [
    (Story) => (
      <QueryWrapper>
        <div className="max-w-sm p-6 bg-neutral-900 min-h-screen">
          <Story />
        </div>
      </QueryWrapper>
    ),
  ],
  args: {
    onOpenSettings: fn(),
  },
};

export default pipelineMeta;
type PipelineStory = StoryObj<typeof PipelineCard>;

export const ContactDrivers: PipelineStory = {
  args: {
    pipeline: {
      id: 'contact-drivers',
      name: 'Contact Drivers',
      trigger: 'PostSubmit',
      logic: 'Lexicon → LLM',
      settingsLink: 'taxonomy',
      moduleKey: 'contact-drivers',
    },
  },
};

export const SentimentScoring: PipelineStory = {
  args: {
    pipeline: {
      id: 'sentiment',
      name: 'Sentiment scoring',
      trigger: 'PostSubmit + CommentCreate',
      logic: 'AFINN lexicon → LLM judge for ambiguous',
      moduleKey: 'sentiment',
    },
  },
};

export const ImpostorDetection: PipelineStory = {
  args: {
    pipeline: {
      id: 'impostor',
      name: 'Impostor detection',
      trigger: 'CommentCreate (non-mods only)',
      logic: 'Regex pre-filter → LLM judge',
      moduleKey: 'impostor-detection',
    },
  },
};

export const CrisisDetection: PipelineStory = {
  args: {
    pipeline: {
      id: 'crisis',
      name: 'Crisis detection',
      trigger: 'CommentCreate',
      logic: 'Hourly volume + negative-share thresholds',
      moduleKey: 'crisis-detection',
    },
  },
};

export const NoSettingsLink: PipelineStory = {
  name: 'Without settings link',
  args: {
    pipeline: {
      id: 'themes',
      name: 'Theme clustering',
      trigger: 'Scheduler (daily 02:00 UTC)',
      logic: 'LLM clustering of negative posts',
      moduleKey: 'theme-clustering',
    },
  },
};
