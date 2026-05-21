/**
 * CopilotPanel — slide-in right-side chat surface.
 *
 * Renders:
 *   - Floating button (bottom-right, ✨) to toggle
 *   - Right panel (420px desktop, full-screen mobile)
 *   - Header with title + "New" + close
 *   - Message list (user / assistant / tool-call cards)
 *   - Footer textarea (Cmd-Enter to send, Enter for newline)
 *
 * Context awareness — accepts `currentTab` / `currentPostId` /
 * `currentInstanceId` props so tool calls can default to "this post" etc.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCopilotChat } from '../hooks/useCopilotChat.ts';
import type { CopilotMessageWire, CopilotToolCallWire } from '../lib/api.ts';

export interface CopilotPanelProps {
  currentTab?: string;
  currentInstanceId?: string;
  currentPostId?: string;
}

export function CopilotPanel(props: CopilotPanelProps) {
  const [open, setOpen] = useState(false);
  const chat = useCopilotChat();
  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');

  // Auto-scroll on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolling intentionally tracks both message arrivals and sending state pulses
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [chat.messages.length, chat.isSending]);

  const ctx = useMemo(
    () => ({
      ...(props.currentTab ? { currentTab: props.currentTab } : {}),
      ...(props.currentInstanceId ? { currentInstanceId: props.currentInstanceId } : {}),
      ...(props.currentPostId ? { currentPostId: props.currentPostId } : {}),
    }),
    [props.currentTab, props.currentInstanceId, props.currentPostId],
  );

  const onSubmit = async () => {
    const text = draft.trim();
    if (!text || chat.isSending) return;
    setDraft('');
    await chat.send(text, ctx);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter sends; plain Enter inserts newline.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void onSubmit();
    }
  };

  return (
    <>
      {/* Floating trigger */}
      <button
        type="button"
        aria-label={open ? 'Close Copilot' : 'Open Copilot'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="copilot-fab"
        className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full bg-[var(--accent-9)] text-white shadow-[var(--shadow-2)] hover:bg-[var(--accent-10)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-9)] flex items-center justify-center text-xl"
      >
        <span aria-hidden>✨</span>
      </button>

      {/* Panel */}
      {open && (
        <aside
          role="dialog"
          aria-label="RedLattice Copilot"
          data-testid="copilot-panel"
          className="fixed inset-y-0 right-0 z-50 w-full md:w-[420px] bg-[var(--n-2)] border-l border-[var(--n-4)] flex flex-col shadow-[var(--shadow-3)]"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--n-4)]">
            <div className="flex items-center gap-2">
              <span aria-hidden>✨</span>
              <h2 className="text-[length:var(--t-sm)] font-semibold text-[var(--n-12)]">
                Copilot
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={chat.startNew}
                className="text-[length:var(--t-xs)] text-[var(--n-8)] hover:text-[var(--n-11)] px-2 py-1 rounded-[var(--r-1)]"
                data-testid="copilot-new"
              >
                New
              </button>
              <button
                type="button"
                aria-label="Close Copilot"
                onClick={() => setOpen(false)}
                data-testid="copilot-close"
                className="text-[var(--n-8)] hover:text-[var(--n-11)] text-lg leading-none px-2"
              >
                ×
              </button>
            </div>
          </header>

          <div
            ref={listRef}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
            data-testid="copilot-messages"
          >
            {chat.messages.length === 0 && <EmptyState />}
            {chat.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onConfirm={(tcId) => chat.executeToolCall(m.id, tcId)}
              />
            ))}
            {chat.isSending && (
              <div className="text-[length:var(--t-xs)] text-[var(--n-8)] italic animate-pulse">
                Copilot is thinking…
              </div>
            )}
            {chat.error && (
              <div className="text-[length:var(--t-xs)] text-[var(--error-11)]" role="alert">
                {chat.error}
              </div>
            )}
          </div>

          <footer className="border-t border-[var(--n-4)] p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              rows={2}
              placeholder="Ask anything. Cmd-Enter to send."
              aria-label="Message Copilot"
              data-testid="copilot-input"
              className="w-full resize-none rounded-[var(--r-2)] bg-[var(--n-3)] border border-[var(--n-4)] px-2 py-1.5 text-[length:var(--t-sm)] text-[var(--n-11)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-9)]"
            />
            <div className="flex justify-end mt-2">
              <button
                type="button"
                onClick={onSubmit}
                disabled={!draft.trim() || chat.isSending}
                data-testid="copilot-send"
                className="text-[length:var(--t-xs)] px-3 py-1.5 rounded-[var(--r-2)] bg-[var(--accent-9)] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--accent-10)]"
              >
                Send
              </button>
            </div>
          </footer>
        </aside>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <div className="text-[length:var(--t-xs)] text-[var(--n-8)] space-y-2 px-1">
      <p className="font-medium text-[var(--n-11)]">Try one of these:</p>
      <ul className="list-disc list-inside space-y-1">
        <li>“Show me posts flagged as bug in the last 7 days”</li>
        <li>“Which pipelines are installed?”</li>
        <li>“Install the spam detector and enable it”</li>
        <li>“What’s our AI spend this month?”</li>
      </ul>
    </div>
  );
}

function MessageBubble(props: {
  message: CopilotMessageWire;
  onConfirm: (toolCallId: string) => Promise<void>;
}) {
  const { message, onConfirm } = props;
  const isUser = message.role === 'user';
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid={`copilot-msg-${message.role}`}
    >
      <div
        className={`max-w-[88%] rounded-[var(--r-2)] px-3 py-2 text-[length:var(--t-sm)] whitespace-pre-wrap ${
          isUser ? 'bg-[var(--accent-3)] text-[var(--n-11)]' : 'bg-[var(--n-3)] text-[var(--n-11)]'
        }`}
      >
        {message.content}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} onConfirm={() => onConfirm(tc.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCallCard(props: { toolCall: CopilotToolCallWire; onConfirm: () => Promise<void> }) {
  const { toolCall, onConfirm } = props;
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <div
        className="rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-8)]"
        data-testid="copilot-tool-dismissed"
      >
        ⊘ {toolCall.name} — cancelled
      </div>
    );
  }

  // Read tool — just show name + result count if possible
  if (toolCall.preview === undefined && toolCall.committed === undefined) {
    return (
      <div
        className="rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-8)]"
        data-testid="copilot-tool-read"
      >
        🔍 {toolCall.name}
        {toolCall.result !== undefined && <span className="ml-1 opacity-75">— done</span>}
      </div>
    );
  }

  // Write tool — render preview / confirm / committed states.
  const preview = toolCall.preview;
  const committed = toolCall.committed;

  if (committed) {
    return (
      <div
        className={`rounded-[var(--r-1)] border px-2 py-1 text-[length:var(--t-xs)] ${
          committed.ok
            ? 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]'
            : 'border-[var(--error-9)] bg-[var(--error-3)] text-[var(--error-11)]'
        }`}
        data-testid="copilot-tool-committed"
      >
        {committed.ok ? '✓' : '✗'} {toolCall.name}
        {committed.error ? <span className="ml-1">— {committed.error}</span> : null}
      </div>
    );
  }

  if (preview && preview.ok === false) {
    return (
      <div
        className="rounded-[var(--r-1)] border border-[var(--error-9)] bg-[var(--error-3)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--error-11)]"
        data-testid="copilot-tool-preview-error"
      >
        ⚠ {toolCall.name} — {preview.error ?? 'preview failed'}
      </div>
    );
  }

  return (
    <div
      className="rounded-[var(--r-2)] border border-[var(--accent-9)] bg-[var(--accent-3)] px-2 py-2 text-[length:var(--t-xs)] text-[var(--n-11)] space-y-2"
      data-testid="copilot-tool-confirm"
    >
      <div>
        <span className="font-medium">⚙ {toolCall.name}</span>
        <div className="mt-0.5 text-[var(--n-8)]">{preview?.summary ?? 'Confirm to apply.'}</div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
          data-testid="copilot-confirm"
          className="text-[length:var(--t-xs)] px-2 py-1 rounded-[var(--r-1)] bg-[var(--accent-9)] text-white disabled:opacity-50 hover:bg-[var(--accent-10)]"
        >
          {busy ? 'Working…' : 'Confirm'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setDismissed(true)}
          className="text-[length:var(--t-xs)] px-2 py-1 rounded-[var(--r-1)] border border-[var(--n-4)] text-[var(--n-8)] hover:text-[var(--n-11)]"
          data-testid="copilot-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
