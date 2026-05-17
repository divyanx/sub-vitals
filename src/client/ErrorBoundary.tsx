import * as Sentry from '@sentry/react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Used to reset the boundary when the parent decides the context changed (e.g. tab id). */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
    // Report to Sentry when DSN is configured; no-ops if Sentry wasn't init'd.
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack ?? '' } },
    });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-6 text-sm text-rose-100">
          <div className="font-semibold">Something went wrong rendering this view.</div>
          <pre className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap text-xs text-rose-200/80">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded border border-rose-700 bg-rose-900/40 px-3 py-1 text-xs text-rose-100 hover:bg-rose-900/70"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
