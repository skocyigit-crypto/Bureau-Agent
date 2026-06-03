import { Router, type IRouter } from "express";
import { requireAuth, requireSuperAdmin } from "../middleware/auth";
import { requireTenant } from "../middleware/tenant";
import { licenseCheck } from "../middleware/license-check";
import healthRouter from "./health";
import authRouter from "./auth";
import registerRouter from "./register";
import callsRouter from "./calls";
import contactsRouter from "./contacts";
import tasksRouter from "./tasks";
import messagesRouter from "./messages";
import dashboardRouter from "./dashboard";
import aiAnalysisRouter from "./ai-analysis";
import workspaceRouter from "./workspace";
import integrationsRouter from "./integrations";
import checkinsRouter from "./checkins";
import locationsRouter from "./locations";
import aiAgentsRouter from "./ai-agents";
import backupsRouter from "./backups";
import googleOAuthRouter from "./google-oauth";
import calendarRouter from "./calendar";
import auditRouter from "./audit";
import searchRouter from "./search";
import exportRouter from "./export";
import automationsRouter from "./automations";
import performanceRouter from "./performance";
import subscriptionsRouter from "./subscriptions";
import organisationsRouter from "./organisations";
import adminReportsRouter from "./admin-reports";
import billingRouter from "./billing";
import legalRouter from "./legal";
import googleDriveBackupRouter from "./google-drive-backup";
import securityRouter from "./security";
import googleWorkspaceRouter from "./google-workspace";
import mathRouter from "./math";
import dataProtectionRouter from "./data-protection";
import documentAiRouter from "./document-ai";
import mySubscriptionRouter from "./my-subscription";
import smartReportsRouter from "./smart-reports";
import bulkOperationsRouter from "./bulk-operations";
import licenseManagementRouter from "./license-management";
import aiCommandantRouter from "./ai-commandant";
import agentCollaborationRouter from "./agent-collaboration";
import faceRecognitionRouter from "./face-recognition";
import telephonyRouter, { telephonyWebhookRouter } from "./telephony";
import voiceCommandRouter from "./voice-command";
import voiceSiteOpsRouter from "./voice-site-ops";
import { twilioVoiceRouter } from "./twilio-voice";
import { whatsappRouter } from "./whatsapp";
import { voiceReceptionistRouter } from "./voice-receptionist";
import invitationsRouter from "./invitations";
import documentsRouter from "./documents";
import aiUsageRouter from "./ai-usage";
import meetingsRouter from "./meetings";
import gmailRouter from "./gmail";
import orgProfileRouter from "./org-profile";
import demoRequestRouter from "./demo-request";
import contactRequestRouter from "./contact-request";
import publicDemoChatRouter from "./public-demo-chat";
import prospectsRouter from "./prospects";
import devisRouter from "./devis";
import facturesClientRouter from "./factures-client";
import notesInternesRouter from "./notes-internes";
import projetsRouter from "./projets";
import dailyDigestRouter from "./daily-digest";
import aiInsightsRouter from "./ai-insights";
import aiInlineSuggestRouter from "./ai-inline-suggest";
import userPreferencesRouter from "./user-preferences";
import aiInlineSuggestEventsRouter from "./ai-inline-suggest-events";
import assistantRouter from "./assistant";
import agentQueueRouter from "./agent-queue";
import appAuditRouter from "./app-audit";
import workforceIntelligenceRouter from "./workforce-intelligence";
import workforceAgentRouter from "./workforce-agent";
import syncRouter from "./sync";
import { autoBroadcast } from "../middleware/auto-broadcast";
import discoveryRouter from "./discovery";
import proactiveRouter from "./proactive";
import aiLearningRouter from "./ai-learning";
import webSearchRouter from "./web-search";
import stripeRouter from "./stripe";
import adminSaasDashboardRouter from "./admin-saas-dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(registerRouter);
router.use(demoRequestRouter);
router.use(contactRequestRouter);
router.use(publicDemoChatRouter);
router.use(telephonyWebhookRouter);
router.use(twilioVoiceRouter);
router.use(whatsappRouter);
router.use(voiceReceptionistRouter);
router.get("/invitations/verify/:token", (req, res, next) => invitationsRouter(req, res, next));
router.post("/invitations/accept/:token", (req, res, next) => invitationsRouter(req, res, next));

router.use(syncRouter);

router.use(requireAuth);

// Backoffice SaaS — accessible super-admin uniquement (Tâche #52, #53).
// Monte AVANT `requireTenant` pour que le super-admin puisse appeler ces
// routes meme s'il n'a pas d'organisation rattachee, et pour basculer la
// vue de "scope tenant" a "scope SaaS global". Les handlers internes ne
// filtrent plus par `organisation_id` par defaut (cf. routes/{prospects,
// devis,factures-client}.ts) et acceptent un parametre `?organisationId=`
// optionnel pour scoper une organisation.
//
// Garde aussi tout futur module `/stock` derriere `requireSuperAdmin`:
// aucun controleur dedie n'existe aujourd'hui, mais cela garantit que
// si un router `/stock` est ajoute plus tard il sera locke par defaut
// au lieu d'etre accessible aux comptes clients.
// IMPORTANT: `requireSuperAdmin` doit etre PATH-SCOPED. Monte sous la forme
// `router.use(requireSuperAdmin, xRouter)` (sans prefixe de chemin), il
// s'enregistre comme middleware global a `/` et bloque alors TOUTES les routes
// tenant suivantes (calls, contacts, tasks, ...) pour les comptes non
// super-admin. On scope donc la garde au prefixe exact de chaque router
// (les routers declarent leur chemin complet en interne, ex. `/prospects`).
router.use("/admin/saas-dashboard", requireSuperAdmin);
router.use("/prospects", requireSuperAdmin);
router.use("/devis", requireSuperAdmin);
router.use("/factures-client", requireSuperAdmin);
router.use(adminSaasDashboardRouter);
router.use(prospectsRouter);
router.use(devisRouter);
router.use(facturesClientRouter);
router.use("/stock", requireSuperAdmin, (_req, res) => {
  res.status(404).json({ error: "Module stock indisponible." });
});

router.use(requireTenant);

router.use(mySubscriptionRouter);
router.use(stripeRouter);
router.use(licenseCheck);

router.use(autoBroadcast);
router.use(callsRouter);
router.use(contactsRouter);
router.use(tasksRouter);
router.use(messagesRouter);
router.use(dashboardRouter);
router.use(aiAnalysisRouter);
router.use(aiAgentsRouter);
router.use(calendarRouter);
router.use(auditRouter);
router.use(searchRouter);
router.use(exportRouter);
router.use(automationsRouter);
router.use(subscriptionsRouter);
router.use("/workspace", workspaceRouter);
router.use("/workspace", backupsRouter);
router.use("/integrations", integrationsRouter);
router.use("/google-oauth", googleOAuthRouter);
router.use(checkinsRouter);
router.use(locationsRouter);
router.use(performanceRouter);
router.use(organisationsRouter);
router.use(adminReportsRouter);
router.use(billingRouter);
router.use(legalRouter);
router.use(googleDriveBackupRouter);
router.use(securityRouter);
router.use(googleWorkspaceRouter);
router.use(mathRouter);
router.use(dataProtectionRouter);
router.use(documentAiRouter);
router.use(smartReportsRouter);
router.use(bulkOperationsRouter);
router.use(licenseManagementRouter);
router.use(aiCommandantRouter);
router.use(aiUsageRouter);
router.use(agentCollaborationRouter);
router.use("/face", faceRecognitionRouter);
router.use(telephonyRouter);
router.use(voiceCommandRouter);
router.use(voiceSiteOpsRouter);
router.use(invitationsRouter);
router.use(documentsRouter);
router.use(meetingsRouter);
router.use(gmailRouter);
router.use(orgProfileRouter);
// NOTE: adminSaasDashboardRouter, prospectsRouter, devisRouter et
// facturesClientRouter sont montes plus haut, AVANT requireTenant, sous
// `requireSuperAdmin` (Tâche #53).
router.use(notesInternesRouter);
router.use(projetsRouter);
router.use(dailyDigestRouter);
router.use(aiInsightsRouter);
router.use(aiInlineSuggestRouter);
router.use(userPreferencesRouter);
router.use(aiInlineSuggestEventsRouter);
router.use(assistantRouter);
router.use(agentQueueRouter);
router.use(appAuditRouter);
router.use(workforceIntelligenceRouter);
router.use(workforceAgentRouter);
router.use(discoveryRouter);
router.use(proactiveRouter);
router.use(aiLearningRouter);
router.use(webSearchRouter);

export default router;
