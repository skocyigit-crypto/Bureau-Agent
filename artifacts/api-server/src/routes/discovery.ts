import { Router } from "express";
import { db } from "@workspace/db";
import { googleOAuthTokensTable, platformConnectionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

export interface DiscoveredService {
  id: string;
  name: string;
  description: string;
  category: "telephonie" | "google" | "ia" | "email" | "productivite" | "autre";
  icon: string;
  status: "connecte" | "disponible" | "non_configure";
  statusLabel: string;
  actionLabel: string;
  actionPath: string;
  priority: number;
  envConfigured: boolean;
  connectedCount?: number;
  details?: string;
}

async function scanEnvironment(orgId: number, userId: number): Promise<DiscoveredService[]> {
  const services: DiscoveredService[] = [];

  // --- 1. TWILIO ---
  const hasTwilioSid = !!process.env["TWILIO_ACCOUNT_SID"];
  const hasTwilioAuth = !!process.env["TWILIO_AUTH_TOKEN"];
  const hasTwilioNum = !!process.env["TWILIO_PHONE_NUMBER"];
  const twilioOk = hasTwilioSid && hasTwilioAuth && hasTwilioNum;

  services.push({
    id: "twilio",
    name: "Twilio — Téléphonie cloud",
    description: "Appels entrants/sortants, SMS, enregistrement vocal, numéros virtuels.",
    category: "telephonie",
    icon: "📞",
    status: twilioOk ? "connecte" : "non_configure",
    statusLabel: twilioOk ? "Configuré et actif" : "Clés API manquantes",
    actionLabel: twilioOk ? "Voir la téléphonie" : "Configurer Twilio",
    actionPath: twilioOk ? "/telephonie" : "/parametres",
    priority: 1,
    envConfigured: twilioOk,
    details: twilioOk ? `Numéro : ${process.env["TWILIO_PHONE_NUMBER"]}` : "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER requis",
  });

  // --- 2. GOOGLE OAUTH (per-user) ---
  const hasGoogleOAuth = !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]);
  let googleTokenCount = 0;
  try {
    const tokens = await db.select({ id: googleOAuthTokensTable.id })
      .from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.organisationId, orgId));
    googleTokenCount = tokens.length;
  } catch { }

  services.push({
    id: "google_oauth",
    name: "Google Workspace — Compte personnel",
    description: "Gmail, Google Agenda, Drive, Docs, Sheets — accès per-agent via OAuth.",
    category: "google",
    icon: "🔑",
    status: !hasGoogleOAuth ? "non_configure" : googleTokenCount > 0 ? "connecte" : "disponible",
    statusLabel: !hasGoogleOAuth ? "Client ID/Secret manquants" : googleTokenCount > 0 ? `${googleTokenCount} compte(s) connecté(s)` : "Prêt — aucun compte lié",
    actionLabel: !hasGoogleOAuth ? "Configurer OAuth" : googleTokenCount > 0 ? "Gérer les comptes" : "Connecter un compte Google",
    actionPath: "/parametres?tab=plateformes",
    priority: 2,
    envConfigured: hasGoogleOAuth,
    connectedCount: googleTokenCount,
  });

  // --- 3. GOOGLE CALENDAR (Replit connector) ---
  let googleCalendarOk = false;
  try {
    const conns = await db.select({ status: platformConnectionsTable.status })
      .from(platformConnectionsTable)
      .where(and(
        eq(platformConnectionsTable.platform, "google"),
        eq(platformConnectionsTable.serviceId, "calendar"),
      ));
    googleCalendarOk = conns.some(c => c.status === "connecte");
  } catch { }

  services.push({
    id: "google_calendar",
    name: "Google Calendar — Agenda partagé",
    description: "Synchronisation automatique des réunions, rappels et événements.",
    category: "google",
    icon: "📅",
    status: googleCalendarOk ? "connecte" : hasGoogleOAuth ? "disponible" : "non_configure",
    statusLabel: googleCalendarOk ? "Synchronisé" : "Disponible via Google OAuth",
    actionLabel: googleCalendarOk ? "Voir l'agenda" : "Connecter Calendar",
    actionPath: googleCalendarOk ? "/calendrier" : "/parametres?tab=plateformes",
    priority: 3,
    envConfigured: hasGoogleOAuth,
  });

  // --- 4. GMAIL (Replit connector) ---
  let gmailOk = false;
  try {
    const conns = await db.select({ status: platformConnectionsTable.status })
      .from(platformConnectionsTable)
      .where(and(
        eq(platformConnectionsTable.platform, "google"),
        eq(platformConnectionsTable.serviceId, "gmail"),
      ));
    gmailOk = conns.some(c => c.status === "connecte");
  } catch { }

  services.push({
    id: "gmail",
    name: "Gmail — Agent Mail IA",
    description: "Lecture, réponse automatique et rédaction d'e-mails assistés par IA.",
    category: "email",
    icon: "📧",
    status: gmailOk ? "connecte" : hasGoogleOAuth ? "disponible" : "non_configure",
    statusLabel: gmailOk ? "Actif" : "Disponible via Google OAuth",
    actionLabel: gmailOk ? "Ouvrir Agent Mail" : "Connecter Gmail",
    actionPath: gmailOk ? "/gmail-agent" : "/parametres?tab=plateformes",
    priority: 4,
    envConfigured: hasGoogleOAuth,
  });

  // --- 5. GOOGLE DRIVE ---
  let driveOk = false;
  try {
    const conns = await db.select({ status: platformConnectionsTable.status })
      .from(platformConnectionsTable)
      .where(and(
        eq(platformConnectionsTable.platform, "google"),
        eq(platformConnectionsTable.serviceId, "drive"),
      ));
    driveOk = conns.some(c => c.status === "connecte");
  } catch { }

  services.push({
    id: "google_drive",
    name: "Google Drive — Stockage & sauvegarde",
    description: "Sauvegarde automatique des rapports, contacts et documents vers Drive.",
    category: "google",
    icon: "💾",
    status: driveOk ? "connecte" : hasGoogleOAuth ? "disponible" : "non_configure",
    statusLabel: driveOk ? "Synchronisé" : "Disponible via Google OAuth",
    actionLabel: driveOk ? "Voir les sauvegardes" : "Connecter Drive",
    actionPath: driveOk ? "/parametres?tab=sauvegardes" : "/parametres?tab=plateformes",
    priority: 5,
    envConfigured: hasGoogleOAuth,
  });

  // --- 6. GOOGLE DOCS & SHEETS ---
  services.push({
    id: "google_docs_sheets",
    name: "Google Docs & Sheets — Documents",
    description: "Export de rapports vers Google Sheets, génération de documents Docs.",
    category: "productivite",
    icon: "📄",
    status: hasGoogleOAuth ? "disponible" : "non_configure",
    statusLabel: hasGoogleOAuth ? "Disponible via Google OAuth" : "Google OAuth requis",
    actionLabel: "Connecter Docs & Sheets",
    actionPath: "/parametres?tab=plateformes",
    priority: 6,
    envConfigured: hasGoogleOAuth,
  });

  // --- 7. GEMINI AI ---
  const hasGemini = !!(process.env["AI_INTEGRATIONS_GEMINI_API_KEY"] && process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"]);
  services.push({
    id: "gemini",
    name: "Google Gemini — IA principale",
    description: "Analyse d'appels, rédaction intelligente, agents IA, rapports quotidiens.",
    category: "ia",
    icon: "✨",
    status: hasGemini ? "connecte" : "non_configure",
    statusLabel: hasGemini ? "Actif — Gemini 2.0 Flash / 2.5 Pro" : "Clé API manquante",
    actionLabel: hasGemini ? "Voir les agents IA" : "Configurer Gemini",
    actionPath: hasGemini ? "/agents-ia" : "/parametres?tab=intelligence-artificielle",
    priority: 7,
    envConfigured: hasGemini,
  });

  // --- 8. OPENAI ---
  const hasOpenAI = !!(process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] && process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"]);
  services.push({
    id: "openai",
    name: "OpenAI — GPT-4 / GPT-4o",
    description: "Modèle alternatif pour l'analyse contextuelle et la génération de texte.",
    category: "ia",
    icon: "🤖",
    status: hasOpenAI ? "connecte" : "non_configure",
    statusLabel: hasOpenAI ? "Actif — GPT-4o disponible" : "Clé API manquante",
    actionLabel: hasOpenAI ? "Voir l'IA" : "Configurer OpenAI",
    actionPath: hasOpenAI ? "/commandant-ia" : "/parametres?tab=intelligence-artificielle",
    priority: 8,
    envConfigured: hasOpenAI,
  });

  // --- 9. ANTHROPIC ---
  const hasAnthropic = !!(process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] && process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"]);
  services.push({
    id: "anthropic",
    name: "Anthropic Claude — IA raisonnement",
    description: "Analyse avancée, document IA et tâches nécessitant un raisonnement profond.",
    category: "ia",
    icon: "🧠",
    status: hasAnthropic ? "connecte" : "non_configure",
    statusLabel: hasAnthropic ? "Actif — Claude 3.5 Sonnet disponible" : "Clé API manquante",
    actionLabel: hasAnthropic ? "Voir Document IA" : "Configurer Claude",
    actionPath: hasAnthropic ? "/document-ia" : "/parametres?tab=intelligence-artificielle",
    priority: 9,
    envConfigured: hasAnthropic,
  });

  // --- 10. RESEND EMAIL ---
  const hasResend = !!process.env["RESEND_API_KEY"];
  services.push({
    id: "resend",
    name: "Resend — Emails transactionnels",
    description: "Invitations, réinitialisations de mot de passe, alertes et notifications.",
    category: "email",
    icon: "✉️",
    status: hasResend ? "connecte" : "disponible",
    statusLabel: hasResend ? "Actif via connecteur Replit" : "Connecteur Replit disponible",
    actionLabel: hasResend ? "Voir les notifications" : "Activer Resend",
    actionPath: "/parametres?tab=notifications",
    priority: 10,
    envConfigured: hasResend,
  });

  return services.sort((a, b) => a.priority - b.priority);
}

router.get("/discovery/scan", async (req, res): Promise<void> => {
  try {
    const orgId = (req.session as any)?.organisationId;
    const userId = (req.session as any)?.userId;
    if (!orgId || !userId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const services = await scanEnvironment(orgId, userId);

    const connected = services.filter(s => s.status === "connecte").length;
    const available = services.filter(s => s.status === "disponible").length;
    const notConfigured = services.filter(s => s.status === "non_configure").length;

    res.json({
      services,
      summary: {
        total: services.length,
        connected,
        available,
        notConfigured,
        fullyConnected: available === 0 && notConfigured === 0,
      },
      scannedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err }, "Discovery scan error");
    res.status(500).json({ error: "Erreur lors du scan." });
  }
});

export default router;
