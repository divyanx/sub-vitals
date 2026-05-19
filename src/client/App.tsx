import { useMemo, useState } from 'react';
import type { DashboardProps } from './views/Dashboard.tsx';
import { Dashboard } from './views/Dashboard.tsx';
import { Pulse } from './views/Pulse.tsx';

type View = 'pulse' | 'dashboard';

type Tab = NonNullable<DashboardProps['initialTab']>;

// Legacy tab aliases — redirect to new canonical tabs on load
const LEGACY_TAB_MAP: Record<string, Tab> = {
  inbox: 'triage',
  overview: 'watch',
  pulse: 'watch',
  insights: 'watch',
  drivers: 'watch',
  sentiment: 'watch',
  themes: 'watch',
  incidents: 'watch',
  agents: 'respond',
  team: 'respond',
  pipelines: 'configure',
  rules: 'configure',
  export: 'configure',
  audit: 'configure',
  lab: 'configure',
  settings: 'configure',
};

type InitialState =
  | { view: 'pulse' }
  | { view: 'dashboard'; initialTab: Tab; initialSection: string; initialDriver: string }
  | { view: 'dashboard'; initialTab: Tab; initialSection: string }
  | { view: 'dashboard'; initialTab: Tab; initialDriver: string }
  | { view: 'dashboard'; initialTab: Tab };

function readInitialState(): InitialState {
  if (typeof window === 'undefined') {
    return { view: 'dashboard', initialTab: 'triage' };
  }
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  if (viewParam === 'pulse') return { view: 'pulse' };

  const rawTab = params.get('tab');

  // Determine canonical tab
  let resolvedTab: Tab = 'triage';
  if (rawTab) {
    if (
      rawTab === 'triage' ||
      rawTab === 'content' ||
      rawTab === 'watch' ||
      rawTab === 'respond' ||
      rawTab === 'configure'
    ) {
      resolvedTab = rawTab as Tab;
    } else if (rawTab in LEGACY_TAB_MAP) {
      resolvedTab = LEGACY_TAB_MAP[rawTab] as Tab;
    }
  }

  // Derive configure section from legacy tab names
  let initialSection: string | undefined;
  if (resolvedTab === 'configure') {
    const rawSection = params.get('section');
    if (rawSection) {
      initialSection = rawSection;
    } else if (rawTab && rawTab in LEGACY_TAB_MAP && LEGACY_TAB_MAP[rawTab] === 'configure') {
      // Map old tab names to configure sections
      const TAB_TO_SECTION: Record<string, string> = {
        pipelines: 'pipelines',
        rules: 'rules',
        export: 'export',
        audit: 'audit',
        lab: 'lab',
        settings: 'brand',
      };
      initialSection = TAB_TO_SECTION[rawTab] ?? 'pipelines';
    }
  }

  const driverParam = params.get('driver');
  if (driverParam && initialSection) {
    return {
      view: 'dashboard',
      initialTab: resolvedTab,
      initialSection,
      initialDriver: driverParam,
    };
  }
  if (driverParam) {
    return { view: 'dashboard', initialTab: resolvedTab, initialDriver: driverParam };
  }
  if (initialSection) {
    return { view: 'dashboard', initialTab: resolvedTab, initialSection };
  }
  return { view: 'dashboard', initialTab: resolvedTab };
}

export function App() {
  const initial = useMemo(readInitialState, []);
  const [view, setView] = useState<View>(initial.view);

  if (view === 'pulse') {
    return <Pulse onOpenDashboard={() => setView('dashboard')} />;
  }
  const dashProps = initial.view === 'dashboard' ? initial : { initialTab: 'triage' as Tab };
  const initialSection: string | undefined =
    'initialSection' in dashProps && typeof dashProps.initialSection === 'string'
      ? dashProps.initialSection
      : undefined;
  const initialDriver: string | undefined =
    'initialDriver' in dashProps && typeof dashProps.initialDriver === 'string'
      ? dashProps.initialDriver
      : undefined;
  return (
    <Dashboard
      initialTab={dashProps.initialTab}
      initialSection={initialSection}
      initialDriver={initialDriver}
    />
  );
}
