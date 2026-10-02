import type { RoomDurableObject } from './room';

/** Worker bindings. Secrets are optional so the core free workflow runs without them. */
export interface Env {
  ROOM: DurableObjectNamespace<RoomDurableObject>;
  DB: D1Database;
  ASSETS: Fetcher;
  SERVICE_ORIGIN: string;
  SHARED_AUTH_ISSUER: string;
  BILLING_GRACE_DAYS: string;
  // Payments (Increment 3) — absent in dev; billing endpoints degrade honestly.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
}
