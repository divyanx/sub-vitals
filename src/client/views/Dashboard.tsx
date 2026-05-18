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
import { type Command, CommandPalette } from '../components/CommandPalette.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { InfoTooltip } from '../components/InfoTooltip.tsx';
import { NavOverflow } from '../components/NavOverflow.tsx';
import { ShortcutsModal } from '../components/ShortcutsModal.tsx';
import { ErrorBoundary } from '../ErrorBoundary.tsx';
import { type NavBadges, useNavBadges } from '../hooks/useNavBadges.ts';
import { useTheme } from '../hooks/useTheme.ts';
import {
  type Agent,
  type AuditAction,
  type AuditEntry,
  api,
  type CustomPipelineAction,
  type CustomPipelineBody,
  type DriverPost,
  formatDriverPath,
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
import { type InsightSection, Insights } from './Insights.tsx';
import { Onboarding } from './Onboarding.tsx';

// Lazy-load heavy tabs — each is code-split into its own async chunk so the
// initial JS bundle stays lean. The skeleton fallback renders instantly.
const Settings = lazy(() => import('./Settings.tsx').then((m) => ({ default: m.Settings })));
const LabLazy = lazy(() => import('./Lab.tsx').then((m) => ({ default: m.Lab })));
const SentimentChartLazy = lazy(() =>
  import('./SentimentChart.tsx').then((m) => ({ default: m.SentimentChart })),
);

type Tab =
  | 'inbox'
  | 'overview'
  | 'insights'
  | 'incidents'
  | 'pipelines'
  | 'team'
  | 'export'
  | 'audit'
  | 'lab'
  | 'settings';

export interface DashboardProps {
  initialTab?: Tab;
  initialDriver?: string;
}

export function Dashboard({ initialTab = 'inbox', initialDriver }: DashboardProps) {
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [activeSection, setActiveSection] = useState<InsightSection>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('section') as InsightSection | null) ?? 'drivers';
  });
  const [activeDriver, setActiveDriver] = useState<string | undefined>(initialDriver);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { theme, cycle: cycleTheme } = useTheme();
  const badges = useNavBadges();

  // URL helpers
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

  const setInsightsSection = useCallback((section: InsightSection) => {
    setActiveSection(section);
    const params = new URLSearchParams({ tab: 'insights', section });
    history.pushState({ tab: 'insights', section }, '', `?${params.toString()}`);
  }, []);

  // Deep-link redirects: old ?tab=drivers|sentiment|themes|agents → new locations
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawTab = params.get('tab');
    if (rawTab === 'drivers' || rawTab === 'sentiment' || rawTab === 'themes') {
      const section = rawTab as InsightSection;
      setTabState('insights');
      setActiveSection(section);
      const p = new URLSearchParams({ tab: 'insights', section });
      history.replaceState({ tab: 'insights', section }, '', `?${p.toString()}`);
    } else if (rawTab === 'agents') {
      setTabState('team');
      history.replaceState({ tab: 'team' }, '', '?tab=team');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const state = e.state as { tab?: Tab; section?: InsightSection } | null;
      if (state?.tab) {
        setTabState(state.tab);
        if (state.tab === 'insights' && state.section) {
          setActiveSection(state.section);
        }
      } else {
        const params = new URLSearchParams(window.location.search);
        const t = params.get('tab') as Tab | null;
        setTabState(t ?? 'inbox');
        if (t === 'insights') {
          setActiveSection((params.get('section') as InsightSection | null) ?? 'drivers');
        }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── Keyboard shortcuts via tinykeys ────────────────────────────────────────
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
      'g i': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('inbox');
      },
      'g p': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('overview');
      },
      'g x': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('insights');
      },
      'g n': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('incidents');
      },
      'g l': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('pipelines');
      },
      'g m': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('team');
      },
      'g e': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('export');
      },
      'g u': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('audit');
      },
      'g ,': (e: KeyboardEvent) => {
        e.preventDefault();
        setTab('settings');
      },
    });
    return () => unsub();
  }, [setTab]);

  // ── Command palette commands ────────────────────────────────────────────────
  const commands: Command[] = useMemo(
    () => [
      {
        id: 'tab-inbox',
        label: 'Inbox',
        group: 'Navigation',
        shortcut: ['g', 'i'],
        action: () => setTab('inbox'),
      },
      {
        id: 'tab-overview',
        label: 'Pulse',
        group: 'Navigation',
        shortcut: ['g', 'p'],
        action: () => setTab('overview'),
      },
      {
        id: 'tab-insights',
        label: 'Insights',
        group: 'Navigation',
        shortcut: ['g', 'x'],
        action: () => setTab('insights'),
      },
      {
        id: 'tab-insights-drivers',
        label: 'Insights › Drivers',
        group: 'Navigation',
        action: () => {
          setTab('insights');
          setInsightsSection('drivers');
        },
      },
      {
        id: 'tab-insights-sentiment',
        label: 'Insights › Sentiment',
        group: 'Navigation',
        action: () => {
          setTab('insights');
          setInsightsSection('sentiment');
        },
      },
      {
        id: 'tab-insights-themes',
        label: 'Insights › Themes',
        group: 'Navigation',
        action: () => {
          setTab('insights');
          setInsightsSection('themes');
        },
      },
      {
        id: 'tab-incidents',
        label: 'Incidents',
        group: 'Navigation',
        shortcut: ['g', 'n'],
        action: () => setTab('incidents'),
      },
      {
        id: 'tab-pipelines',
        label: 'Pipelines',
        group: 'Navigation',
        shortcut: ['g', 'l'],
        action: () => setTab('pipelines'),
      },
      {
        id: 'tab-team',
        label: 'Team',
        group: 'Navigation',
        shortcut: ['g', 'm'],
        action: () => setTab('team'),
      },
      {
        id: 'tab-export',
        label: 'Export',
        group: 'Navigation',
        shortcut: ['g', 'e'],
        action: () => setTab('export'),
      },
      {
        id: 'tab-audit',
        label: 'Audit',
        group: 'Navigation',
        shortcut: ['g', 'u'],
        action: () => setTab('audit'),
      },
      {
        id: 'tab-settings',
        label: 'Settings',
        group: 'Navigation',
        shortcut: ['g', ','],
        action: () => setTab('settings'),
      },
      {
        id: 'theme-cycle',
        label: `Theme: ${theme} → cycle`,
        group: 'Preferences',
        action: cycleTheme,
      },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        group: 'Help',
        shortcut: ['?'],
        action: () => setShortcutsOpen(true),
      },
    ],
    [setTab, setInsightsSection, theme, cycleTheme],
  );

  const customPipelines: Array<{ id: string; name: string; kind: string }> = [];

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg)] text-[var(--text)]">
      <Onboarding />
      <Header theme={theme} onCycleTheme={cycleTheme} onOpenCmd={() => setCmdOpen(true)} />
      <Nav tab={tab} setTab={setTab} badges={badges} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <ErrorBoundary resetKey={tab}>
          <Suspense fallback={<SkeletonGrid />}>
            {tab === 'inbox' && <Inbox />}
            {tab === 'overview' && (
              <Overview
                onNavigate={(t, driver, extra) => {
                  if (driver) setActiveDriver(driver);
                  // When navigating to insights with a section, set the section too
                  if (t === 'insights' && extra?.section) {
                    setActiveSection(extra.section as InsightSection);
                  }
                  setTab(t as Tab, { ...(driver ? { driver } : {}), ...(extra ?? {}) });
                }}
              />
            )}
            {tab === 'insights' && (
              <Insights
                defaultSection={activeSection}
                onSectionChange={setInsightsSection}
                DriversContent={() => <Drivers initialDriver={activeDriver} />}
                SentimentContent={() => <SentimentTab />}
                ThemesContent={() => <Themes />}
                customPipelines={customPipelines}
              />
            )}
            {tab === 'incidents' && <Incidents />}
            {tab === 'pipelines' && <Pipelines onOpenSettings={() => setTab('settings')} />}
            {tab === 'team' && <Agents />}
            {tab === 'export' && <ExportTab />}
            {tab === 'audit' && <Audit />}
            {tab === 'lab' && <LabLazy />}
            {tab === 'settings' && <Settings />}
          </Suspense>
        </ErrorBoundary>
      </main>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function Header({
  theme,
  onCycleTheme,
  onOpenCmd,
}: {
  theme: 'system' | 'dark' | 'light';
  onCycleTheme: () => void;
  onOpenCmd: () => void;
}) {
  const themeIcon = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '⚙️';
  const themeLabel = `Theme: ${theme}. Click to cycle.`;

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

          {/* Theme toggle */}
          <button
            type="button"
            onClick={onCycleTheme}
            aria-label={themeLabel}
            title={themeLabel}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm transition hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {themeIcon}
          </button>
        </div>
      </div>
    </header>
  );
}

// Primary tabs — always visible in the nav bar
const PRIMARY_TABS: { id: Tab; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'overview', label: 'Pulse' },
  { id: 'insights', label: 'Insights' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'pipelines', label: 'Pipelines' },
];

function Nav({ tab, setTab, badges }: { tab: Tab; setTab: (t: Tab) => void; badges: NavBadges }) {
  return (
    <nav className="relative border-b border-[var(--border)] bg-[var(--bg)]">
      <div
        role="tablist"
        aria-label="Dashboard tabs"
        className="mx-auto flex max-w-6xl items-stretch gap-1 overflow-x-auto px-6"
        style={{ scrollbarWidth: 'none' }}
      >
        {PRIMARY_TABS.map((t) => {
          const isActive = tab === t.id;
          const badge =
            t.id === 'inbox' && badges.inbox > 0
              ? badges.inbox
              : t.id === 'incidents' && badges.incidents > 0
                ? badges.incidents
                : null;

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
        {/* Overflow "More ▾" dropdown for secondary tabs */}
        <div className="ml-auto">
          <NavOverflow activeTab={tab} onSelect={(t) => setTab(t)} />
        </div>
      </div>
    </nav>
  );
}

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
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Triage inbox</h2>
          <p className="mt-1 max-w-xl text-xs text-neutral-400">
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
                  : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
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
          className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-orange-700 bg-neutral-950/95 px-4 py-2.5 text-sm backdrop-blur"
        >
          <span className="font-medium text-orange-200">{selected.size} selected</span>
          <span className="text-neutral-400">·</span>
          <select
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as PostStatus)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
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
            className="ml-auto text-xs text-neutral-400 underline-offset-2 hover:text-neutral-300 hover:underline"
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
          <div className="flex items-center gap-2 pb-1 text-xs text-neutral-400">
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
                className={`rounded-lg border bg-neutral-900 p-4 transition ${
                  selected.has(p.postId)
                    ? 'border-orange-600/60'
                    : 'border-neutral-800 hover:border-neutral-700'
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
                      className="block truncate text-sm font-medium text-neutral-100 hover:underline"
                      title={p.title}
                    >
                      {p.title || '(no title)'}
                    </a>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenHistory(openHistory === p.authorName ? null : p.authorName)
                        }
                        className="text-neutral-300 underline-offset-2 hover:underline"
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
                      <div className="mt-1 text-xs italic text-neutral-400">"{p.reasoning}"</div>
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
                          className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:bg-neutral-700"
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
                        className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:bg-neutral-700"
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
                        className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:border-orange-500 hover:text-orange-200"
                      >
                        ↗ Open on Reddit
                      </a>
                    </div>
                  </div>
                </div>
                {openHistory === p.authorName ? (
                  <div className="mt-4 border-t border-neutral-800 pt-4">
                    <UserHistoryPanel username={p.authorName} currentPostId={p.postId} />
                  </div>
                ) : null}
                {openThread === p.postId ? (
                  <div className="mt-4 border-t border-neutral-800 pt-4">
                    <ThreadPanel postId={p.postId} />
                  </div>
                ) : null}
                {openDraft === p.postId ? (
                  <div className="mt-4 border-t border-neutral-800 pt-4">
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
        : 'border-neutral-700 bg-neutral-800 text-neutral-400';
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
      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
        <span className="font-medium text-neutral-200">u/{username}</span>
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
                      : 'text-neutral-300'
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
        <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-950/40">
          {others.map((p) => (
            <li key={p.postId} className="px-3 py-2">
              <a
                href={p.url}
                target="_top"
                rel="noopener noreferrer"
                className="block truncate text-sm text-neutral-100 hover:underline"
                title={p.title}
              >
                {p.title || '(no title)'}
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                <span>{relativeTime(p.createdAt)}</span>
                {p.driverId ? (
                  <>
                    <span>·</span>
                    <span className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5">
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
  concise: 'border-neutral-700 bg-neutral-900 text-neutral-200',
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
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="font-medium text-violet-300">✨ AI draft replies</span>
          {data ? (
            <span className="text-neutral-400">
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
              className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
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
                className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 ${TONE_COLOR[c.tone] ?? TONE_COLOR.concise}`}
                    >
                      {c.tone}
                    </span>
                    <span className="text-neutral-400">{c.rationale}</span>
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
                    className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-200 transition hover:border-orange-500 hover:text-orange-200"
                  >
                    {copiedIdx === i ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [i]: e.target.value }))}
                  rows={Math.min(10, Math.max(3, text.split('\n').length + 2))}
                  className="block w-full resize-y border-0 bg-transparent px-3 py-3 text-sm text-neutral-100 outline-none focus:bg-neutral-900/40"
                  spellCheck
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-xs text-neutral-400">
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
          : 'text-neutral-100';
  const deltaColor = deltaPositive ? 'text-emerald-400' : 'text-rose-400';

  const inner = (
    <>
      <div className="flex items-center text-[10px] uppercase tracking-widest text-neutral-400">
        {label}
        {tooltip ? <InfoTooltip tip={tooltip} /> : null}
      </div>
      <div
        className={`mt-1.5 truncate text-xl font-semibold tabular-nums leading-none ${valueColor}`}
      >
        {value}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {sub ? <span className="text-[11px] text-neutral-400">{sub}</span> : null}
        {delta ? (
          <span className={`ml-auto text-[11px] tabular-nums ${deltaColor}`}>{delta}</span>
        ) : null}
      </div>
    </>
  );

  if (onClick) {
    return (
      <article
        className="rounded-lg border border-neutral-800 bg-neutral-900 p-3.5 transition hover:border-neutral-700 hover:bg-neutral-800/60"
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
      className="rounded-lg border border-neutral-800 bg-neutral-900 p-3.5"
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
      className={`h-4 w-full rounded-[2px] border border-neutral-800/40 bg-orange-500/${opacity}`}
      title={label}
    />
  );
}

// --- Main Overview ---------------------------------------------------------

function Overview({
  onNavigate,
}: {
  onNavigate?: (tab: Tab, driver?: string, extra?: Record<string, string>) => void;
}) {
  const navigateTo = useCallback(
    (tab: Tab, extra?: Record<string, string>) => {
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
  const themesQ = useQuery({ queryKey: ['themes'], queryFn: api.themes, staleTime: 300_000 });

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
        <h2 className="mb-3 text-[11px] uppercase tracking-widest text-neutral-400">
          Pulse — today at a glance
        </h2>
        {summaryQ.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
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
              onClick={() => navigateTo('insights', { section: 'drivers' })}
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
              label="LLM spend (MTD)"
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
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-neutral-400">
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
                    onClick={() => navigateTo('insights', { section: 'drivers', driver: node.id })}
                    className="group flex flex-col gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left transition hover:border-neutral-700 hover:bg-neutral-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
                    aria-label={`${node.label}: ${current} posts today. Click to view driver.`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: node.color }}
                        />
                        <span className="truncate text-xs font-medium text-neutral-200 group-hover:text-white">
                          {node.label}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-100">
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
                    <div className="text-[10px] text-neutral-400">14d trend · click to drill</div>
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
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-neutral-400">
              Activity heatmap · day × hour
            </h2>
            {recentQ.isPending ? (
              <div className="h-36 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
            ) : recentQ.isError ? (
              <ErrorMsg msg="Couldn't load heatmap data." retry={() => recentQ.refetch()} />
            ) : heatmap ? (
              <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4">
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
                    <div key={h} className="text-center text-[9px] text-neutral-400">
                      {HOUR_LABELS.includes(h.padStart(2, '0')) ? h.padStart(2, '0') : ''}
                    </div>
                  ))}
                </div>
                {/* Rows */}
                <div className="space-y-0.5">
                  {DOW_LABELS.map((day, dow) => (
                    <div key={day} className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-right text-[10px] text-neutral-400">
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
                <div className="mt-2 flex items-center gap-2 text-[10px] text-neutral-400">
                  <span>fewer</span>
                  <div className="flex gap-0.5">
                    {[0, 20, 40, 60, 80, 100].map((op) => (
                      <div
                        key={op}
                        className={`h-3 w-4 rounded-[2px] bg-orange-500/${op} border border-neutral-700/30`}
                      />
                    ))}
                  </div>
                  <span>more</span>
                </div>
              </div>
            ) : null}
          </section>

          {/* ── Top themes ──────────────────────────────────────────────── */}
          <section aria-label="Emerging themes">
            <h2 className="mb-3 text-[11px] uppercase tracking-widest text-neutral-400">
              Emerging themes
            </h2>
            {themesQ.isPending ? (
              <SkeletonList />
            ) : themesQ.isError ? (
              <ErrorMsg msg="Couldn't load themes." retry={() => themesQ.refetch()} />
            ) : themesQ.data.themes.length === 0 ? (
              <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
                <span>No themes generated yet.</span>
                <button
                  type="button"
                  onClick={() => navigateTo('insights', { section: 'themes' })}
                  className="text-xs text-orange-400 hover:underline"
                >
                  Generate in Themes tab →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {themesQ.data.themes.slice(0, 5).map((t) => (
                  <div
                    key={t.name}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="truncate text-sm font-medium text-neutral-100">{t.name}</h3>
                      <span
                        className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums ${
                          t.avgSentiment < -0.2
                            ? 'border-rose-700 bg-rose-900/40 text-rose-200'
                            : t.avgSentiment > 0.2
                              ? 'border-emerald-700 bg-emerald-900/40 text-emerald-200'
                              : 'border-neutral-700 bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {t.avgSentiment > 0 ? '+' : ''}
                        {t.avgSentiment.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-neutral-400">
                      {t.postCount} post{t.postCount === 1 ? '' : 's'}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs text-neutral-400">{t.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Activity ticker (sidebar on lg+) ─────────────────────────── */}
        <aside aria-label="Recent activity">
          <h2 className="mb-3 text-[11px] uppercase tracking-widest text-neutral-400">
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
    <ul className="divide-y divide-neutral-800/70 rounded-lg border border-neutral-800 bg-neutral-900/60">
      {items.map((p) => (
        <li key={p.postId} className="px-3 py-2.5">
          <a
            href={p.url}
            target="_top"
            rel="noopener noreferrer"
            className="block truncate text-xs font-medium text-neutral-200 hover:text-orange-300 hover:underline"
            title={p.title}
          >
            {p.title || '(no title)'}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-400">
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
        : 'text-neutral-400';
  return (
    <span className={`font-medium ${color}`} title={`ID: ${id}`}>
      {label}
      {taggedBy ? <span className="ml-1 text-neutral-400">({taggedBy})</span> : null}
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
        : 'border-neutral-700 bg-neutral-800 text-neutral-300';
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

function Drivers({ initialDriver }: { initialDriver?: string | undefined }) {
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
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40">
        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          aria-expanded={configOpen}
          data-testid="drivers-config-toggle"
          className="flex w-full items-center justify-between px-5 py-3 text-left"
        >
          <span className="text-sm font-medium text-neutral-200">Configure taxonomy</span>
          <span className="text-xs text-neutral-400">{configOpen ? '▲ collapse' : '▼ expand'}</span>
        </button>
        {configOpen ? (
          <div
            className="space-y-4 border-t border-neutral-800 px-5 pb-5 pt-4"
            data-testid="drivers-config-panel"
          >
            {settingsQ.isPending ? (
              <div className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
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
        <h2 className="mb-4 text-sm uppercase tracking-wide text-neutral-400">
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
                    ? 'border-orange-500 bg-neutral-900'
                    : 'border-transparent hover:border-neutral-800 hover:bg-neutral-900/60'
                }`}
              >
                <span className="flex w-40 min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: d.color }}
                  />
                  <span className="truncate text-sm text-neutral-200">
                    {formatDriverPath(d.id, taxonomy)}
                  </span>
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-900">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(d.count / max) * 100}%`,
                      background: d.color ?? '#ff4500',
                    }}
                  />
                </span>
                <span className="w-12 text-right text-sm tabular-nums text-neutral-400">
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
        <span className="text-neutral-400">Filter:</span>
        {STATUS_FILTERS.map((f) => (
          <button
            type="button"
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-2 py-0.5 transition ${
              filter === f.id
                ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {f.label}
          </button>
        ))}
        {hasChildren ? (
          <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-neutral-400">
            <input
              type="checkbox"
              checked={includeSubDrivers}
              onChange={(e) => setIncludeSubDrivers(e.target.checked)}
              data-testid="include-sub-drivers-toggle"
              className="rounded border-neutral-700 bg-neutral-800 accent-orange-500"
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
    <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
      {posts.map((p) => (
        <li key={p.postId} className="px-4 py-3">
          <a
            href={p.url}
            target="_top"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium text-neutral-100 hover:underline"
            title={p.title}
          >
            {p.title || '(no title)'}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
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
            <div className="mt-1 text-xs italic text-neutral-400">"{p.reasoning}"</div>
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
                className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:bg-neutral-700"
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
              className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:bg-neutral-700"
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
    <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-400">
          {comments.length} comment{comments.length === 1 ? '' : 's'} processed
        </span>
        {heat.isHot ? (
          <span className="rounded-full border border-rose-700 bg-rose-900/40 px-2 py-0.5 text-rose-200">
            🔥 thread heating up ({(heat.negativeShare * 100).toFixed(0)}% recent negative)
          </span>
        ) : (
          <span className="text-neutral-400">
            {(heat.negativeShare * 100).toFixed(0)}% recent negative
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {comments.map((c) => (
          <li
            key={c.commentId}
            className={`rounded-lg border px-3 py-2 ${
              c.isAgent ? 'border-blue-800 bg-blue-950/30' : 'border-neutral-800 bg-neutral-900'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
              <span className={c.isAgent ? 'font-medium text-blue-300' : 'text-neutral-300'}>
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
            <div className="mt-1 text-sm whitespace-pre-wrap text-neutral-200">{c.body}</div>
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
          : 'border-neutral-700 bg-neutral-800 text-neutral-300';
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
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">
          Daily sentiment volume · 30 days
        </h2>
        <Suspense
          fallback={
            <div className="h-64 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
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
        : 'text-neutral-100';

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
      className={`w-full cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-left transition hover:border-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${ringClass}`}
      onClick={onToggle}
    >
      <div className="flex items-center text-xs uppercase tracking-wide text-neutral-400">
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
      <div className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
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
      className="rounded-lg border border-neutral-800 bg-neutral-900"
    >
      <div className="border-b border-neutral-800 px-4 py-3">
        <span className="text-sm font-medium text-neutral-200">
          {labelTitle} posts · {posts.length} results
        </span>
      </div>
      <ul className="divide-y divide-neutral-800">
        {posts.map((p) => (
          <li key={p.postId} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-neutral-100 hover:text-orange-300 hover:underline"
              >
                {p.title}
              </a>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
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
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Incidents</h2>
          <p className="mt-1 max-w-xl text-xs text-neutral-400">
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
                  : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
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
            <li key={inc.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-medium text-rose-200">{inc.reason}</div>
                  <div className="mt-1 text-xs text-neutral-400">
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
                      className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-400"
                    >
                      {pid}
                    </span>
                  ))}
                  {inc.postIds.length > 6 ? (
                    <span className="px-2 py-0.5 text-neutral-400">
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
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Emerging themes</h2>
          <p className="mt-1 max-w-xl text-xs text-neutral-400">
            LLM-clustered themes from the most recent negative posts. Regenerated daily; click below
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
          <div className="text-xs text-neutral-400">
            generated {q.data.generatedAt ? relativeTime(q.data.generatedAt) : 'recently'} · last 7
            days
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {q.data.themes.map((t) => (
              <li key={t.name} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium text-neutral-100">{t.name}</h3>
                  <span className="text-xs text-neutral-400">
                    {t.postCount} post{t.postCount === 1 ? '' : 's'} ·{' '}
                    <span
                      className={
                        t.avgSentiment < -0.2
                          ? 'text-rose-300'
                          : t.avgSentiment > 0.2
                            ? 'text-emerald-300'
                            : 'text-neutral-300'
                      }
                    >
                      {t.avgSentiment.toFixed(2)}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-sm text-neutral-400">{t.summary}</p>
                {t.samplePostIds.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1 text-xs">
                    {t.samplePostIds.slice(0, 4).map((pid) => (
                      <span
                        key={pid}
                        className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-400"
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
// Pipelines — catalog of all classification/analysis pipelines
// ---------------------------------------------------------------------------

type PipelineKind =
  | 'intent classification'
  | 'sentiment'
  | 'theme clustering'
  | 'crisis detection'
  | 'identity verification'
  | 'performance'
  | 'root cause';

interface PipelineDef {
  id: string;
  name: string;
  kind: PipelineKind;
  trigger: string;
  logic: string;
  settingsLink?: string;
  moduleKey?: string;
  /** Alpha pipelines are stubbed / not yet fully functional */
  alpha?: boolean;
}

const PIPELINE_DEFS: PipelineDef[] = [
  {
    id: 'contact-drivers',
    name: 'Contact Drivers',
    kind: 'intent classification',
    trigger: 'PostSubmit',
    logic: 'Lexicon → LLM',
    settingsLink: 'taxonomy',
    moduleKey: 'contact-drivers',
  },
  {
    id: 'sentiment',
    name: 'Sentiment scoring',
    kind: 'sentiment',
    trigger: 'PostSubmit + CommentCreate',
    logic: 'AFINN lexicon → LLM judge for ambiguous',
    moduleKey: 'sentiment',
  },
  {
    id: 'impostor',
    name: 'Impostor detection',
    kind: 'identity verification',
    trigger: 'CommentCreate (non-mods only)',
    logic: 'Regex pre-filter → LLM judge',
    moduleKey: 'impostor-detection',
  },
  {
    id: 'crisis',
    name: 'Crisis detection',
    kind: 'crisis detection',
    trigger: 'CommentCreate',
    logic: 'Hourly volume + negative-share thresholds',
    moduleKey: 'crisis-detection',
  },
  {
    id: 'themes',
    name: 'Theme clustering',
    kind: 'theme clustering',
    trigger: 'Scheduler (daily 02:00 UTC)',
    logic: 'LLM clustering of negative posts',
    moduleKey: 'theme-clustering',
  },
  {
    id: 'agent-metrics',
    name: 'Response metrics',
    kind: 'performance',
    trigger: 'CommentCreate',
    logic: 'First-response latency + sentiment delta tracking',
    moduleKey: 'agent-metrics',
  },
  {
    id: 'root-cause',
    name: 'Root cause summariser',
    kind: 'root cause',
    trigger: 'status-change (resolved)',
    logic: 'AI summarises post + agent reply into root-cause string',
    moduleKey: 'root-cause',
    alpha: true,
  },
];

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
    <div className="mt-3 border-t border-neutral-800 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-300"
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
            <span className="col-span-3 text-neutral-400">Loading…</span>
          ) : debugQ.isError ? (
            <span className="col-span-3 text-rose-400">Failed to load stats.</span>
          ) : (
            <>
              <div className="rounded bg-neutral-800 px-2 py-1">
                <div className="text-neutral-400">Received</div>
                <div className="font-medium text-neutral-200">{stats.events_received ?? '—'}</div>
              </div>
              <div className="rounded bg-neutral-800 px-2 py-1">
                <div className="text-neutral-400">Processed</div>
                <div className="font-medium text-neutral-200">{stats.events_processed ?? '—'}</div>
              </div>
              <div className="rounded bg-neutral-800 px-2 py-1">
                <div className="text-neutral-400">Failed</div>
                <div
                  className={`font-medium ${(stats.events_failed ?? 0) > 0 ? 'text-rose-400' : 'text-neutral-200'}`}
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
  pipeline: PipelineDef;
  onOpenSettings?: () => void;
  onOpenDrawer?: (pipeline: PipelineDef) => void;
}) {
  const handleTune = () => {
    onOpenDrawer?.(pipeline);
  };

  return (
    <div
      className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-5"
      data-testid={`pipeline-card-${pipeline.id}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">{pipeline.name}</h3>
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
          {pipeline.settingsLink === 'taxonomy' && onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:border-orange-600 hover:text-orange-300"
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
            className="rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:border-violet-600 hover:text-violet-300"
          >
            Tune →
          </button>
        </div>
      </div>

      <dl className="flex flex-col gap-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-neutral-400">Kind</dt>
          <dd className="text-neutral-300">{pipeline.kind}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-neutral-400">Trigger</dt>
          <dd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-neutral-300">
            {pipeline.trigger}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 text-neutral-400">Logic</dt>
          <dd className="text-neutral-400">{pipeline.logic}</dd>
        </div>
      </dl>

      {pipeline.moduleKey ? <PipelineStats moduleKey={pipeline.moduleKey} /> : null}
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
      className="flex flex-col items-start rounded-xl border border-dashed border-neutral-700 bg-neutral-900/40 p-5 text-left transition hover:border-orange-600/50 hover:bg-neutral-900"
    >
      <span className="mb-2 text-2xl" aria-hidden="true">
        +
      </span>
      <h3 className="text-sm font-semibold text-neutral-400">Custom pipeline</h3>
      <p className="mt-1 text-xs text-neutral-400">RedLattice Studio</p>
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
    systemPrompt: 'Tracks agent response metrics. No LLM prompt required.',
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

function PipelineDrawer({ pipeline, onClose }: { pipeline: PipelineDef; onClose: () => void }) {
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
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-neutral-700 bg-neutral-950 shadow-2xl sm:w-[480px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">{pipeline.name}</h2>
            <p className="mt-0.5 text-xs text-neutral-400">{pipeline.trigger}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Enabled toggle */}
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <span className={enabled ? 'text-emerald-400' : 'text-neutral-400'}>
                {enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled((e) => !e)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-600' : 'bg-neutral-700'}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-1'}`}
                />
              </button>
            </label>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="rounded p-1 text-neutral-400 hover:text-neutral-200"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b border-neutral-800 px-5">
          {DRAWER_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-3 text-xs font-medium transition ${
                activeTab === t.id
                  ? 'border-orange-500 text-white'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
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
                      <span className="text-xs font-medium text-neutral-300">System prompt</span>
                      <button
                        type="button"
                        onClick={handleResetToDefault}
                        className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
                      >
                        Reset to default
                      </button>
                    </div>
                    <textarea
                      ref={systemPromptRef}
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      rows={6}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
                      placeholder="System prompt…"
                      aria-label="System prompt"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-neutral-300">
                      User prompt template
                    </p>
                    <textarea
                      ref={userPromptRef}
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      rows={6}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
                      placeholder="User prompt template with {{variables}}…"
                      aria-label="User prompt template"
                    />
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-neutral-400">
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
                          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300 hover:border-orange-500 hover:text-orange-300"
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
                          <label className="mb-2 flex items-center justify-between text-xs font-medium text-neutral-300">
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
                              className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-right text-xs text-neutral-100 outline-none focus:border-orange-500"
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
                          <div className="mt-1 flex justify-between text-xs text-neutral-400">
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
                    <p className="mb-2 text-xs font-medium text-neutral-300">Sample input</p>
                    <textarea
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      rows={5}
                      placeholder="Paste sample post or comment text here…"
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
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
                      <div className="text-xs text-neutral-400">
                        Cost: ${(testResult.costCents / 100).toFixed(4)}
                      </div>
                      <pre className="overflow-auto rounded-md border border-neutral-700 bg-neutral-900 p-3 text-xs text-neutral-200">
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
        <div className="border-t border-neutral-800 px-5 py-4">
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

/** Studio waitlist modal */
function StudioModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Wire to Studio waitlist webhook later
    console.log('[RedLattice Studio] Waitlist signup:', email);
    setSubmitted(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="RedLattice Studio waitlist"
    >
      <div className="w-96 rounded-xl border border-neutral-700 bg-neutral-900 p-7 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-neutral-100">RedLattice Studio</h3>
            <p className="mt-1 text-xs text-neutral-400">Coming soon</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-400 hover:text-neutral-300"
          >
            ×
          </button>
        </div>
        <p className="mb-5 text-sm text-neutral-300">
          RedLattice Studio lets you build custom classification pipelines visually — no code
          required. Chain classifiers, set conditions, and route signals to any destination.
        </p>
        {submitted ? (
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
            You're on the list! We'll reach out when Studio launches.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              aria-label="Email address for Studio waitlist"
              className="flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
              data-testid="studio-email-input"
            />
            <button
              type="submit"
              className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-2 text-sm font-medium text-orange-200 hover:bg-orange-600/40"
              data-testid="studio-waitlist-submit"
            >
              Join waitlist →
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New pipeline builder modal
// ---------------------------------------------------------------------------

const STUDIO_ADVANCED_OPTIONS = [
  'Multiple steps / branching',
  'Scheduled (cron)',
  'Call external APIs',
  'Combine multiple AI calls',
];

const BUILDER_VARIABLES = [
  'post.title',
  'post.body',
  'comment.body',
  'comment.author',
  'taxonomy_json',
  'current_driver',
  'current_sentiment',
];

function NewPipelineModal({
  onClose,
  onStudioPromotion,
}: {
  onClose: () => void;
  onStudioPromotion: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<PipelineKind>('intent classification');
  const [trigger, setTrigger] = useState<'post-create' | 'comment-create'>('post-create');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [outputSchema, setOutputSchema] = useState<'single-label' | 'label-confidence' | 'boolean'>(
    'single-label',
  );
  const [actionType, setActionType] = useState<CustomPipelineAction['type']>('tag-driver');
  const [actionDriverId, setActionDriverId] = useState('');
  const [actionModmailTemplate, setActionModmailTemplate] = useState('');
  const [actionStatus, setActionStatus] = useState<'open' | 'in-progress' | 'resolved'>('open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userPromptRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (variable: string) => {
    const ta = userPromptRef.current;
    const token = `{{${variable}}}`;
    if (!ta) {
      setUserPrompt((p) => p + token);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = userPrompt.slice(0, start) + token + userPrompt.slice(end);
    setUserPrompt(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const buildAction = (): CustomPipelineAction => {
    if (actionType === 'tag-driver') return { type: 'tag-driver', driverId: actionDriverId };
    if (actionType === 'send-modmail')
      return { type: 'send-modmail', bodyTemplate: actionModmailTemplate };
    return { type: 'set-status', status: actionStatus };
  };

  const handleCreate = async () => {
    setError(null);
    setBusy(true);
    try {
      const body: CustomPipelineBody = {
        name: name.trim(),
        description: description.trim(),
        trigger,
        systemPrompt: systemPrompt.trim(),
        userPrompt: userPrompt.trim(),
        outputSchema,
        action: buildAction(),
      };
      await api.pipelines.createCustom(body);
      await qc.invalidateQueries({ queryKey: ['custom-pipelines'] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="New custom pipeline"
    >
      <div
        className="w-full max-w-lg overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        style={{ maxHeight: '90vh' }}
        data-testid="new-pipeline-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <h3 className="text-base font-semibold text-neutral-100">New pipeline</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-400 hover:text-neutral-200"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Name */}
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-300">Name *</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bug escalation detector"
              aria-label="Pipeline name"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
              data-testid="new-pipeline-name"
            />
          </div>

          {/* Description */}
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-300">Description</p>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              aria-label="Pipeline description"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
            />
          </div>

          {/* Kind */}
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-300">Kind *</p>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PipelineKind)}
              aria-label="Pipeline kind"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
            >
              <option value="intent classification">Intent classification</option>
              <option value="sentiment">Sentiment</option>
              <option value="theme clustering">Theme clustering</option>
              <option value="crisis detection">Crisis detection</option>
              <option value="identity verification">Identity verification</option>
              <option value="performance">Performance</option>
              <option value="root cause">Root cause</option>
            </select>
          </div>

          {/* Trigger */}
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-300">Trigger</p>
            <div className="flex gap-4">
              {(
                [
                  { value: 'post-create', label: 'On post create' },
                  { value: 'comment-create', label: 'On comment create' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200"
                >
                  <input
                    type="radio"
                    name="trigger"
                    value={opt.value}
                    checked={trigger === opt.value}
                    onChange={() => setTrigger(opt.value)}
                    className="accent-orange-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* System prompt */}
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-300">System prompt *</p>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="You are a classifier that…"
              aria-label="System prompt"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
              data-testid="new-pipeline-system-prompt"
            />
          </div>

          {/* User prompt + variable chips */}
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-300">User prompt template *</p>
            <textarea
              ref={userPromptRef}
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              rows={4}
              placeholder="Use {{variables}} for dynamic content…"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
              data-testid="new-pipeline-user-prompt"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {BUILDER_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300 hover:border-orange-500 hover:text-orange-300"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* Output schema */}
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-300">Output schema</p>
            <div className="space-y-1.5">
              {(
                [
                  { value: 'single-label', label: 'Single label (string)' },
                  {
                    value: 'label-confidence',
                    label: 'Label + confidence ({ label, confidence })',
                  },
                  { value: 'boolean', label: 'Boolean (true/false)' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-neutral-200"
                >
                  <input
                    type="radio"
                    name="outputSchema"
                    value={opt.value}
                    checked={outputSchema === opt.value}
                    onChange={() => setOutputSchema(opt.value)}
                    className="accent-orange-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Advanced options → Studio promotion */}
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-300">
              Advanced options (require Studio)
            </p>
            <div className="space-y-1">
              {STUDIO_ADVANCED_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={onStudioPromotion}
                  className="flex w-full items-center justify-between rounded border border-neutral-800 bg-neutral-800/50 px-3 py-2 text-left text-xs text-neutral-400 hover:border-orange-500/50 hover:text-orange-300"
                  data-testid={`studio-advanced-${opt.replace(/\s+/g, '-').toLowerCase()}`}
                >
                  <span>{opt}</span>
                  <span className="text-orange-400">Studio →</span>
                </button>
              ))}
            </div>
          </div>

          {/* Action */}
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-300">Action when output matches</p>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value as CustomPipelineAction['type'])}
              aria-label="Action type"
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
              data-testid="new-pipeline-action-type"
            >
              <option value="tag-driver">Tag post with driver</option>
              <option value="send-modmail">Send modmail</option>
              <option value="set-status">Set post status</option>
            </select>
            {actionType === 'tag-driver' ? (
              <input
                type="text"
                value={actionDriverId}
                onChange={(e) => setActionDriverId(e.target.value)}
                placeholder="Driver ID (e.g. bug)"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
              />
            ) : actionType === 'send-modmail' ? (
              <textarea
                value={actionModmailTemplate}
                onChange={(e) => setActionModmailTemplate(e.target.value)}
                rows={3}
                placeholder="Modmail body template…"
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-mono text-neutral-100 outline-none focus:border-orange-500"
              />
            ) : (
              <select
                value={actionStatus}
                onChange={(e) => setActionStatus(e.target.value as typeof actionStatus)}
                className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
              >
                <option value="open">Open</option>
                <option value="in-progress">In progress</option>
                <option value="resolved">Resolved</option>
              </select>
            )}
          </div>

          {error ? (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-200">
              {error}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-800 px-6 py-4">
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy || !name.trim() || !systemPrompt.trim() || !userPrompt.trim()}
            className="w-full rounded-md border border-orange-600 bg-orange-600/20 py-2 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50"
            data-testid="new-pipeline-save"
          >
            {busy ? 'Creating…' : 'Create pipeline'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Pipelines({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [studioOpen, setStudioOpen] = useState(false);
  const [drawerPipeline, setDrawerPipeline] = useState<PipelineDef | null>(null);
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);

  return (
    <div className="space-y-6">
      {studioOpen ? <StudioModal onClose={() => setStudioOpen(false)} /> : null}
      {drawerPipeline ? (
        <PipelineDrawer pipeline={drawerPipeline} onClose={() => setDrawerPipeline(null)} />
      ) : null}
      {newPipelineOpen ? (
        <NewPipelineModal
          onClose={() => setNewPipelineOpen(false)}
          onStudioPromotion={() => {
            setNewPipelineOpen(false);
            setStudioOpen(true);
          }}
        />
      ) : null}

      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Active pipelines</h2>
          <p className="mt-1 max-w-2xl text-xs text-neutral-400">
            Every classification and analysis pipeline running on this subreddit. Each pipeline is
            event-driven, failure-isolated, and writes to Redis.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewPipelineOpen(true)}
          className="rounded-md border border-violet-700 bg-violet-900/30 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-900/60"
          data-testid="new-pipeline-button"
        >
          + New pipeline
        </button>
      </header>

      <div data-testid="pipelines-grid" className="space-y-6">
        {/* Group pipeline cards by kind */}
        {(
          [
            'intent classification',
            'sentiment',
            'theme clustering',
            'crisis detection',
            'identity verification',
            'performance',
            'root cause',
          ] as PipelineKind[]
        ).map((k) => {
          const group = PIPELINE_DEFS.filter((p) => p.kind === k);
          if (group.length === 0) return null;
          return (
            <section key={k}>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-widest text-neutral-500">
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.map((p) => (
                  <PipelineCard
                    key={p.id}
                    pipeline={p}
                    onOpenSettings={onOpenSettings}
                    onOpenDrawer={setDrawerPipeline}
                  />
                ))}
              </div>
            </section>
          );
        })}
        <section>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-widest text-neutral-500">
            Custom
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StubPipelineCard onOpen={() => setStudioOpen(true)} />
          </div>
        </section>
      </div>
    </div>
  );
}

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
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">
          Performance · last {lb.days}d
        </h2>
        <AgentLeaderboard rows={lb.rows} />
      </section>
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">Verified roster</h2>
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
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <table className="w-full text-sm">
        <thead className="bg-neutral-950/50 text-left text-xs uppercase tracking-wide text-neutral-400">
          <tr>
            <th className="px-4 py-2">Rep</th>
            <th className="px-4 py-2 text-right">Replies</th>
            <th className="px-4 py-2 text-right">First responses</th>
            <th className="px-4 py-2 text-right">First-response rate</th>
            <th className="px-4 py-2 text-right">Avg first-response latency</th>
            <th className="px-4 py-2 text-right">Sentiment lift</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((r) => (
            <tr key={r.username}>
              <td className="px-4 py-2 font-medium text-neutral-100">u/{r.username}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.replies}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.firstResponses}</td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-300">
                {r.firstResponseRate != null ? `${(r.firstResponseRate * 100).toFixed(0)}%` : '—'}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-300">
                {r.avgLatencyMs != null ? formatLatency(r.avgLatencyMs) : '—'}
              </td>
              <td
                className={`px-4 py-2 text-right tabular-nums ${
                  r.avgSentimentDelta == null
                    ? 'text-neutral-400'
                    : r.avgSentimentDelta > 0.05
                      ? 'text-emerald-300'
                      : r.avgSentimentDelta < -0.05
                        ? 'text-rose-300'
                        : 'text-neutral-300'
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
    <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
      {agents.map((a) => (
        <li key={a.username} className="flex items-center justify-between px-4 py-3">
          <span className="font-medium">u/{a.username}</span>
          <span className="text-xs uppercase tracking-wide text-neutral-400">{a.role}</span>
          <time
            dateTime={isoTime(a.verifiedAt)}
            title={absoluteTime(a.verifiedAt)}
            className="text-xs text-neutral-400"
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
      <span className="text-neutral-400">Views:</span>
      {views.map((v) => (
        <span
          key={v.id}
          className="group flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900 pl-2.5 pr-1.5 py-0.5 text-neutral-300"
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
            className="ml-0.5 rounded-full p-0.5 text-neutral-400 opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
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
            className="w-36 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-200 outline-none focus:border-orange-500"
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
            className="text-neutral-400 hover:text-neutral-400"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setSaving(true)}
          className="rounded-full border border-dashed border-neutral-700 px-2.5 py-0.5 text-neutral-400 transition hover:border-orange-600 hover:text-orange-400"
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
      return 'border-neutral-600 bg-neutral-800 text-neutral-300';
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
      return 'border-neutral-600 bg-neutral-800 text-neutral-300';
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
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Audit log</h2>
          <p className="mt-1 max-w-xl text-xs text-neutral-400">
            Every mutating mod action, most recent first. Capped at 5 000 entries per installation.
          </p>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-400">Action:</span>
        <button
          type="button"
          aria-pressed={actionFilter === ''}
          onClick={() => setActionFilter('')}
          className={`rounded-full border px-2.5 py-0.5 transition ${
            actionFilter === ''
              ? 'border-orange-500 bg-orange-500/10 text-orange-200'
              : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
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
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-neutral-400">Actor:</span>
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
          className="w-36 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-neutral-200 outline-none focus:border-orange-500"
        />
        <button
          type="button"
          onClick={commitActor}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:border-orange-500"
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
            className="text-neutral-400 underline-offset-2 hover:text-neutral-300 hover:underline"
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
        <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950/50 text-left text-xs uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="px-4 py-2 w-36">Time</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Target</th>
                <th className="px-4 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
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
        className={`cursor-pointer transition ${hasMeta ? 'hover:bg-neutral-800/40' : ''}`}
        onClick={hasMeta ? onToggle : undefined}
        aria-expanded={hasMeta ? expanded : undefined}
      >
        <td className="px-4 py-2 text-xs text-neutral-400 tabular-nums">
          <time dateTime={isoTime(entry.ts)} title={absoluteTime(entry.ts)}>
            {relativeTime(entry.ts)}
          </time>
        </td>
        <td className="px-4 py-2 text-xs text-neutral-300">
          {entry.actor ? `u/${entry.actor}` : <span className="text-neutral-400">—</span>}
        </td>
        <td className="px-4 py-2">
          <AuditActionBadge action={entry.action} />
        </td>
        <td className="px-4 py-2 text-xs text-neutral-400">
          {entry.target ?? <span className="text-neutral-400">—</span>}
        </td>
        <td className="px-4 py-2 text-right">
          {hasMeta ? (
            <span className="text-neutral-400 transition hover:text-neutral-300">
              {expanded ? '▲' : '▼'}
            </span>
          ) : null}
        </td>
      </tr>
      {expanded && hasMeta ? (
        <tr>
          <td colSpan={5} className="bg-neutral-950/40 px-4 py-3">
            <pre className="overflow-x-auto rounded border border-neutral-800 bg-neutral-900 p-3 text-[11px] text-neutral-300">
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
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">Data export</h2>
        <p className="mb-4 max-w-2xl text-sm text-neutral-400">
          RedLattice keeps the operational hot data in Devvit Redis. For longer retention, cross-sub
          analytics, or pulling into your own warehouse (BigQuery, Snowflake, Sprinklr), export the
          most recent posts as CSV. Endpoint is mod-only and same-origin to the dashboard.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/export/posts.csv?limit=500"
            target="_top"
            rel="noopener noreferrer"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 transition hover:border-orange-500 hover:text-orange-300"
          >
            Download recent 500 posts (CSV)
          </a>
          <a
            href="/api/export/posts.csv?limit=1000"
            target="_top"
            rel="noopener noreferrer"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 transition hover:border-orange-500 hover:text-orange-300"
          >
            Download recent 1000 posts (CSV)
          </a>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">REST endpoints</h2>
        <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4 font-mono text-xs text-neutral-300">
          <div>GET /api/dashboard/summary</div>
          <div>GET /api/dashboard/recent-posts?limit=N</div>
          <div>GET /api/drivers/taxonomy</div>
          <div>GET /api/drivers/volume?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</div>
          <div>GET /api/drivers/&lt;driverId&gt;/posts?limit=N</div>
          <div>GET /api/sentiment/rollup?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</div>
          <div>GET /api/agents</div>
          <div>GET /api/export/posts.csv?limit=N</div>
        </div>
        <p className="mt-3 max-w-2xl text-xs text-neutral-400">
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
        : 'text-neutral-100';
  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      <div className={`mt-2 truncate text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-1 text-xs text-neutral-400">{sub}</div>
    </article>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
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
          className="h-14 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
        />
      ))}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-400">
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
