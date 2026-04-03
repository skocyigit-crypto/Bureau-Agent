import { Router } from "express";

const router = Router();

const GOOGLE_SERVICES = [
  { id: "calendar", name: "Google Calendar", scope: "https://www.googleapis.com/auth/calendar" },
  { id: "gmail", name: "Gmail", scope: "https://www.googleapis.com/auth/gmail.modify" },
  { id: "drive", name: "Google Drive", scope: "https://www.googleapis.com/auth/drive" },
  { id: "docs", name: "Google Docs", scope: "https://www.googleapis.com/auth/documents" },
  { id: "sheets", name: "Google Sheets", scope: "https://www.googleapis.com/auth/spreadsheets" },
  { id: "slides", name: "Google Slides", scope: "https://www.googleapis.com/auth/presentations" },
];

router.get("/status", (_req, res) => {
  const services = GOOGLE_SERVICES.map(svc => ({
    id: svc.id,
    name: svc.name,
    status: "deconnecte" as const,
    lastSync: null,
    scope: svc.scope,
  }));

  res.json({
    connected: false,
    services,
    syncEnabled: false,
    lastGlobalSync: null,
  });
});

router.post("/connect/:serviceId", (req, res) => {
  const { serviceId } = req.params;
  const service = GOOGLE_SERVICES.find(s => s.id === serviceId);
  if (!service) {
    return res.status(404).json({ error: "Service inconnu." });
  }

  res.json({
    status: "redirect",
    message: `Redirection vers Google pour autoriser ${service.name}.`,
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?scope=${encodeURIComponent(service.scope)}&response_type=code&client_id=CONFIGURE_CLIENT_ID`,
    service: service.name,
  });
});

router.post("/disconnect/:serviceId", (req, res) => {
  const { serviceId } = req.params;
  const service = GOOGLE_SERVICES.find(s => s.id === serviceId);
  if (!service) {
    return res.status(404).json({ error: "Service inconnu." });
  }

  res.json({
    status: "deconnecte",
    message: `${service.name} a ete deconnecte.`,
  });
});

router.post("/sync", (_req, res) => {
  res.json({
    status: "en_cours",
    message: "Synchronisation lancee. Les donnees seront mises a jour sous peu.",
    startedAt: new Date().toISOString(),
  });
});

router.get("/calendar/events", (_req, res) => {
  res.json({
    events: [],
    message: "Connectez Google Calendar pour voir vos evenements.",
    connected: false,
  });
});

router.get("/gmail/messages", (_req, res) => {
  res.json({
    messages: [],
    message: "Connectez Gmail pour voir vos e-mails.",
    connected: false,
  });
});

router.get("/drive/files", (_req, res) => {
  res.json({
    files: [],
    message: "Connectez Google Drive pour voir vos fichiers.",
    connected: false,
  });
});

export default router;
