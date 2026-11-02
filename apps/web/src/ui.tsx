import { useEffect, useMemo, type ReactNode } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Agent, AgentStatus, Priority } from '@easy-kanban/shared';

// ---------- icons (inline, stroke-based) ----------
const paths: Record<string, string> = {
  board: 'M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v13h-4z',
  agents: 'M12 2a3 3 0 0 1 3 3v1h2a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1v3l-4-3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h2V5a3 3 0 0 1 3-3zM9 12h.01M15 12h.01',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  check: 'M20 6L9 17l-5-5',
  comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  checklist: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  copy: 'M9 9h13v13H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  play: 'M5 3l14 9-14 9V3z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5L22 3z',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  chevronLeft: 'M15 18l-6-6 6-6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
};
export function Icon({ name, size = 18, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

// ---------- modal / bottom sheet ----------
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    document.body.classList.add('no-scroll');
    return () => { document.removeEventListener('keydown', h); document.body.classList.remove('no-scroll'); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="modal-head">
            <div className="modal-title">{title}</div>
            <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- markdown ----------
marked.setOptions({ gfm: true, breaks: true });
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text || '', { async: false }) as string), [text]);
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------- badges ----------
export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Idle', working: 'Working', waiting: 'Needs input', error: 'Error', offline: 'Offline', paused: 'Paused',
};
export function StatusDot({ status }: { status: AgentStatus }) {
  return <span className={`dot dot-${status}`} title={STATUS_LABEL[status]} />;
}
export function StatusPill({ status }: { status: AgentStatus }) {
  return <span className={`pill pill-${status}`}><StatusDot status={status} />{STATUS_LABEL[status]}</span>;
}
export function AgentAvatar({ agent, size = 28, showStatus = false }: { agent?: Pick<Agent, 'avatar' | 'color' | 'name' | 'status'> | null; size?: number; showStatus?: boolean }) {
  if (!agent) return null;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.55, background: `${agent.color}22`, borderColor: `${agent.color}66` }} title={agent.name}>
      {agent.avatar || '🤖'}
      {showStatus && <StatusDot status={agent.status} />}
    </span>
  );
}
export function UserAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return <span className="avatar avatar-user" style={{ width: size, height: size, fontSize: size * 0.4 }} title={name}>{initials}</span>;
}
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
export function PriorityBadge({ p, compact }: { p: Priority; compact?: boolean }) {
  return <span className={`prio prio-${p}`}>{compact ? PRIORITY_LABEL[p][0] : PRIORITY_LABEL[p]}</span>;
}

export function labelColor(label: string) {
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 60%)`;
}
export function Label({ text, onRemove }: { text: string; onRemove?: () => void }) {
  const c = labelColor(text);
  return (
    <span className="label" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
      {text}
      {onRemove && <button className="label-x" onClick={onRemove} aria-label={`Remove ${text}`}>×</button>}
    </span>
  );
}

export function Empty({ icon = 'board', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={28} /></div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Spinner() { return <div className="spinner" aria-label="Loading" />; }

export function copy(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
  return Promise.resolve();
}
