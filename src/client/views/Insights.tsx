/**
 * Insights — tabbed container for Drivers, Sentiment, Themes, Root causes, Custom.
 *
 * Section sub-tabs are reflected in the URL as ?tab=insights&section=<name>.
 * The parent Dashboard passes defaultSection from the URL on mount.
 */

import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

export type InsightSection = 'drivers' | 'sentiment' | 'themes' | 'root-causes' | 'custom';

interface InsightsProps {
  defaultSection?: InsightSection;
  /** Called when the section changes — parent syncs URL. */
  onSectionChange?: (section: InsightSection) => void;
  /** Lazy-injected content components to keep Dashboard.tsx as-is. */
  DriversContent: React.ComponentType<{ initialDriver?: string }>;
  SentimentContent: React.ComponentType<Record<string, never>>;
  ThemesContent: React.ComponentType<Record<string, never>>;
  /** Custom pipelines list passed in from Dashboard. */
  customPipelines: Array<{ id: string; name: string; kind: string }>;
}

const SECTIONS: { id: InsightSection; label: string }[] = [
  { id: 'drivers', label: 'Drivers' },
  { id: 'sentiment', label: 'Sentiment' },
  { id: 'themes', label: 'Themes' },
  { id: 'root-causes', label: 'Root causes' },
  { id: 'custom', label: 'Custom' },
];

export function Insights({
  defaultSection = 'drivers',
  onSectionChange,
  DriversContent,
  SentimentContent,
  ThemesContent,
  customPipelines,
}: InsightsProps) {
  const [section, setSection] = useState<InsightSection>(defaultSection);

  const navigate = useCallback(
    (s: InsightSection) => {
      setSection(s);
      onSectionChange?.(s);
    },
    [onSectionChange],
  );

  // Sync if parent pushes a new defaultSection (e.g. deep-link redirect)
  useEffect(() => {
    setSection(defaultSection);
  }, [defaultSection]);

  return (
    <div className="space-y-6">
      {/* Section sub-tabs */}
      <div
        role="tablist"
        aria-label="Insights sections"
        className="flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-0"
        style={{ scrollbarWidth: 'none' }}
      >
        {SECTIONS.map((s) => {
          const isActive = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => navigate(s.id)}
              className={`-mb-px flex-shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                isActive
                  ? 'border-orange-400 text-[var(--text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Section content */}
      <div>
        {section === 'drivers' && <DriversContent />}
        {section === 'sentiment' && <SentimentContent />}
        {section === 'themes' && <ThemesContent />}
        {section === 'root-causes' && <RootCausesPlaceholder />}
        {section === 'custom' && <CustomPipelinesList pipelines={customPipelines} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root causes placeholder
// ---------------------------------------------------------------------------

function RootCausesPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-700 bg-neutral-900/40 px-8 py-16 text-center">
      <span className="mb-3 text-3xl" aria-hidden="true">
        🔍
      </span>
      <h3 className="mb-2 font-semibold text-neutral-200">Coming soon</h3>
      <p className="max-w-md text-sm text-neutral-400">
        When you mark a post resolved, RedLattice's root-cause pipeline will summarize what fixed
        it.{' '}
        <a
          href="?tab=pipelines"
          className="text-orange-400 underline underline-offset-2 hover:text-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          onClick={(e) => {
            e.preventDefault();
            history.pushState({ tab: 'pipelines' }, '', '?tab=pipelines');
            window.dispatchEvent(new PopStateEvent('popstate', { state: { tab: 'pipelines' } }));
          }}
        >
          Visit the Pipelines tab to enable it.
        </a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom pipelines list
// ---------------------------------------------------------------------------

function CustomPipelinesList({
  pipelines,
}: {
  pipelines: Array<{ id: string; name: string; kind: string }>;
}) {
  if (pipelines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-700 bg-neutral-900/40 px-8 py-16 text-center">
        <span className="mb-3 text-3xl" aria-hidden="true">
          🛠
        </span>
        <h3 className="mb-2 font-semibold text-neutral-200">No custom pipelines yet</h3>
        <p className="max-w-md text-sm text-neutral-400">
          Create a custom pipeline in the Pipelines tab and it will appear here with its tag
          distribution once it has processed posts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm uppercase tracking-wide text-neutral-400">Custom pipelines</h2>
      <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
        {pipelines.map((p) => (
          <li key={p.id} className="flex items-center justify-between px-4 py-3">
            <span className="font-medium text-neutral-200">{p.name}</span>
            <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400">
              {p.kind}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
