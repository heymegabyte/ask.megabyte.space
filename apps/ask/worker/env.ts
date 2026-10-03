import type { AiRunner } from './features/enrichment/service';
import type { RoomDurableObject } from './room';

/** Minimal shape of a Cloudflare rate-limiting binding (avoids a hard dep on the generated type). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Worker bindings. Secrets are optional so the core free workflow runs without them. */
export interface Env {
  ROOM: DurableObjectNamespace<RoomDurableObject>;
  DB: D1Database;
  ASSETS: Fetcher;
  SERVICE_ORIGIN: string;
  SHARED_AUTH_ISSUER: string;
  BILLING_GRACE_DAYS: string;
  /** Gates the AI enrichment feature (§6). "1" = on (default), "0" = honest-off. */
  ENRICHMENT_ENABLED?: string;
  /** Workers AI binding (§6). Optional — enrichment no-ops honestly when absent. */
  AI?: AiRunner;
  /** CF rate-limit bindings (§17 abuse controls). Optional — no-op when unbound (local/dev). */
  CREATE_LIMIT?: RateLimiter;
  WRITE_LIMIT?: RateLimiter;
  // Payments (Increment 3) — absent in dev; billing endpoints degrade honestly.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
}
