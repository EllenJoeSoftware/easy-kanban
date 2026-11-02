import { useEffect, useRef, useState } from 'react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { KanbanClient, type KanbanEvent, type Notification } from '@easy-kanban/shared';

const TOKEN_KEY = 'ek_token';

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export const api = new KanbanClient({
  baseUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  token: readToken() ?? undefined,
  onUnauthorized: () => {
    setToken(null);
    if (!location.pathname.startsWith('/login')) location.href = '/login';
  },
});

export function setToken(t: string | null) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  api.setToken(t);
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
});

export type Toast = { id: number; title: string; body?: string; onClick?: () => void };
type ToastListener = (t: Toast) => void;
const toastListeners = new Set<ToastListener>();
let toastSeq = 1;
export function toast(title: string, body?: string, onClick?: () => void) {
  const t = { id: toastSeq++, title, body, onClick };
  toastListeners.forEach((l) => l(t));
}
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const l: ToastListener = (t) => {
      setToasts((x) => [...x.slice(-3), t]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 5000);
    };
    toastListeners.add(l);
    return () => { toastListeners.delete(l); };
  }, []);
  return [toasts, (id: number) => setToasts((x) => x.filter((y) => y.id !== id))] as const;
}

/** Subscribe to realtime server events and invalidate the relevant queries. */
export function useRealtime(onNotification?: (n: Notification) => void) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const cb = useRef(onNotification);
  cb.current = onNotification;

  useEffect(() => {
    if (!api.getToken()) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const pending = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = (key: string) => {
      pending.add(key);
      if (!flushTimer) flushTimer = setTimeout(() => {
        flushTimer = null;
        for (const k of pending) qc.invalidateQueries({ queryKey: JSON.parse(k) });
        pending.clear();
      }, 150);
    };

    const connect = () => {
      es = new EventSource(api.eventsUrl());
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
      es.onmessage = (m) => {
        let ev: KanbanEvent;
        try { ev = JSON.parse(m.data); } catch { return; }
        const t = ev.type;
        if (t.startsWith('board.') || t.startsWith('column.')) { invalidate('["boards"]'); }
        if (ev.boardId) invalidate(JSON.stringify(['board', ev.boardId]));
        if (ev.cardId) invalidate(JSON.stringify(['card', ev.cardId]));
        if (t.startsWith('card.') || t.startsWith('comment.')) { invalidate('["dashboard"]'); invalidate('["boards"]'); invalidate('["cards"]'); }
        if (t.startsWith('agent.')) { invalidate('["agents"]'); invalidate('["dashboard"]'); }
        invalidate('["activity"]');
        if (t === 'notification') {
          invalidate('["notifications"]');
          cb.current?.(ev.data as Notification);
        }
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); es?.close(); };
  }, [qc]);

  return connected;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.round(f / 60)}m`;
    if (f < 86400) return `in ${Math.round(f / 3600)}h`;
    return `in ${Math.round(f / 86400)}d`;
  }
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}
export const useIsMobile = () => useMediaQuery('(max-width: 768px)');
