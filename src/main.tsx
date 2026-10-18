import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerSW } from "./lib/registerSW";
import { captureReminderLink } from "./lib/reminderLink";

captureReminderLink();
createRoot(document.getElementById("root")!).render(<App />);
registerSW();
