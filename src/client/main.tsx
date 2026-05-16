import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      // Treat data as stale after 10s so a manual refetch is quick; auto-poll
      // every 30s so new posts/sentiment scores appear without a manual refresh.
      staleTime: 10_000,
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
