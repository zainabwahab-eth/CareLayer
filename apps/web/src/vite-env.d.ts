/// <reference types="vite/client" />

// Only VITE_* variables reach the browser. Never put secrets in them. See .env.example.
interface ImportMetaEnv {
  /** apps/api base URL, e.g. http://localhost:4000 */
  readonly VITE_API_URL?: string;
  /** "true" = use the in-browser mock API instead of apps/api. */
  readonly VITE_USE_MOCK_API?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Health workers' app (apps/workers), linked from the landing page. */
  readonly VITE_WORKERS_APP_URL?: string;
  /** Hosted CareLayer MCP server, shown on Account → Use CareLayer in Claude. */
  readonly VITE_MCP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
