import "./styles/base.css";
import "./styles/tokens.css";

import { setupL10N } from "@shared/l10n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initAppStore } from "./app-store";
import { TRANSLATIONS } from "./locale";
// Must stay LAST: module execution is depth-first in import order, so this
// injects the private stylesheets after every upstream component stylesheet.
// Moving it up makes upstream rules win the cascade (they are equally specific).
import "./private";

setupL10N(imb.initialLocale, TRANSLATIONS);
await initAppStore();

document.documentElement.dataset.platform = imb.platform;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
