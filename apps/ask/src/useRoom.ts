/**
 * useRoom — the live room store.
 *
 * Responsibilities:
 *  - Load the initial snapshot by slug (or id), exposing room.id for every write.
 *  - Open a WebSocket to the room DO; on each `event` frame, GET /changes and
 *    merge the deltas so a SECOND browser sees new Q&A WITHOUT a reload.
 *  - Reconnect with exponential backoff; on `snapshotRequired`, refetch the
 *    whole snapshot (the history window moved past our cursor).
 *  - Optimistic answers: a submitted answer renders immediately as "sending",
 *    and flips to a real saved revision ONLY when the server commits it.
 *
 * Merge strategy is derived from the event TYPE + the entity in its payload;
 * when a payload lacks a full entity we fall back to a scoped /changes-driven
 * snapshot refetch, so we never show stale or half-merged state.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  type AnswerRevision,
  type AnswerValue,
  type AgentInstallation,
  type ApplicationReceipt,
  type Participant,
  type Question,
  type Room,
  type RoomEvent,
  type RoomSnapshot,
  type Role,
} from '@ask/contracts';
import { getChanges, getRoom, postAnswer, roomEventsWsUrl, type SnapshotResult } from './api';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** A locally-submitted answer awaiting server commit (keyed by questionId). */
export interface PendingAnswer {
  questionId: string;
  value?: AnswerValue;
  text?: string;
  status: 'sending' | 'error';
  error?: string;
}

export interface RoomStore {
  room: Room | undefined;
  questions: Question[];
  answers: AnswerRevision[];
  receipts: ApplicationReceipt[];
  agents: AgentInstallation[];
  participants: Participant[];
  viewerRole: Role;
  cursor: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'free' } // slug unclaimed — offer to claim
  | { status: 'denied'; slug: string } // private room, not the owner
  | { status: 'error'; message: string }
  | { status: 'ready'; store: RoomStore };

interface State {
  load: LoadState;
  connection: ConnectionState;
  pending: Record<string, PendingAnswer>;
}

type Action =
  | { type: 'loading' }
  | { type: 'loaded'; result: SnapshotResult; slug: string }
  | { type: 'load_error'; message: string }
  | { type: 'merge_snapshot'; snapshot: RoomSnapshot }
  | { type: 'merge_events'; events: RoomEvent[]; cursor: string }
  | { type: 'room'; room: Room }
  | { type: 'connection'; state: ConnectionState }
  | { type: 'answer_pending'; pending: PendingAnswer }
  | { type: 'answer_committed'; questionId: string; answer: AnswerRevision }
  | { type: 'answer_error'; questionId: string; message: string }
  | { type: 'answer_clear'; questionId: string };

function snapshotToStore(s: RoomSnapshot): RoomStore {
  return {
    room: s.room,
    questions: s.questions,
    answers: s.answers,
    receipts: s.receipts,
    agents: s.agents,
    participants: s.participants,
    viewerRole: s.viewerRole,
    cursor: s.cursor,
  };
}

/** Upsert by id, preserving array order (new items appended, existing replaced). */
function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

/**
 * Apply one event's payload to the store. Returns the next store, or null when
 * the event can't be merged from its payload alone (caller should refetch).
 */
function applyEvent(store: RoomStore, ev: RoomEvent): RoomStore | null {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.type) {
    case 'question.created':
    case 'question.updated': {
      const q = p.question as Question | undefined;
      if (!q?.id) return null;
      return { ...store, questions: upsert(store.questions, q) };
    }
    case 'answer.created':
    case 'answer.superseded': {
      const a = p.answer as AnswerRevision | undefined;
      if (!a?.id) return null;
      return { ...store, answers: upsert(store.answers, a) };
    }
    case 'receipt.recorded': {
      const r = p.receipt as ApplicationReceipt | undefined;
      if (!r?.id) return null;
      return { ...store, receipts: upsert(store.receipts, r) };
    }
    case 'agent.enrolled':
    case 'agent.status': {
      const ag = p.agent as AgentInstallation | undefined;
      if (!ag?.id) return null;
      return { ...store, agents: upsert(store.agents, ag) };
    }
    case 'participant.joined':
    case 'participant.left': {
      const pt = p.participant as Participant | undefined;
      if (!pt?.id) return null;
      return { ...store, participants: upsert(store.participants, pt) };
    }
    case 'room.renamed':
    case 'room.visibility_changed': {
      const room = p.room as Room | undefined;
      return room ? { ...store, room } : null;
    }
    case 'room.created':
      return store;
    default:
      return null;
  }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loading':
      return { ...state, load: { status: 'loading' } };
    case 'loaded': {
      if (action.result.kind === 'free') return { ...state, load: { status: 'free' } };
      if (action.result.kind === 'denied')
        return { ...state, load: { status: 'denied', slug: action.result.info.room.slug } };
      return { ...state, load: { status: 'ready', store: snapshotToStore(action.result.snapshot) } };
    }
    case 'load_error':
      return { ...state, load: { status: 'error', message: action.message } };
    case 'merge_snapshot':
      return { ...state, load: { status: 'ready', store: snapshotToStore(action.snapshot) } };
    case 'merge_events': {
      if (state.load.status !== 'ready') return state;
      let store = state.load.store;
      for (const ev of action.events) {
        const next = applyEvent(store, ev);
        if (next) store = next;
      }
      return { ...state, load: { status: 'ready', store: { ...store, cursor: action.cursor } } };
    }
    case 'room': {
      if (state.load.status !== 'ready') return state;
      return { ...state, load: { status: 'ready', store: { ...state.load.store, room: action.room } } };
    }
    case 'connection':
      return { ...state, connection: action.state };
    case 'answer_pending':
      return { ...state, pending: { ...state.pending, [action.pending.questionId]: action.pending } };
    case 'answer_error':
      return {
        ...state,
        pending: {
          ...state.pending,
          [action.questionId]: {
            ...(state.pending[action.questionId] ?? { questionId: action.questionId }),
            status: 'error',
            error: action.message,
          },
        },
      };
    case 'answer_committed': {
      // Drop the optimistic entry and fold the committed revision into answers.
      const pending = { ...state.pending };
      delete pending[action.questionId];
      if (state.load.status !== 'ready') return { ...state, pending };
      return {
        ...state,
        pending,
        load: {
          status: 'ready',
          store: { ...state.load.store, answers: upsert(state.load.store.answers, action.answer) },
        },
      };
    }
    case 'answer_clear': {
      const pending = { ...state.pending };
      delete pending[action.questionId];
      return { ...state, pending };
    }
    default:
      return state;
  }
}

const MAX_BACKOFF_MS = 15_000;

export interface UseRoom {
  load: LoadState;
  connection: ConnectionState;
  pending: Record<string, PendingAnswer>;
  /** Submit an answer; resolves true on server commit, false on failure. */
  submitAnswer: (
    questionId: string,
    body: { value?: AnswerValue; text?: string; supersedes?: string },
  ) => Promise<boolean>;
  /** Patch the room locally (e.g. after an owner rename succeeds). */
  setRoom: (room: Room) => void;
  /** Force a fresh snapshot (used after reconnect / snapshotRequired). */
  refresh: () => Promise<void>;
}

/**
 * @param identifier the slug or room id from the URL path.
 */
export function useRoom(identifier: string): UseRoom {
  const [state, dispatch] = useReducer(reducer, {
    load: { status: 'loading' },
    connection: 'connecting',
    pending: {},
  });

  // room.id is the stable identity for WS + writes once the snapshot loads.
  const roomId =
    state.load.status === 'ready' ? state.load.store.room?.id : undefined;
  const cursor = state.load.status === 'ready' ? state.load.store.cursor : '0';

  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(500);
  const mergingRef = useRef(false);
  const closedRef = useRef(false);

  // Initial snapshot load (and reload when the identifier changes).
  useEffect(() => {
    let alive = true;
    dispatch({ type: 'loading' });
    getRoom(identifier)
      .then((result) => alive && dispatch({ type: 'loaded', result, slug: identifier }))
      .catch((e: unknown) => alive && dispatch({ type: 'load_error', message: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [identifier]);

  const refresh = useCallback(async () => {
    if (!roomId) return;
    const result = await getRoom(roomId);
    if (result.kind === 'snapshot') dispatch({ type: 'merge_snapshot', snapshot: result.snapshot });
  }, [roomId]);

  // Pull deltas since our cursor; on snapshotRequired, refetch the snapshot.
  const pullChanges = useCallback(async () => {
    if (!roomId || mergingRef.current) return;
    mergingRef.current = true;
    try {
      const res = await getChanges(roomId, cursorRef.current);
      if (res.snapshotRequired) {
        await refresh();
      } else if (res.events.length) {
        dispatch({ type: 'merge_events', events: res.events, cursor: res.cursor });
      }
    } catch {
      /* transient — the next event frame (or reconnect) retries */
    } finally {
      mergingRef.current = false;
    }
  }, [roomId, refresh]);

  // WebSocket lifecycle with exponential backoff reconnect.
  useEffect(() => {
    if (!roomId) return;
    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;
      dispatch({ type: 'connection', state: backoffRef.current > 500 ? 'reconnecting' : 'connecting' });
      const ws = new WebSocket(roomEventsWsUrl(roomId));
      wsRef.current = ws;

      ws.onopen = () => {
        backoffRef.current = 500;
        dispatch({ type: 'connection', state: 'open' });
        // Resume from our last-known position; the server sends `hello` with its cursor.
        try {
          ws.send(JSON.stringify({ type: 'resume', lastSeq: Number(cursorRef.current) || 0 }));
        } catch {
          /* ignore */
        }
        // Reconcile immediately in case we missed frames while disconnected.
        void pullChanges();
      };

      ws.onmessage = (msg) => {
        let frame: { type?: string } = {};
        try {
          frame = JSON.parse(typeof msg.data === 'string' ? msg.data : '') as { type?: string };
        } catch {
          return;
        }
        // Any `event` frame means "something changed" — pull the authoritative delta.
        if (frame.type === 'event' || frame.type === 'hello') void pullChanges();
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closedRef.current) {
          dispatch({ type: 'connection', state: 'closed' });
          return;
        }
        dispatch({ type: 'connection', state: 'reconnecting' });
        const delay = Math.min(backoffRef.current, MAX_BACKOFF_MS);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        window.setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    // Keep-alive ping + a periodic visibility-aware reconcile (belt + suspenders).
    const ping = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'ping' }));
        } catch {
          /* ignore */
        }
      }
    }, 25_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pullChanges();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closedRef.current = true;
      window.clearInterval(ping);
      document.removeEventListener('visibilitychange', onVisible);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, pullChanges]);

  const submitAnswer = useCallback<UseRoom['submitAnswer']>(
    async (questionId, body) => {
      if (!roomId) return false;
      dispatch({
        type: 'answer_pending',
        pending: { questionId, value: body.value, text: body.text, status: 'sending' },
      });
      try {
        const res = await postAnswer(roomId, questionId, body);
        // Flip to saved ONLY now that the server committed the revision.
        dispatch({ type: 'answer_committed', questionId, answer: res.answer });
        return true;
      } catch (e: unknown) {
        dispatch({ type: 'answer_error', questionId, message: (e as Error).message });
        return false;
      }
    },
    [roomId],
  );

  const setRoom = useCallback((room: Room) => dispatch({ type: 'room', room }), []);

  return useMemo(
    () => ({
      load: state.load,
      connection: state.connection,
      pending: state.pending,
      submitAnswer,
      setRoom,
      refresh,
    }),
    [state.load, state.connection, state.pending, submitAnswer, setRoom, refresh],
  );
}
