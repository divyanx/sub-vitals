/**
 * RuleFiringsPanel — collapsible panel showing last 10 rule firings.
 * Derives from the rules list (lastFiredAt + fireCount on each Rule).
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Rule } from '../../shared/rules-types.ts';
import { relativeTime } from '../lib/format-time.ts';

async function fetchRules(): Promise<{ count: number; rules: Rule[] }> {
  const res = await fetch('/api/rules', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('Failed to fetch rules');
  return res.json() as Promise<{ count: number; rules: Rule[] }>;
}

interface RuleFiringsPanelProps {
  onOpenRules: () => void;
}

export function RuleFiringsPanel({ onOpenRules }: RuleFiringsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const rulesQ = useQuery({
    queryKey: ['rules-list'],
    queryFn: fetchRules,
    staleTime: 30_000,
  });

  const rules = rulesQ.data?.rules ?? [];

  // Only rules that have fired at least once, sorted by lastFiredAt desc
  const recentFirings = rules
    .filter((r) => r.fireCount > 0 && r.lastFiredAt !== undefined)
    .sort((a, b) => (b.lastFiredAt ?? 0) - (a.lastFiredAt ?? 0))
    .slice(0, 10);

  const hasRules = rules.length > 0;

  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)]"
      aria-label="Recent rule firings"
    >
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls="rule-firings-body"
      >
        <div className="flex items-center gap-2">
          <svg
            className="h-3.5 w-3.5 text-orange-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-sm font-semibold text-[var(--text)]">Recent rule firings</span>
          {recentFirings.length > 0 && (
            <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-medium text-orange-400">
              {recentFirings.length}
            </span>
          )}
        </div>
        <svg
          className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${collapsed ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {!collapsed && (
        <div id="rule-firings-body" className="border-t border-[var(--border)] px-4 pb-4 pt-3">
          {rulesQ.isPending && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-[var(--border)]" />
              ))}
            </div>
          )}

          {!rulesQ.isPending && !hasRules && (
            <div className="py-4 text-center">
              <p className="text-sm text-[var(--text-muted)]">No automation rules yet.</p>
              <button
                type="button"
                onClick={onOpenRules}
                className="mt-2 text-xs text-orange-400 underline underline-offset-2 hover:text-orange-300"
              >
                Visit Rules tab to create one
              </button>
            </div>
          )}

          {!rulesQ.isPending && hasRules && recentFirings.length === 0 && (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">
              No rules have fired yet.
            </p>
          )}

          {recentFirings.length > 0 && (
            <ul className="divide-y divide-[var(--border)]">
              {recentFirings.map((rule) => {
                const action = rule.actions[0];
                const actionLabel = action
                  ? action.type === 'set-status'
                    ? `Set status → ${action.status}`
                    : action.type === 'send-modmail'
                      ? 'Send modmail'
                      : action.type === 'tag-post'
                        ? `Tag post → ${action.value}`
                        : action.type
                  : '—';

                return (
                  <li key={rule.id} className="flex flex-col gap-0.5 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[var(--text)]">{rule.name}</span>
                      <span className="shrink-0 text-[var(--text-muted)]">
                        {relativeTime(rule.lastFiredAt ?? 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[var(--text-muted)]">
                      <span className="rounded bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[10px]">
                        {rule.trigger}
                      </span>
                      <span>&rarr;</span>
                      <span>{actionLabel}</span>
                      {rule.fireCount > 0 && (
                        <span className="ml-auto text-[var(--text-muted)]">
                          &times;{rule.fireCount} total
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
