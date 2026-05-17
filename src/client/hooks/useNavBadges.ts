/**
 * useNavBadges — derives badge counts for nav tabs from existing queries.
 *
 * Inbox: count of 'open' status posts from triageQueue.
 * Incidents: count of 'active' incidents.
 * Themes: dot indicator when a regenerated snapshot exists
 *         and the user hasn't visited Themes since last regeneration.
 *
 * Data is already fetched by the tabs themselves — this hook just reads
 * from the React Query cache via useQueryClient to avoid duplicate fetches.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';

export interface NavBadges {
  inbox: number; // open post count
  incidents: number; // active incident count
  themesDot: boolean; // new themes generated since last visit
}

export function useNavBadges(): NavBadges {
  const inboxQ = useQuery({
    queryKey: ['triage-queue', 'open'],
    queryFn: () => api.triageQueue({ status: 'open' }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const incidentsQ = useQuery({
    queryKey: ['incidents', 'active'],
    queryFn: () => api.incidents('active'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const themesQ = useQuery({
    queryKey: ['themes'],
    queryFn: api.themes,
    staleTime: 300_000,
  });

  const inbox = inboxQ.data?.items?.length ?? 0;
  const incidents = incidentsQ.data?.count ?? 0;

  // Themes dot: show when generatedAt exists and is newer than last theme visit
  // We persist the last-visit timestamp in a module-scoped variable (no
  // localStorage needed — resets on page reload, which is acceptable).
  const generatedAt = themesQ.data?.generatedAt ?? null;
  const themesDot = generatedAt != null && generatedAt > _lastThemesVisit;

  return { inbox, incidents, themesDot };
}

// Module-scoped visit timestamp — reset on page reload
let _lastThemesVisit = 0;

/** Call this when the user navigates to the Themes tab. */
export function markThemesVisited() {
  _lastThemesVisit = Date.now();
}
