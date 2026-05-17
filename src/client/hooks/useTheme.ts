/**
 * useTheme — three-state theme management: system | dark | light
 *
 * Persists to localStorage under 'rl-theme'. Applies via data-theme
 * attribute on <html>. CSS @media prefers-color-scheme handles the
 * 'system' case natively (no JS needed for that path).
 *
 * localStorage is an intentional exception to our "no localStorage"
 * rule — theme preference is a pure UX setting, not application state,
 * and it must be read synchronously before paint to avoid FOUC.
 */

import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'dark' | 'light';

const STORAGE_KEY = 'rl-theme';

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    /* SSR / storage blocked */
  }
  return 'system';
}

function applyTheme(mode: ThemeMode) {
  const html = document.documentElement;
  if (mode === 'system') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', mode);
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(readStored);

  // Apply on mount and whenever theme changes
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage blocked — apply in-memory only */
    }
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
  }, []);

  const cycle = useCallback(() => {
    setThemeState((prev) => {
      const order: ThemeMode[] = ['system', 'dark', 'light'];
      return order[(order.indexOf(prev) + 1) % order.length] ?? 'system';
    });
  }, []);

  return { theme, setTheme, cycle };
}
