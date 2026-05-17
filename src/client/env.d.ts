/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional Sentry DSN for client-side error tracking (hobby tier). */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
