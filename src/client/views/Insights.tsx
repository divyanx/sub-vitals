/**
 * Insights — dynamic tabbed container.
 *
 * Sub-tabs are generated from enabled pipelines returned by
 * GET /api/pipelines/enabled. Each pipeline renders a visualization
 * based on its `kind` field:
 *
 *   categorical → CategoricalView (bar chart + drill-through)
 *   ordinal     → OrdinalView (cards in label order)
 *   cluster     → ClusterView (emerging-cluster list)
 *   scalar      → ScalarView (histogram)
 *   boolean     → BooleanView (two stat cards)
 *
 * Legacy DriversContent / SentimentContent / ThemesContent components are
 * still accepted as props and used for the builtin pipelines so existing
 * functionality is preserved without rewriting them.
 */

import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { api, type PipelineRecord, type TagDistributionEntry } from '../lib/api.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InsightSection = string;

interface InsightsProps {
  defaultSection?: InsightSection;
  onSectionChange?: (section: InsightSection) => void;
  DriversContent: React.ComponentType<{ initialDriver?: string }>;
  SentimentContent: React.ComponentType<Record<string, never>>;
  ThemesContent: React.ComponentType<Record<string, never>>;
  /** Legacy prop — still accepted but no longer the primary mechanism */
  customPipelines?: Array<{ id: string; name: string; kind: string }>;
  /** Called when the user clicks the "+ New" tab button. */
  onOpenNewPipeline?: () => void;
}

// ---------------------------------------------------------------------------
// Generic visualization components
// ---------------------------------------------------------------------------

function CategoricalView({
  pipeline,
  DriversContent,
}: {
  pipeline: PipelineRecord;
  DriversContent?: React.ComponentType<{ initialDriver?: string }>;
}) {
  // For the builtin intent/driver pipeline, delegate to the existing component
  if (pipeline.id === 'intent' && DriversContent) {
    return <DriversContent />;
  }

  return (
    <TagDistributionPanel
      pipeline={pipeline}
      labels={pipeline.labels ?? []}
      emptyMessage={`No ${pipeline.name} data yet. This pipeline has not tagged any posts.`}
    />
  );
}

function OrdinalView({
  pipeline,
  SentimentContent,
}: {
  pipeline: PipelineRecord;
  SentimentContent?: React.ComponentType<Record<string, never>>;
}) {
  // For the builtin sentiment pipeline, delegate to the existing component
  if (pipeline.id === 'sentiment' && SentimentContent) {
    return <SentimentContent />;
  }

  return (
    <TagDistributionPanel
      pipeline={pipeline}
      labels={pipeline.labels ?? []}
      emptyMessage={`No ${pipeline.name} data yet.`}
    />
  );
}

function ClusterView({
  pipeline,
  ThemesContent,
}: {
  pipeline: PipelineRecord;
  ThemesContent?: React.ComponentType<Record<string, never>>;
}) {
  if (pipeline.id === 'themes' && ThemesContent) {
    return <ThemesContent />;
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--r-3)] border border-dashed border-[var(--n-4)] bg-[var(--n-2)] px-8 py-16 text-center">
      <h3 className="mb-2 font-semibold text-[var(--n-12)]">{pipeline.name}</h3>
      <p className="max-w-md text-[length:var(--t-sm)] text-[var(--n-8)]">
        Cluster data will appear here once the pipeline has processed enough posts.
      </p>
    </div>
  );
}

function ScalarView({ pipeline }: { pipeline: PipelineRecord }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--r-3)] border border-dashed border-[var(--n-4)] bg-[var(--n-2)] px-8 py-16 text-center">
      <h3 className="mb-2 font-semibold text-[var(--n-12)]">{pipeline.name}</h3>
      <p className="max-w-md text-[length:var(--t-sm)] text-[var(--n-8)]">
        Scalar distribution chart will render once this pipeline has scored posts.
      </p>
    </div>
  );
}

function BooleanView({ pipeline }: { pipeline: PipelineRecord }) {
  const pipelineLabels = ['true', 'false'];
  return (
    <TagDistributionPanel
      pipeline={pipeline}
      labels={pipelineLabels}
      emptyMessage={`No ${pipeline.name} detections yet.`}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared: tag distribution panel (categorical / ordinal / boolean)
// ---------------------------------------------------------------------------

function TagDistributionPanel({
  pipeline,
  labels,
  emptyMessage,
}: {
  pipeline: PipelineRecord;
  labels: string[];
  emptyMessage: string;
}) {
  const distQ = useQuery({
    queryKey: ['tag-distribution', pipeline.id, labels],
    queryFn: () => api.tags.distribution(pipeline.id, labels),
    staleTime: 2 * 60 * 1000,
    enabled: labels.length > 0,
  });

  const distribution: TagDistributionEntry[] = distQ.data?.distribution ?? [];
  const total = distribution.reduce((s, e) => s + e.count, 0);

  if (distQ.isPending) {
    return (
      <div className="space-y-2 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-[var(--r-2)] bg-[var(--n-3)]" />
        ))}
      </div>
    );
  }

  if (distribution.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--r-3)] border border-dashed border-[var(--n-4)] bg-[var(--n-2)] px-8 py-16 text-center">
        <h3 className="mb-2 font-semibold text-[var(--n-12)]">{pipeline.name}</h3>
        <p className="max-w-md text-[length:var(--t-sm)] text-[var(--n-8)]">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[length:var(--t-sm)] uppercase tracking-wide text-[var(--n-8)]">
        {pipeline.name}
      </h2>
      <ul className="space-y-2">
        {distribution.map((entry) => {
          const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
          return (
            <li
              key={entry.value}
              className="rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] p-3"
            >
              <div className="mb-1 flex items-center justify-between text-[length:var(--t-sm)]">
                <span className="font-medium text-[var(--n-11)] capitalize">{entry.value}</span>
                <span className="text-[length:var(--t-xs)] text-[var(--n-8)]">
                  {entry.count.toLocaleString()} ({pct}%)
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--n-3)]">
                <div
                  className="h-full rounded-full bg-[var(--accent-9)]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Insights component
// ---------------------------------------------------------------------------

export function Insights({
  defaultSection = 'intent',
  onSectionChange,
  DriversContent,
  SentimentContent,
  ThemesContent,
  onOpenNewPipeline,
}: InsightsProps) {
  const [section, setSection] = useState<InsightSection>(defaultSection);

  const pipelinesQ = useQuery({
    queryKey: ['pipelines-enabled'],
    queryFn: () => api.pipelines.enabled(),
    staleTime: 5 * 60 * 1000,
  });

  // Filter to pipelines that belong in the Insights sub-tab strip.
  // Builtins that route to dedicated tabs (Incidents, Team, Audit) are excluded
  // so they don't clutter the Insights section list.
  const pipelines: PipelineRecord[] = (pipelinesQ.data?.pipelines ?? []).filter(
    (p) => !p.showIn || p.showIn.includes('insights'),
  );

  const navigate = useCallback(
    (s: InsightSection) => {
      setSection(s);
      onSectionChange?.(s);
    },
    [onSectionChange],
  );

  useEffect(() => {
    setSection(defaultSection);
  }, [defaultSection]);

  // When pipelines load and current section isn't valid, reset to first one
  useEffect(() => {
    if (pipelines.length > 0 && !pipelines.some((p) => p.id === section)) {
      const first = pipelines[0];
      if (first) navigate(first.id);
    }
  }, [pipelines, section, navigate]);

  if (pipelinesQ.isPending) {
    return (
      <div className="space-y-4 py-4">
        <div className="flex gap-1 border-b border-[var(--n-4)] pb-0">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-8 w-24 animate-pulse rounded-t-[var(--r-2)] bg-[var(--n-3)]"
            />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-[var(--r-2)] bg-[var(--n-2)]" />
      </div>
    );
  }

  if (pipelines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--r-3)] border border-dashed border-[var(--n-4)] bg-[var(--n-2)] px-8 py-16 text-center">
        <h3 className="mb-2 font-semibold text-[var(--n-12)]">No pipelines enabled</h3>
        <p className="max-w-md text-[length:var(--t-sm)] text-[var(--n-8)]">
          Enable pipelines from the Pipelines tab to see analytics sections here.
        </p>
      </div>
    );
  }

  const activePipeline = pipelines.find((p) => p.id === section) ?? pipelines[0];

  return (
    <div className="space-y-6">
      {/* Section sub-tabs — one per enabled pipeline */}
      <div
        role="tablist"
        aria-label="Insights sections"
        className="flex gap-1 overflow-x-auto border-b border-[var(--n-4)] pb-0"
        style={{ scrollbarWidth: 'none' }}
      >
        {pipelines.map((p) => {
          const isActive = (activePipeline?.id ?? '') === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => navigate(p.id)}
              className={`-mb-px flex-shrink-0 border-b-2 px-4 py-2.5 text-[length:var(--t-sm)] font-medium transition ${
                isActive
                  ? 'border-[var(--accent-9)] text-[var(--n-12)]'
                  : 'border-transparent text-[var(--n-8)] hover:text-[var(--n-11)]'
              }`}
            >
              {p.name}
            </button>
          );
        })}

        {/* "+ New pipeline" shortcut — opens the new pipeline modal directly */}
        {onOpenNewPipeline ? (
          <button
            type="button"
            aria-label="Create new pipeline"
            data-testid="insights-new-pipeline-btn"
            onClick={onOpenNewPipeline}
            className="-mb-px ml-1 flex flex-shrink-0 items-center gap-1 border-b-2 border-transparent px-3 py-2.5 text-[length:var(--t-sm)] font-medium text-[var(--n-8)] transition hover:border-[var(--accent-9)] hover:text-[var(--accent-11)]"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span>New</span>
          </button>
        ) : null}
      </div>

      {/* Section content — rendered by kind */}
      <div>
        {activePipeline ? (
          <PipelineSection
            pipeline={activePipeline}
            DriversContent={DriversContent}
            SentimentContent={SentimentContent}
            ThemesContent={ThemesContent}
          />
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route to correct visualization based on pipeline kind
// ---------------------------------------------------------------------------

function PipelineSection({
  pipeline,
  DriversContent,
  SentimentContent,
  ThemesContent,
}: {
  pipeline: PipelineRecord;
  DriversContent: React.ComponentType<{ initialDriver?: string }>;
  SentimentContent: React.ComponentType<Record<string, never>>;
  ThemesContent: React.ComponentType<Record<string, never>>;
}) {
  switch (pipeline.kind) {
    case 'categorical':
      return <CategoricalView pipeline={pipeline} DriversContent={DriversContent} />;
    case 'ordinal':
      return <OrdinalView pipeline={pipeline} SentimentContent={SentimentContent} />;
    case 'cluster':
      return <ClusterView pipeline={pipeline} ThemesContent={ThemesContent} />;
    case 'scalar':
      return <ScalarView pipeline={pipeline} />;
    case 'boolean':
      return <BooleanView pipeline={pipeline} />;
    default:
      return null;
  }
}
