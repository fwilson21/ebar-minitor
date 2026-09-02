/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Lo inyecta vite.config.ts (`define`) en tiempo de compilación — timestamp (ms) del build.
declare const __BUILD_TIME__: number;
