/**
 * useCopilotChat — conversation state + send/execute helpers.
 *
 * Single-active-conversation model. Resuming an old conversation swaps the
 * local message buffer; sending a message POSTs to /api/copilot/chat which
 * persists the full transcript server-side. Tool calls are surfaced inline
 * via the returned messages; write-tool confirmation goes through
 * `executeToolCall`.
 */

import { useCallback, useState } from 'react';
import { api, type CopilotMessageWire } from '../lib/api.ts';

export interface CopilotChatContext {
  currentTab?: string;
  currentInstanceId?: string;
  currentPostId?: string;
}

export interface UseCopilotChatResult {
  messages: CopilotMessageWire[];
  conversationId: string | null;
  isSending: boolean;
  error: string | null;
  send: (text: string, ctx?: CopilotChatContext) => Promise<void>;
  executeToolCall: (messageId: string, toolCallId: string) => Promise<void>;
  startNew: () => void;
  loadConversation: (id: string) => Promise<void>;
}

export function useCopilotChat(): UseCopilotChatResult {
  const [messages, setMessages] = useState<CopilotMessageWire[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string, ctx?: CopilotChatContext) => {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;

      // Optimistic user message
      const userMsg: CopilotMessageWire = {
        id: `local_${Date.now()}`,
        role: 'user',
        content: trimmed,
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsSending(true);
      setError(null);

      try {
        const res = await api.copilot.chat({
          message: trimmed,
          ...(conversationId ? { conversationId } : {}),
          ...(ctx ? { context: ctx } : {}),
        });
        setConversationId(res.conversationId);
        setMessages((prev) => [...prev, res.message]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsSending(false);
      }
    },
    [conversationId, isSending],
  );

  const executeToolCall = useCallback(
    async (messageId: string, toolCallId: string) => {
      if (!conversationId) return;
      try {
        const res = await api.copilot.execute({ conversationId, messageId, toolCallId });
        // Patch the local message's tool-call entry with the committed result.
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId || !m.toolCalls) return m;
            return {
              ...m,
              toolCalls: m.toolCalls.map((tc) =>
                tc.id === toolCallId
                  ? {
                      ...tc,
                      committed: {
                        ok: res.ok,
                        ...(res.result !== undefined ? { result: res.result } : {}),
                        ...(res.error !== undefined ? { error: res.error } : {}),
                        at: Date.now(),
                      },
                    }
                  : tc,
              ),
            };
          }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [conversationId],
  );

  const startNew = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const res = await api.copilot.conversation(id);
      setConversationId(res.conversation.id);
      setMessages(res.conversation.messages);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return {
    messages,
    conversationId,
    isSending,
    error,
    send,
    executeToolCall,
    startNew,
    loadConversation,
  };
}
