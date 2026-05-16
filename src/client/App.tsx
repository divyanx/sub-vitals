import { useMemo, useState } from 'react';
import { Dashboard } from './views/Dashboard.tsx';
import { Pulse } from './views/Pulse.tsx';

type View = 'pulse' | 'dashboard';

function readInitialView(): View {
  if (typeof window === 'undefined') return 'dashboard';
  const v = new URLSearchParams(window.location.search).get('view');
  return v === 'pulse' ? 'pulse' : 'dashboard';
}

export function App() {
  const initial = useMemo(readInitialView, []);
  const [view, setView] = useState<View>(initial);

  if (view === 'pulse') {
    return <Pulse onOpenDashboard={() => setView('dashboard')} />;
  }
  return <Dashboard />;
}
