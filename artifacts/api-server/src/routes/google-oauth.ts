import { Router } from "express";
import { google } from "googleapis";
import {
  db,
  googleOAuthTokensTable,
  googleAppCredentialsTable,
  platformConnectionsTable,
  platformSyncLogsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../lib/logger";
import { getOrgId } from "../middleware/tenant";
import {
  encryptSecret,
  getGoogleRedirectUri,
  getOrgGoogleCredentials,
} from "../lib/google-auth";

const router = Router();

const GOOGLE_SCOPES_MAP: Record<string, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.modify",
  calendar: "https://www.googleapis.com/auth/calendar",
  drive: "https://www.googleapis.com/auth/drive",
  docs: "https://www.googleapis.com/auth/documents",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
  slides: "https://www.googleapis.com/auth/presentations",
  contacts: "https://www.googleapis.com/auth/contacts",
  tasks: "https://www.googleapis.com/auth/tasks",
  keep: "https://www.googleapis.com/auth/keep",
  photos: "https://www.googleapis.com/auth/photoslibrary",
  youtube: "https://www.googleapis.com/auth/youtube.readonly",
  meet: "https://www.googleapis.com/auth/calendar.events",
  chat: "https://www.googleapis.com/auth/chat.spaces.readonly",
  forms: "https://www.googleapis.com/auth/forms.body.readonly",
};

const CORE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

// Construit un client OAuth2 a partir des identifiants de l'organisation.
// `envFallback=false` (defaut connexion) impose des identifiants PROPRES a l'org
// pour eviter une erreur "invalid_client" cryptique cote Google : on renvoie un
// message clair "configurez vos identifiants" a la place.
async function getOAuth2ClientForOrg(
  organisationId: number | null | undefined,
  opts: { envFallback?: boolean } = {},
) {
  const creds = await getOrgGoogleCredentials(organisationId, { envFallback: opts.envFallback ?? false });
  if (!creds) return null;
  return new google.auth.OAuth2(creds.clientId, creds.clientSecret, getGoogleRedirectUri());
}

router.get("/status", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const orgId = req.session?.organisationId ?? null;
    const creds = await getOrgGoogleCredentials(orgId, { envFallback: true });
    const configured = !!creds;

    const tokens = await db.select().from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    const hasToken = tokens.length > 0;
    const tokenValid = hasToken && tokens[0].expiresAt && tokens[0].expiresAt > new Date();

    res.json({
      configured,
      credentialsSource: creds?.source ?? null,
      authenticated: hasToken,
      tokenValid,
      scopes: hasToken ? tokens[0].scope.split(" ") : [],
      expiresAt: hasToken ? tokens[0].expiresAt : null,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Google OAuth status error:");
    res.status(500).json({ error: "Erreur lors de la verification du statut OAuth." });
  }
});

router.post("/auth-url", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const orgId = getOrgId(req);

    // Connexion : identifiants PROPRES a l'org requis (pas de repli env) afin de
    // donner un message clair plutot que "invalid_client".
    const oauth2Client = await getOAuth2ClientForOrg(orgId, { envFallback: false });
    if (!oauth2Client) {
      res.status(400).json({
        error: "Identifiants Google non configures. Ajoutez votre Client ID et Client Secret dans Parametres > Google Workspace.",
        needsConfig: true,
      }); return;
    }

    const { services } = req.body;
    const requestedScopes = [...CORE_SCOPES];

    if (Array.isArray(services) && services.length > 0) {
      for (const svcId of services) {
        const scope = GOOGLE_SCOPES_MAP[svcId];
        if (scope) requestedScopes.push(scope);
      }
    } else {
      requestedScopes.push(...Object.values(GOOGLE_SCOPES_MAP));
    }

    const state = crypto.randomBytes(16).toString("hex");
    req.session.googleOAuthState = state;
    req.session.googleOAuthServices = services || Object.keys(GOOGLE_SCOPES_MAP);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [...new Set(requestedScopes)],
      prompt: "consent",
      state,
      include_granted_scopes: true,
    });

    res.json({ authUrl, state });
  } catch (error: any) {
    logger.error({ err: error }, "Google OAuth auth-url error:");
    res.status(500).json({ error: "Erreur lors de la generation de l'URL d'authentification." });
  }
});

router.get("/callback", async (req, res): Promise<void> => {
  try {
    const { code, state, error: oauthError } = req.query;
    const baseUrl = "/";

    if (oauthError) {
      logger.error({ err: oauthError }, "Google OAuth error:");
      res.redirect(`${baseUrl}parametres?google_error=access_denied`);
      return;
    }

    if (!code || typeof code !== "string") {
      res.redirect(`${baseUrl}parametres?google_error=no_code`);
      return;
    }

    const sessionState = req.session?.googleOAuthState;
    if (!state || state !== sessionState) {
      res.redirect(`${baseUrl}parametres?google_error=invalid_state`);
      return;
    }

    const userId = req.session?.userId;
    if (!userId) {
      res.redirect(`${baseUrl}parametres?google_error=not_authenticated`);
      return;
    }

    const orgId = req.session?.organisationId ?? null;
    // Doit utiliser les MEMES identifiants que /auth-url (org, pas de repli env).
    const oauth2Client = await getOAuth2ClientForOrg(orgId, { envFallback: false });
    if (!oauth2Client) {
      res.redirect(`${baseUrl}parametres?google_error=not_configured`);
      return;
    }

    const { tokens } = await oauth2Client.getToken(code as string);
    const now = new Date();
    const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(now.getTime() + 3600 * 1000);

    const existing = await db.select().from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    if (existing.length > 0) {
      await db.update(googleOAuthTokensTable)
        .set({
          accessToken: tokens.access_token!,
          refreshToken: tokens.refresh_token || existing[0].refreshToken,
          scope: tokens.scope || "",
          organisationId: orgId ?? existing[0].organisationId,
          expiresAt,
          updatedAt: now,
        })
        .where(eq(googleOAuthTokensTable.userId, userId));
    } else {
      await db.insert(googleOAuthTokensTable).values({
        userId,
        organisationId: orgId,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token || null,
        scope: tokens.scope || "",
        expiresAt,
      });
    }

    const services = req.session?.googleOAuthServices || Object.keys(GOOGLE_SCOPES_MAP);
    const grantedScopes = (tokens.scope || "").split(" ");

    for (const svcId of services) {
      const requiredScope = GOOGLE_SCOPES_MAP[svcId];
      if (!requiredScope) continue;
      const isGranted = grantedScopes.includes(requiredScope);
      if (!isGranted) continue;

      const existingConn = await db.select().from(platformConnectionsTable)
        .where(and(
          eq(platformConnectionsTable.platform, "google"),
          eq(platformConnectionsTable.serviceId, svcId)
        ));

      if (existingConn.length > 0) {
        await db.update(platformConnectionsTable)
          .set({ status: "connecte", connectedAt: now, lastSync: now, updatedAt: now })
          .where(and(
            eq(platformConnectionsTable.platform, "google"),
            eq(platformConnectionsTable.serviceId, svcId)
          ));
      } else {
        const svcName = Object.entries(GOOGLE_SCOPES_MAP).find(([k]) => k === svcId)?.[0] || svcId;
        await db.insert(platformConnectionsTable).values({
          platform: "google",
          serviceId: svcId,
          serviceName: svcName.charAt(0).toUpperCase() + svcName.slice(1),
          status: "connecte",
          connectedAt: now,
          lastSync: now,
        });
      }
    }

    await db.insert(platformSyncLogsTable).values({
      platform: "google",
      serviceId: "oauth",
      action: "authentification_oauth",
      status: "succes",
      details: `Authentification Google reussie. ${services.length} services autorises.`,
      itemsProcessed: String(services.length),
    });

    delete req.session.googleOAuthState;
    delete req.session.googleOAuthServices;

    res.redirect(`${baseUrl}parametres?google_success=true`); return;
  } catch (error: any) {
    logger.error({ err: error }, "Google OAuth callback error:");
    res.redirect(`/parametres?google_error=exchange_failed`);
  }
});

router.post("/disconnect", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const orgId = req.session?.organisationId ?? null;

    const tokens = await db.select().from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    if (tokens.length > 0 && tokens[0].accessToken) {
      try {
        // Revoquer avec les identifiants de l'org QUI a emis le token (le
        // refresh_token est lie au client_id emetteur), sinon fallback session.
        const oauth2Client = await getOAuth2ClientForOrg(tokens[0].organisationId ?? orgId, { envFallback: true });
        if (oauth2Client) {
          oauth2Client.setCredentials({ access_token: tokens[0].accessToken });
          await oauth2Client.revokeToken(tokens[0].accessToken);
        }
      } catch (err) { logger.warn({ err: err }, "[GoogleOAuth] operation failed:"); }
    }

    await db.delete(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    await db.update(platformConnectionsTable)
      .set({ status: "deconnecte", updatedAt: new Date() })
      .where(eq(platformConnectionsTable.platform, "google"));

    await db.insert(platformSyncLogsTable).values({
      platform: "google",
      serviceId: "oauth",
      action: "deconnexion_oauth",
      status: "succes",
      details: "Compte Google deconnecte et tokens revoques.",
    });

    res.json({ status: "deconnecte", message: "Compte Google deconnecte avec succes." });
  } catch (error: any) {
    logger.error({ err: error }, "Google OAuth disconnect error:");
    res.status(500).json({ error: "Erreur lors de la deconnexion." });
  }
});

router.post("/refresh", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const orgId = req.session?.organisationId ?? null;

    const tokens = await db.select().from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    if (tokens.length === 0 || !tokens[0].refreshToken) {
      res.status(400).json({ error: "Aucun token de rafraichissement disponible. Reconnectez votre compte Google." }); return;
    }

    // Le refresh_token DOIT etre echange avec le client_id/secret qui l'a emis :
    // on resout les identifiants depuis l'org du token, fallback session.
    const oauth2Client = await getOAuth2ClientForOrg(tokens[0].organisationId ?? orgId, { envFallback: true });
    if (!oauth2Client) {
      res.status(400).json({ error: "Identifiants Google non configures." }); return;
    }

    oauth2Client.setCredentials({ refresh_token: tokens[0].refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();
    const now = new Date();
    const expiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(now.getTime() + 3600 * 1000);

    await db.update(googleOAuthTokensTable)
      .set({
        accessToken: credentials.access_token!,
        expiresAt,
        updatedAt: now,
      })
      .where(eq(googleOAuthTokensTable.userId, userId));

    res.json({ status: "rafraichi", expiresAt });
  } catch (error: any) {
    logger.error({ err: error }, "Google OAuth refresh error:");
    res.status(500).json({ error: "Erreur lors du rafraichissement du token." });
  }
});

// ---------------------------------------------------------------------------
// Gestion des identifiants OAuth PROPRES a l'organisation (bring your own
// credentials). Reserve aux administrateurs / super-admins de l'org.
// ---------------------------------------------------------------------------

function canManageCredentials(req: any): boolean {
  const role = req.session?.userRole;
  return role === "administrateur" || role === "super_admin";
}

// Changer (ou retirer) les identifiants OAuth de l'org invalide les tokens
// existants : ils ont ete emis par un AUTRE client_id et leur refresh echouerait
// silencieusement. On force donc une reconnexion en supprimant les tokens de
// tous les utilisateurs de l'org.
async function resetOrgGoogleTokens(orgId: number): Promise<void> {
  const orgUsers = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.organisationId, orgId));
  const ids = orgUsers.map((u) => u.id);
  if (ids.length === 0) return;
  await db.delete(googleOAuthTokensTable).where(inArray(googleOAuthTokensTable.userId, ids));
}

router.get("/app-credentials", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    if (!canManageCredentials(req)) {
      res.status(403).json({ error: "Acces reserve aux administrateurs de l'organisation." }); return;
    }
    const orgId = getOrgId(req);

    const rows = await db.select().from(googleAppCredentialsTable)
      .where(eq(googleAppCredentialsTable.organisationId, orgId)).limit(1);

    const hasOrgCreds = rows.length > 0 && !!rows[0].clientId;
    const envConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

    res.json({
      configured: hasOrgCreds,
      clientIdPreview: hasOrgCreds ? rows[0].clientId.slice(0, 16) + "..." : null,
      updatedAt: hasOrgCreds ? rows[0].updatedAt : null,
      envFallbackAvailable: envConfigured,
      redirectUri: getGoogleRedirectUri(),
      canManage: canManageCredentials(req),
    });
  } catch (error: any) {
    logger.error({ err: error }, "Google app-credentials read error:");
    res.status(500).json({ error: "Erreur." });
  }
});

router.post("/app-credentials", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    if (!canManageCredentials(req)) {
      res.status(403).json({ error: "Acces reserve aux administrateurs de l'organisation." }); return;
    }
    const orgId = getOrgId(req);

    const clientId = typeof req.body?.clientId === "string" ? req.body.clientId.trim() : "";
    const clientSecret = typeof req.body?.clientSecret === "string" ? req.body.clientSecret.trim() : "";

    if (!clientId || !clientSecret) {
      res.status(400).json({ error: "Client ID et Client Secret requis." }); return;
    }
    if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
      res.status(400).json({
        error: "Le Client ID doit se terminer par '.apps.googleusercontent.com'. Copiez-le depuis Google Cloud Console.",
      }); return;
    }

    const clientSecretEnc = encryptSecret(clientSecret);
    const now = new Date();

    const existing = await db.select().from(googleAppCredentialsTable)
      .where(eq(googleAppCredentialsTable.organisationId, orgId)).limit(1);

    // Si le client_id change (ou premiere config), les tokens existants ont ete
    // emis par un autre client et doivent etre re-crees -> on les purge.
    const clientIdChanged = existing.length === 0 || existing[0].clientId !== clientId;

    if (existing.length > 0) {
      await db.update(googleAppCredentialsTable)
        .set({ clientId, clientSecretEnc, updatedAt: now })
        .where(eq(googleAppCredentialsTable.organisationId, orgId));
    } else {
      await db.insert(googleAppCredentialsTable).values({ organisationId: orgId, clientId, clientSecretEnc });
    }

    if (clientIdChanged) {
      await resetOrgGoogleTokens(orgId);
    }

    res.json({
      status: "enregistre",
      clientIdPreview: clientId.slice(0, 16) + "...",
      redirectUri: getGoogleRedirectUri(),
      reconnectRequired: clientIdChanged,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Google app-credentials write error:");
    res.status(500).json({ error: "Erreur lors de l'enregistrement des identifiants." });
  }
});

router.delete("/app-credentials", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    if (!canManageCredentials(req)) {
      res.status(403).json({ error: "Acces reserve aux administrateurs de l'organisation." }); return;
    }
    const orgId = getOrgId(req);

    await db.delete(googleAppCredentialsTable)
      .where(eq(googleAppCredentialsTable.organisationId, orgId));

    // Les tokens emis avec ces identifiants ne sont plus valides -> reconnexion.
    await resetOrgGoogleTokens(orgId);

    res.json({ status: "supprime" });
  } catch (error: any) {
    logger.error({ err: error }, "Google app-credentials delete error:");
    res.status(500).json({ error: "Erreur lors de la suppression des identifiants." });
  }
});

// Conserve pour compatibilite : l'ancienne config runtime via env est remplacee
// par la gestion par organisation ci-dessus.
router.get("/config", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const orgId = req.session?.organisationId ?? null;
    const creds = await getOrgGoogleCredentials(orgId, { envFallback: true });

    res.json({
      configured: !!creds,
      source: creds?.source ?? null,
      clientIdPreview: creds ? creds.clientId.slice(0, 12) + "..." : null,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Google OAuth config read error");
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
