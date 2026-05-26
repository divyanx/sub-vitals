import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ModsOnlyLanding } from './components/ModsOnlyLanding.tsx';
import { useBrandAccent } from './hooks/useBrandAccent.ts';
import type { DashboardProps } from './views/Dashboard.tsx';
import { Dashboard } from './views/Dashboard.tsx';
import { Pulse } from './views/Pulse.tsx';

interface MeResponse {
  isMod: boolean;
  username: string | null;
  subredditName: string | null;
}

async function fetchMe(): Promise<MeResponse> {
  const r = await fetch('/api/me');
  if (!r.ok) return { isMod: false, username: null, subredditName: null };
  return (await r.json()) as MeResponse;
}

type View = 'pulse' | 'dashboard';

type Tab = NonNullable<DashboardProps['initialTab']>;

// ---------------------------------------------------------------------------
// Legacy tab → new canonical tab mapping
// ---------------------------------------------------------------------------
const LEGACY_TAB_MAP: Record<string, Tab> = {
  // Old primary tabs → Posts
  inbox: 'posts',
  triage: 'posts',
  content: 'posts',
  watch: 'posts',
  respond: 'posts',
  overview: 'posts',
  pulse: 'posts',
  insights: 'posts',
  drivers: 'posts',
  sentiment: 'posts',
  themes: 'posts',
  incidents: 'posts',
  agents: 'posts',
  team: 'posts',
  // Old configure sub-sections that are now primary tabs
  rules: 'rules',
  pipelines: 'pipelines',
  // Catalogue is no longer a primary tab — landing on Pipelines will
  // auto-open the catalogue modal via Dashboard's URL handler.
  catalogue: 'pipelines',
  // Old configure → Settings
  configure: 'settings',
  settings: 'settings',
  audit: 'settings',
  export: 'settings',
  lab: 'settings',
  webhooks: 'settings',
};

// Old configure section → new SettingsSection name mapping
const SECTION_REMAP: Record<string, string> = {
  'team-roster': 'team',
  pipelines: 'brand', // pipelines moved to primary tab
  rules: 'brand', // rules moved to primary tab
};

type InitialState =
  | { view: 'pulse' }
  | {
      view: 'dashboard';
      initialTab: Tab;
      initialSection?: string;
      initialInstance?: string;
      initialDriver?: string;
    };

function readInitialState(): InitialState {
  if (typeof window === 'undefined') {
    return { view: 'dashboard', initialTab: 'posts' };
  }
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  if (viewParam === 'pulse') return { view: 'pulse' };

  const rawTab = params.get('tab');

  // Determine canonical tab
  let resolvedTab: Tab = 'posts';
  if (rawTab) {
    if (
      rawTab === 'posts' ||
      rawTab === 'pipelines' ||
      rawTab === 'catalogue' ||
      rawTab === 'rules' ||
      rawTab === 'settings'
    ) {
      resolvedTab = rawTab as Tab;
    } else if (rawTab in LEGACY_TAB_MAP) {
      resolvedTab = LEGACY_TAB_MAP[rawTab] as Tab;
    }
  }

  // Derive settings section
  let initialSection: string | undefined;
  if (resolvedTab === 'settings') {
    const rawSection = params.get('section');
    if (rawSection) {
      initialSection = SECTION_REMAP[rawSection] ?? rawSection;
    } else if (rawTab && rawTab !== 'settings' && rawTab !== 'configure') {
      // Legacy tab name maps to a settings section
      const TAB_TO_SECTION: Record<string, string> = {
        audit: 'audit',
        export: 'export',
        lab: 'lab',
        webhooks: 'webhooks',
        settings: 'brand',
        configure: 'brand',
      };
      initialSection = TAB_TO_SECTION[rawTab] ?? 'brand';
    }
  }

  // Derive pipeline instance
  let initialInstance: string | undefined;
  if (resolvedTab === 'pipelines') {
    const inst = params.get('instance');
    if (inst) initialInstance = inst;
  }

  const driverParam = params.get('driver');

  return {
    view: 'dashboard',
    initialTab: resolvedTab,
    ...(initialSection ? { initialSection } : {}),
    ...(initialInstance ? { initialInstance } : {}),
    ...(driverParam ? { initialDriver: driverParam } : {}),
  };
}

export function App() {
  useBrandAccent();
  const initial = useMemo(readInitialState, []);
  const [view, setView] = useState<View>(initial.view);

  // Mod-status check — SubVitals is a mod tool; non-mods see a friendly
  // landing instead of broken loading states. Server still enforces via
  // requireMod on every endpoint; this is the UX layer.
  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    staleTime: 5 * 60 * 1000, // 5 min — mod status changes rarely
  });

  if (view === 'pulse') {
    return <Pulse onOpenDashboard={() => setView('dashboard')} />;
  }

  // Show a quiet skeleton during the initial mod-check (sub-second).
  if (meQ.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="h-3 w-32 animate-pulse rounded-full bg-[var(--n-4)]" />
      </div>
    );
  }

  // Non-mods get the friendly landing — same chrome as the dashboard
  // header so it doesn't feel like an error page.
  if (!meQ.data?.isMod) {
    return <ModsOnlyLanding subredditName={meQ.data?.subredditName ?? null} />;
  }

  const dashProps = initial.view === 'dashboard' ? initial : { initialTab: 'posts' as Tab };
  const initialSection =
    'initialSection' in dashProps && typeof dashProps.initialSection === 'string'
      ? dashProps.initialSection
      : undefined;
  const initialInstance =
    'initialInstance' in dashProps && typeof dashProps.initialInstance === 'string'
      ? dashProps.initialInstance
      : undefined;
  const initialDriver =
    'initialDriver' in dashProps && typeof dashProps.initialDriver === 'string'
      ? dashProps.initialDriver
      : undefined;

  return (
    <Dashboard
      initialTab={dashProps.initialTab}
      initialSection={initialSection}
      initialInstance={initialInstance}
      initialDriver={initialDriver}
    />
  );
}
