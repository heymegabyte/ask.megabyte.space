/**
 * @ask/contracts — the single source of truth for Ask.
 *
 * Every runtime boundary (web client, Worker REST, MCP tools, agent helper)
 * imports these Zod schemas and infers its types from them. Never hand-maintain
 * a type beside a schema. See docs/protocol.md for the narrative.
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Versioning & limits (starting defaults, documented — not permanent promises)
// ─────────────────────────────────────────────────────────────────────────────

export const API_VERSION = 'v1' as const;
export const PROTOCOL_VERSION = 1 as const;

export const LIMITS = {
  /** Max bytes of a single textual answer (§17). */
  answerTextBytes: 16 * 1024,
  /** Max questions accepted in one batch (§17). */
  questionsPerBatch: 25,
  /** Max bytes of sanitized context attached to a question. */
  questionContextBytes: 4 * 1024,
  /** Slug length bounds (§4). */
  slugMin: 3,
  slugMax: 63,
  /** Minimum poll interval for active agent checkpoints, ms (§9). */
  minPollIntervalMs: 15_000,
  /** Grace period before a lapsed private room becomes read-only, days (§15). */
  billingGraceDays: 7,
} as const;

/** System routes a slug may never shadow (§4). Case-normalized. */
export const RESERVED_SLUGS: readonly string[] = [
  'api',
  'integrations',
  'assets',
  'static',
  'health',
  'robots.txt',
  'sitemap.xml',
  'favicon.ico',
  'login',
  'logout',
  'auth',
  'oauth',
  'callback',
  'billing',
  'webhook',
  'webhooks',
  'admin',
  'new',
  'about',
  'privacy',
  'terms',
  'docs',
  'mcp',
  'sse',
  '_app',
  'well-known',
];

// ─────────────────────────────────────────────────────────────────────────────
// Primitives & IDs — opaque, independent of human-facing slugs (§12)
// ─────────────────────────────────────────────────────────────────────────────

export const RoomId = z.string().regex(/^rm_[0-9a-z]{20,32}$/, 'invalid room id');
export const QuestionId = z.string().regex(/^q_[0-9a-z]{16,32}$/, 'invalid question id');
export const AnswerId = z.string().regex(/^a_[0-9a-z]{16,32}$/, 'invalid answer id');
export const DecisionId = z.string().regex(/^d_[0-9a-z]{16,32}$/, 'invalid decision id');
export const ReceiptId = z.string().regex(/^rcpt_[0-9a-z]{16,32}$/, 'invalid receipt id');
export const ParticipantId = z.string().regex(/^p_[0-9a-z]{16,32}$/, 'invalid participant id');
export const InstallId = z.string().regex(/^ai_[0-9a-z]{16,32}$/, 'invalid installation id');
export const EventId = z.string().regex(/^e_[0-9a-z]{16,32}$/, 'invalid event id');

/**
 * Human-facing slug: lowercase word-based, hyphen-joined, bounded. Must look
 * intentional (word dictionaries, §4), not like a UUID. Enforced in storage.
 */
export const Slug = z
  .string()
  .min(LIMITS.slugMin)
  .max(LIMITS.slugMax)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'slug must be lowercase word-based');

export const IdempotencyKey = z.string().min(8).max(200);
export const Cursor = z.string().max(400);
export const Iso = z.string().datetime();

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const Visibility = z.enum(['public', 'private']);
export type Visibility = z.infer<typeof Visibility>;

export const RoomCreationState = z.enum(['provisional', 'active', 'expired']);
export type RoomCreationState = z.infer<typeof RoomCreationState>;

export const SlugStatus = z.enum(['active', 'alias', 'provisional']);

/** Permission roles — viewing, answering, administration are separate (§4,§14). */
export const Role = z.enum(['owner', 'admin', 'answerer', 'viewer', 'guest']);
export type Role = z.infer<typeof Role>;

export const ParticipantType = z.enum(['guest', 'owner', 'collaborator', 'agent']);
export type ParticipantType = z.infer<typeof ParticipantType>;

/** A caller-supplied agent name never proves identity (§5,§12). */
export const AgentTrust = z.enum(['public_contributor', 'creator_bound']);
export type AgentTrust = z.infer<typeof AgentTrust>;

export const QuestionKind = z.enum([
  'single', // single choice
  'multiple', // multiple choice
  'short_text',
  'long_text',
  'number',
  'range',
  'link',
  'image_comparison',
]);
export type QuestionKind = z.infer<typeof QuestionKind>;

/** Coverage dimensions (§6) — internal ranking aid, not dumped on users. */
export const QuestionCategory = z.enum([
  'purpose',
  'audience',
  'success',
  'scope',
  'workflow',
  'interface',
  'accessibility',
  'delight',
  'data',
  'identity',
  'architecture',
  'performance',
  'offline_recovery',
  'ai_behavior',
  'collaboration',
  'integrations',
  'operations',
  'testing',
  'economics',
  'distribution',
  'maintenance',
  'future',
  'other',
]);
export type QuestionCategory = z.infer<typeof QuestionCategory>;

export const QuestionClass = z.enum(['blocker', 'decision', 'opportunity']);
export type QuestionClass = z.infer<typeof QuestionClass>;

export const Horizon = z.enum(['now', 'next', 'later']);
export type Horizon = z.infer<typeof Horizon>;

export const QuestionState = z.enum([
  'open',
  'answered',
  'dismissed',
  'superseded',
  // Archived: no longer needs answering — stale, or inappropriate for the project (§6).
  'archived',
]);
export type QuestionState = z.infer<typeof QuestionState>;

/** Answer lifecycle status with required evidence (§5). */
export const AnswerStatus = z.enum([
  'answer_saved', // server durably committed
  'agent_downloaded', // an enrolled agent stored that exact revision
  'applied_to_project', // agent reports files/behavior changed
  'verified', // agent-reported validation (not server-inspected)
  'needs_clarification',
  'superseded',
  'deferred',
  'could_not_apply',
]);
export type AnswerStatus = z.infer<typeof AnswerStatus>;

/** Author identity class of an answer revision (§7,§12). */
export const AuthorClass = z.enum(['guest', 'collaborator', 'owner', 'agent', 'system']);
export type AuthorClass = z.infer<typeof AuthorClass>;

/** Normalized meaning an answer carries once interpreted (§10). */
export const DecisionMeaning = z.enum([
  'preference',
  'requirement',
  'constraint',
  'clarification',
  'delegated_choice',
  'future_opportunity',
  'contradiction',
  'revocation',
]);
export type DecisionMeaning = z.infer<typeof DecisionMeaning>;

export const DecisionStatus = z.enum(['active', 'superseded', 'conflicted', 'retracted']);

export const ReceiptState = z.enum(['received', 'considered', 'applied']);
export type ReceiptState = z.infer<typeof ReceiptState>;

export const EntitlementState = z.enum([
  'none', // free / public
  'active', // paid, current
  'grace', // renewal failed, within grace window
  'read_only', // grace elapsed — private + read-only, never public
  'canceled', // paid-through elapsed after normal cancel
]);
export type EntitlementState = z.infer<typeof EntitlementState>;

// ─────────────────────────────────────────────────────────────────────────────
// Question options & answer values
// ─────────────────────────────────────────────────────────────────────────────

export const QuestionOption = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  /** Optional image for image_comparison / illustrated choices. */
  imageUrl: z.string().url().optional(),
  description: z.string().max(400).optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const NumberConstraint = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  unit: z.string().max(24).optional(),
});

/** Structured answer value — discriminated by the shape the question expects. */
export const AnswerValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), selected: z.array(z.string().max(64)).max(50) }),
  z.object({ kind: z.literal('text'), text: z.string().max(LIMITS.answerTextBytes) }),
  z.object({ kind: z.literal('number'), value: z.number() }),
  z.object({ kind: z.literal('link'), url: z.string().url().max(2048) }),
  // Delegation is scoped to THIS decision within current constraints (§5).
  z.object({ kind: z.literal('delegate') }),
  z.object({ kind: z.literal('skip') }),
]);
export type AnswerValue = z.infer<typeof AnswerValue>;

// ─────────────────────────────────────────────────────────────────────────────
// Entities (§12)
// ─────────────────────────────────────────────────────────────────────────────

export const Room = z.object({
  id: RoomId,
  slug: Slug,
  creationState: RoomCreationState,
  visibility: Visibility,
  /** Monotonic access epoch; privacy changes increment it (§13). */
  visibilityEpoch: z.number().int().nonnegative(),
  entitlement: EntitlementState,
  /** Opaque — the owner verifier itself is never returned to clients (§4). */
  hasOwnerClaim: z.boolean(),
  /** Current room-wide event sequence high-water mark. */
  revision: z.number().int().nonnegative(),
  retentionDays: z.number().int().positive().optional(),
  createdAt: Iso,
  updatedAt: Iso,
});
export type Room = z.infer<typeof Room>;

export const SlugMapping = z.object({
  slug: Slug,
  roomId: RoomId,
  status: SlugStatus,
  createdAt: Iso,
});
export type SlugMapping = z.infer<typeof SlugMapping>;

export const Participant = z.object({
  id: ParticipantId,
  type: ParticipantType,
  /** Display handle — self-selected, never proof of identity. */
  handle: z.string().min(1).max(60),
  role: Role,
  connected: z.boolean(),
  lastSeenAt: Iso.optional(),
});
export type Participant = z.infer<typeof Participant>;

/**
 * A git repository identity, normalized to lowercase `owner/name`
 * (e.g. "heymegabyte/projectsites.dev"). Lets questions be grouped by project
 * and gives each project a stable `/{owner}/{repo}` URL (§28-ext).
 */
export const RepoSlug = z
  .string()
  .regex(/^[a-z0-9._-]+\/[a-z0-9._-]+$/, 'repo must be lowercase owner/name')
  .max(140);
export type RepoSlug = z.infer<typeof RepoSlug>;

export const AgentInstallation = z.object({
  id: InstallId,
  /** Self-reported agent product (e.g. "Claude Code"); not authoritative (§5). */
  agent: z.string().max(80),
  version: z.string().max(40).optional(),
  trust: AgentTrust,
  /** Optional branch/task the agent reports it is working on (§5). */
  branch: z.string().max(200).optional(),
  task: z.string().max(200).optional(),
  /** Normalized `owner/name` of the git repo this agent works in (§28-ext). */
  repo: RepoSlug.optional(),
  /** The repo's remote URL, if the agent reported it (display only). */
  repoUrl: z.string().max(400).optional(),
  status: z.enum(['working', 'waiting', 'offline']),
  features: z.array(z.string().max(40)).max(40).default([]),
  lastSeenAt: Iso.optional(),
});
export type AgentInstallation = z.infer<typeof AgentInstallation>;

export const Question = z.object({
  id: QuestionId,
  /** Stable dedup key supplied by the agent or derived (§6,§17). */
  dedupKey: z.string().min(1).max(200),
  kind: QuestionKind,
  title: z.string().min(1).max(300),
  /** Short sanitized context — why it matters now (§5). */
  context: z.string().max(LIMITS.questionContextBytes).optional(),
  /** What different answers would change (§5). */
  consequence: z.string().max(1000).optional(),
  category: QuestionCategory.default('other'),
  klass: QuestionClass.default('decision'),
  horizon: Horizon.default('now'),
  options: z.array(QuestionOption).max(50).default([]),
  numberConstraint: NumberConstraint.optional(),
  /** Labeled suggestion — never pre-selected as the user's choice (§5). */
  recommendation: z.string().max(600).optional(),
  /** Whether work can continue without an answer (§5). */
  blocksWork: z.boolean().default(false),
  relevantTask: z.string().max(200).optional(),
  /** Source git repo (owner/name), stamped server-side from the posting agent (§28-ext). */
  repo: RepoSlug.optional(),
  /** Why this question was archived — AI appropriateness/staleness verdict or owner action (§6). */
  archiveReason: z.string().max(400).optional(),
  state: QuestionState.default('open'),
  revision: z.number().int().nonnegative(),
  createdByInstall: InstallId.optional(),
  createdAt: Iso,
  updatedAt: Iso,
});
export type Question = z.infer<typeof Question>;

export const AnswerRevision = z.object({
  id: AnswerId,
  questionId: QuestionId,
  authorClass: AuthorClass,
  authorHandle: z.string().max(60).optional(),
  value: AnswerValue.optional(),
  text: z.string().max(LIMITS.answerTextBytes).optional(),
  /** Append-only chain; points at the revision it replaces (§7). */
  supersedes: AnswerId.optional(),
  status: AnswerStatus.default('answer_saved'),
  revision: z.number().int().nonnegative(),
  createdAt: Iso,
});
export type AnswerRevision = z.infer<typeof AnswerRevision>;

export const Decision = z.object({
  id: DecisionId,
  sourceAnswerIds: z.array(AnswerId).min(1),
  meaning: DecisionMeaning,
  summary: z.string().max(1000),
  scope: z.enum(['project', 'task', 'global']).default('project'),
  status: DecisionStatus.default('active'),
  supersedes: DecisionId.optional(),
  createdAt: Iso,
});
export type Decision = z.infer<typeof Decision>;

export const ApplicationReceipt = z.object({
  id: ReceiptId,
  installId: InstallId,
  questionId: QuestionId,
  answerId: AnswerId,
  state: ReceiptState,
  status: AnswerStatus,
  decisionSummary: z.string().max(1000).optional(),
  /** Relative paths only — never absolute paths or private diffs by default (§10). */
  affectedPaths: z.array(z.string().max(300)).max(100).default([]),
  commitRef: z.string().max(120).optional(),
  validation: z.string().max(600).optional(),
  createdAt: Iso,
});
export type ApplicationReceipt = z.infer<typeof ApplicationReceipt>;

/** Monotonic room event (§13). Every event carries an entity revision. */
export const RoomEvent = z.object({
  id: EventId,
  seq: z.number().int().nonnegative(),
  type: z.enum([
    'room.created',
    'room.renamed',
    'room.visibility_changed',
    'question.created',
    'question.updated',
    'answer.created',
    'answer.superseded',
    'receipt.recorded',
    'agent.enrolled',
    'agent.status',
    'participant.joined',
    'participant.left',
    'enrichment.updated',
  ]),
  schemaVersion: z.number().int().positive().default(PROTOCOL_VERSION),
  entityRevision: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()).default({}),
  at: Iso,
});
export type RoomEvent = z.infer<typeof RoomEvent>;

export const BillingRecord = z.object({
  roomId: RoomId,
  customerId: z.string().max(120).optional(),
  subscriptionId: z.string().max(120).optional(),
  entitlement: EntitlementState,
  /** Separate from visibility — a lapse never flips visibility to public (§15). */
  requestedVisibility: Visibility,
  paidThrough: Iso.optional(),
  graceUntil: Iso.optional(),
  updatedAt: Iso,
});
export type BillingRecord = z.infer<typeof BillingRecord>;

// ─────────────────────────────────────────────────────────────────────────────
// API request / response schemas (§12)
// ─────────────────────────────────────────────────────────────────────────────

export const CreateRoomRequest = z.object({
  /** Optionally claim a specific available slug; else one is generated. */
  slug: Slug.optional(),
  idempotencyKey: IdempotencyKey.optional(),
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequest>;

/** Creation returns canonical id + initial state so first render needs no index read (§11). */
export const CreateRoomResponse = z.object({
  room: Room,
  /** The URL the client should adopt (replaceState). */
  url: z.string(),
  /** Ownership capability is set as an HttpOnly cookie — never in the body (§4). */
  owned: z.boolean(),
});
export type CreateRoomResponse = z.infer<typeof CreateRoomResponse>;

// ─────────────────────────────────────────────────────────────────────────────
// AI enrichment (§6) — a server-side "project understanding" + per-question
// quality pass over ONLY the room's Q&A text (never repo files). Entirely
// additive + optional so a room with enrichment off (or unavailable) is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

/** A concise, clearly-AI-generated read of what the project is about (§6). */
export const ProjectUnderstanding = z.object({
  /** 2-3 sentence plain-language summary synthesized from the Q&A so far. */
  summary: z.string().max(1200),
  /** The model that produced it (surfaced so the UI can label the source). */
  model: z.string().max(80),
  /** How many Q&A pairs informed this read — lets the UI say "from N answers". */
  basedOnAnswers: z.number().int().nonnegative(),
  updatedAt: Iso,
});
export type ProjectUnderstanding = z.infer<typeof ProjectUnderstanding>;

/** A quality verdict for a single OPEN question — is it pulling its weight? (§6) */
export const QuestionQuality = z.object({
  questionId: QuestionId,
  /** 0..1 — how useful/decision-relevant this question is right now. */
  usefulness: z.number().min(0).max(1),
  /** True when the AI judges it vague, redundant, or low-value as written. */
  lame: z.boolean(),
  /** One short, actionable suggestion to sharpen it (shown only when lame). */
  improvement: z.string().max(400),
  /** Does the question FIT the project's apparent stack/domain? (§6 appropriateness). */
  appropriate: z.boolean().default(true),
  /** True when the question is overtaken by events / no longer needs answering. */
  stale: z.boolean().default(false),
  /** Why it's inappropriate or stale — shown to the user + used as the archive reason. */
  concern: z.string().max(400).default(''),
  updatedAt: Iso,
});
export type QuestionQuality = z.infer<typeof QuestionQuality>;

export const RoomSnapshot = z.object({
  room: Room,
  questions: z.array(Question),
  answers: z.array(AnswerRevision),
  receipts: z.array(ApplicationReceipt),
  agents: z.array(AgentInstallation),
  participants: z.array(Participant),
  /** Cursor to subscribe for deltas after this snapshot (§13). */
  cursor: Cursor,
  /** Viewer's resolved role in this room. */
  viewerRole: Role,
  /** AI read of the project (§6). Optional — absent when enrichment is off/unrun. */
  understanding: ProjectUnderstanding.optional(),
  /** AI quality verdicts for OPEN questions (§6). Optional + additive. */
  questionQuality: z.array(QuestionQuality).optional(),
});
export type RoomSnapshot = z.infer<typeof RoomSnapshot>;

// ─────────────────────────────────────────────────────────────────────────────
// Per-project (git repo) addressing + personal dashboard (§28-ext)
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve an owner/repo path (`/{owner}/{repo}`) to its canonical room. */
export const ResolveRepoResponse = z.object({
  roomId: RoomId,
  slug: Slug,
  repo: RepoSlug,
  /** The canonical URL the client should adopt (the memorable word-slug). */
  url: z.string(),
});
export type ResolveRepoResponse = z.infer<typeof ResolveRepoResponse>;

/** One room in the viewer's personal dashboard — a room they own + its AI read. */
export const MeRoom = z.object({
  room: Room,
  url: z.string(),
  questionCount: z.number().int().nonnegative(),
  openCount: z.number().int().nonnegative(),
  answeredCount: z.number().int().nonnegative(),
  /** Git repos that have published to this room (grouping + per-project URLs). */
  repos: z.array(RepoSlug).default([]),
  /** AI read of the project (§6) — the "what this is about" summary. */
  understanding: ProjectUnderstanding.optional(),
  lastActivityAt: Iso.optional(),
});
export type MeRoom = z.infer<typeof MeRoom>;

/** The viewer's own rooms — powers the apex dashboard (private to this browser's principal). */
export const MeRoomsResponse = z.object({
  rooms: z.array(MeRoom),
});
export type MeRoomsResponse = z.infer<typeof MeRoomsResponse>;

export const ChangesResponse = z.object({
  events: z.array(RoomEvent),
  cursor: Cursor,
  /** True when the history window moved past the requested cursor (§13). */
  snapshotRequired: z.boolean().default(false),
});
export type ChangesResponse = z.infer<typeof ChangesResponse>;

export const EnrollAgentRequest = z.object({
  agent: z.string().max(80),
  version: z.string().max(40).optional(),
  features: z.array(z.string().max(40)).max(40).default([]),
  branch: z.string().max(200).optional(),
  task: z.string().max(200).optional(),
  /** Normalized `owner/name` git repo — registers the project's `/{owner}/{repo}` URL (§28-ext). */
  repo: RepoSlug.optional(),
  repoUrl: z.string().max(400).optional(),
});
export type EnrollAgentRequest = z.infer<typeof EnrollAgentRequest>;

export const EnrollAgentResponse = z.object({
  install: AgentInstallation,
  /** Scoped anonymous token to prevent spoofed receipts (§12). Store in ignored local state. */
  token: z.string(),
});
export type EnrollAgentResponse = z.infer<typeof EnrollAgentResponse>;

/** One question in a dedup batch (id/revision assigned server-side). */
export const QuestionInput = Question.omit({
  id: true,
  revision: true,
  state: true,
  createdByInstall: true,
  // `repo` is stamped server-side from the posting agent's install, never client-set.
  repo: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  kind: QuestionKind,
  title: z.string().min(1).max(300),
});
export type QuestionInput = z.infer<typeof QuestionInput>;

export const PostQuestionsRequest = z.object({
  questions: z.array(QuestionInput).min(1).max(LIMITS.questionsPerBatch),
  idempotencyKey: IdempotencyKey.optional(),
});
export type PostQuestionsRequest = z.infer<typeof PostQuestionsRequest>;

export const PostQuestionsResponse = z.object({
  /** Upserted questions (created or matched by dedupKey). */
  questions: z.array(Question),
  created: z.number().int().nonnegative(),
  deduped: z.number().int().nonnegative(),
});
export type PostQuestionsResponse = z.infer<typeof PostQuestionsResponse>;

export const PostAnswerRequest = z.object({
  value: AnswerValue.optional(),
  text: z.string().max(LIMITS.answerTextBytes).optional(),
  /** When revising your own prior answer. */
  supersedes: AnswerId.optional(),
  idempotencyKey: IdempotencyKey.optional(),
});
export type PostAnswerRequest = z.infer<typeof PostAnswerRequest>;

export const PostAnswerResponse = z.object({ answer: AnswerRevision });
export type PostAnswerResponse = z.infer<typeof PostAnswerResponse>;

export const PostReceiptRequest = z.object({
  questionId: QuestionId,
  answerId: AnswerId,
  state: ReceiptState,
  status: AnswerStatus.default('agent_downloaded'),
  decisionSummary: z.string().max(1000).optional(),
  affectedPaths: z.array(z.string().max(300)).max(100).default([]),
  commitRef: z.string().max(120).optional(),
  validation: z.string().max(600).optional(),
});
export type PostReceiptRequest = z.infer<typeof PostReceiptRequest>;

export const PostReceiptResponse = z.object({ receipt: ApplicationReceipt });
export type PostReceiptResponse = z.infer<typeof PostReceiptResponse>;

export const UpdateSettingsRequest = z.object({
  slug: Slug.optional(),
});
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

/** Result of a manual enrichment trigger (§6). `ran:false` = honest no-op (off/budget). */
export const EnrichResponse = z.object({
  ran: z.boolean(),
  /** Why it didn't run, when `ran` is false: 'disabled' | 'unavailable' | 'budget' | 'throttled' | 'empty'. */
  reason: z.string().max(40).optional(),
  understanding: ProjectUnderstanding.optional(),
  questionQuality: z.array(QuestionQuality).optional(),
});
export type EnrichResponse = z.infer<typeof EnrichResponse>;

export const ContextRequest = z.object({
  questionId: QuestionId.optional(),
  kind: z.enum(['explain', 'clarify', 'deeper']),
  note: z.string().max(600).optional(),
});
export type ContextRequest = z.infer<typeof ContextRequest>;

/** RFC7807-ish structured error (§12). Room content never leaks into errors. */
export const ApiError = z.object({
  error: z.string(),
  code: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

// ─────────────────────────────────────────────────────────────────────────────
// Integration manifest (§8) — served at /integrations/manifest.json
// ─────────────────────────────────────────────────────────────────────────────

export const IntegrationFile = z.object({
  path: z.string().max(300),
  url: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
});

export const IntegrationManifest = z.object({
  schema: z.literal(PROTOCOL_VERSION),
  adapterVersion: z.string(),
  serviceOrigin: z.string(),
  /** Supported hosts and their project skill locations (§8). */
  hosts: z.array(
    z.object({
      agent: z.string(),
      skillPath: z.string(),
      automation: z.string(),
      verified: z.boolean(),
    }),
  ),
  files: z.array(IntegrationFile),
  generatedAt: Iso,
});
export type IntegrationManifest = z.infer<typeof IntegrationManifest>;

// ─────────────────────────────────────────────────────────────────────────────
// Route manifest — every transport resolves the same immutable room id (§12)
// ─────────────────────────────────────────────────────────────────────────────

export const ROUTES = {
  createRoom: `/api/${API_VERSION}/rooms`,
  room: (id: string) => `/api/${API_VERSION}/rooms/${id}`,
  changes: (id: string) => `/api/${API_VERSION}/rooms/${id}/changes`,
  agents: (id: string) => `/api/${API_VERSION}/rooms/${id}/agents`,
  questions: (id: string) => `/api/${API_VERSION}/rooms/${id}/questions:batch`,
  answers: (id: string, qid: string) => `/api/${API_VERSION}/rooms/${id}/questions/${qid}/answers`,
  receipts: (id: string) => `/api/${API_VERSION}/rooms/${id}/receipts`,
  contextRequests: (id: string) => `/api/${API_VERSION}/rooms/${id}/context-requests`,
  settings: (id: string) => `/api/${API_VERSION}/rooms/${id}/settings`,
  claim: (id: string) => `/api/${API_VERSION}/rooms/${id}/claim`,
  checkout: (id: string) => `/api/${API_VERSION}/rooms/${id}/checkout`,
  enrich: (id: string) => `/api/${API_VERSION}/rooms/${id}/enrich`,
  events: (id: string) => `/api/${API_VERSION}/rooms/${id}/events`,
  meRooms: `/api/${API_VERSION}/me/rooms`,
  resolveRepo: (owner: string, repo: string) => `/api/${API_VERSION}/repos/${owner}/${repo}`,
  archiveQuestion: (id: string, qid: string) =>
    `/api/${API_VERSION}/rooms/${id}/questions/${qid}/archive`,
  stripeWebhook: '/api/billing/stripe/webhook',
  manifest: '/integrations/manifest.json',
  health: '/api/health',
} as const;
