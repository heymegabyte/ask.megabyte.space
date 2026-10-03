/**
 * RoomDurableObject — one SQLite-backed Durable Object per room (§11).
 * Authoritative for Q&A, revisions, receipts, agents, permissions, visibility
 * epoch, the monotonic event sequence, and live WebSocket connections.
 *
 * The DO is the authority for access decisions; D1 indexes never override it (§11).
 */
import { DurableObject } from 'cloudflare:workers';
import {
  type AgentInstallation,
  type AnswerRevision,
  type ApplicationReceipt,
  type ChangesResponse,
  type EnrollAgentResponse,
  type Participant,
  type PostAnswerRequest,
  type PostQuestionsResponse,
  type PostReceiptRequest,
  type ProjectUnderstanding,
  type Question,
  type QuestionInput,
  type QuestionQuality,
  type Room,
  type RoomEvent,
  type RoomSnapshot,
  type Role,
  type Visibility,
} from '@ask/contracts';
import type { Env } from './env';
import {
  runEnrichment,
  type EnrichmentInputQuestion,
} from './features/enrichment/service';
import {
  newAnswerId,
  newEventId,
  newInstallId,
  newQuestionId,
  newReceiptId,
  newSecret,
  sha256,
} from './ids';

const now = (): string => new Date().toISOString();

/** A plain-text rendering of an answer (free text or a normalized value) for the AI input. */
function answerText(a: AnswerRevision): string | undefined {
  if (a.text && a.text.trim()) return a.text.trim();
  const v = a.value;
  if (!v) return undefined;
  switch (v.kind) {
    case 'choice':
      return v.selected.length ? `chose: ${v.selected.join(', ')}` : undefined;
    case 'text':
      return v.text?.trim() || undefined;
    case 'number':
      return String(v.value);
    case 'link':
      return v.url;
    case 'delegate':
      return 'delegated the decision to the agent';
    case 'skip':
      return undefined; // a skip carries no project signal
    default:
      return undefined;
  }
}

interface WsMeta {
  role: Role;
  epoch: number;
  participantId: string;
  handle: string;
}

export class RoomDurableObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        id TEXT PRIMARY KEY, slug TEXT, visibility TEXT, visibility_epoch INTEGER,
        entitlement TEXT, revision INTEGER, owner_principal TEXT, retention_days INTEGER,
        created_at TEXT, updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY, dedup_key TEXT UNIQUE, state TEXT, revision INTEGER,
        created_at TEXT, updated_at TEXT, data TEXT
      );
      CREATE TABLE IF NOT EXISTS answers (
        id TEXT PRIMARY KEY, question_id TEXT, revision INTEGER, created_at TEXT, data TEXT
      );
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY, install_id TEXT, question_id TEXT, answer_id TEXT,
        created_at TEXT, data TEXT
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, token_hash TEXT, last_seen TEXT, data TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT, type TEXT,
        entity_revision INTEGER, at TEXT, payload TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_answers_q ON answers (question_id);
      -- AI enrichment (§6): one understanding row (id='current') + per-question quality.
      CREATE TABLE IF NOT EXISTS enrichment (
        id TEXT PRIMARY KEY, data TEXT, pass_count INTEGER DEFAULT 0, last_run_at TEXT
      );
      CREATE TABLE IF NOT EXISTS question_quality (
        question_id TEXT PRIMARY KEY, data TEXT, updated_at TEXT
      );
    `);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Idempotent room initialization — safe to retry after a partial create (§11). */
  async init(id: string, slug: string, ownerPrincipal: string): Promise<Room> {
    const existing = this.metaRow();
    if (existing) return this.toRoom(existing);
    const ts = now();
    this.sql.exec(
      `INSERT INTO meta (id, slug, visibility, visibility_epoch, entitlement, revision, owner_principal, created_at, updated_at)
       VALUES (?, ?, 'public', 0, 'none', 0, ?, ?, ?)`,
      id,
      slug,
      ownerPrincipal,
      ts,
      ts,
    );
    this.append('room.created', 0, { slug });
    return this.toRoom(this.metaRow()!);
  }

  async getState(): Promise<Room | null> {
    const row = this.metaRow();
    return row ? this.toRoom(row) : null;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async snapshot(viewerRole: Role): Promise<RoomSnapshot> {
    const room = this.toRoom(this.metaRow()!);
    const questions = this.rows('SELECT data FROM questions ORDER BY created_at ASC').map(
      (r) => JSON.parse(r.data) as Question,
    );
    const answers = this.rows('SELECT data FROM answers ORDER BY created_at ASC').map(
      (r) => JSON.parse(r.data) as AnswerRevision,
    );
    const receipts = this.rows('SELECT data FROM receipts ORDER BY created_at ASC').map(
      (r) => JSON.parse(r.data) as ApplicationReceipt,
    );
    const agents = this.rows('SELECT data FROM agents ORDER BY last_seen DESC').map(
      (r) => JSON.parse(r.data) as AgentInstallation,
    );
    return {
      room,
      questions,
      answers,
      receipts,
      agents,
      participants: this.livingParticipants(),
      cursor: String(room.revision),
      viewerRole,
      understanding: this.currentUnderstanding(),
      questionQuality: this.currentQuestionQuality(),
    };
  }

  async changes(cursor: string): Promise<ChangesResponse> {
    const since = Number.parseInt(cursor, 10);
    const from = Number.isFinite(since) ? since : 0;
    const rows = this.rows(
      'SELECT id, seq, type, entity_revision, at, payload FROM events WHERE seq > ? ORDER BY seq ASC LIMIT 500',
      from,
    );
    const events = rows.map((r) => this.toEvent(r));
    const head = this.metaRow()?.revision ?? 0;
    const minSeq = Number(this.rows('SELECT MIN(seq) AS m FROM events')[0]?.m ?? 0);
    return {
      events,
      cursor: String(events.length ? events[events.length - 1]!.seq : head),
      snapshotRequired: from > 0 && from < minSeq - 1,
    };
  }

  // ── mutations ──────────────────────────────────────────────────────────────

  async postQuestions(input: QuestionInput[], installId?: string): Promise<PostQuestionsResponse> {
    let created = 0;
    let deduped = 0;
    const out: Question[] = [];
    for (const q of input) {
      const found = this.rows('SELECT data FROM questions WHERE dedup_key = ?', q.dedupKey)[0];
      if (found) {
        deduped += 1;
        out.push(JSON.parse(found.data) as Question);
        continue;
      }
      const ts = now();
      const question: Question = {
        ...q,
        id: newQuestionId(),
        state: 'open',
        revision: 0,
        createdByInstall: installId,
        createdAt: ts,
        updatedAt: ts,
        options: q.options ?? [],
        category: q.category ?? 'other',
        klass: q.klass ?? 'decision',
        horizon: q.horizon ?? 'now',
        blocksWork: q.blocksWork ?? false,
      };
      this.sql.exec(
        'INSERT INTO questions (id, dedup_key, state, revision, created_at, updated_at, data) VALUES (?, ?, ?, 0, ?, ?, ?)',
        question.id,
        question.dedupKey,
        'open',
        ts,
        ts,
        JSON.stringify(question),
      );
      this.append('question.created', 0, { question });
      created += 1;
      out.push(question);
    }
    // A new question changes the open set → re-assess quality (throttled, §6).
    if (created > 0) this.scheduleEnrichment();
    return { questions: out, created, deduped };
  }

  async postAnswer(
    questionId: string,
    input: PostAnswerRequest,
    authorClass: AnswerRevision['authorClass'],
    authorHandle?: string,
  ): Promise<AnswerRevision> {
    const q = this.rows('SELECT data FROM questions WHERE id = ?', questionId)[0];
    if (!q) throw new RoomError('question_not_found', 404);
    const prior = this.rows(
      'SELECT COUNT(*) AS c FROM answers WHERE question_id = ?',
      questionId,
    )[0];
    const revision = Number(prior?.c ?? 0);
    const answer: AnswerRevision = {
      id: newAnswerId(),
      questionId,
      authorClass,
      authorHandle,
      value: input.value,
      text: input.text,
      supersedes: input.supersedes,
      status: 'answer_saved',
      revision,
      createdAt: now(),
    };
    this.sql.exec(
      'INSERT INTO answers (id, question_id, revision, created_at, data) VALUES (?, ?, ?, ?, ?)',
      answer.id,
      questionId,
      revision,
      answer.createdAt,
      JSON.stringify(answer),
    );
    // Mark the question answered (non-destructive — original question preserved).
    const question = JSON.parse(q.data) as Question;
    question.state = 'answered';
    question.updatedAt = now();
    this.sql.exec(
      'UPDATE questions SET state = ?, updated_at = ?, data = ? WHERE id = ?',
      'answered',
      question.updatedAt,
      JSON.stringify(question),
      questionId,
    );
    this.append('answer.created', revision, { answer });
    // A fresh answer sharpens the project read + retires the question → re-run (§6).
    this.scheduleEnrichment();
    return answer;
  }

  async enrollAgent(input: Omit<AgentInstallation, 'id' | 'status' | 'trust'>): Promise<EnrollAgentResponse> {
    const token = newSecret();
    const tokenHash = await sha256(token);
    const install: AgentInstallation = {
      id: newInstallId(),
      agent: input.agent,
      version: input.version,
      trust: 'public_contributor',
      branch: input.branch,
      task: input.task,
      status: 'working',
      features: input.features ?? [],
      lastSeenAt: now(),
    };
    this.sql.exec(
      'INSERT INTO agents (id, token_hash, last_seen, data) VALUES (?, ?, ?, ?)',
      install.id,
      tokenHash,
      install.lastSeenAt,
      JSON.stringify(install),
    );
    this.append('agent.enrolled', 0, { agent: install });
    return { install, token };
  }

  /** Verify a bearer token belongs to a known installation (prevents spoofed receipts §12). */
  async verifyInstall(installId: string, token: string): Promise<boolean> {
    const row = this.rows('SELECT token_hash FROM agents WHERE id = ?', installId)[0];
    if (!row) return false;
    return row.token_hash === (await sha256(token));
  }

  async recordReceipt(installId: string, input: PostReceiptRequest): Promise<ApplicationReceipt> {
    const receipt: ApplicationReceipt = {
      id: newReceiptId(),
      installId,
      questionId: input.questionId,
      answerId: input.answerId,
      state: input.state,
      status: input.status,
      decisionSummary: input.decisionSummary,
      affectedPaths: input.affectedPaths ?? [],
      commitRef: input.commitRef,
      validation: input.validation,
      createdAt: now(),
    };
    this.sql.exec(
      'INSERT INTO receipts (id, install_id, question_id, answer_id, created_at, data) VALUES (?, ?, ?, ?, ?, ?)',
      receipt.id,
      installId,
      receipt.questionId,
      receipt.answerId,
      receipt.createdAt,
      JSON.stringify(receipt),
    );
    // Advance the answer's status to reflect agent-reported evidence (§5).
    const a = this.rows('SELECT data FROM answers WHERE id = ?', input.answerId)[0];
    if (a) {
      const answer = JSON.parse(a.data) as AnswerRevision;
      answer.status = input.status;
      this.sql.exec('UPDATE answers SET data = ? WHERE id = ?', JSON.stringify(answer), answer.id);
    }
    this.sql.exec('UPDATE agents SET last_seen = ? WHERE id = ?', receipt.createdAt, installId);
    this.append('receipt.recorded', 0, { receipt });
    return receipt;
  }

  async rename(slug: string, callerPrincipal: string): Promise<Room> {
    const row = this.metaRow();
    if (!row) throw new RoomError('room_not_found', 404);
    if (row.owner_principal !== callerPrincipal) throw new RoomError('forbidden', 403);
    this.sql.exec('UPDATE meta SET slug = ?, updated_at = ? WHERE id = ?', slug, now(), row.id);
    this.append('room.renamed', 0, { slug, room: this.toRoom(this.metaRow()!) });
    return this.toRoom(this.metaRow()!);
  }

  /** Visibility change increments the access epoch and closes unauthorized sockets (§13). */
  async setVisibility(visibility: Visibility, callerPrincipal: string): Promise<Room> {
    const row = this.metaRow();
    if (!row) throw new RoomError('room_not_found', 404);
    if (row.owner_principal !== callerPrincipal) throw new RoomError('forbidden', 403);
    const epoch = row.visibility_epoch + 1;
    this.sql.exec(
      'UPDATE meta SET visibility = ?, visibility_epoch = ?, updated_at = ? WHERE id = ?',
      visibility,
      epoch,
      now(),
      row.id,
    );
    this.append('room.visibility_changed', epoch, { visibility, epoch, room: this.toRoom(this.metaRow()!) });
    if (visibility === 'private') {
      for (const ws of this.ctx.getWebSockets()) {
        const meta = this.wsMeta(ws);
        if (!meta || (meta.role !== 'owner' && meta.role !== 'admin' && meta.role !== 'answerer' && meta.role !== 'viewer')) {
          ws.close(4403, 'room is now private');
        }
      }
    }
    return this.toRoom(this.metaRow()!);
  }

  // ── AI enrichment (§6) ─────────────────────────────────────────────────────

  /** Enrichment config/limits. Throttle ≤ 1 pass / 30s; budget ~50 passes / room. */
  private static readonly ENRICH_THROTTLE_MS = 30_000;
  private static readonly ENRICH_BUDGET = 50;

  private enrichmentOn(): boolean {
    // Default-on; only the explicit string "0" disables (honest-off, §6).
    return this.env.ENRICHMENT_ENABLED !== '0';
  }

  /**
   * Manual enrichment trigger (authorized owner, via POST /enrich). Runs INLINE so
   * the response carries the fresh result; honest `{ ran:false, reason }` when off,
   * unavailable, empty, or over budget. Never throws.
   */
  async enrich(): Promise<{
    ran: boolean;
    reason?: string;
    understanding?: ProjectUnderstanding;
    questionQuality?: QuestionQuality[];
  }> {
    if (!this.enrichmentOn()) return { ran: false, reason: 'disabled' };
    if (!this.env.AI) return { ran: false, reason: 'unavailable' };
    const result = await this.runEnrichmentPass();
    if (!result) {
      // Honest reason: empty vs budget-exhausted vs a transient model error.
      const passCount = Number(
        this.rows('SELECT pass_count FROM enrichment WHERE id = ?', 'current')[0]?.pass_count ?? 0,
      );
      const reason =
        this.enrichInput().length === 0
          ? 'empty'
          : passCount >= RoomDurableObject.ENRICH_BUDGET
            ? 'budget'
            : 'model_error';
      return { ran: false, reason };
    }
    return { ran: true, understanding: result.understanding, questionQuality: result.questionQuality };
  }

  /**
   * Coalesce bursts into at most one pass per throttle window via a DO alarm.
   * Several answers/questions in quick succession schedule a single future run
   * rather than N concurrent model calls (the §6 throttle). No-op when off/unbound.
   */
  private scheduleEnrichment(): void {
    if (!this.enrichmentOn() || !this.env.AI) return;
    void this.ctx.storage.getAlarm().then((existing) => {
      if (existing != null) return; // a pass is already queued for this window
      const row = this.rows('SELECT last_run_at FROM enrichment WHERE id = ?', 'current')[0];
      const last = row?.last_run_at ? Date.parse(String(row.last_run_at)) : 0;
      const elapsed = Date.now() - (Number.isFinite(last) ? last : 0);
      const delay = Math.max(0, RoomDurableObject.ENRICH_THROTTLE_MS - elapsed);
      void this.ctx.storage.setAlarm(Date.now() + delay);
    });
  }

  /** DO alarm → run a single (throttled) enrichment pass in the background. */
  override async alarm(): Promise<void> {
    await this.runEnrichmentPass();
  }

  /**
   * The actual pass: project Q&A → call the enrichment service → persist +
   * broadcast. Returns the result (or null when it didn't/ couldn't run). Never
   * throws (the service already fails soft; this guards persistence too).
   */
  private async runEnrichmentPass(): Promise<{
    understanding: ProjectUnderstanding;
    questionQuality: QuestionQuality[];
  } | null> {
    if (!this.enrichmentOn() || !this.env.AI) return null;
    const passCount = Number(
      this.rows('SELECT pass_count FROM enrichment WHERE id = ?', 'current')[0]?.pass_count ?? 0,
    );
    if (passCount >= RoomDurableObject.ENRICH_BUDGET) return null; // budget exhausted (§6)

    const questions = this.enrichInput();
    if (questions.length === 0) return null;

    let result;
    try {
      result = await runEnrichment(this.env.AI, { questions });
    } catch {
      result = null; // belt + suspenders — the service shouldn't throw, but never let it bubble
    }
    if (!result) {
      // A FAILED pass must NOT consume the budget (a transient model error shouldn't
      // permanently lock a room) — only advance last_run_at so retries stay throttled.
      this.sql.exec(
        `INSERT INTO enrichment (id, data, pass_count, last_run_at)
         VALUES ('current', COALESCE((SELECT data FROM enrichment WHERE id='current'), NULL), ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_run_at = ?`,
        passCount,
        now(),
        now(),
      );
      return null;
    }

    const ts = now();
    this.sql.exec(
      `INSERT INTO enrichment (id, data, pass_count, last_run_at) VALUES ('current', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = ?, pass_count = ?, last_run_at = ?`,
      JSON.stringify(result.understanding),
      passCount + 1,
      ts,
      JSON.stringify(result.understanding),
      passCount + 1,
      ts,
    );
    // Replace the quality set wholesale — verdicts only exist for CURRENTLY-open questions.
    this.sql.exec('DELETE FROM question_quality');
    for (const q of result.questionQuality) {
      this.sql.exec(
        'INSERT INTO question_quality (question_id, data, updated_at) VALUES (?, ?, ?)',
        q.questionId,
        JSON.stringify(q),
        q.updatedAt,
      );
    }
    // Tell live clients to refresh (they GET /changes → re-snapshot the enrichment fields).
    this.append('enrichment.updated', 0, {
      understanding: result.understanding,
      questionQuality: result.questionQuality,
    });
    return result;
  }

  /** Project stored questions + their latest answer into the enrichment input shape. */
  private enrichInput(): EnrichmentInputQuestion[] {
    const questions = this.rows('SELECT data FROM questions ORDER BY created_at ASC').map(
      (r) => JSON.parse(r.data) as Question,
    );
    return questions.map((q) => {
      const latest = this.rows(
        'SELECT data FROM answers WHERE question_id = ? ORDER BY revision DESC LIMIT 1',
        q.id,
      )[0];
      const answer = latest ? answerText(JSON.parse(latest.data) as AnswerRevision) : undefined;
      return {
        id: q.id,
        title: q.title,
        context: q.context,
        consequence: q.consequence,
        category: q.category,
        open: q.state === 'open',
        answer,
      };
    });
  }

  private currentUnderstanding(): ProjectUnderstanding | undefined {
    const row = this.rows('SELECT data FROM enrichment WHERE id = ?', 'current')[0];
    if (!row?.data) return undefined;
    try {
      return JSON.parse(row.data) as ProjectUnderstanding;
    } catch {
      return undefined;
    }
  }

  private currentQuestionQuality(): QuestionQuality[] | undefined {
    const rows = this.rows('SELECT data FROM question_quality');
    if (rows.length === 0) return undefined;
    const out: QuestionQuality[] = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.data) as QuestionQuality);
      } catch {
        /* skip a corrupt row */
      }
    }
    return out.length ? out : undefined;
  }

  // ── WebSocket (hibernation) ──────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const url = new URL(request.url);
    const role = (url.searchParams.get('role') as Role) || 'guest';
    const handle = url.searchParams.get('handle') || 'guest';
    const participantId = url.searchParams.get('pid') || `p_${crypto.randomUUID().replace(/-/g, '')}`;
    const room = this.metaRow();
    if (!room) return new Response('room not found', { status: 404 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);
    const meta: WsMeta = { role, epoch: room.visibility_epoch, participantId, handle };
    server.serializeAttachment(meta);
    server.send(JSON.stringify({ type: 'hello', cursor: String(room.revision), epoch: room.visibility_epoch }));
    this.append('participant.joined', 0, {
      participant: { id: participantId, type: role === 'owner' ? 'owner' : 'guest', handle, role, connected: true, lastSeenAt: now() },
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let msg: { type?: string; lastSeq?: number };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.type === 'resume' && typeof msg.lastSeq === 'number') {
      const { events } = await this.changes(String(msg.lastSeq));
      ws.send(JSON.stringify({ type: 'replay', events }));
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const meta = this.wsMeta(ws);
    if (meta)
      this.append('participant.left', 0, {
        participant: { id: meta.participantId, type: meta.role === 'owner' ? 'owner' : 'guest', handle: meta.handle, role: meta.role, connected: false, lastSeenAt: now() },
      });
  }

  override async webSocketError(): Promise<void> {
    // no-op: connection teardown handled by webSocketClose
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Append an event (monotonic seq), bump room revision, broadcast to live sockets. */
  private append(type: RoomEvent['type'], entityRevision: number, payload: Record<string, unknown>): RoomEvent {
    const id = newEventId();
    const at = now();
    this.sql.exec(
      'INSERT INTO events (id, type, entity_revision, at, payload) VALUES (?, ?, ?, ?, ?)',
      id,
      type,
      entityRevision,
      at,
      JSON.stringify(payload),
    );
    const seq = Number(this.rows('SELECT seq FROM events WHERE id = ?', id)[0]?.seq ?? 0);
    this.sql.exec('UPDATE meta SET revision = ?, updated_at = ? WHERE 1=1', seq, at);
    const event: RoomEvent = {
      id,
      seq,
      type,
      schemaVersion: 1,
      entityRevision,
      payload,
      at,
    };
    this.broadcast(event);
    return event;
  }

  private broadcast(event: RoomEvent): void {
    const room = this.metaRow();
    const frame = JSON.stringify({ type: 'event', event });
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.wsMeta(ws);
      // Private rooms: only deliver to connections at the current access epoch (§13).
      if (room && room.visibility === 'private' && (!meta || meta.epoch !== room.visibility_epoch)) {
        continue;
      }
      try {
        ws.send(frame);
      } catch {
        // socket gone; ignore
      }
    }
  }

  private livingParticipants(): Participant[] {
    const out: Participant[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.wsMeta(ws);
      if (!meta) continue;
      out.push({
        id: meta.participantId,
        type: meta.role === 'owner' ? 'owner' : 'guest',
        handle: meta.handle,
        role: meta.role,
        connected: true,
        lastSeenAt: now(),
      });
    }
    return out;
  }

  private wsMeta(ws: WebSocket): WsMeta | null {
    try {
      return ws.deserializeAttachment() as WsMeta;
    } catch {
      return null;
    }
  }

  private metaRow(): MetaRow | undefined {
    return this.rows('SELECT * FROM meta LIMIT 1')[0] as MetaRow | undefined;
  }

  private toRoom(row: MetaRow): Room {
    return {
      id: row.id,
      slug: row.slug,
      creationState: 'active',
      visibility: row.visibility as Visibility,
      visibilityEpoch: row.visibility_epoch,
      entitlement: row.entitlement as Room['entitlement'],
      hasOwnerClaim: false,
      revision: row.revision,
      retentionDays: row.retention_days ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toEvent(r: Record<string, any>): RoomEvent {
    return {
      id: r.id,
      seq: Number(r.seq),
      type: r.type as RoomEvent['type'],
      schemaVersion: 1,
      entityRevision: Number(r.entity_revision),
      payload: JSON.parse(r.payload ?? '{}'),
      at: r.at,
    };
  }

  private rows(query: string, ...binds: (string | number)[]): Record<string, any>[] {
    return this.sql.exec(query, ...binds).toArray();
  }
}

interface MetaRow {
  id: string;
  slug: string;
  visibility: string;
  visibility_epoch: number;
  entitlement: string;
  revision: number;
  owner_principal: string;
  retention_days: number | null;
  created_at: string;
  updated_at: string;
}

export class RoomError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
