import { Router } from "express";
import { google } from "googleapis";
import { db, googleOAuthTokensTable, platformConnectionsTable, platformSyncLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../lib/logger";

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

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Prefer explicit redirect URI; fallback to PUBLIC_URL/APP_URL; finally Replit domain.
  const publicBase = process.env.PUBLIC_URL || process.env.APP_URL;
  const replitDomain = process.env.REPLIT_DEV_DOMAIN || (process.env.REPL_SLUG ? `${process.env.REPL_SLUG}.repl.co` : null);
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
    || (publicBase ? `${publicBase.replace(/\/$/, "")}/api/google-oauth/callback` : null)
    || (replitDomain ? `https://${replitDomain}/api/google-oauth/callback` : "http://localhost/api/google-oauth/callback");

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

router.get("/status", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const configured = !!(clientId && clientSecret);

    const tokens = await db.select().from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    const hasToken = tokens.length > 0;
    const tokenValid = hasToken && tokens[0].expiresAt && tokens[0].expiresAt > new Date();

    res.json({
      configured,
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

    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
      res.status(400).json({
        error: "Google Workspace n'est pas configure. Ajoutez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans les variables d'environnement.",
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

    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
      res.redirect(`${baseUrl}parametres?google_error=not_configured`);
      return;
    }

    const { tokens } = await oauth2Client!.getToken(code as string);
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
          expiresAt,
          updatedAt: now,
        })
        .where(eq(googleOAuthTokensTable.userId, userId));
    } else {
      await db.insert(googleOAuthTokensTable).values({
        userId,
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

    const tokens = await db.select().from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    if (tokens.length > 0 && tokens[0].accessToken) {
      try {
        const oauth2Client = getOAuth2Client();
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

    const tokens = await db.select().from(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    if (tokens.length === 0 || !tokens[0].refreshToken) {
      res.status(400).json({ error: "Aucun token de rafraichissement disponible. Reconnectez votre compte Google." }); return;
    }

    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
      res.status(400).json({ error: "Google Workspace n'est pas configure." }); return;
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

router.get("/config", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    res.json({
      configured: !!(clientId && clientSecret),
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      clientIdPreview: clientId ? clientId.slice(0, 12) + "..." : null,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Google OAuth config read error");
    res.status(500).json({ error: "Erreur." });
  }
});

router.post("/config", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const userRole = req.session?.userRole;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    if (userRole !== "super_admin") { res.status(403).json({ error: "Acces reserve au Super Administrateur." }); return; }

    res.status(410).json({
      error: "Configuration runtime desactivee pour des raisons de securite.",
      code: "runtime_oauth_config_disabled",
      message:
        "Les identifiants Google OAuth doivent etre configures via les variables d'environnement (Replit Secrets) "
        + "GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET. La configuration runtime est desactivee car elle etait volatile "
        + "(perdue au redemarrage) et exposait les identifiants en memoire. Ajoutez-les dans l'onglet 'Secrets' de Replit "
        + "puis redemarrez le serveur.",
      docsUrl: "https://docs.replit.com/replit-workspace/workspace-features/secrets",
    });
  } catch (error: any) {
    logger.error({ err: error }, "Google OAuth config error:");
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
