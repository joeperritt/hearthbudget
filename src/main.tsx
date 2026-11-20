import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "./lib/registerSW";
import { captureReminderLink } from "./lib/reminderLink";

// After a new publish, an older cached page may ask for a file that no longer exists.
// Reload once so the freshly cached page and files are used.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('perritt-reloaded-for-update')) return;
    sessionStorage.setItem('perritt-reloaded-for-update', '1');
  } catch { /* ignore */ }
  event.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => { setTimeout(() => { try { sessionStorage.removeItem('perritt-reloaded-for-update'); } catch { /* ignore */ } }, 10_000); });

captureReminderLink();
createRoot(document.getElementById("root")!).render(<App />);
registerSW();
