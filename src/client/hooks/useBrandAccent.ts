import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../lib/api.ts';
import { applyAccentStops } from '../lib/brand-accent.ts';

const DEFAULT_ACCENT = '#FF4500';

/**
 * Reads 'brand-accent' from /api/settings and stamps --accent-* CSS variables
 * onto <html>. Must be called once at the App root level.
 *
 * Falls back to Reddit orange (#FF4500) when no override is saved.
 * Re-runs whenever settings change (query invalidation).
 */
export function useBrandAccent(): void {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings.get(),
    staleTime: 5 * 60 * 1000, // 5 min
  });

  useEffect(() => {
    const hex =
      (data as { 'brand-accent'?: string } | undefined)?.['brand-accent'] ?? DEFAULT_ACCENT;
    applyAccentStops(hex);
  }, [data]);
}
