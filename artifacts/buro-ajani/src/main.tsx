import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import App from "./App";
// Inter, servie par nos soins: les quatre graisses reellement utilisees
// (400/500/600/700), pas la famille entiere. Importee ici plutot que dans
// index.html pour que Vite empaquette les .woff2 et les serve depuis notre
// propre domaine — aucune requete vers Google, donc aucune adresse IP
// transmise a un tiers avant consentement.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./index.css";

import { ConfirmProvider } from "@/hooks/use-confirm";
import { I18nProvider } from "@/i18n";
import { bootstrapDocument } from "./bootstrap-document";

bootstrapDocument();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </I18nProvider>
  </StrictMode>,
);
