// A tapped reminder push opens the app with ?todo=<id>&reminderUser=<uid>&from=push.
// The link is captured once at startup (or from a service worker message when the app
// was already open), the URL is cleaned right away, and the pending link is consumed
// exactly once by the To Do widget.
export type PendingReminder = { todoId: string; userId: string | null };

const KEY = 'perritt-pending-reminder';
const EVENT = 'perritt-reminder-link';
let pending: PendingReminder | null = null;

function read(): PendingReminder | null {
  if (pending) return pending;
  try { const raw = sessionStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function store(p: PendingReminder | null) {
  pending = p;
  try { p ? sessionStorage.setItem(KEY, JSON.stringify(p)) : sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Parse a URL/search string; returns a pending reminder only for push taps. */
export function parsePushLink(search: string): PendingReminder | null {
  const q = new URLSearchParams(search);
  const todoId = q.get('todo');
  if (!todoId || q.get('from') !== 'push') return null;
  return { todoId, userId: q.get('reminderUser') };
}

function cleanUrl() {
  const q = new URLSearchParams(window.location.search);
  if (!['todo', 'action', 'reminderUser', 'from'].some(k => q.has(k))) return;
  ['todo', 'action', 'reminderUser', 'from'].forEach(k => q.delete(k));
  window.history.replaceState(null, '', `${window.location.pathname}${q.size ? `?${q}` : ''}${window.location.hash}`);
}

function accept(p: PendingReminder) {
  store(p);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Call once at startup, before React renders. */
export function captureReminderLink() {
  const p = parsePushLink(window.location.search);
  cleanUrl();
  if (p) store(p);
  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { type?: string; url?: string } | null;
    if (data?.type !== 'open-url' || !data.url) return;
    try {
      const p2 = parsePushLink(new URL(data.url, window.location.origin).search);
      if (p2) accept(p2);
    } catch { /* ignore */ }
  });
}

export const peekReminderLink = () => read();
export function takeReminderLink() { const p = read(); store(null); return p; }
export function onReminderLink(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
