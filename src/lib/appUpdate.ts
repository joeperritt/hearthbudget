/**
 * Installed iPhone apps can stay alive for days, and the offline copy of the page is
 * one publish behind on the first open. When the app returns to the foreground, check
 * whether a newer publish exists; if so, store it as the saved page and reload once.
 */
const SHELL_CACHE = 'perritt-shell-v1';
const entryOf = (html: string) => html.match(/<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1] ?? null;

export function currentEntry(doc: Document = document) {
  const el = doc.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return el ? new URL(el.src, location.origin).pathname : null;
}

export async function checkForNewBuild(reload: () => void = () => location.reload()) {
  const mine = currentEntry();
  if (!mine) return false; // dev/preview: no built entry
  try {
    const res = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
    if (!res.ok) return false;
    const html = await res.clone().text();
    const latest = entryOf(html);
    if (!latest || latest === mine) return false;
    if (sessionStorage.getItem('perritt-updated-to') === latest) return false; // never loop
    sessionStorage.setItem('perritt-updated-to', latest);
    try { if ('caches' in window) await (await caches.open(SHELL_CACHE)).put('/', res); } catch { /* ignore */ }
    reload();
    return true;
  } catch {
    return false;
  }
}

export function watchForNewBuild() {
  let last = 0;
  const check = () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < 30_000) return;
    last = Date.now();
    checkForNewBuild();
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', check);
  setTimeout(check, 5_000);
}
