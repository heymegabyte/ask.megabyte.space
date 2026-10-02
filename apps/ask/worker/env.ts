import type { AiRunner } from './features/enrichment/service';
import type { RoomDurableObject } from './room';

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
  // Payments (Increment 3) — absent in dev; billing endpoints degrade honestly.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
}
