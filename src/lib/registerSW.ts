/** Registers the network-only /sw.js in the published app only; never in dev or Lovable preview. */
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const h = location.hostname;
  const refused = !import.meta.env.PROD || window.self !== window.top
    || h.startsWith('id-preview--') || h.startsWith('preview--')
    || /(^|\.)lovableproject(-dev)?\.com$/.test(h) || /(^|\.)beta\.lovable\.dev$/.test(h)
    || new URLSearchParams(location.search).get('sw') === 'off';
  if (refused) {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => { if (r.active?.scriptURL.endsWith('/sw.js')) r.unregister(); })).catch(() => {});
    return;
  }
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
