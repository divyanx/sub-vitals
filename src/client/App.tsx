import { useMemo, useState } from 'react';
import type { DashboardProps } from './views/Dashboard.tsx';
import { Dashboard } from './views/Dashboard.tsx';
import { Pulse } from './views/Pulse.tsx';

type View = 'pulse' | 'dashboard';

type Tab = NonNullable<DashboardProps['initialTab']>;

const VALID_TABS: Tab[] = [
  'inbox',
  'overview',
  'drivers',
  'sentiment',
  'incidents',
  'themes',
  'agents',
  'export',
  'audit',
  'settings',
];

type InitialState =
  | { view: 'pulse' }
  | { view: 'dashboard'; initialTab: Tab; initialDriver?: string };

function readInitialState(): InitialState {
  if (typeof window === 'undefined') {
    return { view: 'dashboard', initialTab: 'inbox' };
  }
  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view');
  if (viewParam === 'pulse') return { view: 'pulse' };

  const tabParam = params.get('tab') as Tab | null;
  const initialTab: Tab =
    tabParam && (VALID_TABS as string[]).includes(tabParam) ? tabParam : 'inbox';
  const driverParam = params.get('driver');
  if (driverParam) {
    return { view: 'dashboard', initialTab, initialDriver: driverParam };
  }
  return { view: 'dashboard', initialTab };
}

export function App() {
  const initial = useMemo(readInitialState, []);
  const [view, setView] = useState<View>(initial.view);

  if (view === 'pulse') {
    return <Pulse onOpenDashboard={() => setView('dashboard')} />;
  }
  const dashProps = initial.view === 'dashboard' ? initial : { initialTab: 'inbox' as Tab };
  return (
    <Dashboard
      initialTab={dashProps.initialTab}
      {...('initialDriver' in dashProps && dashProps.initialDriver !== undefined
        ? { initialDriver: dashProps.initialDriver }
        : {})}
    />
  );
}
