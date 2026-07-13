import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

import { ConfirmProvider } from "@/hooks/use-confirm";

createRoot(document.getElementById("root")!).render(
  <ConfirmProvider>
    <App />
  </ConfirmProvider>,
);
