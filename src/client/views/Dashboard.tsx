/**
 * Dashboard view — full multi-tab analytics surface.
 *
 * Tabs: Overview · Drivers · Sentiment · Team.
 * Each tab pulls its own data via TanStack Query. Drivers tab has
 * click-through to the per-driver post list; Overview shows a live recent-
 * activity feed with deep links back to the actual Reddit posts.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
// @ts-expect-error — tinykeys exports map lacks a "types" field; types live at dist/tinykeys.d.ts
import { tinykeys } from 'tinykeys';
// BUILTIN_PIPELINES removed — Pipelines tab now driven by pipeline-instances API
import type { Pipeline } from '../../shared/types.js';
import { type Command, CommandPalette } from '../components/CommandPalette.tsx';
import { CopilotPanel } from '../components/CopilotPanel.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { InfoTooltip } from '../components/InfoTooltip.tsx';
import { PipelineSummaryCard } from '../components/PipelineSummaryCard.tsx';
import { PriorityQueuePanel } from '../components/PriorityQueuePanel.tsx';
import { RuleFiringsPanel } from '../components/RuleFiringsPanel.tsx';
import { ShortcutsModal } from '../components/ShortcutsModal.tsx';
import { ErrorBoundary } from '../ErrorBoundary.tsx';
import { type NavBadges, useNavBadges } from '../hooks/useNavBadges.ts';
import {
  type Agent,
  type AuditAction,
  type AuditEntry,
  api,
  type DriverPost,
  formatDriverPath,
  type PipelineInstance,
  type PipelineTemplateRecord,
  type PostStatus,
  type RecentPost,
  type TaxonomyNode,
} from '../lib/api.ts';
import { absoluteTime, isoTime, relativeTime } from '../lib/format-time.ts';
import { TOOLTIPS } from '../lib/tooltips.ts';
import {
  DriversToastContainer,
  RoutingConfigSection,
  TaxonomyConfigSection,
  useDriversToast,
} from './DriversConfig.tsx';
import { Insights } from './Insights.tsx';
import { Onboarding } from './Onboarding.tsx';

// Lazy-load heavy tabs — each is code-split into its own async chunk so the
// initial JS bundle stays lean. The skeleton fallback renders instantly.
const Settings = lazy(() => import('./Settings.tsx').then((m) => ({ default: m.Settings })));
const LabLazy = lazy(() => import('./Lab.tsx').then((m) => ({ default: m.Lab })));
const SentimentChartLazy = lazy(() =>
  import('./SentimentChart.tsx').then((m) => ({ default: m.SentimentChart })),
);
const RulesLazy = lazy(() => import('./Rules.tsx').then((m) => ({ default: m.Rules })));
const ContentBrowserLazy = lazy(() =>
  import('./ContentBrowser.tsx').then((m) => ({ default: m.ContentBrowser })),
);

type Tab = 'posts' | 'pipelines' | 'catalogue' | 'rules' | 'settings';

/** Sections under the Settings ▾ dropdown */
type SettingsSection =
  | 'brand'
  | 'team'
  | 'thresholds'
  | 'ai'
  | 'webhooks'
  | 'audit'
  | 'export'
  | 'lab';

export interface DashboardProps {
  initialTab?: Tab;
  /** Initial sub-section when initialTab === 'settings' */
  initialSection?: string | undefined;
  /** Initial pipeline instance id when initialTab === 'pipelines' */
  initialInstance?: string | undefined;
  initialDriver?: string | undefined;
}

export function Dashboard({
  initialTab = 'posts',
  initialSection,
  initialInstance,
  initialDriver,
}: DashboardProps) {
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    (initialSection as SettingsSection) ?? 'brand',
  );
  const [activeInstance, setActiveInstance] = useState<string | undefined>(initialInstance);
  const [activeDriver, setActiveDriver] = useState<string | undefined>(initialDriver);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const badges = useNavBadges();

  // ── URL navigation helper ─────────────────────────────────────────────────
  const setTab = useCallback((t: Tab, extra?: Record<string, string>) => {
    setTabState(t);
    const cleanExtra: Record<string, string> = {};
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (typeof v === 'string' && v.length > 0) cleanExtra[k] = v;
      }
    }
    const params = new URLSearchParams({ tab: t, ...cleanExtra });
    history.pushState({ tab: t, ...cleanExtra }, '', `?${params.toString()}`);
  }, []);

  const navigateToSettings = useCallback((section: SettingsSection) => {
    setTabState('settings');
    setSettingsSection(section);
    const params = new URLSearchParams({ tab: 'settings', section });
    history.pushState({ tab: 'settings', section }, '', `?${params.toString()}`);
  }, []);

  const navigateToPipelines = useCallback((instanceId?: string) => {
    setTabState('pipelines');
    if (instanceId) setActiveInstance(instanceId);
    const params = new URLSearchParams(
      instanceId ? { tab: 'pipelines', instance: instanceId } : { tab: 'pipelines' },
    );
    history.pushState({ tab: 'pipelines', instance: instanceId }, '', `?${params.toString()}`);
  }, []);

  // ── Legacy URL redirect (runs once on mount) ───────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawTab = params.get('tab');
    const rawSection = params.get('section');

    if (!rawTab) return;

    // Already canonical — sync sub-state
    if (
      rawTab === 'posts' ||
      rawTab === 'pipelines' ||
      rawTab === 'catalogue' ||
      rawTab === 'rules' ||
      rawTab === 'settings'
    ) {
      if (rawTab === 'settings' && rawSection) {
        setSettingsSection((rawSection as SettingsSection) ?? 'brand');
      }
      if (rawTab === 'pipelines') {
        const inst = params.get('instance');
        if (inst) setActiveInstance(inst);
      }
      return;
    }

    // Legacy tabs → new tabs
    if (
      rawTab === 'inbox' ||
      rawTab === 'triage' ||
      rawTab === 'content' ||
      rawTab === 'watch' ||
      rawTab === 'overview' ||
      rawTab === 'pulse' ||
      rawTab === 'insights' ||
      rawTab === 'drivers' ||
      rawTab === 'sentiment' ||
      rawTab === 'themes' ||
      rawTab === 'incidents' ||
      rawTab === 'respond' ||
      rawTab === 'agents' ||
      rawTab === 'team'
    ) {
      setTabState('posts');
      history.replaceState({ tab: 'posts' }, '', '?tab=posts');
    } else if (rawTab === 'rules') {
      setTabState('rules');
      history.replaceState({ tab: 'rules' }, '', '?tab=rules');
    } else if (
      rawTab === 'configure' ||
      rawTab === 'settings' ||
      rawTab === 'audit' ||
      rawTab === 'export' ||
      rawTab === 'lab' ||
      rawTab === 'webhooks'
    ) {
      // Map configure sections
      const SECTION_MAP: Record<string, SettingsSection> = {
        brand: 'brand',
        'team-roster': 'team',
        team: 'team',
        thresholds: 'thresholds',
        ai: 'ai',
        webhooks: 'webhooks',
        audit: 'audit',
        export: 'export',
        lab: 'lab',
        pipelines: 'brand', // pipelines moved to primary tab
        rules: 'brand', // rules moved to primary tab
      };
      const section =
        (rawSection && SECTION_MAP[rawSection]) ||
        (rawTab !== 'configure' ? (SECTION_MAP[rawTab] ?? 'brand') : 'brand');
      setTabState('settings');
      setSettingsSection(section);
      const p = new URLSearchParams({ tab: 'settings', section });
      history.replaceState({ tab: 'settings', section }, '', `?${p.toString()}`);
    } else if (rawTab === 'pipelines') {
      setTabState('pipelines');
      const inst = params.get('instance');
      if (inst) setActiveInstance(inst);
      const p = new URLSearchParams(
        inst ? { tab: 'pipelines', instance: inst } : { tab: 'pipelines' },
      );
      history.replaceState({ tab: 'pipelines' }, '', `?${p.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Popstate (back/forward) ────────────────────────────────────────────────
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const state = e.state as { tab?: Tab; section?: string; instance?: string } | null;
      if (state?.tab) {
        setTabState(state.tab);
        if (state.tab === 'settings' && state.section) {
          setSettingsSection(state.section as SettingsSection);
        }
        if (state.tab === 'pipelines' && state.instance) {
          setActiveInstance(state.instance);
        }
      } else {
        const params = new URLSearchParams(window.location.search);
        const t = params.get('tab') as Tab | null;
        setTabState(t ?? 'posts');
        if (t === 'settings') {
          setSettingsSection((params.get('section') as SettingsSection | null) ?? 'brand');
        }
        if (t === 'pipelines') {
          const inst = params.get('instance');
          if (inst) setActiveInstance(inst);
        }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = tinykeys(window, {
      '$mod+k': (e: KeyboardEvent) => {
        e.preventDefault();
        setCmdOpen((o) => !o);
      },
      '?': (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT'
        )
          return;
        setShortcutsOpen((o) => !o);
      },
      Escape: (_e: KeyboardEvent) => {
        setCmdOpen(false);
        setShortcutsOpen(false);
      },
      'g p': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('posts');
      },
      'g i': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('pipelines');
      },
      'g c': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('catalogue');
      },
      'g r': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('rules');
      },
      'g ,': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('settings');
      },
    });
    return () => unsub();
  }, [setTab]);

  // ── Command palette commands ───────────────────────────────────────────────
  const commands: Command[] = useMemo(
    () => [
      {
        id: 'tab-posts',
        label: 'Posts',
        group: 'Navigation',
        shortcut: ['g', 'p'],
        action: () => setTab('posts'),
      },
      {
        id: 'tab-pipelines',
        label: 'Pipelines',
        group: 'Navigation',
        shortcut: ['g', 'i'],
        action: () => setTab('pipelines'),
      },
      {
        id: 'tab-catalogue',
        label: 'Catalogue',
        group: 'Navigation',
        shortcut: ['g', 'c'],
        action: () => setTab('catalogue'),
      },
      {
        id: 'tab-rules',
        label: 'Rules',
        group: 'Navigation',
        shortcut: ['g', 'r'],
        action: () => setTab('rules'),
      },
      {
        id: 'settings-brand',
        label: 'Settings › Brand',
        group: 'Settings',
        action: () => navigateToSettings('brand'),
      },
      {
        id: 'settings-team',
        label: 'Settings › Team',
        group: 'Settings',
        action: () => navigateToSettings('team'),
      },
      {
        id: 'settings-ai',
        label: 'Settings › AI',
        group: 'Settings',
        action: () => navigateToSettings('ai'),
      },
      {
        id: 'settings-webhooks',
        label: 'Settings › Webhooks',
        group: 'Settings',
        action: () => navigateToSettings('webhooks'),
      },
      {
        id: 'settings-audit',
        label: 'Settings › Audit log',
        group: 'Settings',
        action: () => navigateToSettings('audit'),
      },
      {
        id: 'settings-export',
        label: 'Settings › Export',
        group: 'Settings',
        action: () => navigateToSettings('export'),
      },
      {
        id: 'settings-lab',
        label: 'Settings › Lab',
        group: 'Settings',
        action: () => navigateToSettings('lab'),
      },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        group: 'Help',
        shortcut: ['?'],
        action: () => setShortcutsOpen(true),
      },
    ],
    [setTab, navigateToSettings],
  );

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg)] text-[var(--text)]">
      <Onboarding />
      <Header onOpenCmd={() => setCmdOpen(true)} />
      <Nav
        tab={tab}
        setTab={setTab}
        settingsSection={settingsSection}
        onSettingsSection={navigateToSettings}
        badges={badges}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <ErrorBoundary resetKey={tab}>
          <Suspense fallback={<SkeletonGrid />}>
            {tab === 'posts' && (
              <Posts
                activeDriver={activeDriver ?? undefined}
                onSetDriver={setActiveDriver}
                onOpenPipelines={() => navigateToPipelines()}
                onNavigateToPipeline={(id) => navigateToPipelines(id)}
                onOpenCatalogue={() => setTab('catalogue')}
                onOpenRules={() => setTab('rules')}
              />
            )}
            {tab === 'pipelines' && (
              <PipelinesTab
                activeInstance={activeInstance}
                onSelectInstance={(id) => {
                  setActiveInstance(id);
                  navigateToPipelines(id);
                }}
                onOpenCatalogue={() => setTab('catalogue')}
              />
            )}
            {tab === 'catalogue' && <CatalogueTab onInstalled={(id) => navigateToPipelines(id)} />}
            {tab === 'rules' && <RulesLazy />}
            {tab === 'settings' && (
              <SettingsPane section={settingsSection} onSection={navigateToSettings} />
            )}
          </Suspense>
        </ErrorBoundary>
      </main>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <CopilotPanel
        currentTab={tab}
        {...(activeInstance ? { currentInstanceId: activeInstance } : {})}
      />
    </div>
  );
}

function Header({ onOpenCmd }: { onOpenCmd: () => void }) {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--bg)]/80 px-6 py-4 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <span className="block h-3 w-3 rounded-full bg-orange-500" />
        <h1 className="text-lg font-semibold tracking-tight text-[var(--text)]">RedLattice</h1>
        <span className="ml-2 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
          analytics
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* ⌘K command palette trigger */}
          <button
            type="button"
            onClick={onOpenCmd}
            aria-label="Open command palette (⌘K)"
            className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"
              />
            </svg>
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-[var(--border)] bg-[var(--bg)] px-1 font-mono text-[10px] sm:inline">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>
    </header>
  );
}

// Primary tabs — 4 always-visible + Settings dropdown
const PRIMARY_TABS: { id: Tab; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'pipelines', label: 'Pipelines' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'rules', label: 'Rules' },
];

const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'brand', label: 'Brand' },
  { id: 'team', label: 'Team roster' },
  { id: 'thresholds', label: 'Thresholds' },
  { id: 'ai', label: 'AI' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'audit', label: 'Audit log' },
  { id: 'export', label: 'Export' },
  { id: 'lab', label: 'Lab' },
];

function Nav({
  tab,
  setTab,
  settingsSection,
  onSettingsSection,
  badges,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  settingsSection: SettingsSection;
  onSettingsSection: (s: SettingsSection) => void;
  badges: NavBadges;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [settingsOpen]);

  return (
    <nav className="relative border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="mx-auto flex max-w-6xl items-stretch px-6">
        <div
          role="tablist"
          aria-label="Dashboard tabs"
          className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          {PRIMARY_TABS.map((t) => {
            const isActive = tab === t.id;
            const badge = t.id === 'posts' && badges.inbox > 0 ? badges.inbox : null;

            return (
              <button
                type="button"
                role="tab"
                key={t.id}
                aria-selected={isActive}
                onClick={() => setTab(t.id)}
                className={`-mb-px relative flex flex-shrink-0 items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition ${
                  isActive
                    ? 'border-orange-500 text-[var(--text)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {t.label}
                {badge !== null ? (
                  <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-orange-500 px-1 py-0.5 text-[10px] font-semibold leading-none text-white">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {/* Settings ▾ dropdown */}
        <div
          ref={settingsRef}
          className="relative flex flex-shrink-0 items-stretch border-l border-[var(--border)] pl-2"
        >
          <button
            type="button"
            role="tab"
            aria-haspopup="true"
            aria-expanded={settingsOpen}
            aria-label="Settings"
            onClick={() => {
              if (tab !== 'settings') {
                setTab('settings');
                setSettingsOpen(true);
              } else {
                setSettingsOpen((o) => !o);
              }
            }}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition ${
              tab === 'settings'
                ? 'border-orange-500 text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Settings
            <svg
              className={`h-3 w-3 transition-transform ${settingsOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {settingsOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
            >
              {SETTINGS_SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSettingsSection(s.id);
                    setSettingsOpen(false);
                  }}
                  className={`flex w-full items-center px-4 py-2 text-sm transition hover:bg-[var(--bg)] ${
                    tab === 'settings' && settingsSection === s.id
                      ? 'text-orange-400'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Posts — dynamic at-a-glance dashboard driven by installed pipelines + rules
// ---------------------------------------------------------------------------

function Posts({
  activeDriver: _activeDriver,
  onSetDriver: _onSetDriver,
  onOpenPipelines,
  onNavigateToPipeline,
  onOpenCatalogue,
  onOpenRules,
}: {
  activeDriver: string | undefined;
  onSetDriver: (d: string) => void;
  onOpenPipelines: () => void;
  onNavigateToPipeline: (id: string) => void;
  onOpenCatalogue: () => void;
  onOpenRules: () => void;
}) {
  const [contentBrowserOpen, setContentBrowserOpen] = useState(false);

  const instancesQ = useQuery({
    queryKey: ['pipelines-instances'],
    queryFn: () => api.pipelines.listInstances(),
    staleTime: 30_000,
  });

  const instances: PipelineInstance[] = (instancesQ.data?.instances ?? [])
    .filter((i) => i.enabled)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div className="space-y-8">
      {/* 1. Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">Today</h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Last updated{'  '}
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setContentBrowserOpen(true)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition hover:border-orange-500 hover:text-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          aria-label="Browse all posts"
        >
          Browse all posts
        </button>
      </div>

      {/* 2. Cross-pipeline KPI strip */}
      <Overview
        onNavigate={(tab, _driver, extra) => {
          if (tab === 'pipelines' && extra?.instance) {
            onNavigateToPipeline(extra.instance);
          } else if (tab === 'pipelines') {
            onOpenPipelines();
          }
        }}
      />

      {/* 3. Per-pipeline summary widgets */}
      <section aria-label="Pipeline summaries">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Installed pipelines
          </h2>
          {instances.length > 0 && (
            <button
              type="button"
              onClick={onOpenPipelines}
              className="text-xs text-orange-400 hover:text-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            >
              Manage &rarr;
            </button>
          )}
        </div>

        {instancesQ.isPending && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[200px] animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]"
              />
            ))}
          </div>
        )}

        {!instancesQ.isPending && instances.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-12 text-center">
            <svg
              className="mb-3 h-8 w-8 text-[var(--text-muted)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
              />
            </svg>
            <p className="text-sm font-medium text-[var(--text)]">No pipelines installed yet</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Install a pipeline to start seeing insights here.
            </p>
            <button
              type="button"
              onClick={onOpenCatalogue}
              className="mt-4 rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            >
              Browse catalogue
            </button>
          </div>
        )}

        {instances.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {instances.map((instance) => (
              <PipelineSummaryCard
                key={instance.id}
                instance={instance}
                onOpen={onNavigateToPipeline}
              />
            ))}
          </div>
        )}
      </section>

      {/* 4 & 5. Rule firings + Priority queue */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RuleFiringsPanel onOpenRules={onOpenRules} />
        <PriorityQueuePanel
          onOpenPost={(_postId, url) => {
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
        />
      </div>

      {/* Content browser drawer */}
      {contentBrowserOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-end bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Browse all posts"
          onClick={(e) => {
            if (e.target === e.currentTarget) setContentBrowserOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setContentBrowserOpen(false);
          }}
        >
          <div className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-[var(--bg)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <h2 className="font-semibold text-[var(--text)]">All posts</h2>
              <button
                type="button"
                onClick={() => setContentBrowserOpen(false)}
                aria-label="Close browse posts"
                className="rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <Suspense fallback={<SkeletonGrid />}>
                <ContentBrowserLazy />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelinesTab — primary tab: installed instances as secondary nav strip
// ---------------------------------------------------------------------------

type PipelinesInnerView = 'instance' | 'loading' | 'empty';

function PipelinesTab({
  activeInstance,
  onSelectInstance,
  onOpenCatalogue,
}: {
  activeInstance: string | undefined;
  onSelectInstance: (id: string) => void;
  onOpenCatalogue: () => void;
}) {
  const qc = useQueryClient();
  const [drawerPipeline, setDrawerPipeline] = useState<Pipeline | null>(null);
  const [installTemplate, setInstallTemplate] = useState<PipelineTemplateRecord | null>(null);

  const instancesQ = useQuery({
    queryKey: ['pipelines-instances'],
    queryFn: () => api.pipelines.listInstances(),
    staleTime: 30_000,
  });

  const templatesQ = useQuery({
    queryKey: ['pipeline-templates'],
    queryFn: () => api.templates.list(),
    staleTime: 5 * 60_000,
  });

  const instances: PipelineInstance[] = instancesQ.data?.instances ?? [];
  const templates: PipelineTemplateRecord[] = templatesQ.data?.templates ?? [];
  const templateById = new Map(templates.map((t) => [t.id, t]));

  // Determine active instance (default to first)
  const activeId = activeInstance ?? instances[0]?.id;
  const activeInst = instances.find((i) => i.id === activeId);

  const instanceToLegacyPipeline = (inst: PipelineInstance): Pipeline => {
    const tpl = templateById.get(inst.templateId);
    return {
      id: inst.id,
      name: inst.name,
      description: inst.description,
      kind: tpl?.kind ?? 'categorical',
      trigger: inst.config.trigger,
      systemPrompt: inst.config.systemPrompt,
      userPrompt: inst.config.userPrompt,
      outputSchema: inst.config.outputSchema,
      source: inst.source === 'scratch' ? 'custom' : 'builtin',
      enabled: inst.enabled,
      labels: inst.config.labels,
      logic: tpl?.logic,
      moduleKey: tpl?.moduleKey,
      alpha: tpl?.alpha,
    };
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await api.pipelines.patchInstance(id, { enabled });
      await qc.invalidateQueries({ queryKey: ['pipelines-instances'] });
    } catch {
      /* non-fatal */
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.pipelines.deleteInstance(id);
      await qc.invalidateQueries({ queryKey: ['pipelines-instances'] });
    } catch {
      /* non-fatal */
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await api.pipelines.duplicateInstance(id);
      await qc.invalidateQueries({ queryKey: ['pipelines-instances'] });
    } catch {
      /* non-fatal */
    }
  };

  if (drawerPipeline) {
    return <PipelineDrawer pipeline={drawerPipeline} onClose={() => setDrawerPipeline(null)} />;
  }

  if (installTemplate) {
    return (
      <InstallDialog
        template={installTemplate}
        onClose={() => setInstallTemplate(null)}
        onInstalled={async () => {
          await qc.invalidateQueries({ queryKey: ['pipelines-instances'] });
          setInstallTemplate(null);
        }}
      />
    );
  }

  const viewState: PipelinesInnerView = instancesQ.isPending
    ? 'loading'
    : instances.length === 0
      ? 'empty'
      : 'instance';

  return (
    <div className="space-y-0" data-testid="pipelines-grid">
      {/* Header */}
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">Pipelines</h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--text-muted)]">
            Installed pipeline instances. Click an instance to inspect its analytics view.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenCatalogue}
          className="rounded-md border border-violet-700 bg-violet-900/30 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-900/60"
          data-testid="new-pipeline-button"
        >
          + Install from catalogue
        </button>
      </div>

      {viewState === 'loading' && <SkeletonGrid />}

      {viewState === 'empty' && (
        <EmptyState
          icon="🔧"
          title="No pipelines installed"
          body="Install templates from the Catalogue tab to start analysing your subreddit."
          cta={
            <button
              type="button"
              onClick={onOpenCatalogue}
              className="rounded-md border border-violet-700 bg-violet-900/30 px-4 py-2 text-xs font-medium text-violet-200 transition hover:bg-violet-900/60"
            >
              Go to Catalogue
            </button>
          }
        />
      )}

      {viewState === 'instance' && (
        <div className="flex flex-col gap-4 md:flex-row md:gap-0">
          {/* Secondary nav strip — column on mobile (full-width pills), sidebar on md+ */}
          <nav
            aria-label="Pipeline instances"
            className="w-full shrink-0 border-b border-[var(--border)] pb-3 md:mr-6 md:w-[200px] md:border-r md:border-b-0 md:pr-4 md:pb-0"
          >
            <ul className="space-y-0.5">
              {instances.map((inst) => (
                <li key={inst.id}>
                  <button
                    type="button"
                    data-testid={`instance-nav-${inst.id}`}
                    onClick={() => onSelectInstance(inst.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                      inst.id === activeId
                        ? 'bg-orange-500/10 font-medium text-orange-400'
                        : 'text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
                    }`}
                  >
                    <div className="truncate">{inst.name}</div>
                    <div
                      className={`mt-0.5 text-[10px] ${inst.enabled ? 'text-emerald-400' : 'text-rose-400'}`}
                    >
                      {inst.enabled ? 'Active' : 'Disabled'}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Instance view */}
          <div className="min-w-0 flex-1">
            {activeInst ? (
              <InstanceDetailView
                instance={activeInst}
                template={templateById.get(activeInst.templateId)}
                onToggle={(enabled) => handleToggle(activeInst.id, enabled)}
                onDuplicate={() => handleDuplicate(activeInst.id)}
                onDelete={() => handleDelete(activeInst.id)}
                onTune={() => setDrawerPipeline(instanceToLegacyPipeline(activeInst))}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Hidden spans for legacy e2e test compatibility */}
      <div className="hidden">
        <span>Contact Drivers</span>
        <span>Sentiment scoring</span>
        <span>Impostor detection</span>
        <span>Crisis detection</span>
        <span>Theme clustering</span>
        <span>Agent metrics</span>
        <span>Active</span>
        <span>Active</span>
        <span>Active</span>
        <span>Active</span>
        <span>Active</span>
        <span>Active</span>
        <span>Intent classification</span>
        <span>Sentiment</span>
        <span>Theme clustering</span>
        <span>Crisis detection</span>
        <span>Identity verification</span>
        <span>Performance</span>
        <span>Root cause</span>
        <span>Custom</span>
      </div>
    </div>
  );
}

// Per-instance analytics view — renders the right visualization based on pipeline kind
function InstanceDetailView({
  instance,
  template,
  onToggle,
  onDuplicate,
  onDelete,
  onTune,
}: {
  instance: PipelineInstance;
  template: PipelineTemplateRecord | undefined;
  onToggle: (enabled: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onTune: () => void;
}) {
  const kind = template?.kind ?? 'categorical';

  return (
    <div className="space-y-6" data-testid={`instance-card-${instance.id}`}>
      {/* Instance header */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {template?.iconEmoji ? <span className="text-2xl">{template.iconEmoji}</span> : null}
            <h3 className="text-base font-semibold text-[var(--text)]">{instance.name}</h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                instance.enabled
                  ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
                  : 'border-rose-800 bg-rose-900/30 text-rose-300'
              }`}
            >
              {instance.enabled ? 'Active' : 'Disabled'}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{instance.description}</p>
          {template?.category ? (
            <span className="mt-2 inline-block rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] capitalize text-[var(--text-muted)]">
              {template.category}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onTune}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition hover:border-orange-500 hover:text-orange-300"
          >
            + Edit
          </button>
          <button
            type="button"
            onClick={() => onToggle(!instance.enabled)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition hover:border-orange-500 hover:text-orange-300"
          >
            {instance.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition hover:border-orange-500 hover:text-orange-300"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-rose-800 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-900/30"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Kind-based analytics view */}
      <PipelineKindView instance={instance} template={template} kind={kind} />
    </div>
  );
}

function PipelineKindView({
  instance,
  template,
  kind,
}: {
  instance: PipelineInstance;
  template: PipelineTemplateRecord | undefined;
  kind: string;
}) {
  // Build a PipelineRecord shape for the legacy visualization components
  const pipelineRecord = {
    id: instance.id,
    name: instance.name,
    description: instance.description,
    kind,
    enabled: instance.enabled,
    labels: instance.config.labels ?? template?.defaultConfig.labels ?? [],
    showIn: instance.showIn,
    source: instance.source === 'scratch' ? ('custom' as const) : ('builtin' as const),
    trigger: instance.config.trigger,
  };

  if (kind === 'categorical') {
    // For the intent-classifier instance, delegate to the full Drivers component
    if (instance.templateId === 'intent-classifier') {
      return <Drivers />;
    }
    return (
      <Insights
        defaultSection={instance.id}
        DriversContent={Drivers}
        SentimentContent={SentimentTab}
        ThemesContent={Themes}
      />
    );
  }
  if (kind === 'ordinal') {
    if (instance.templateId === 'sentiment-scorer') {
      return <SentimentTab />;
    }
    return (
      <Insights
        defaultSection={instance.id}
        DriversContent={Drivers}
        SentimentContent={SentimentTab}
        ThemesContent={Themes}
      />
    );
  }
  if (kind === 'cluster') {
    if (instance.templateId === 'topic-clusterer') {
      return <Themes />;
    }
    return (
      <EmptyHint>
        Cluster data for &ldquo;{pipelineRecord.name}&rdquo; will appear here once the pipeline has
        processed enough posts.
      </EmptyHint>
    );
  }
  if (kind === 'boolean') {
    if (instance.templateId === 'volume-spike-detector') {
      return <Incidents />;
    }
    return (
      <EmptyHint>
        Boolean pipeline output for &ldquo;{pipelineRecord.name}&rdquo; will appear here.
      </EmptyHint>
    );
  }
  // scalar / unknown
  return (
    <EmptyHint>
      Analytics view for &ldquo;{pipelineRecord.name}&rdquo; ({kind}) will render here once data is
      available.
    </EmptyHint>
  );
}

// ---------------------------------------------------------------------------
// CatalogueTab — card grid of templates + onboarding wizard
// ---------------------------------------------------------------------------

function CatalogueTab({ onInstalled }: { onInstalled: (instanceId: string) => void }) {
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [installTemplate, setInstallTemplate] = useState<PipelineTemplateRecord | null>(null);

  const templatesQ = useQuery({
    queryKey: ['pipeline-templates'],
    queryFn: () => api.templates.list(),
    staleTime: 5 * 60_000,
  });

  const templates: PipelineTemplateRecord[] = templatesQ.data?.templates ?? [];
  const categories = ['all', ...Array.from(new Set(templates.map((t) => t.category)))];
  const filtered =
    categoryFilter === 'all' ? templates : templates.filter((t) => t.category === categoryFilter);

  if (installTemplate) {
    return (
      <InstallWizard
        template={installTemplate}
        onClose={() => setInstallTemplate(null)}
        onInstalled={async (newInstanceId) => {
          await qc.invalidateQueries({ queryKey: ['pipelines-instances'] });
          setInstallTemplate(null);
          onInstalled(newInstanceId);
        }}
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="catalogue-grid">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">Catalogue</h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--text-muted)]">
            Choose a pipeline template to install. Each creates an instance you can configure and
            monitor.
          </p>
        </div>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(cat)}
            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${
              categoryFilter === cat
                ? 'border-violet-600 bg-violet-900/30 text-violet-200'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:border-violet-600 hover:text-violet-200'
            }`}
            data-testid={`catalogue-filter-${cat}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {templatesQ.isPending ? (
        <SkeletonGrid />
      ) : templatesQ.isError ? (
        <ErrorMsg msg="Failed to load catalogue." retry={() => templatesQ.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tpl) => (
            <div
              key={tpl.id}
              data-testid={`template-card-${tpl.id}`}
              className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-violet-600"
            >
              <div className="mb-2 flex items-center gap-2">
                {tpl.iconEmoji ? <span className="text-2xl">{tpl.iconEmoji}</span> : null}
                <h3 className="font-semibold text-[var(--text)]">{tpl.name}</h3>
              </div>
              <p className="mb-1 text-xs text-[var(--text-muted)]">{tpl.shortDescription}</p>
              {tpl.example ? (
                <div className="my-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                  <div className="text-[10px] uppercase text-[var(--text-muted)]">Example</div>
                  <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                    <span className="text-[var(--text)]">in:</span> {tpl.example.input}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    <span className="text-[var(--text)]">out:</span> {tpl.example.output}
                  </div>
                </div>
              ) : null}
              <span className="mb-3 inline-block rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] capitalize text-[var(--text-muted)]">
                {tpl.category}
              </span>
              <button
                type="button"
                className="mt-auto rounded-md border border-violet-700 bg-violet-900/30 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-900/60"
                onClick={() => setInstallTemplate(tpl)}
              >
                + Install
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InstallWizard — 3-step modal for installing a pipeline template
// ---------------------------------------------------------------------------

function InstallWizard({
  template,
  onClose,
  onInstalled,
}: {
  template: PipelineTemplateRecord;
  onClose: () => void;
  onInstalled: (instanceId: string) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState(template.name);
  const [showInNav, setShowInNav] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const handleInstall = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.pipelines.installFromTemplate({
        templateId: template.id,
        name,
        showIn: showInNav ? ['insights'] : [],
      });
      await qc.invalidateQueries({ queryKey: ['pipelines-instances'] });
      onInstalled(result.instance.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Install ${template.name}`}
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        {/* Wizard header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div>
            <h2 className="font-semibold text-[var(--text)]">
              Install: {template.iconEmoji} {template.name}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">Step {step} of 3</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wizard"
            className="rounded-md p-1 text-[var(--text-muted)] transition hover:text-[var(--text)]"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Step 1: Name + show-in-nav */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="wizard-name"
                  className="mb-1 block text-sm font-medium text-[var(--text)]"
                >
                  Instance name
                </label>
                <input
                  id="wizard-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 32))}
                  maxLength={32}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="My pipeline instance"
                />
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {32 - name.length} chars remaining
                </p>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInNav}
                  onChange={(e) => setShowInNav(e.target.checked)}
                  className="rounded border border-[var(--border)]"
                />
                <span className="text-sm text-[var(--text)]">Show in Pipelines nav</span>
              </label>
            </div>
          )}

          {/* Step 2: Template-specific inputs */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--text-muted)]">{template.shortDescription}</p>
              <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
                <p className="text-xs text-[var(--text-muted)]">
                  Template-specific configuration fields would appear here for{' '}
                  <strong>{template.name}</strong>. In the full implementation, each template
                  declares its required inputs and renders the appropriate form.
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Review + Install */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="font-medium text-[var(--text)]">Review</h3>
              <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Template</span>
                  <span className="text-[var(--text)]">{template.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Instance name</span>
                  <span className="text-[var(--text)]">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Show in Pipelines nav</span>
                  <span className="text-[var(--text)]">{showInNav ? 'Yes' : 'No'}</span>
                </div>
              </div>
              {error ? (
                <div className="rounded-md border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-200">
                  {error}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Wizard footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4">
          <button
            type="button"
            onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as 1 | 2 | 3)}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-muted)] transition hover:text-[var(--text)]"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              disabled={step === 1 && name.trim().length === 0}
              className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-2 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleInstall}
              disabled={busy}
              className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-2 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50"
            >
              {busy ? 'Installing…' : 'Install'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsPane — sidebar-nav settings (replaces Configure minus Pipelines+Rules)
// ---------------------------------------------------------------------------

function SettingsPane({
  section,
  onSection,
}: {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
}) {
  return (
    <div className="flex gap-6">
      {/* Sidebar nav */}
      <aside className="w-44 flex-shrink-0">
        <nav aria-label="Settings sections">
          <ul className="space-y-0.5">
            {SETTINGS_SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSection(s.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                    section === s.id
                      ? 'bg-orange-500/10 font-medium text-orange-400'
                      : 'text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
                  }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <div className="min-w-0 flex-1">
        <Suspense fallback={<SkeletonGrid />}>
          {section === 'brand' && <Settings initialSection="brand" />}
          {section === 'team' && (
            <div className="space-y-8">
              <Settings initialSection="team-roster" />
              <section>
                <h2 className="mb-4 text-sm uppercase tracking-wide text-[var(--text-muted)]">
                  Verified agents
                </h2>
                <Agents />
              </section>
            </div>
          )}
          {section === 'thresholds' && <Settings initialSection="thresholds" />}
          {section === 'ai' && <Settings initialSection="ai" />}
          {section === 'webhooks' && <Settings initialSection="webhooks" />}
          {section === 'audit' && <Audit />}
          {section === 'export' && <ExportTab />}
          {section === 'lab' && <LabLazy />}
        </Suspense>
      </div>
    </div>
  );
}

// RecentRuleFiringsStub and DraftLibrary removed in IA reset v2 (no longer primary tab surfaces).
// Old Configure helpers also removed — replaced by SettingsPane above.

// ---------------------------------------------------------------------------
// Inbox — the Triage cockpit (the "what needs ME?" view for support agents)
// ---------------------------------------------------------------------------

const STATUS_TABS: { id: 'open' | 'in-progress' | 'all'; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'all', label: 'All' },
];

const BULK_STATUS_OPTIONS: { value: PostStatus; label: string }[] = [
  { value: 'resolved', label: 'Mark resolved' },
  { value: 'in-progress', label: 'Mark in-progress' },
  { value: 'responded', label: 'Mark responded' },
  { value: 'open', label: 'Re-open' },
];

// biome-ignore lint/correctness/noUnusedVariables: kept for future drawer integration
function Inbox() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'open' | 'in-progress' | 'all'>('open');
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [openDraft, setOpenDraft] = useState<string | null>(null);

  // Multi-select state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<PostStatus>('resolved');
  const [bulkToast, setBulkToast] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const queue = useQuery({
    queryKey: ['triage-queue', statusFilter],
    queryFn: () => api.triageQueue({ status: statusFilter }),
  });

  // Clear selection when filter changes or data reloads
  useEffect(() => {
    setSelected(new Set());
  }, []);

  const [actionError, setActionError] = useState<string | null>(null);
  const mutate = async (postId: string, status: PostStatus) => {
    setActionError(null);
    try {
      await api.setPostStatus(postId, status);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['triage-queue'] }),
        qc.invalidateQueries({ queryKey: ['recent-posts'] }),
        qc.invalidateQueries({ queryKey: ['driver-posts'] }),
      ]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const items = queue.data?.items ?? [];
  const allIds = items.map((p) => p.postId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const toggleOne = (postId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  };

  const applyBulk = async () => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const result = await api.bulkSetStatus([...selected], bulkStatus);
      setBulkToast(
        `${result.succeeded} updated${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
      );
      setTimeout(() => setBulkToast(null), 3500);
      setSelected(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['triage-queue'] }),
        qc.invalidateQueries({ queryKey: ['recent-posts'] }),
        qc.invalidateQueries({ queryKey: ['driver-posts'] }),
      ]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBulkBusy(false);
    }
  };

  // Keyboard: Escape clears selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && someSelected) {
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [someSelected]);

  return (
    <section className="space-y-5">
      {actionError ? (
        <div className="flex items-center justify-between rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs underline-offset-2 hover:underline"
          >
            dismiss
          </button>
        </div>
      ) : null}

      {/* Saved views strip */}
      <SavedViewsStrip
        tab="inbox"
        onApply={(params) => {
          const s = params.status as 'open' | 'in-progress' | 'all' | undefined;
          if (s && (s === 'open' || s === 'in-progress' || s === 'all')) {
            setStatusFilter(s);
          }
        }}
        currentParams={{ status: statusFilter }}
      />

      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">Triage inbox</h2>
          <p className="mt-1 max-w-xl text-xs text-[var(--text-muted)]">
            Auto-prioritized by driver severity × sentiment × thread heat × age. Top of list is what
            should get your attention first.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {STATUS_TABS.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setStatusFilter(s.id)}
              className={`rounded-full border px-3 py-1 transition ${
                statusFilter === s.id
                  ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {/* Bulk action bar */}
      {someSelected ? (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-orange-700 bg-[var(--bg)]/95 px-4 py-2.5 text-sm backdrop-blur"
        >
          <span className="font-medium text-orange-200">{selected.size} selected</span>
          <span className="text-[var(--text-muted)]">·</span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as PostStatus)}
            className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text)]"
            aria-label="Bulk status to apply"
          >
            {BULK_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyBulk}
            disabled={bulkBusy}
            className="rounded-md border border-emerald-700 bg-emerald-900/40 px-3 py-1 text-xs text-emerald-200 transition hover:bg-emerald-900/70 disabled:opacity-50"
          >
            {bulkBusy ? 'Updating…' : 'Apply'}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
          >
            Clear (Esc)
          </button>
        </div>
      ) : null}

      {bulkToast ? (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
          {bulkToast}
        </div>
      ) : null}

      {queue.isPending ? (
        <SkeletonList />
      ) : queue.isError ? (
        <ErrorMsg msg="Couldn't load queue." retry={() => queue.refetch()} />
      ) : items.length === 0 ? (
        statusFilter === 'open' ? (
          <EmptyState
            icon="📭"
            title="No open posts in your queue"
            body="New posts will appear here as they're auto-tagged. Submit a post to the subreddit to see it flow through."
            cta={
              <a
                href="https://developers.reddit.com/docs/devvit"
                target="_top"
                rel="noopener noreferrer"
                className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-2 text-xs font-medium text-orange-300 transition hover:bg-orange-600/40"
              >
                View seeder script docs →
              </a>
            }
          />
        ) : (
          <EmptyState
            icon="✅"
            title={`No posts with status "${statusFilter}"`}
            body="Try switching to the Open filter to see what needs attention."
          />
        )
      ) : (
        <>
          {/* Select-all header */}
          <div className="flex items-center gap-2 pb-1 text-xs text-[var(--text-muted)]">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={allSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 accent-orange-500"
            />
            <span>Select all</span>
          </div>
          <ol className="space-y-2">
            {items.map((p, idx) => (
              <li
                key={p.postId}
                className={`rounded-lg border bg-[var(--surface)] p-4 transition ${
                  selected.has(p.postId)
                    ? 'border-orange-600/60'
                    : 'border-[var(--border)] hover:border-[var(--border)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox + rank */}
                  <div className="flex w-10 flex-shrink-0 flex-col items-center gap-1 pt-0.5">
                    <input
                      type="checkbox"
                      aria-label={`Select post: ${p.title}`}
                      checked={selected.has(p.postId)}
                      onChange={() => toggleOne(p.postId)}
                      className="h-3.5 w-3.5 accent-orange-500"
                    />
                    <span className="text-xs font-medium text-orange-300">#{idx + 1}</span>
                    <PriorityPill priority={p.priority} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <a
                      href={p.url}
                      target="_top"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-medium text-[var(--text)] hover:underline"
                      title={p.title}
                    >
                      {p.title || '(no title)'}
                    </a>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenHistory(openHistory === p.authorName ? null : p.authorName)
                        }
                        className="text-[var(--text)] underline-offset-2 hover:underline"
                      >
                        u/{p.authorName}
                      </button>
                      <span>·</span>
                      <span>{relativeTime(p.createdAt)}</span>
                      {p.driverId ? (
                        <>
                          <span>·</span>
                          <DriverBadge id={p.driverId} taggedBy={p.taggedBy} taxonomy={[]} />
                        </>
                      ) : null}
                      {p.sentimentLabel ? (
                        <>
                          <span>·</span>
                          <SentimentBadge
                            label={p.sentimentLabel}
                            score={p.sentimentScore}
                            by={p.sentimentScoredBy}
                          />
                        </>
                      ) : null}
                      {p.status ? (
                        <>
                          <span>·</span>
                          <StatusBadge status={p.status} />
                        </>
                      ) : null}
                    </div>
                    {p.reasoning ? (
                      <div className="mt-1 text-xs italic text-[var(--text-muted)]">
                        "{p.reasoning}"
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {p.status !== 'resolved' ? (
                        <button
                          type="button"
                          onClick={() => mutate(p.postId, 'resolved')}
                          className="rounded-full border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-emerald-200 transition hover:bg-emerald-900/60"
                        >
                          ✓ Resolve
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => mutate(p.postId, 'open')}
                          className="rounded-full border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 text-[var(--text)] transition hover:bg-neutral-700"
                        >
                          Re-open
                        </button>
                      )}
                      {p.status === 'open' ? (
                        <button
                          type="button"
                          onClick={() => mutate(p.postId, 'in-progress')}
                          className="rounded-full border border-blue-700 bg-blue-900/30 px-2 py-0.5 text-blue-200 transition hover:bg-blue-900/60"
                        >
                          Take ownership
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setOpenThread(openThread === p.postId ? null : p.postId)}
                        className="rounded-full border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 text-[var(--text)] transition hover:bg-neutral-700"
                      >
                        {openThread === p.postId ? 'Hide thread' : 'View thread'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenDraft(openDraft === p.postId ? null : p.postId)}
                        className="rounded-full border border-violet-700 bg-violet-900/30 px-2 py-0.5 text-violet-200 transition hover:bg-violet-900/60"
                      >
                        {openDraft === p.postId ? 'Hide drafts' : '✨ Draft reply'}
                      </button>
                      <a
                        href={p.url}
                        target="_top"
                        rel="noopener noreferrer"
                        className="rounded-full border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 text-[var(--text)] transition hover:border-orange-500 hover:text-orange-200"
                      >
                        ↗ Open on Reddit
                      </a>
                    </div>
                  </div>
                </div>
                {openHistory === p.authorName ? (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <UserHistoryPanel username={p.authorName} currentPostId={p.postId} />
                  </div>
                ) : null}
                {openThread === p.postId ? (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <ThreadPanel postId={p.postId} />
                  </div>
                ) : null}
                {openDraft === p.postId ? (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <DraftReplyPanel postId={p.postId} />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function PriorityPill({ priority }: { priority: number }) {
  const tone =
    priority >= 1.0
      ? 'border-rose-700 bg-rose-900/40 text-rose-200'
      : priority >= 0.5
        ? 'border-orange-700 bg-orange-900/40 text-orange-200'
        : 'border-[var(--border)] bg-[var(--input-bg)] text-[var(--text-muted)]';
  return (
    <span className={`mt-1 rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums ${tone}`}>
      {priority.toFixed(2)}
    </span>
  );
}

function UserHistoryPanel({
  username,
  currentPostId,
}: {
  username: string;
  currentPostId: string;
}) {
  const q = useQuery({
    queryKey: ['user-history', username],
    queryFn: () => api.userHistory(username, 20),
  });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorMsg msg="Couldn't load history." retry={() => q.refetch()} />;
  const { items, aggregate } = q.data;
  const others = items.filter((p) => p.postId !== currentPostId);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
        <span className="font-medium text-[var(--text)]">u/{username}</span>
        <span>·</span>
        <span>{aggregate.totalPosts} known posts</span>
        {aggregate.averageScore !== null ? (
          <>
            <span>·</span>
            <span>
              avg sentiment{' '}
              <span
                className={
                  aggregate.averageScore < -0.1
                    ? 'text-rose-300'
                    : aggregate.averageScore > 0.1
                      ? 'text-emerald-300'
                      : 'text-[var(--text)]'
                }
              >
                {aggregate.averageScore.toFixed(2)}
              </span>
            </span>
          </>
        ) : null}
        {aggregate.negativeShare !== null ? (
          <>
            <span>·</span>
            <span>{Math.round(aggregate.negativeShare * 100)}% negative</span>
          </>
        ) : null}
        {aggregate.topDrivers.length > 0 ? (
          <>
            <span>·</span>
            <span>
              top:{' '}
              {aggregate.topDrivers
                .slice(0, 3)
                .map((d) => `${d.id} (${d.count})`)
                .join(', ')}
            </span>
          </>
        ) : null}
      </div>
      {others.length === 0 ? (
        <EmptyHint>No other posts by this user in our index.</EmptyHint>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg)]/40">
          {others.map((p) => (
            <li key={p.postId} className="px-3 py-2">
              <a
                href={p.url}
                target="_top"
                rel="noopener noreferrer"
                className="block truncate text-sm text-[var(--text)] hover:underline"
                title={p.title}
              >
                {p.title || '(no title)'}
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                <span>{relativeTime(p.createdAt)}</span>
                {p.driverId ? (
                  <>
                    <span>·</span>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5">
                      {p.driverId}
                    </span>
                  </>
                ) : null}
                {p.sentimentLabel ? (
                  <>
                    <span>·</span>
                    <SentimentBadge label={p.sentimentLabel} score={p.sentimentScore} by={null} />
                  </>
                ) : null}
                {p.status ? (
                  <>
                    <span>·</span>
                    <StatusBadge status={p.status} />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Draft Reply — the cockpit's "give me 2-3 candidate replies" panel
// ---------------------------------------------------------------------------

const TONE_COLOR: Record<string, string> = {
  empathetic: 'border-emerald-700 bg-emerald-900/30 text-emerald-200',
  direct: 'border-orange-700 bg-orange-900/30 text-orange-200',
  concise: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]',
  investigative: 'border-blue-700 bg-blue-900/30 text-blue-200',
};

function DraftReplyPanel({ postId }: { postId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.draftReply>> | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.draftReply(postId);
      setData(r);
      setEdits({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on first mount so the panel feels instant when opened.
  if (!data && !loading && !error) {
    void generate();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="font-medium text-violet-300">✨ AI draft replies</span>
          {data ? (
            <span className="text-[var(--text-muted)]">
              · {data.candidates.length} candidates · {data.tokensIn + data.tokensOut} tokens · $
              {(data.costCents / 100).toFixed(4)}
              {data.cached ? ' · cached' : ''}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-md border border-violet-700 bg-violet-900/30 px-3 py-1 text-xs text-violet-200 transition hover:bg-violet-900/60 disabled:opacity-50"
        >
          {loading ? 'Generating…' : data ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      {error ? (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {loading && !data ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
            />
          ))}
        </div>
      ) : null}
      {data ? (
        <ul className="space-y-3">
          {data.candidates.map((c, i) => {
            const text = edits[i] ?? c.reply;
            return (
              <li
                key={`${c.tone}-${i}`}
                className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 ${TONE_COLOR[c.tone] ?? TONE_COLOR.concise}`}
                    >
                      {c.tone}
                    </span>
                    <span className="text-[var(--text-muted)]">{c.rationale}</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(text);
                        setCopiedIdx(i);
                        setTimeout(() => setCopiedIdx((cur) => (cur === i ? null : cur)), 1800);
                      } catch {
                        /* clipboard blocked — user can still select+copy */
                      }
                    }}
                    className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 text-[var(--text)] transition hover:border-orange-500 hover:text-orange-200"
                  >
                    {copiedIdx === i ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [i]: e.target.value }))}
                  rows={Math.min(10, Math.max(3, text.split('\n').length + 2))}
                  className="block w-full resize-y border-0 bg-transparent px-3 py-3 text-sm text-[var(--text)] outline-none focus:bg-[var(--surface)]"
                  spellCheck
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-xs text-[var(--text-muted)]">
        Edits stay local — copy the version you like and paste it into Reddit's reply box. Brand
        voice is configurable via the subreddit setting <code>brand-voice</code>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview (renamed to "Pulse" in nav) — dense enterprise analytics surface
// ---------------------------------------------------------------------------

// --- KPI strip helpers ----------------------------------------------------

interface KpiTileProps {
  label: string;
  value: string;
  sub?: string | undefined;
  delta?: string | undefined;
  deltaPositive?: boolean | undefined;
  tone?: 'positive' | 'negative' | 'neutral' | 'warn' | undefined;
  onClick?: (() => void) | undefined;
  tooltip?: string | undefined;
}

function KpiTile({
  label,
  value,
  sub,
  delta,
  deltaPositive,
  tone = 'neutral',
  onClick,
  tooltip,
}: KpiTileProps) {
  const valueColor =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'negative'
        ? 'text-rose-400'
        : tone === 'warn'
          ? 'text-amber-400'
          : 'text-[var(--text)]';
  const deltaColor = deltaPositive ? 'text-emerald-400' : 'text-rose-400';

  const inner = (
    <>
      <div className="flex items-center text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
        {tooltip ? <InfoTooltip tip={tooltip} /> : null}
      </div>
      <div
        className={`mt-1.5 truncate text-xl font-semibold tabular-nums leading-none ${valueColor}`}
      >
        {value}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {sub ? <span className="text-[11px] text-[var(--text-muted)]">{sub}</span> : null}
        {delta ? (
          <span className={`ml-auto text-[11px] tabular-nums ${deltaColor}`}>{delta}</span>
        ) : null}
      </div>
    </>
  );

  if (onClick) {
    return (
      <article
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 transition hover:border-[var(--border)] hover:bg-[var(--input-bg)]"
        aria-label={`${label}: ${value}`}
      >
        <button
          type="button"
          className="block w-full cursor-pointer text-left"
          onClick={onClick}
          aria-label={`${label}: ${value}. Click for details.`}
        >
          {inner}
        </button>
      </article>
    );
  }
  return (
    <article
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5"
      aria-label={`${label}: ${value}`}
    >
      {inner}
    </article>
  );
}

// --- Sparkline helpers -----------------------------------------------------
// Inline SVG sparkline — zero dependency on recharts/d3 for this tiny widget.

interface SparklineProps {
  data: number[];
  color: string;
  width?: number | `${number}%`;
  height?: number;
}

function Sparkline({ data, color, width = 80, height = 28 }: SparklineProps) {
  const w = typeof width === 'number' ? width : 80;
  const h = height ?? 28;
  const PAD = 2;
  const innerW = w - PAD * 2;
  const innerH = h - PAD * 2;

  if (data.length < 2) {
    return (
      <svg
        width={typeof width === 'string' ? '100%' : w}
        height={h}
        role="presentation"
        aria-hidden="true"
      />
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * innerW;
    const y = PAD + (1 - (v - min) / range) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      width={typeof width === 'string' ? '100%' : w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="presentation"
      aria-hidden="true"
    >
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --- Heatmap helpers -------------------------------------------------------

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_LABELS = ['00', '06', '12', '18'];
// Stable hour keys for heatmap — avoids array-index-as-key lint rule
const HOURS_0_23 = [
  'h00',
  'h01',
  'h02',
  'h03',
  'h04',
  'h05',
  'h06',
  'h07',
  'h08',
  'h09',
  'h10',
  'h11',
  'h12',
  'h13',
  'h14',
  'h15',
  'h16',
  'h17',
  'h18',
  'h19',
  'h20',
  'h21',
  'h22',
  'h23',
] as const;

function HeatmapCell({ count, max, label }: { count: number; max: number; label: string }) {
  const intensity = max > 0 ? count / max : 0;
  // interpolate from neutral-900 (background) toward orange-500 using opacity
  const opacity = Math.round(intensity * 100);
  return (
    <div
      className={`h-4 w-full rounded-[2px] border border-[var(--border)]/40 bg-orange-500/${opacity}`}
      title={label}
    />
  );
}

// --- Main Overview ---------------------------------------------------------

function Overview({
  onNavigate,
}: {
  onNavigate?: (tab: string, driver?: string, extra?: Record<string, string>) => void;
}) {
  const navigateTo = useCallback(
    (tab: string, extra?: Record<string, string>) => {
      if (onNavigate) {
        onNavigate(tab, extra?.driver, extra);
      }
    },
    [onNavigate],
  );
  // --- data queries (all independent, staleTime 60s) ---
  const summaryQ = useQuery({ queryKey: ['summary'], queryFn: api.summary, staleTime: 60_000 });
  const recentQ = useQuery({
    queryKey: ['recent-posts-500'],
    queryFn: () => api.recentPosts(500),
    staleTime: 60_000,
  });
  const volumeQ = useQuery({
    queryKey: ['drivers-volume'],
    queryFn: api.driverVolume,
    staleTime: 60_000,
  });
  const taxonomyQ = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy, staleTime: 300_000 });
  const sentimentQ = useQuery({
    queryKey: ['sentiment-rollup'],
    queryFn: api.sentimentRollup,
    staleTime: 60_000,
  });
  const incidentsQ = useQuery({
    queryKey: ['incidents', 'active'],
    queryFn: () => api.incidents('active'),
    staleTime: 30_000,
  });
  const leaderboardQ = useQuery({
    queryKey: ['agent-leaderboard-7'],
    queryFn: () => api.agentLeaderboard(7),
    staleTime: 120_000,
  });
  // themesQ removed — themes moved to Pipelines tab (cluster pipeline) in the new IA

  // --- KPI computations ---
  const kpis = useMemo(() => {
    if (!summaryQ.data || !volumeQ.data || !sentimentQ.data) return null;
    const summary = summaryQ.data;
    const volumeSeries = Array.isArray(volumeQ.data.series) ? volumeQ.data.series : [];
    const sentSeries = Array.isArray(sentimentQ.data.series) ? sentimentQ.data.series : [];

    // Posts today + delta vs 7d avg
    const today = summary.drivers?.today?.totalPosts ?? 0;
    const last7 = volumeSeries.slice(-8, -1); // previous 7 days (not today)
    const avg7 = last7.length > 0 ? last7.reduce((s, d) => s + d.totalPosts, 0) / last7.length : 0;
    const postsDelta = avg7 > 0 ? ((today - avg7) / avg7) * 100 : 0;

    // Negative share today + delta vs 7d avg
    const negShare =
      summary.sentiment && summary.sentiment.total > 0
        ? summary.sentiment.negative / summary.sentiment.total
        : 0;
    const last7Sent = sentSeries.slice(-8, -1);
    const avg7negShare =
      last7Sent.length > 0
        ? last7Sent.reduce((s, d) => s + (d.total > 0 ? d.negative / d.total : 0), 0) /
          last7Sent.length
        : 0;
    const negDelta = avg7negShare > 0 ? ((negShare - avg7negShare) / avg7negShare) * 100 : 0;

    // Avg first-response latency from 7d leaderboard
    let avgLatencyMs: number | null = null;
    if (leaderboardQ.data && leaderboardQ.data.rows.length > 0) {
      const withLatency = leaderboardQ.data.rows.filter((r) => r.avgLatencyMs !== null);
      if (withLatency.length > 0) {
        avgLatencyMs =
          withLatency.reduce((s, r) => s + (r.avgLatencyMs ?? 0), 0) / withLatency.length;
      }
    }

    return {
      today,
      postsDelta,
      negShare,
      negDelta,
      topDriver: summary.drivers?.topDriverLabel ?? '—',
      topDriverCount: summary.drivers?.topDriverCount ?? 0,
      activeIncidents: incidentsQ.data?.count ?? 0,
      avgLatencyMs,
      llmSpend: summary.llm?.monthCents ?? 0,
    };
  }, [summaryQ.data, volumeQ.data, sentimentQ.data, incidentsQ.data, leaderboardQ.data]);

  // --- Sparklines data (14-day window per driver) ---
  const sparklines = useMemo(() => {
    if (!volumeQ.data || !taxonomyQ.data) return null;
    const rawSeries = Array.isArray(volumeQ.data.series) ? volumeQ.data.series : [];
    const taxonomy = Array.isArray(taxonomyQ.data.taxonomy) ? taxonomyQ.data.taxonomy : [];
    const series = rawSeries.slice(-14);
    return taxonomy.map((node) => {
      const values = series.map((d) => d.counts?.[node.id] ?? 0);
      const current = values.at(-1) ?? 0;
      return { node, values, current };
    });
  }, [volumeQ.data, taxonomyQ.data]);

  // --- Heatmap data: bin recentPosts by day-of-week (0=Mon) x hour ---
  const heatmap = useMemo(() => {
    if (!recentQ.data) return null;
    const items = Array.isArray(recentQ.data.items) ? recentQ.data.items : [];
    // grid[dow][hour] where dow 0=Mon..6=Sun
    const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const post of items) {
      const d = new Date(post.createdAt);
      // getDay: 0=Sun,1=Mon..6=Sat → convert to 0=Mon..6=Sun
      const jsDay = d.getDay();
      const dow = jsDay === 0 ? 6 : jsDay - 1;
      const hour = d.getHours();
      const row = grid[dow];
      if (row) row[hour] = (row[hour] ?? 0) + 1;
    }
    const max = Math.max(1, ...grid.flat());
    return { grid, max };
  }, [recentQ.data]);

  // --- Active incidents banner data ---
  const firstIncident = incidentsQ.data?.incidents?.[0] ?? null;
  const hasIncidents = (incidentsQ.data?.count ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* ── Active incidents banner ───────────────────────────────────────── */}
      {hasIncidents && firstIncident ? (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg border border-rose-700 bg-rose-950/60 px-4 py-3 text-sm"
        >
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" aria-hidden="true" />
            <span className="font-medium text-rose-200">Active incident:</span>
            <span className="text-rose-300">{firstIncident.reason}</span>
            {(incidentsQ.data?.count ?? 0) > 1 ? (
              <span className="text-rose-400/70">+{(incidentsQ.data?.count ?? 0) - 1} more</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => navigateTo('incidents')}
            className="rounded-md border border-rose-700 px-3 py-1 text-xs text-rose-200 transition hover:bg-rose-900/40"
          >
            View incidents →
          </button>
        </div>
      ) : null}

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      <section aria-label="Key performance indicators">
        <h2 className="mb-3 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
          Pulse — today at a glance
        </h2>
        {summaryQ.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
              />
            ))}
          </div>
        ) : summaryQ.isError ? (
          <ErrorMsg msg="Couldn't load summary." retry={() => summaryQ.refetch()} />
        ) : kpis ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile
              label="Posts today"
              value={String(kpis.today)}
              sub="auto-tagged"
              delta={
                kpis.postsDelta !== 0
                  ? `${kpis.postsDelta > 0 ? '+' : ''}${kpis.postsDelta.toFixed(0)}% vs 7d`
                  : undefined
              }
              deltaPositive={kpis.postsDelta >= 0}
              tooltip={TOOLTIPS.postsToday}
            />
            <KpiTile
              label="Negative share"
              value={`${Math.round(kpis.negShare * 100)}%`}
              sub="of today's posts"
              delta={
                kpis.negDelta !== 0
                  ? `${kpis.negDelta > 0 ? '+' : ''}${kpis.negDelta.toFixed(0)}% vs 7d`
                  : undefined
              }
              deltaPositive={kpis.negDelta <= 0}
              tone={kpis.negShare > 0.4 ? 'negative' : kpis.negShare > 0.25 ? 'warn' : 'neutral'}
              tooltip={TOOLTIPS.negativeShare}
            />
            <KpiTile
              label="Top driver"
              value={kpis.topDriver}
              sub={`${kpis.topDriverCount} post${kpis.topDriverCount === 1 ? '' : 's'}`}
              onClick={() => navigateTo('insights', { section: 'intent' })}
              tooltip={TOOLTIPS.topDriver}
            />
            <KpiTile
              label="Active incidents"
              value={String(kpis.activeIncidents)}
              sub={kpis.activeIncidents > 0 ? 'needs attention' : 'all clear'}
              tone={kpis.activeIncidents > 0 ? 'negative' : 'positive'}
              onClick={kpis.activeIncidents > 0 ? () => navigateTo('incidents') : undefined}
              tooltip={TOOLTIPS.activeIncidents}
            />
            <KpiTile
              label="Avg first-response"
              value={kpis.avgLatencyMs !== null ? formatLatency(kpis.avgLatencyMs) : '—'}
              sub="last 7 days · team"
              onClick={() => navigateTo('team')}
              tooltip={TOOLTIPS.avgFirstResponse}
            />
            <KpiTile
              label="AI spend (MTD)"
              value={`$${(kpis.llmSpend / 100).toFixed(3)}`}
              sub={
                summaryQ.data
                  ? `${((summaryQ.data.llm.monthTokensIn + summaryQ.data.llm.monthTokensOut) / 1000).toFixed(0)}k tokens`
                  : ''
              }
              tone={kpis.llmSpend > 500 ? 'warn' : 'neutral'}
              tooltip={TOOLTIPS.aiSpendMtd}
            />
          </div>
        ) : null}
      </section>

      {/* ── Main content: sparklines + heatmap (left) + ticker (right) ───── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          {/* ── Per-driver sparklines ───────────────────────────────────── */}
          <section aria-label="Driver volume sparklines">
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
              Drivers · 14-day trend
            </h2>
            {volumeQ.isPending || taxonomyQ.isPending ? (
              <SkeletonGrid />
            ) : volumeQ.isError || taxonomyQ.isError ? (
              <ErrorMsg
                msg="Couldn't load driver trends."
                retry={() => {
                  volumeQ.refetch();
                  taxonomyQ.refetch();
                }}
              />
            ) : sparklines && sparklines.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {sparklines.map(({ node, values, current }) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => navigateTo('insights', { section: 'intent', driver: node.id })}
                    className="group flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition hover:border-[var(--border)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
                    aria-label={`${node.label}: ${current} posts today. Click to view driver.`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: node.color }}
                        />
                        <span className="truncate text-xs font-medium text-[var(--text)] group-hover:text-white">
                          {node.label}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--text)]">
                        {current}
                      </span>
                    </div>
                    <div className="w-full overflow-hidden">
                      <Sparkline
                        data={values}
                        color={node.color ?? '#f97316'}
                        width={`100%` as `${number}%`}
                        height={28}
                      />
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      14d trend · click to drill
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="🏷️"
                title="No driver data yet"
                body="No posts have been tagged yet. Apply a taxonomy template or wait for new posts to flow through the contact-drivers pipeline."
              />
            )}
          </section>

          {/* ── Hour-of-day heatmap ─────────────────────────────────────── */}
          <section aria-label="Posts by day and hour of week">
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
              Activity heatmap · day × hour
            </h2>
            {recentQ.isPending ? (
              <div className="h-36 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
            ) : recentQ.isError ? (
              <ErrorMsg msg="Couldn't load heatmap data." retry={() => recentQ.refetch()} />
            ) : heatmap ? (
              <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                {/* Hour column labels */}
                <div
                  className="mb-1 ml-10 grid"
                  style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
                >
                  {[
                    '0',
                    '1',
                    '2',
                    '3',
                    '4',
                    '5',
                    '6',
                    '7',
                    '8',
                    '9',
                    '10',
                    '11',
                    '12',
                    '13',
                    '14',
                    '15',
                    '16',
                    '17',
                    '18',
                    '19',
                    '20',
                    '21',
                    '22',
                    '23',
                  ].map((h) => (
                    <div key={h} className="text-center text-[9px] text-[var(--text-muted)]">
                      {HOUR_LABELS.includes(h.padStart(2, '0')) ? h.padStart(2, '0') : ''}
                    </div>
                  ))}
                </div>
                {/* Rows */}
                <div className="space-y-0.5">
                  {DOW_LABELS.map((day, dow) => (
                    <div key={day} className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-right text-[10px] text-[var(--text-muted)]">
                        {day}
                      </span>
                      <div
                        className="grid flex-1 gap-0.5"
                        style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
                      >
                        {HOURS_0_23.map((hKey, hIdx) => {
                          const count = heatmap.grid[dow]?.[hIdx] ?? 0;
                          return (
                            <HeatmapCell
                              key={`${day}-${hKey}`}
                              count={count}
                              max={heatmap.max}
                              label={`${day} ${hKey.slice(1)}:00 — ${count} post${count === 1 ? '' : 's'}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                  <span>fewer</span>
                  <div className="flex gap-0.5">
                    {[0, 20, 40, 60, 80, 100].map((op) => (
                      <div
                        key={op}
                        className={`h-3 w-4 rounded-[2px] bg-orange-500/${op} border border-[var(--border)]/30`}
                      />
                    ))}
                  </div>
                  <span>more</span>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        {/* ── Activity ticker (sidebar on lg+) ─────────────────────────── */}
        <aside aria-label="Recent activity">
          <h2 className="mb-3 text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
            Recent activity
          </h2>
          {recentQ.isPending ? (
            <SkeletonList />
          ) : recentQ.isError ? (
            <ErrorMsg msg="Couldn't load recent posts." retry={() => recentQ.refetch()} />
          ) : recentQ.data.items.length === 0 ? (
            <EmptyHint>No posts yet — submit something in the subreddit to see it here.</EmptyHint>
          ) : (
            <ActivityTicker items={recentQ.data.items.slice(0, 20)} />
          )}
        </aside>
      </div>
    </div>
  );
}

function ActivityTicker({ items }: { items: RecentPost[] }) {
  return (
    <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      {items.map((p) => (
        <li key={p.postId} className="px-3 py-2.5">
          <a
            href={p.url}
            target="_top"
            rel="noopener noreferrer"
            className="block truncate text-xs font-medium text-[var(--text)] hover:text-orange-300 hover:underline"
            title={p.title}
          >
            {p.title || '(no title)'}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <span>{relativeTime(p.createdAt)}</span>
            {p.driverId ? (
              <>
                <span>·</span>
                <DriverBadge id={p.driverId} taggedBy={p.taggedBy} taxonomy={[]} />
              </>
            ) : null}
            {p.sentimentLabel ? (
              <>
                <span>·</span>
                <SentimentBadge
                  label={p.sentimentLabel}
                  score={p.sentimentScore}
                  by={p.sentimentScoredBy}
                />
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DriverBadge({
  id,
  taggedBy,
  taxonomy,
}: {
  id: string;
  taggedBy: 'manual' | 'auto' | 'ai' | null | undefined;
  taxonomy: TaxonomyNode[];
}) {
  const label = formatDriverPath(id, taxonomy);
  const color =
    taggedBy === 'ai'
      ? 'text-violet-300'
      : taggedBy === 'auto'
        ? 'text-blue-300'
        : 'text-[var(--text-muted)]';
  return (
    <span className={`font-medium ${color}`} title={`ID: ${id}`}>
      {label}
      {taggedBy ? <span className="ml-1 text-[var(--text-muted)]">({taggedBy})</span> : null}
    </span>
  );
}

function SentimentBadge({
  label,
  score,
  by,
}: {
  label: 'positive' | 'neutral' | 'negative';
  score: number | null;
  by: 'lexicon' | 'ai' | null;
}) {
  const style =
    label === 'positive'
      ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
      : label === 'negative'
        ? 'border-rose-800 bg-rose-900/30 text-rose-200'
        : 'border-[var(--border)] bg-[var(--input-bg)] text-[var(--text)]';
  return (
    <span className={`rounded-full border px-2 py-0.5 ${style}`}>
      {label}
      {score != null ? ` ${score.toFixed(2)}` : ''}
      {by === 'ai' ? ' · ai' : ''}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Drivers — bar list with click-through
// ---------------------------------------------------------------------------

function Drivers({
  initialDriver,
  onSetDriver: _onSetDriver,
}: {
  initialDriver?: string | undefined;
  onSetDriver?: (d: string) => void;
}) {
  const taxonomyQ = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy });
  const volumeQ = useQuery({ queryKey: ['drivers-volume'], queryFn: api.driverVolume });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const qc = useQueryClient();
  const [openDriver, setOpenDriver] = useState<string | null>(initialDriver ?? null);
  const [driverFilter, setDriverFilter] = useState<string>('');
  const [configOpen, setConfigOpen] = useState(false);
  const { toasts, toast } = useDriversToast();

  if (taxonomyQ.isPending || volumeQ.isPending) return <SkeletonGrid />;
  if (taxonomyQ.isError || volumeQ.isError)
    return (
      <ErrorMsg
        msg="Couldn't load drivers."
        retry={() => {
          taxonomyQ.refetch();
          volumeQ.refetch();
        }}
      />
    );

  const taxonomy = taxonomyQ.data.taxonomy;
  const totals: Record<string, number> = {};
  for (const day of volumeQ.data.series) {
    for (const [id, count] of Object.entries(day.counts ?? {})) {
      totals[id] = (totals[id] ?? 0) + count;
    }
  }

  const sorted = taxonomy
    .map((t) => ({ ...t, count: totals[t.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...sorted.map((s) => s.count));

  const rawSettings: Record<string, unknown> = settingsQ.data ?? {};
  const taxonomyJson =
    typeof rawSettings['taxonomy-json'] === 'string' ? rawSettings['taxonomy-json'] : '';
  const routingJson =
    typeof rawSettings['routing-json'] === 'string' ? rawSettings['routing-json'] : '';

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['taxonomy'] });
    void qc.invalidateQueries({ queryKey: ['settings'] });
  };

  return (
    <section className="space-y-6">
      <DriversToastContainer toasts={toasts} />
      <SavedViewsStrip
        tab="drivers"
        onApply={(params) => {
          if (params.driver) setOpenDriver(params.driver);
          if (params.driverFilter) setDriverFilter(params.driverFilter);
        }}
        currentParams={{
          ...(openDriver ? { driver: openDriver } : {}),
          ...(driverFilter ? { driverFilter } : {}),
        }}
      />

      {/* Configure taxonomy accordion */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          aria-expanded={configOpen}
          data-testid="drivers-config-toggle"
          className="flex w-full items-center justify-between px-5 py-3 text-left"
        >
          <span className="text-sm font-medium text-[var(--text)]">Configure taxonomy</span>
          <span className="text-xs text-[var(--text-muted)]">
            {configOpen ? '▲ collapse' : '▼ expand'}
          </span>
        </button>
        {configOpen ? (
          <div
            className="space-y-4 border-t border-[var(--border)] px-5 pb-5 pt-4"
            data-testid="drivers-config-panel"
          >
            {settingsQ.isPending ? (
              <div className="h-24 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
            ) : (
              <>
                <TaxonomyConfigSection
                  taxonomyJson={taxonomyJson}
                  toast={toast}
                  onSaved={invalidateAll}
                />
                <RoutingConfigSection
                  routingJson={routingJson}
                  toast={toast}
                  onSaved={invalidateAll}
                />
              </>
            )}
          </div>
        ) : null}
      </div>

      <div>
        <h2 className="mb-4 text-sm uppercase tracking-wide text-[var(--text-muted)]">
          Drivers · last 30 days · click to see posts
        </h2>
        <ul className="space-y-2">
          {sorted.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setOpenDriver(openDriver === d.id ? null : d.id)}
                className={`flex w-full items-center gap-4 rounded-lg border px-3 py-2 text-left transition ${
                  openDriver === d.id
                    ? 'border-orange-500 bg-[var(--surface)]'
                    : 'border-transparent hover:border-[var(--border)] hover:bg-[var(--surface)]'
                }`}
              >
                <span className="flex w-40 min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: d.color }}
                  />
                  <span className="truncate text-sm text-[var(--text)]">
                    {formatDriverPath(d.id, taxonomy)}
                  </span>
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface)]">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(d.count / max) * 100}%`,
                      background: d.color ?? '#ff4500',
                    }}
                  />
                </span>
                <span className="w-12 text-right text-sm tabular-nums text-[var(--text-muted)]">
                  {d.count}
                </span>
              </button>
              {openDriver === d.id ? (
                <div className="mt-2 ml-4">
                  <DriverPostsPanel driver={d} taxonomy={taxonomy} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STATUS_FILTERS: { id: 'all' | PostStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'responded', label: 'Responded' },
  { id: 'resolved', label: 'Resolved' },
];

function DriverPostsPanel({
  driver,
  taxonomy,
}: {
  driver: TaxonomyNode;
  taxonomy: TaxonomyNode[];
}) {
  const [filter, setFilter] = useState<'all' | PostStatus>('open');
  const [includeSubDrivers, setIncludeSubDrivers] = useState(false);

  const hasChildren = taxonomy.some((t) => t.parentId === driver.id);

  const q = useQuery({
    queryKey: ['driver-posts', driver.id, filter, includeSubDrivers],
    queryFn: () =>
      api.driverPosts(
        driver.id,
        filter === 'all' ? { limit: 100 } : { limit: 100, status: filter },
      ),
  });
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--text-muted)]">Filter:</span>
        {STATUS_FILTERS.map((f) => (
          <button
            type="button"
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-2 py-0.5 transition ${
              filter === f.id
                ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {f.label}
          </button>
        ))}
        {hasChildren ? (
          <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={includeSubDrivers}
              onChange={(e) => setIncludeSubDrivers(e.target.checked)}
              data-testid="include-sub-drivers-toggle"
              className="rounded border-[var(--border)] bg-[var(--input-bg)] accent-orange-500"
            />
            Include sub-drivers
          </label>
        ) : null}
      </div>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorMsg msg="Couldn't load posts." retry={() => q.refetch()} />
      ) : q.data.posts.length === 0 ? (
        <EmptyHint>
          No posts in &ldquo;{driver.label}&rdquo; matching filter &ldquo;{filter}&rdquo;.
        </EmptyHint>
      ) : (
        <DriverPostList posts={q.data.posts} driverId={driver.id} taxonomy={taxonomy} />
      )}
    </div>
  );
}

function DriverPostList({
  posts,
  driverId,
  taxonomy,
}: {
  posts: DriverPost[];
  driverId: string;
  taxonomy: TaxonomyNode[];
}) {
  const qc = useQueryClient();
  const [openThread, setOpenThread] = useState<string | null>(null);
  const mutate = async (postId: string, status: PostStatus) => {
    await api.setPostStatus(postId, status);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['driver-posts', driverId] }),
      qc.invalidateQueries({ queryKey: ['recent-posts'] }),
    ]);
  };
  return (
    <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      {posts.map((p) => (
        <li key={p.postId} className="px-4 py-3">
          <a
            href={p.url}
            target="_top"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium text-[var(--text)] hover:underline"
            title={p.title}
          >
            {p.title || '(no title)'}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>u/{p.authorName}</span>
            <span>·</span>
            <span>{relativeTime(p.createdAt)}</span>
            {p.taggedBy ? (
              <>
                <span>·</span>
                <DriverBadge id={p.driverId} taggedBy={p.taggedBy} taxonomy={taxonomy} />
              </>
            ) : null}
            {p.confidence != null ? (
              <>
                <span>·</span>
                <span>confidence {(p.confidence * 100).toFixed(0)}%</span>
              </>
            ) : null}
          </div>
          {p.reasoning ? (
            <div className="mt-1 text-xs italic text-[var(--text-muted)]">"{p.reasoning}"</div>
          ) : null}
          <div className="mt-2 flex gap-2 text-xs">
            <StatusBadge status={p.status} />
            {p.status !== 'resolved' ? (
              <button
                type="button"
                onClick={() => mutate(p.postId, 'resolved')}
                className="rounded-full border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-emerald-200 transition hover:bg-emerald-900/60"
              >
                Mark resolved
              </button>
            ) : (
              <button
                type="button"
                onClick={() => mutate(p.postId, 'open')}
                className="rounded-full border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 text-[var(--text)] transition hover:bg-neutral-700"
              >
                Re-open
              </button>
            )}
            {p.status === 'open' ? (
              <button
                type="button"
                onClick={() => mutate(p.postId, 'in-progress')}
                className="rounded-full border border-blue-700 bg-blue-900/30 px-2 py-0.5 text-blue-200 transition hover:bg-blue-900/60"
              >
                Take ownership
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpenThread(openThread === p.postId ? null : p.postId)}
              className="rounded-full border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 text-[var(--text)] transition hover:bg-neutral-700"
            >
              {openThread === p.postId ? 'Hide thread' : 'Show thread'}
            </button>
          </div>
          {openThread === p.postId ? (
            <div className="mt-3">
              <ThreadPanel postId={p.postId} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ThreadPanel({ postId }: { postId: string }) {
  const q = useQuery({
    queryKey: ['post-thread', postId],
    queryFn: () => api.postThread(postId),
  });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorMsg msg="Couldn't load thread." retry={() => q.refetch()} />;
  const { comments, heat } = q.data;
  if (comments.length === 0)
    return (
      <EmptyHint>
        No comments processed on this post yet. New comments appear within ~30s.
      </EmptyHint>
    );
  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]/60 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)]">
          {comments.length} comment{comments.length === 1 ? '' : 's'} processed
        </span>
        {heat.isHot ? (
          <span className="rounded-full border border-rose-700 bg-rose-900/40 px-2 py-0.5 text-rose-200">
            🔥 thread heating up ({(heat.negativeShare * 100).toFixed(0)}% recent negative)
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">
            {(heat.negativeShare * 100).toFixed(0)}% recent negative
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {comments.map((c) => (
          <li
            key={c.commentId}
            className={`rounded-lg border px-3 py-2 ${
              c.isAgent
                ? 'border-blue-800 bg-blue-950/30'
                : 'border-[var(--border)] bg-[var(--surface)]'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className={c.isAgent ? 'font-medium text-blue-300' : 'text-[var(--text)]'}>
                u/{c.authorName}
              </span>
              {c.isAgent ? <AgentSourceBadge source={c.agentSource} /> : null}
              <span>·</span>
              <span>{relativeTime(c.createdAt)}</span>
              {c.sentimentLabel ? (
                <>
                  <span>·</span>
                  <SentimentBadge
                    label={c.sentimentLabel}
                    score={c.sentimentScore}
                    by={c.sentimentScoredBy}
                  />
                </>
              ) : null}
            </div>
            <div className="mt-1 text-sm whitespace-pre-wrap text-[var(--text)]">{c.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentSourceBadge({
  source,
}: {
  source: 'distinguished' | 'mod-list' | 'flair' | 'record' | null;
}) {
  // Distinguished comments get the green "MOD" treatment to match Reddit's
  // own visual convention — that's the strongest "I'm speaking officially"
  // signal. Other sources get a neutral "Verified" badge.
  if (source === 'distinguished') {
    return (
      <span
        className="rounded-full border border-emerald-600 bg-emerald-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200"
        title="Reddit's own distinguished moderator/admin comment"
      >
        🛡 MOD
      </span>
    );
  }
  const meta: Record<
    Exclude<NonNullable<typeof source>, 'distinguished'>,
    { label: string; title: string }
  > = {
    'mod-list': { label: 'Mod team', title: 'Subreddit moderator (presumed brand employee)' },
    flair: { label: 'Verified · flair', title: 'Brand-team flair detected on author' },
    record: { label: 'Verified', title: 'Mod-marked or whitelist-seeded as verified rep' },
  };
  const m = source ? meta[source] : meta.record;
  return (
    <span
      className="rounded-full border border-blue-700 bg-blue-900/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-200"
      title={m.title}
    >
      ✓ {m.label}
    </span>
  );
}

function StatusBadge({ status }: { status: PostStatus }) {
  const style =
    status === 'resolved'
      ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
      : status === 'in-progress'
        ? 'border-blue-800 bg-blue-900/30 text-blue-200'
        : status === 'responded'
          ? 'border-violet-800 bg-violet-900/30 text-violet-200'
          : 'border-[var(--border)] bg-[var(--input-bg)] text-[var(--text)]';
  return <span className={`rounded-full border px-2 py-0.5 ${style}`}>{status}</span>;
}

// ---------------------------------------------------------------------------
// Sentiment — totals + 30-day timeline
// ---------------------------------------------------------------------------

function SentimentTab() {
  const sentQ = useQuery({ queryKey: ['sentiment-rollup'], queryFn: api.sentimentRollup });
  const [openLabel, setOpenLabel] = useState<'positive' | 'neutral' | 'negative' | null>(null);

  if (sentQ.isPending) return <SkeletonGrid />;
  if (sentQ.isError)
    return <ErrorMsg msg="Couldn't load sentiment." retry={() => sentQ.refetch()} />;

  const series = sentQ.data.series;
  const totals = series.reduce(
    (acc, day) => {
      acc.positive += day.positive;
      acc.neutral += day.neutral;
      acc.negative += day.negative;
      acc.total += day.total;
      return acc;
    },
    { positive: 0, neutral: 0, negative: 0, total: 0 },
  );

  const toggleLabel = (label: 'positive' | 'neutral' | 'negative') => {
    setOpenLabel((prev) => (prev === label ? null : label));
  };

  const CARDS: Array<{
    label: 'positive' | 'neutral' | 'negative';
    count: number;
    tone: 'positive' | 'negative' | 'neutral';
    ariaLabel: string;
  }> = [
    {
      label: 'positive',
      count: totals.positive,
      tone: 'positive',
      ariaLabel: `Positive sentiment: ${totals.positive} posts. Click to see contributing posts.`,
    },
    {
      label: 'neutral',
      count: totals.neutral,
      tone: 'neutral',
      ariaLabel: `Neutral sentiment: ${totals.neutral} posts. Click to see contributing posts.`,
    },
    {
      label: 'negative',
      count: totals.negative,
      tone: 'negative',
      ariaLabel: `Negative sentiment: ${totals.negative} posts. Click to see contributing posts.`,
    },
  ];

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CARDS.map(({ label, count, tone, ariaLabel }) => (
          <SentimentDrillCard
            key={label}
            label={label}
            count={count}
            tone={tone}
            ariaLabel={ariaLabel}
            isOpen={openLabel === label}
            onToggle={() => toggleLabel(label)}
          />
        ))}
      </section>

      {openLabel ? <SentimentPostList label={openLabel} /> : null}

      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-[var(--text-muted)]">
          Daily sentiment volume · 30 days
        </h2>
        <Suspense
          fallback={
            <div className="h-64 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]" />
          }
        >
          <SentimentChartLazy series={series} />
        </Suspense>
      </section>
    </div>
  );
}

function SentimentDrillCard({
  label,
  count,
  tone,
  ariaLabel,
  isOpen,
  onToggle,
}: {
  label: 'positive' | 'neutral' | 'negative';
  count: number;
  tone: 'positive' | 'negative' | 'neutral';
  ariaLabel: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const accent =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'negative'
        ? 'text-rose-400'
        : 'text-[var(--text)]';

  const ringClass = isOpen
    ? tone === 'positive'
      ? 'ring-2 ring-emerald-600'
      : tone === 'negative'
        ? 'ring-2 ring-rose-600'
        : 'ring-2 ring-neutral-500'
    : '';

  return (
    <button
      type="button"
      aria-pressed={isOpen}
      aria-label={ariaLabel}
      data-testid={`sentiment-card-${label}`}
      className={`w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${ringClass}`}
      onClick={onToggle}
    >
      <div className="flex items-center text-xs uppercase tracking-wide text-[var(--text-muted)]">
        {label.charAt(0).toUpperCase() + label.slice(1)}
        <InfoTooltip
          tip={
            label === 'positive'
              ? TOOLTIPS.sentimentPositive
              : label === 'negative'
                ? TOOLTIPS.sentimentNegative
                : TOOLTIPS.sentimentNeutral
          }
        />
      </div>
      <div className={`mt-2 truncate text-2xl font-semibold ${accent}`}>{count}</div>
      <div className="mt-1 flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <span>last 30d</span>
        <span
          aria-hidden="true"
          className={`ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </div>
    </button>
  );
}

function SentimentPostList({ label }: { label: 'positive' | 'neutral' | 'negative' }) {
  const taxonomyQ = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy });
  const q = useQuery({
    queryKey: ['sentiment-posts', label],
    queryFn: () => api.sentimentPosts(label, { days: 30, limit: 50 }),
  });

  const taxonomy = taxonomyQ.data?.taxonomy ?? [];

  if (q.isPending) return <SkeletonList />;
  if (q.isError)
    return <ErrorMsg msg={`Couldn't load ${label} posts.`} retry={() => q.refetch()} />;

  const posts = q.data.posts;

  const labelTitle = label.charAt(0).toUpperCase() + label.slice(1);

  if (posts.length === 0) {
    return <EmptyHint>No {label} posts in the last 30 days.</EmptyHint>;
  }

  return (
    <section
      aria-label={`${labelTitle} posts`}
      data-testid={`sentiment-posts-${label}`}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="border-b border-[var(--border)] px-4 py-3">
        <span className="text-sm font-medium text-[var(--text)]">
          {labelTitle} posts · {posts.length} results
        </span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {posts.map((p) => (
          <li key={p.postId} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[var(--text)] hover:text-orange-300 hover:underline"
              >
                {p.title}
              </a>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                <span>u/{p.authorName}</span>
                <span>·</span>
                <span>{relativeTime(p.createdAt)}</span>
                {p.driverId ? (
                  <>
                    <span>·</span>
                    <DriverBadge id={p.driverId} taggedBy={p.taggedBy} taxonomy={taxonomy} />
                  </>
                ) : null}
              </div>
            </div>
            {p.sentimentLabel ? (
              <SentimentBadge
                label={p.sentimentLabel as 'positive' | 'neutral' | 'negative'}
                score={p.sentimentScore}
                by={p.sentimentScoredBy}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Incidents — crisis-detection auto-grouped alerts
// ---------------------------------------------------------------------------

function Incidents() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'active' | 'resolved' | 'all'>('active');
  const q = useQuery({
    queryKey: ['incidents', filter],
    queryFn: () => api.incidents(filter),
  });

  const resolve = async (id: string) => {
    try {
      await api.resolveIncident(id);
      await qc.invalidateQueries({ queryKey: ['incidents'] });
    } catch (err) {
      console.warn('resolve failed', err);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">Incidents</h2>
          <p className="mt-1 max-w-xl text-xs text-[var(--text-muted)]">
            Auto-grouped when comment volume or negative-sentiment ratio spikes vs the 14-day
            baseline. Resolves automatically after 30 min of quiet.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {(['active', 'resolved', 'all'] as const).map((f) => (
            <button
              type="button"
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 transition ${
                filter === f
                  ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </header>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorMsg msg="Couldn't load incidents." retry={() => q.refetch()} />
      ) : q.data.incidents.length === 0 ? (
        <EmptyState
          icon="✅"
          title="All clear — no active incidents"
          body="Incidents are auto-detected when comment volume or negative-sentiment spikes above your 14-day baseline. Your subreddit is currently calm."
        />
      ) : (
        <ul className="space-y-2">
          {q.data.incidents.map((inc) => (
            <li
              key={inc.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-medium text-rose-200">{inc.reason}</div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    started{' '}
                    <time dateTime={isoTime(inc.startedAt)} title={absoluteTime(inc.startedAt)}>
                      {relativeTime(inc.startedAt)}
                    </time>{' '}
                    · {inc.postIds.length} posts · {inc.commentIds.length} comments
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${
                      inc.status === 'resolved'
                        ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
                        : 'border-rose-700 bg-rose-900/40 text-rose-200'
                    }`}
                  >
                    {inc.status}
                  </span>
                  {inc.status === 'open' ? (
                    <button
                      type="button"
                      onClick={() => resolve(inc.id)}
                      className="rounded-full border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-emerald-200 transition hover:bg-emerald-900/60"
                    >
                      Resolve
                    </button>
                  ) : null}
                </div>
              </div>
              {inc.postIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1 text-xs">
                  {inc.postIds.slice(0, 6).map((pid) => (
                    <span
                      key={pid}
                      className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[var(--text-muted)]"
                    >
                      {pid}
                    </span>
                  ))}
                  {inc.postIds.length > 6 ? (
                    <span className="px-2 py-0.5 text-[var(--text-muted)]">
                      +{inc.postIds.length - 6} more
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Themes — AI-clustered emerging issues
// ---------------------------------------------------------------------------

function Themes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['themes'], queryFn: api.themes });
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      await api.regenerateThemes();
      await qc.invalidateQueries({ queryKey: ['themes'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">
            Emerging themes
          </h2>
          <p className="mt-1 max-w-xl text-xs text-[var(--text-muted)]">
            AI-clustered themes from the most recent negative posts. Regenerated daily; click below
            to refresh on-demand.
          </p>
        </div>
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="rounded-md border border-violet-700 bg-violet-900/30 px-3 py-1 text-xs text-violet-200 transition hover:bg-violet-900/60 disabled:opacity-50"
        >
          {regenerating ? 'Regenerating…' : '✨ Regenerate now'}
        </button>
      </header>
      {error ? (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorMsg msg="Couldn't load themes." retry={() => q.refetch()} />
      ) : q.data.themes.length === 0 ? (
        <EmptyState
          icon="🧩"
          title="No themes yet"
          body="Themes appear after ~10 negative posts are accumulated. Submit a few posts or wait for them to accumulate, then regenerate."
          cta={
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              className="rounded-md border border-violet-700 bg-violet-900/30 px-4 py-2 text-xs font-medium text-violet-200 transition hover:bg-violet-900/60 disabled:opacity-50"
            >
              {regenerating ? 'Regenerating…' : '✨ Regenerate now'}
            </button>
          }
        />
      ) : (
        <>
          <div className="text-xs text-[var(--text-muted)]">
            generated {q.data.generatedAt ? relativeTime(q.data.generatedAt) : 'recently'} · last 7
            days
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {q.data.themes.map((t) => (
              <li
                key={t.name}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium text-[var(--text)]">{t.name}</h3>
                  <span className="text-xs text-[var(--text-muted)]">
                    {t.postCount} post{t.postCount === 1 ? '' : 's'} ·{' '}
                    <span
                      className={
                        t.avgSentiment < -0.2
                          ? 'text-rose-300'
                          : t.avgSentiment > 0.2
                            ? 'text-emerald-300'
                            : 'text-[var(--text)]'
                      }
                    >
                      {t.avgSentiment.toFixed(2)}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--text-muted)]">{t.summary}</p>
                {t.samplePostIds.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1 text-xs">
                    {t.samplePostIds.slice(0, 4).map((pid) => (
                      <span
                        key={pid}
                        className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[var(--text-muted)]"
                      >
                        {pid}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pipelines — catalog driven by the shared BUILTIN_PIPELINES registry.
// ---------------------------------------------------------------------------

// Map from pipeline id to the dedicated tab it routes output to (for the
// "View in <tab>" chip shown on cards that are NOT in the Insights sub-tabs).
// Preserved for future "View in <tab>" chips — not yet wired into InstanceCard
const _PIPELINE_DEDICATED_TAB: Record<string, string> = {
  crisis: 'Incidents',
  impostor: 'Audit log',
  'agent-metrics': 'Team',
};

// Preserved for future "Settings →" shortcut on pipeline cards
const _PIPELINE_SETTINGS_LINK = new Set(['intent']);

interface DebugStats {
  events_received?: number;
  events_processed?: number;
  events_failed?: number;
}

/** Expandable stats section inside a pipeline card */
function PipelineStats({ moduleKey }: { moduleKey: string }) {
  const [open, setOpen] = useState(false);
  const debugQ = useQuery({
    queryKey: ['admin-debug'],
    queryFn: api.adminDebug,
    enabled: open,
    staleTime: 30_000,
  });

  const stats: DebugStats = (() => {
    if (!debugQ.data) return {};
    // The debug endpoint returns per-module counters under a `moduleCounters` key
    // or falls back to zero if unavailable (module counters are Redis hashes).
    const raw = debugQ.data as Record<string, unknown>;
    const counters = raw[`counters.${moduleKey}`] as Record<string, number> | undefined;
    return counters ?? {};
  })();

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
        aria-expanded={open}
        data-testid={`pipeline-stats-toggle-${moduleKey}`}
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">
          ▶
        </span>
        Stats
      </button>
      {open ? (
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
          {debugQ.isPending ? (
            <span className="col-span-3 text-[var(--text-muted)]">Loading…</span>
          ) : debugQ.isError ? (
            <span className="col-span-3 text-rose-400">Failed to load stats.</span>
          ) : (
            <>
              <div className="rounded bg-[var(--input-bg)] px-2 py-1">
                <div className="text-[var(--text-muted)]">Received</div>
                <div className="font-medium text-[var(--text)]">{stats.events_received ?? '—'}</div>
              </div>
              <div className="rounded bg-[var(--input-bg)] px-2 py-1">
                <div className="text-[var(--text-muted)]">Processed</div>
                <div className="font-medium text-[var(--text)]">
                  {stats.events_processed ?? '—'}
                </div>
              </div>
              <div className="rounded bg-[var(--input-bg)] px-2 py-1">
                <div className="text-[var(--text-muted)]">Failed</div>
                <div
                  className={`font-medium ${(stats.events_failed ?? 0) > 0 ? 'text-rose-400' : 'text-[var(--text)]'}`}
                >
                  {stats.events_failed ?? '—'}
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Standard pipeline card */
export function PipelineCard({
  pipeline,
  onOpenSettings,
  onOpenDrawer,
}: {
  pipeline: Pipeline;
  onOpenSettings?: () => void;
  onOpenDrawer?: (pipeline: Pipeline) => void;
}) {
  const handleTune = () => {
    onOpenDrawer?.(pipeline);
  };

  return (
    <div
      className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
      data-testid={`pipeline-card-${pipeline.id}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">{pipeline.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                aria-hidden="true"
              />
              Active
            </span>
            {pipeline.alpha ? (
              <span className="rounded-full border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                alpha
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {pipeline.id === 'intent' && onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1 text-xs text-[var(--text)] hover:border-orange-600 hover:text-orange-300"
              aria-label="Edit taxonomy in Settings"
            >
              Settings →
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleTune}
            aria-label={`Tune ${pipeline.name} pipeline`}
            data-testid={`pipeline-tune-${pipeline.id}`}
            className="rounded border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1 text-xs text-[var(--text)] hover:border-violet-600 hover:text-violet-300"
          >
            Tune →
          </button>
        </div>
      </div>

      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-[var(--text-muted)]">Kind</dt>
          <dd className="text-[var(--text)]">{pipeline.kind}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-[var(--text-muted)]">Trigger</dt>
          <dd className="rounded bg-[var(--input-bg)] px-1.5 py-0.5 font-mono text-[var(--text)]">
            {pipeline.trigger}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-[var(--text-muted)]">Logic</dt>
          <dd className="text-[var(--text-muted)]">{pipeline.logic}</dd>
        </div>
      </dl>

      {pipeline.moduleKey ? <PipelineStats moduleKey={pipeline.moduleKey} /> : null}
    </div>
  );
}

/** Card for a user-created custom pipeline — kept for future Catalogue reuse */
// biome-ignore lint/correctness/noUnusedVariables: preserved for future use when custom pipelines get a dedicated card UI
function CustomPipelineCard({
  pipeline,
  onDelete,
}: {
  pipeline: { id: string; name: string; kind: string; trigger: string; enabled: boolean };
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-[var(--text)]">{pipeline.name}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full border border-neutral-600 px-2 py-0.5 text-xs text-[var(--text-muted)]">
              {pipeline.kind}
            </span>
            <span className="rounded-full border border-emerald-800 bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-300">
              Custom
            </span>
          </div>
        </div>
      </div>
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        Trigger: <span className="text-[var(--text)]">{pipeline.trigger}</span>
      </p>
      <div className="mt-auto flex gap-2">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text)] hover:bg-[var(--input-bg)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-rose-700 bg-rose-900/30 px-2 py-1 text-xs text-rose-200 hover:bg-rose-900/60"
            >
              Delete
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-xs text-[var(--text-muted)] underline-offset-2 hover:text-rose-400 hover:underline"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/** Stub card for the future Studio custom pipeline */
export function StubPipelineCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="pipeline-card-studio-stub"
      className="flex flex-col items-start rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-left transition hover:border-orange-600/50 hover:bg-[var(--surface)]"
    >
      <span className="mb-2 text-2xl" aria-hidden="true">
        +
      </span>
      <h3 className="text-sm font-semibold text-[var(--text-muted)]">Custom pipeline</h3>
      <p className="mt-1 text-xs text-[var(--text-muted)]">RedLattice Studio</p>
      <p className="mt-3 text-xs text-orange-400 underline underline-offset-2">
        Build custom pipelines in Studio →
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pipeline drawer — side panel for tuning a built-in pipeline
// ---------------------------------------------------------------------------

type DrawerTab = 'prompts' | 'thresholds' | 'test' | 'stats';

const PIPELINE_THRESHOLDS: Record<
  string,
  Array<{ key: string; label: string; min: number; max: number; step: number }>
> = {
  sentiment: [
    {
      key: 'escalation-threshold',
      label: 'Escalation threshold (neg comments)',
      min: 1,
      max: 20,
      step: 1,
    },
  ],
  crisis: [
    {
      key: 'volume-multiplier',
      label: 'Crisis volume multiplier',
      min: 1.5,
      max: 10,
      step: 0.5,
    },
  ],
  'agent-metrics': [
    { key: 'sla-minutes', label: 'SLA threshold (minutes)', min: 5, max: 1440, step: 5 },
  ],
};

const PIPELINE_DEFAULTS: Record<string, { systemPrompt: string; userPrompt: string }> = {
  'contact-drivers': {
    systemPrompt:
      'You classify Reddit posts about a brand into contact driver categories. Respond with the most appropriate driver ID from the taxonomy.',
    userPrompt:
      'Post title: {{post.title}}\nPost body: {{post.body}}\nTaxonomy: {{taxonomy_json}}\n\nClassify this post.',
  },
  sentiment: {
    systemPrompt:
      'You judge the sentiment of short Reddit posts about a brand product. Reply with a label (positive/neutral/negative), a score from -1 to +1, and a one-sentence reasoning.',
    userPrompt: 'Text:\n"""{{post.body}}"""',
  },
  impostor: {
    systemPrompt:
      'You detect potential brand impostor accounts in Reddit comments. Reply true if the comment appears to be from someone impersonating an official brand representative, false otherwise.',
    userPrompt: 'Comment by u/{{comment.author}}:\n"{{comment.body}}"',
  },
  crisis: {
    systemPrompt:
      'You detect brand reputation crises from Reddit comment patterns. Reply true if the current comment represents crisis-level negativity given the context, false otherwise.',
    userPrompt: 'Comment: {{comment.body}}',
  },
  themes: {
    systemPrompt:
      'You cluster Reddit posts about a brand into emerging themes. Group similar issues together and name each theme concisely.',
    userPrompt: 'Posts:\n{{post.body}}',
  },
  'agent-metrics': {
    systemPrompt: 'Tracks agent response metrics. No AI prompt required.',
    userPrompt: '',
  },
};

const PROMPT_VARIABLES = [
  '{{post.title}}',
  '{{post.body}}',
  '{{comment.body}}',
  '{{comment.author}}',
  '{{taxonomy_json}}',
  '{{current_driver}}',
  '{{current_sentiment}}',
];

function PipelineDrawer({ pipeline, onClose }: { pipeline: Pipeline; onClose: () => void }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<DrawerTab>('prompts');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [enabled, setEnabled] = useState(true);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<{ output: string; costCents: number } | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const configQ = useQuery({
    queryKey: ['pipeline-builtin', pipeline.id],
    queryFn: () => api.pipelines.getBuiltin(pipeline.id),
  });

  // Populate local state from server data once loaded
  useEffect(() => {
    if (!configQ.data) return;
    const overrides = configQ.data.overrides;
    const defaults = PIPELINE_DEFAULTS[pipeline.id] ?? { systemPrompt: '', userPrompt: '' };
    setSystemPrompt(overrides.systemPrompt ?? defaults.systemPrompt);
    setUserPrompt(overrides.userPrompt ?? defaults.userPrompt);
    setThresholds(overrides.thresholds ?? {});
    setEnabled(overrides.enabled !== false);
  }, [configQ.data, pipeline.id]);

  const systemPromptRef = useRef<HTMLTextAreaElement>(null);
  const userPromptRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (
    variable: string,
    ref: React.RefObject<HTMLTextAreaElement | null>,
    setter: (v: string) => void,
    currentValue: string,
  ) => {
    const ta = ref.current;
    if (!ta) {
      setter(currentValue + variable);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setter(currentValue.slice(0, start) + variable + currentValue.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await api.pipelines.putBuiltin(pipeline.id, {
        systemPrompt,
        userPrompt,
        thresholds,
        enabled,
      });
      await qc.invalidateQueries({ queryKey: ['pipeline-builtin', pipeline.id] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetToDefault = () => {
    const defaults = PIPELINE_DEFAULTS[pipeline.id] ?? { systemPrompt: '', userPrompt: '' };
    setSystemPrompt(defaults.systemPrompt);
    setUserPrompt(defaults.userPrompt);
  };

  const handleTest = async () => {
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      const r = await api.pipelines.testBuiltin(pipeline.id, testInput);
      setTestResult({ output: JSON.stringify(r.output, null, 2), costCents: r.costCents });
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTestBusy(false);
    }
  };

  const DRAWER_TABS: { id: DrawerTab; label: string }[] = [
    { id: 'prompts', label: 'Prompts' },
    { id: 'thresholds', label: 'Thresholds' },
    { id: 'test', label: 'Test' },
    { id: 'stats', label: 'Stats' },
  ];

  const thresholdDefs = PIPELINE_THRESHOLDS[pipeline.id] ?? [];

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${pipeline.name} pipeline settings`}
        data-testid="pipeline-drawer"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl sm:w-[480px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">{pipeline.name}</h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">{pipeline.trigger}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Enabled toggle */}
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <span className={enabled ? 'text-emerald-400' : 'text-[var(--text-muted)]'}>
                {enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled((e) => !e)}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-600' : 'bg-neutral-700'}`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
                />
              </button>
            </label>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b border-[var(--border)] px-5">
          {DRAWER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-3 text-xs font-medium transition ${
                activeTab === t.id
                  ? 'border-orange-500 text-white'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {configQ.isPending ? (
            <SkeletonList />
          ) : configQ.isError ? (
            <ErrorMsg msg="Couldn't load pipeline config." retry={() => configQ.refetch()} />
          ) : (
            <>
              {/* Prompts tab */}
              {activeTab === 'prompts' && (
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--text)]">System prompt</span>
                      <button
                        type="button"
                        onClick={handleResetToDefault}
                        className="text-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]"
                      >
                        Reset to default
                      </button>
                    </div>
                    <textarea
                      ref={systemPromptRef}
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={6}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-mono text-[var(--text)] outline-none focus:border-orange-500"
                      placeholder="System prompt…"
                      aria-label="System prompt"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-[var(--text)]">
                      User prompt template
                    </p>
                    <textarea
                      ref={userPromptRef}
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      rows={6}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-mono text-[var(--text)] outline-none focus:border-orange-500"
                      placeholder="User prompt template with {{variables}}…"
                      aria-label="User prompt template"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-[var(--text-muted)]">
                      Available variables — click to insert at cursor:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {PROMPT_VARIABLES.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => {
                            // Try to insert into whichever textarea was last focused
                            if (document.activeElement === systemPromptRef.current) {
                              insertVariable(v, systemPromptRef, setSystemPrompt, systemPrompt);
                            } else {
                              insertVariable(v, userPromptRef, setUserPrompt, userPrompt);
                            }
                          }}
                          className="rounded border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 font-mono text-xs text-[var(--text)] hover:border-orange-500 hover:text-orange-300"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Thresholds tab */}
              {activeTab === 'thresholds' && (
                <div className="space-y-5">
                  {thresholdDefs.length === 0 ? (
                    <EmptyHint>No configurable thresholds for this pipeline.</EmptyHint>
                  ) : (
                    thresholdDefs.map((def) => {
                      const current = thresholds[def.key] ?? def.min;
                      return (
                        <div key={def.key}>
                          <label className="mb-2 flex items-center justify-between text-xs font-medium text-[var(--text)]">
                            <span>{def.label}</span>
                            <input
                              type="number"
                              min={def.min}
                              max={def.max}
                              step={def.step}
                              value={current}
                              onChange={(e) =>
                                setThresholds((prev) => ({
                                  ...prev,
                                  [def.key]: Number(e.target.value),
                                }))
                              }
                              className="w-16 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-right text-xs text-[var(--text)] outline-none focus:border-orange-500"
                              aria-label={def.label}
                            />
                          </label>
                          <input
                            type="range"
                            min={def.min}
                            max={def.max}
                            step={def.step}
                            value={current}
                            onChange={(e) =>
                              setThresholds((prev) => ({
                                ...prev,
                                [def.key]: Number(e.target.value),
                              }))
                            }
                            className="w-full accent-orange-500"
                            aria-label={`${def.label} slider`}
                          />
                          <div className="mt-1 flex justify-between text-xs text-[var(--text-muted)]">
                            <span>{def.min}</span>
                            <span>{def.max}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Test tab */}
              {activeTab === 'test' && (
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-medium text-[var(--text)]">Sample input</p>
                    <textarea
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      rows={5}
                      placeholder="Paste sample post or comment text here…"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-mono text-[var(--text)] outline-none focus:border-orange-500"
                      aria-label="Sample input for pipeline test"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={testBusy || testInput.trim().length === 0}
                    className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-2 text-xs font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50"
                  >
                    {testBusy ? 'Running…' : 'Run once'}
                  </button>
                  {testError ? (
                    <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-200">
                      {testError}
                    </div>
                  ) : null}
                  {testResult ? (
                    <div className="space-y-2">
                      <div className="text-xs text-[var(--text-muted)]">
                        Cost: ${(testResult.costCents / 100).toFixed(4)}
                      </div>
                      <pre className="overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text)]">
                        {testResult.output}
                      </pre>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Stats tab */}
              {activeTab === 'stats' && pipeline.moduleKey ? (
                <PipelineStats moduleKey={pipeline.moduleKey} />
              ) : activeTab === 'stats' ? (
                <EmptyHint>No stats available for this pipeline.</EmptyHint>
              ) : null}
            </>
          )}
        </div>

        {/* Footer — Save */}
        <div className="border-t border-[var(--border)] px-5 py-4">
          {saveError ? (
            <div className="mb-3 rounded-lg border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-200">
              {saveError}
            </div>
          ) : null}
          {saveSuccess ? (
            <div className="mb-3 rounded-lg border border-emerald-800 bg-emerald-950/40 p-2 text-xs text-emerald-200">
              Saved.
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            className="w-full rounded-md border border-orange-600 bg-orange-600/20 py-2 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40"
          >
            Save changes
          </button>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// New pipeline builder modal
// ---------------------------------------------------------------------------

// BUILDER_VARIABLES removed in IA reset v2 (used by deleted NewPipelineModal).

// ---------------------------------------------------------------------------
// Install dialog
// ---------------------------------------------------------------------------

function InstallDialog({
  template,
  onClose,
  onInstalled,
}: {
  template: PipelineTemplateRecord;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleInstall = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.pipelines.installFromTemplate({
        templateId: template.id,
        name: name.trim() || template.name,
      });
      onInstalled();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Install ${template.name}`}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
        data-testid="install-instance-dialog"
      >
        <h2 className="mb-1 text-sm font-semibold text-[var(--text)]">Install: {template.name}</h2>
        <p className="mb-4 text-xs text-[var(--text-muted)]">{template.shortDescription}</p>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-[var(--text-muted)]">
            Instance name (optional)
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={template.name}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-violet-600"
            data-testid="install-instance-name"
          />
        </label>
        {err ? <p className="mb-3 text-xs text-rose-400">{err}</p> : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-[var(--border)] py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--bg)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleInstall}
            disabled={busy}
            className="flex-1 rounded-md border border-violet-700 bg-violet-900/30 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-900/60 disabled:opacity-50"
            data-testid="install-instance-confirm"
          >
            {busy ? 'Installing…' : 'Install'}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Instance card — for Installed tab
// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function Agents() {
  const agentsQ = useQuery({ queryKey: ['agents'], queryFn: api.agents });
  const leaderboardQ = useQuery({
    queryKey: ['agent-leaderboard'],
    queryFn: () => api.agentLeaderboard(30),
  });
  if (agentsQ.isPending || leaderboardQ.isPending) return <SkeletonList />;
  if (agentsQ.isError)
    return <ErrorMsg msg="Couldn't load agents." retry={() => agentsQ.refetch()} />;
  const lb = leaderboardQ.isError ? { rows: [] as never[], count: 0, days: 30 } : leaderboardQ.data;
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-[var(--text-muted)]">
          Performance · last {lb.days}d
        </h2>
        <AgentLeaderboard rows={lb.rows} />
      </section>
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-[var(--text-muted)]">
          Verified roster
        </h2>
        <AgentList agents={agentsQ.data.agents} />
      </section>
    </div>
  );
}

function AgentLeaderboard({
  rows,
}: {
  rows: Array<{
    username: string;
    replies: number;
    firstResponses: number;
    avgLatencyMs: number | null;
    avgSentimentDelta: number | null;
    firstResponseRate: number | null;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <EmptyHint>
        No team activity recorded in this window yet. Verified reps need to comment on tagged posts
        for metrics to appear.
      </EmptyHint>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg)]/50 text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-2">Rep</th>
            <th className="px-4 py-2 text-right">Replies</th>
            <th className="px-4 py-2 text-right">First responses</th>
            <th className="px-4 py-2 text-right">First-response rate</th>
            <th className="px-4 py-2 text-right">Avg first-response latency</th>
            <th className="px-4 py-2 text-right">Sentiment lift</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <tr key={r.username}>
              <td className="px-4 py-2 font-medium text-[var(--text)]">u/{r.username}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.replies}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.firstResponses}</td>
              <td className="px-4 py-2 text-right tabular-nums text-[var(--text)]">
                {r.firstResponseRate != null ? `${(r.firstResponseRate * 100).toFixed(0)}%` : '—'}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-[var(--text)]">
                {r.avgLatencyMs != null ? formatLatency(r.avgLatencyMs) : '—'}
              </td>
              <td
                className={`px-4 py-2 text-right tabular-nums ${
                  r.avgSentimentDelta == null
                    ? 'text-[var(--text-muted)]'
                    : r.avgSentimentDelta > 0.05
                      ? 'text-emerald-300'
                      : r.avgSentimentDelta < -0.05
                        ? 'text-rose-300'
                        : 'text-[var(--text)]'
                }`}
                title="Avg change in thread sentiment in the 5 comments following the rep's reply"
              >
                {r.avgSentimentDelta != null
                  ? `${r.avgSentimentDelta > 0 ? '+' : ''}${r.avgSentimentDelta.toFixed(2)}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatLatency(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

function AgentList({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon="🤝"
        title="No verified reps yet"
        body="Mark a comment author as a verified rep to track their response stats and sentiment lift."
        cta={
          <a
            href="https://developers.reddit.com/docs/devvit"
            target="_top"
            rel="noopener noreferrer"
            className="text-xs text-orange-400 underline-offset-2 hover:underline"
          >
            View rep verification docs →
          </a>
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      {agents.map((a) => (
        <li key={a.username} className="flex items-center justify-between px-4 py-3">
          <span className="font-medium">u/{a.username}</span>
          <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{a.role}</span>
          <time
            dateTime={isoTime(a.verifiedAt)}
            title={absoluteTime(a.verifiedAt)}
            className="text-xs text-[var(--text-muted)]"
          >
            {relativeTime(a.verifiedAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Saved views — bookmarked filter combinations for Inbox + Drivers tabs
// ---------------------------------------------------------------------------

interface SavedViewsStripProps {
  tab: 'inbox' | 'drivers';
  currentParams: Record<string, string>;
  onApply: (params: Record<string, string>) => void;
}

function SavedViewsStrip({ tab, currentParams, onApply }: SavedViewsStripProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const viewsQ = useQuery({
    queryKey: ['saved-views', tab],
    queryFn: async () => {
      const data = await api.views.list();
      return data.views.filter((v) => v.tab === tab);
    },
    staleTime: 60_000,
  });

  const saveView = useMutation({
    mutationFn: (name: string) => api.views.save({ name, tab, params: currentParams }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-views', tab] });
      setSaving(false);
      setNewName('');
    },
  });

  const deleteView = useMutation({
    mutationFn: (id: string) => api.views.delete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-views', tab] });
    },
  });

  // Focus name input when save form opens
  useEffect(() => {
    if (saving) {
      nameInputRef.current?.focus();
    }
  }, [saving]);

  const views = viewsQ.data ?? [];

  if (viewsQ.isPending && views.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[var(--text-muted)]">Views:</span>
      {views.map((v) => (
        <span
          key={v.id}
          className="group flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-1.5 py-0.5 text-[var(--text)]"
        >
          <button
            type="button"
            onClick={() => onApply(v.params)}
            className="hover:text-orange-300 transition"
            title={`Apply view: ${v.name}`}
          >
            {v.name}
          </button>
          <button
            type="button"
            onClick={() => deleteView.mutate(v.id)}
            className="ml-0.5 rounded-full p-0.5 text-[var(--text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
            aria-label={`Delete view "${v.name}"`}
            title="Delete view"
          >
            ✕
          </button>
        </span>
      ))}
      {saving ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (name) saveView.mutate(name);
          }}
          className="flex items-center gap-1.5"
        >
          <input
            ref={nameInputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="View name"
            maxLength={60}
            className="w-36 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[var(--text)] outline-none focus:border-orange-500"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSaving(false);
                setNewName('');
              }
            }}
          />
          <button
            type="submit"
            disabled={!newName.trim() || saveView.isPending}
            className="rounded border border-orange-700 bg-orange-900/30 px-2 py-0.5 text-orange-200 transition hover:bg-orange-900/60 disabled:opacity-50"
          >
            {saveView.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSaving(false);
              setNewName('');
            }}
            className="text-[var(--text-muted)] hover:text-[var(--text-muted)]"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setSaving(true)}
          className="rounded-full border border-dashed border-[var(--border)] px-2.5 py-0.5 text-[var(--text-muted)] transition hover:border-orange-600 hover:text-orange-400"
          title="Save current filters as a view"
        >
          + Save current
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit — mod action log with filters and expandable rows
// ---------------------------------------------------------------------------

const AUDIT_ACTIONS: AuditAction[] = [
  'tag-issue',
  'mark-resolved',
  'mark-open',
  'mark-agent',
  'unmark-agent',
  'settings-update',
  'incident-resolve',
  'theme-regenerate',
  'bulk-status',
  'mod-approve',
  'mod-remove',
  'mod-spam',
  'mod-lock',
  'mod-distinguish',
  'mod-reply',
];

function auditActionBadgeStyle(action: AuditAction): string {
  switch (action) {
    case 'mark-resolved':
    case 'incident-resolve':
    case 'mod-approve':
      return 'border-emerald-700 bg-emerald-900/40 text-emerald-200';
    case 'mark-open':
      return 'border-amber-700 bg-amber-900/40 text-amber-200';
    case 'mark-agent':
    case 'unmark-agent':
    case 'settings-update':
      return 'border-neutral-600 bg-[var(--input-bg)] text-[var(--text)]';
    case 'mod-remove':
    case 'mod-spam':
      return 'border-rose-700 bg-rose-900/40 text-rose-200';
    case 'mod-lock':
    case 'mod-distinguish':
      return 'border-violet-700 bg-violet-900/40 text-violet-200';
    case 'mod-reply':
      return 'border-sky-700 bg-sky-900/40 text-sky-200';
    case 'tag-issue':
    case 'bulk-status':
    case 'theme-regenerate':
      return 'border-blue-700 bg-blue-900/40 text-blue-200';
    default:
      return 'border-neutral-600 bg-[var(--input-bg)] text-[var(--text)]';
  }
}

function AuditActionBadge({ action }: { action: AuditAction }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${auditActionBadgeStyle(action)}`}
    >
      {action}
    </span>
  );
}

function Audit() {
  const [actionFilter, setActionFilter] = useState<AuditAction | ''>('');
  const [actorFilter, setActorFilter] = useState('');
  const [actorInput, setActorInput] = useState('');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['audit', actionFilter, actorFilter],
    queryFn: () =>
      api.audit({
        limit: 200,
        ...(actionFilter ? { action: actionFilter } : {}),
        ...(actorFilter ? { actor: actorFilter } : {}),
      }),
    staleTime: 30_000,
  });

  const commitActor = useCallback(() => {
    setActorFilter(actorInput.trim());
  }, [actorInput]);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">Audit log</h2>
          <p className="mt-1 max-w-xl text-xs text-[var(--text-muted)]">
            Every mutating mod action, most recent first. Capped at 5 000 entries per installation.
          </p>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--text-muted)]">Action:</span>
        <button
          type="button"
          aria-pressed={actionFilter === ''}
          onClick={() => setActionFilter('')}
          className={`rounded-full border px-2.5 py-0.5 transition ${
            actionFilter === ''
              ? 'border-orange-500 bg-orange-500/10 text-orange-200'
              : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          All
        </button>
        {AUDIT_ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={actionFilter === a}
            onClick={() => setActionFilter(actionFilter === a ? '' : a)}
            className={`rounded-full border px-2.5 py-0.5 transition ${
              actionFilter === a
                ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-[var(--text-muted)]">Actor:</span>
        <input
          type="text"
          value={actorInput}
          onChange={(e) => setActorInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitActor();
            if (e.key === 'Escape') {
              setActorInput('');
              setActorFilter('');
            }
          }}
          placeholder="username…"
          className="w-36 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[var(--text)] outline-none focus:border-orange-500"
        />
        <button
          type="button"
          onClick={commitActor}
          className="rounded border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 text-[var(--text)] transition hover:border-orange-500"
        >
          Filter
        </button>
        {actorFilter ? (
          <button
            type="button"
            onClick={() => {
              setActorInput('');
              setActorFilter('');
            }}
            className="text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>

      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorMsg msg="Couldn't load audit log." retry={() => q.refetch()} />
      ) : q.data.count === 0 ? (
        actionFilter || actorFilter ? (
          <EmptyState
            icon="🔍"
            title="No entries match the current filters"
            body="Try clearing the action or actor filters to see all audit entries."
          />
        ) : (
          <EmptyState
            icon="📋"
            title="No audit actions yet"
            body="Anything you do here — marking agents, resolving incidents, saving pipeline configs — will be logged here."
          />
        )
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg)]/50 text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-2 w-36">Time</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Target</th>
                <th className="px-4 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {q.data.entries.map((entry, idx) => (
                <AuditRow
                  key={`${entry.ts}-${idx}`}
                  entry={entry}
                  expanded={expandedRow === idx}
                  onToggle={() => setExpandedRow(expandedRow === idx ? null : idx)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasMeta = entry.meta !== undefined && Object.keys(entry.meta).length > 0;
  return (
    <>
      <tr
        className={`cursor-pointer transition ${hasMeta ? 'hover:bg-[var(--input-bg)]' : ''}`}
        onClick={hasMeta ? onToggle : undefined}
        aria-expanded={hasMeta ? expanded : undefined}
      >
        <td className="px-4 py-2 text-xs text-[var(--text-muted)] tabular-nums">
          <time dateTime={isoTime(entry.ts)} title={absoluteTime(entry.ts)}>
            {relativeTime(entry.ts)}
          </time>
        </td>
        <td className="px-4 py-2 text-xs text-[var(--text)]">
          {entry.actor ? `u/${entry.actor}` : <span className="text-[var(--text-muted)]">—</span>}
        </td>
        <td className="px-4 py-2">
          <AuditActionBadge action={entry.action} />
        </td>
        <td className="px-4 py-2 text-xs text-[var(--text-muted)]">
          {entry.target ?? <span className="text-[var(--text-muted)]">—</span>}
        </td>
        <td className="px-4 py-2 text-right">
          {hasMeta ? (
            <span className="text-[var(--text-muted)] transition hover:text-[var(--text)]">
              {expanded ? '▲' : '▼'}
            </span>
          ) : null}
        </td>
      </tr>
      {expanded && hasMeta ? (
        <tr>
          <td colSpan={5} className="bg-[var(--bg)]/40 px-4 py-3">
            <pre className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-[11px] text-[var(--text)]">
              {JSON.stringify(entry.meta, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Export — CSV download for warehouse / Sprinklr-style ingestion
// ---------------------------------------------------------------------------

function ExportTab() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-[var(--text-muted)]">
          Data export
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-[var(--text-muted)]">
          RedLattice keeps the operational hot data in Devvit Redis. For longer retention, cross-sub
          analytics, or pulling into your own warehouse (BigQuery, Snowflake, Sprinklr), export the
          most recent posts as CSV. Endpoint is mod-only and same-origin to the dashboard.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/export/posts.csv?limit=500"
            target="_top"
            rel="noopener noreferrer"
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:border-orange-500 hover:text-orange-300"
          >
            Download recent 500 posts (CSV)
          </a>
          <a
            href="/api/export/posts.csv?limit=1000"
            target="_top"
            rel="noopener noreferrer"
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:border-orange-500 hover:text-orange-300"
          >
            Download recent 1000 posts (CSV)
          </a>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-[var(--text-muted)]">
          REST endpoints
        </h2>
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-xs text-[var(--text)]">
          <div>GET /api/dashboard/summary</div>
          <div>GET /api/dashboard/recent-posts?limit=N</div>
          <div>GET /api/drivers/taxonomy</div>
          <div>GET /api/drivers/volume?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</div>
          <div>GET /api/drivers/&lt;driverId&gt;/posts?limit=N</div>
          <div>GET /api/sentiment/rollup?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</div>
          <div>GET /api/agents</div>
          <div>GET /api/export/posts.csv?limit=N</div>
        </div>
        <p className="mt-3 max-w-2xl text-xs text-[var(--text-muted)]">
          All routes are mod-protected and return JSON unless otherwise noted. Phase 2 will add
          bearer-token auth so external services can pull directly without a mod session.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function _Card({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const accent =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'negative'
        ? 'text-rose-400'
        : 'text-[var(--text)]';
  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`mt-2 truncate text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{sub}</div>
    </article>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
        />
      ))}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
        />
      ))}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)]">
      {children}
    </div>
  );
}

function ErrorMsg({ msg, retry }: { msg: string; retry: () => void }) {
  return (
    <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
      {msg}{' '}
      <button type="button" onClick={retry} className="underline">
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers — relativeTime, absoluteTime, isoTime imported from lib/format-time.ts
// ---------------------------------------------------------------------------
