import { Router, type IRouter } from "express";
import {
  db,
  googleOAuthTokensTable,
  platformConnectionsTable,
  platformSyncLogsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../lib/logger";
import { getOrgId } from "../middleware/tenant";
import { SCOPE_GMAIL_READONLY, SCOPE_GMAIL_SEND, serviceConnecte } from "../services/google-scopes";
import {
  createOAuthClient,
  getGoogleRedirectUri,
  getOrgGoogleCredentials,
  encryptToken,
  decryptToken,
  ensureTokenRowEncrypted,
  ensureEncryptedToken,
} from "../lib/google-auth";

const router = Router();

/**
 * State OAuth signe (HMAC-SHA256), format `<payloadBase64url>.<signature>`.
 *
 * Il remplit les deux roles attendus d'un state OAuth:
 *  - anti-CSRF: seul le serveur peut produire une signature valide, un tiers
 *    ne peut donc pas forger un retour de callback ;
 *  - transport d'identite: le callback sait a QUI rattacher le compte Google
 *    sans dependre du cookie de session, qui n'accompagne pas toujours une
 *    navigation venant d'accounts.google.com.
 *
 * Duree de vie courte: un state ne doit servir qu'a un aller-retour immediat.
 */
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function oauthStateSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("SESSION_SECRET requis pour signer le state OAuth.");
  return secret;
}

interface OAuthStatePayload {
  userId: number;
  orgId: number | null;
  services: string[];
  iat: number;
  nonce: string;
}

export function signOAuthState(input: { userId: number; orgId: number | null; services: string[] }): string {
  const payload: OAuthStatePayload = {
    userId: input.userId,
    orgId: input.orgId,
    services: input.services,
    iat: Date.now(),
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", oauthStateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Retourne le payload si la signature est valide et le state non expire, sinon null. */
export function verifyOAuthState(state: string): OAuthStatePayload | null {
  try {
    const [body, sig] = state.split(".");
    if (!body || !sig) return null;
    const expected = crypto.createHmac("sha256", oauthStateSecret()).update(body).digest("base64url");
    // Comparaison a temps constant: une comparaison naive laisserait fuir la
    // signature attendue par mesure du temps de reponse.
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as OAuthStatePayload;
    if (!payload?.userId || typeof payload.iat !== "number") return null;
    if (Date.now() - payload.iat > OAUTH_STATE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Scopes demandes par service.
 *
 * Gmail demandait `gmail.modify`, qui autorise a LIRE, MODIFIER et SUPPRIMER
 * le courrier. Inventaire de ce que le produit en fait, sur tout le depot :
 * getProfile, labels.list, messages.list/get/attachments, messages.send,
 * threads.get — aucun `modify`, aucun changement d'etiquette, aucune mise a
 * la corbeille, ni via la bibliotheque cliente ni en REST brut.
 *
 * Le droit d'ecriture n'etait utilise nulle part. Les deux scopes sont
 * « restricted » chez Google, donc l'evaluation CASA reste due dans les deux
 * cas : ce que le resserrement change, c'est que l'ecran de consentement cesse
 * de demander le droit de supprimer le courrier, et qu'un jeton compromis ne
 * permet plus de le faire.
 */
const GOOGLE_SCOPES_MAP: Record<string, string[]> = {
  gmail: [SCOPE_GMAIL_READONLY, SCOPE_GMAIL_SEND],
  calendar: ["https://www.googleapis.com/auth/calendar"],
  drive: ["https://www.googleapis.com/auth/drive"],
  docs: ["https://www.googleapis.com/auth/documents"],
  sheets: ["https://www.googleapis.com/auth/spreadsheets"],
  slides: ["https://www.googleapis.com/auth/presentations"],
  contacts: ["https://www.googleapis.com/auth/contacts"],
  tasks: ["https://www.googleapis.com/auth/tasks"],
  keep: ["https://www.googleapis.com/auth/keep"],
  photos: ["https://www.googleapis.com/auth/photoslibrary"],
  youtube: ["https://www.googleapis.com/auth/youtube.readonly"],
  meet: ["https://www.googleapis.com/auth/calendar.events"],
  chat: ["https://www.googleapis.com/auth/chat.spaces.readonly"],
  forms: ["https://www.googleapis.com/auth/forms.body.readonly"],
};

const CORE_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

// Services demandes par defaut lors d'une connexion "tout Google".
// Cote Google, un SEUL scope dont l'API est desactivee — ou non disponible pour
// le type de compte — fait echouer TOUT le consentement avec un 403 generique
// ("you do not have access to this page"). Pour maximiser le taux de reussite de
// la connexion et minimiser le nombre d'API que le proprietaire doit activer, on
// se limite par defaut aux 3 scopes essentiels (Gmail, Agenda, Drive). Les autres
// (docs, sheets, contacts, tasks, et les scopes fragiles keep/photos/youtube/
// meet/chat/forms) restent connectables a la demande via la decouverte
// d'integrations (l'appelant peut toujours passer `services: [...]` explicite).
const DEFAULT_SERVICES = ["gmail", "calendar", "drive"];

// Modele SaaS centralise : on construit TOUJOURS le client OAuth2 a partir des
// identifiants GLOBAUX du serveur (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
// Les identifiants ne sont jamais propres a une organisation ni exposes a l'UI.
// La construction est deleguee a `createOAuthClient` (lib/google-auth.ts), seule
// source de verite pour fabriquer un client OAuth2.
const getOAuth2ClientForOrg = createOAuthClient;

router.get("/status", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }

    const orgId = req.session?.organisationId ?? null;
    const creds = await getOrgGoogleCredentials(orgId, { envOnly: true });
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
      // URI de redirection effective (callback public, non secret) : l'admin doit
      // l'enregistrer a l'identique dans la console Google Cloud. Surface dans l'UI
      // pour faciliter le diagnostic des erreurs "redirect_uri_mismatch".
      redirectUri: getGoogleRedirectUri(),
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

    // Modele centralise : on utilise les identifiants OAuth GLOBAUX du serveur
    // (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Chaque utilisateur connecte
    // simplement SON propre compte Google ; les identifiants de l'application ne
    // sont jamais exposes a l'utilisateur final.
    const oauth2Client = await getOAuth2ClientForOrg(orgId);
    if (!oauth2Client) {
      res.status(503).json({ error: "La connexion Google est momentanement indisponible." }); return;
    }

    const { services } = req.body;
    const requestedScopes = [...CORE_SCOPES];

    const effectiveServices =
      Array.isArray(services) && services.length > 0 ? services : DEFAULT_SERVICES;
    for (const svcId of effectiveServices) {
      const scopes = GOOGLE_SCOPES_MAP[svcId];
      if (scopes) requestedScopes.push(...scopes);
    }

    // State SIGNE portant l'utilisateur, au lieu d'un aleatoire stocke en session.
    //
    // Le retour de Google est une navigation venant d'un AUTRE site. Si le
    // cookie de session n'accompagne pas cette navigation — politique du
    // navigateur, cookies tiers restreints, session expiree pendant que
    // l'utilisateur donnait son consentement — la session est vide au callback
    // et l'ancien code repondait "Non authentifie" alors que l'autorisation
    // Google avait pourtant reussi. Le state porte donc lui-meme l'identite,
    // signe en HMAC pour rester infalsifiable, avec une expiration courte.
    const state = signOAuthState({ userId, orgId, services: effectiveServices });
    // Conserve aussi en session quand elle est disponible: double verification
    // pour les navigateurs qui renvoient bien le cookie.
    req.session.googleOAuthState = state;
    req.session.googleOAuthServices = effectiveServices;

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

/**
 * Router du SEUL callback, monte AVANT requireAuth (cf. routes/index.ts).
 *
 * Google renvoie l'utilisateur ici depuis accounts.google.com. Cette navigation
 * n'emporte pas toujours le cookie de session, si bien que le callback tombait
 * sur requireAuth et repondait `{"error":"Non authentifie"}` en JSON brut —
 * l'utilisateur voyait une page blanche avec un message technique alors qu'il
 * venait d'autoriser l'acces cote Google. L'identite provient desormais du
 * state signe, la protection anti-CSRF de sa signature: aucune session requise.
 *
 * Les autres routes (/auth-url, /status, /disconnect, /refresh, /config)
 * restent derriere requireAuth.
 */
export const googleOAuthCallbackRouter: IRouter = Router();

googleOAuthCallbackRouter.get("/callback", async (req, res): Promise<void> => {
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

    // Identite reconstruite depuis le state SIGNE, pas depuis la session.
    // Le cookie de session n'accompagne pas forcement le retour depuis
    // accounts.google.com; s'y fier faisait echouer la connexion avec
    // "Non authentifie" alors que l'autorisation Google avait reussi.
    const verified = typeof state === "string" ? verifyOAuthState(state) : null;
    if (!verified) {
      res.redirect(`${baseUrl}parametres?google_error=invalid_state`);
      return;
    }

    // LE STATE FAIT AUTORITE. La session ne peut que le CONFIRMER.
    //
    // L'ordre precedent etait `req.session?.userId ?? verified.userId`: la
    // session primait, le state ne servait que de repli. Cela annulait la
    // raison d'etre du state signe, qui est de lier ce retour a l'utilisateur
    // qui a REELLEMENT lance l'autorisation.
    //
    // Le scenario, sur une route GET sans jeton CSRF:
    //
    //   1. l'attaquant lance le flux pour LUI, obtient un `code` Google
    //      valide et un `state` signe a son nom;
    //   2. il envoie a la victime un lien vers ce callback portant SES `code`
    //      et `state`;
    //   3. la victime est connectee, son cookie part avec la navigation;
    //   4. `verified` designe l'attaquant, mais `req.session.userId` designe
    //      la victime — et c'est la session qui gagnait.
    //
    // Les jetons Google de l'ATTAQUANT etaient alors enregistres sur le
    // compte de la VICTIME. Tout ce que l'application pousse ensuite vers
    // Google — sauvegardes Drive, evenements d'agenda, messages — partait
    // vers le compte de l'attaquant. Rien n'apparaissait comme une erreur:
    // la victime voyait « Google connecte ».
    //
    // Une session qui contredit le state n'est donc pas une preference a
    // arbitrer, c'est un signe d'attaque: on refuse.
    if (req.session?.userId && req.session.userId !== verified.userId) {
      logger.warn(
        { sessionUserId: req.session.userId, stateUserId: verified.userId },
        "[google-oauth] callback refuse: la session ne correspond pas au state signe",
      );
      res.redirect(`${baseUrl}parametres?google_error=invalid_state`);
      return;
    }
    const userId = verified.userId;
    const orgId = verified.orgId ?? req.session?.organisationId ?? null;
    // Memes identifiants globaux que /auth-url.
    const oauth2Client = await getOAuth2ClientForOrg(orgId);
    if (!oauth2Client) {
      res.redirect(`${baseUrl}parametres?google_error=exchange_failed`);
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
          accessToken: encryptToken(tokens.access_token!),
          refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : ensureEncryptedToken(existing[0].refreshToken),
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
        accessToken: encryptToken(tokens.access_token!),
        refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
        scope: tokens.scope || "",
        expiresAt,
      });
    }

    const services = req.session?.googleOAuthServices || Object.keys(GOOGLE_SCOPES_MAP);
    const grantedScopes = (tokens.scope || "").split(" ");

    for (const svcId of services) {
      const requiredScopes = GOOGLE_SCOPES_MAP[svcId];
      if (!requiredScopes) continue;
      // ENGLOBEMENT, et non egalite stricte.
      //
      // Les utilisateurs deja connectes ont accorde `gmail.modify`. Comparer
      // le scope demande au scope accorde par egalite aurait affiche « Gmail
      // non connecte » a tous ceux-la, dont le jeton fonctionne parfaitement.
      // Un scope accorde satisfait un scope requis s'il le contient.
      if (!serviceConnecte(requiredScopes, grantedScopes)) continue;

      const existingConn = await db.select().from(platformConnectionsTable)
        .where(and(
          eq(platformConnectionsTable.organisationId, orgId as number),
          eq(platformConnectionsTable.platform, "google"),
          eq(platformConnectionsTable.serviceId, svcId)
        ));

      if (existingConn.length > 0) {
        await db.update(platformConnectionsTable)
          .set({ status: "connecte", connectedAt: now, lastSync: now, updatedAt: now })
          .where(and(
            eq(platformConnectionsTable.organisationId, orgId as number),
            eq(platformConnectionsTable.platform, "google"),
            eq(platformConnectionsTable.serviceId, svcId)
          ));
      } else {
        const svcName = Object.entries(GOOGLE_SCOPES_MAP).find(([k]) => k === svcId)?.[0] || svcId;
        await db.insert(platformConnectionsTable).values({
          organisationId: orgId,
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
      organisationId: orgId,
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
        const oauth2Client = await getOAuth2ClientForOrg(tokens[0].organisationId ?? orgId);
        if (oauth2Client) {
          const accessToken = decryptToken(tokens[0].accessToken);
          if (accessToken) {
            oauth2Client.setCredentials({ access_token: accessToken });
            await oauth2Client.revokeToken(accessToken);
          }
        }
      } catch (err) { logger.warn({ err: err }, "[GoogleOAuth] operation failed:"); }
    }

    await db.delete(googleOAuthTokensTable)
      .where(eq(googleOAuthTokensTable.userId, userId));

    await db.update(platformConnectionsTable)
      .set({ status: "deconnecte", updatedAt: new Date() })
      .where(and(eq(platformConnectionsTable.organisationId, orgId as number), eq(platformConnectionsTable.platform, "google")));

    await db.insert(platformSyncLogsTable).values({
      organisationId: orgId,
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

    // Re-chiffre une eventuelle ligne legacy en clair avant la maj du flux refresh.
    await ensureTokenRowEncrypted(tokens[0]);

    // Le refresh_token DOIT etre echange avec le client_id/secret qui l'a emis :
    // on resout les identifiants depuis l'org du token, fallback session.
    const oauth2Client = await getOAuth2ClientForOrg(tokens[0].organisationId ?? orgId);
    if (!oauth2Client) {
      res.status(400).json({ error: "Identifiants Google non configures." }); return;
    }

    oauth2Client.setCredentials({ refresh_token: decryptToken(tokens[0].refreshToken) });
    const { credentials } = await oauth2Client.refreshAccessToken();
    const now = new Date();
    const expiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(now.getTime() + 3600 * 1000);

    await db.update(googleOAuthTokensTable)
      .set({
        accessToken: encryptToken(credentials.access_token!),
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

// Statut de configuration : indique simplement si l'application Google est
// operationnelle cote serveur. N'expose jamais le Client ID/Secret a l'UI.
router.get("/config", async (req, res): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: "Non authentifie." }); return; }
    const orgId = req.session?.organisationId ?? null;
    const creds = await getOrgGoogleCredentials(orgId, { envOnly: true });

    res.json({
      configured: !!creds,
      source: creds?.source ?? null,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Google OAuth config read error");
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
