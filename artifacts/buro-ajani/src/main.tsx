import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

import { ConfirmProvider } from "@/hooks/use-confirm";
import { I18nProvider } from "@/i18n";

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </I18nProvider>,
);
