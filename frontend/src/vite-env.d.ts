/// <reference types="vite/client" />

declare const __RELEASE_PROVENANCE__: Readonly<{
  commitSha: string;
  buildTimestamp: string;
}>;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SOCKET_URL?: string;
  readonly VITE_API_DOCS_URL?: string;
  readonly VITE_LOCATION_MODE?: 'REAL' | 'SIMULATION';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
