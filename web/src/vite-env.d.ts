/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "false" to talk to a real Django server instead of MSW fixtures. */
  readonly VITE_API_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
