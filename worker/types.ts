/** Bindings are never bundled into the browser application. */
export interface Env {
  DB: D1Database
  SESSION_PEPPER: string
  /** Remove/rotate after bootstrap. Existing owner accounts cannot be replaced. */
  SETUP_TOKEN?: string
  ASSETS?: Fetcher
}
