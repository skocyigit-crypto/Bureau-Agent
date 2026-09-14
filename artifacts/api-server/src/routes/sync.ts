import { Router } from "express";
import { broadcaster, type SyncEventType } from "../services/broadcaster";

const router = Router();

router.get("/sync/events", (req, res): void => {
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (!orgId || !userId) { res.status(401).end(); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const unsubscribe = broadcaster.subscribe(orgId, res);

  const welcome = `data: ${JSON.stringify({ type: "ping", action: "ping", ts: Date.now(), connections: broadcaster.connectionCount(orgId) })}\n\n`;
  res.write(welcome);

  const heartbeat = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: "ping", action: "ping", ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  // Duree de vie maximale du flux.
  //
  // Sans elle, un simple onglet laisse ouvert (meme en arriere-plan) maintient
  // une connexion indefiniment: Cloud Run ne peut jamais arreter l'instance et
  // la facture court en continu, ce qui annule tout l'interet de
  // min-instances=0. Au bout du delai on ferme proprement; le client se
  // reconnecte tout seul (use-realtime-sync.tsx gere deja la reprise), donc le
  // temps reel n'est pas perdu — l'instance obtient juste une fenetre pour
  // s'eteindre si plus personne ne travaille.
  // Le delai doit rester SOUS le delai de requete de Cloud Run (300 s par
  // defaut, valeur effective du service). Il valait 30 minutes: la plateforme
  // coupait donc le flux six fois plus tot que prevu, et la fermeture propre
  // ci-dessous — la seule chose qui evite le reveil immediat — n'avait jamais
  // lieu.
  //
  // Mesure sur sept jours de production: dix-sept flux termines a
  // 300,99 s, tous a la seconde du plafond de la plateforme. Aucun a 1800 s.
  //
  // Le degat est exactement celui que le commentaire ci-dessus cherche a
  // eviter: un onglet inactif se rebranche AUSSITOT, toutes les cinq minutes,
  // et maintient une instance eveillee — ce qui annule l'interet de
  // min-instances=0. Rien ne le signale: le temps reel fonctionne, le client
  // se reconnecte, seule la facture en parle.
  const MARGE_SOUS_LE_DELAI_PLATEFORME_MS = 240 * 1000;
  const maxMs = Number(process.env.SSE_MAX_DURATION_MS || MARGE_SOUS_LE_DELAI_PLATEFORME_MS);
  const maxLifetime = setTimeout(() => {
    try {
      // `retry` indique au navigateur d'attendre avant de revenir: sur un
      // onglet inactif, cela evite qu'il se rebranche instantanement et
      // reveille l'instance pour rien.
      res.write("retry: 60000\n");
      res.write(`data: ${JSON.stringify({ type: "ping", action: "reconnect", ts: Date.now() })}\n\n`);
    } catch { /* le flux est peut-etre deja mort */ }
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  }, maxMs);

  req.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(maxLifetime);
    unsubscribe();
  });
});

router.post("/sync/broadcast", (req, res): void => {
  const orgId = req.session?.organisationId;
  const userId = req.session?.userId;
  if (!orgId || !userId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const { type, action, resourceId } = req.body as {
    type: SyncEventType;
    action: "created" | "updated" | "deleted";
    resourceId?: number;
  };

  if (!type || !action) { res.status(400).json({ error: "type et action requis." }); return; }

  broadcaster.broadcast(orgId, { type, action, resourceId, triggeredBy: userId });
  res.json({ ok: true, connections: broadcaster.connectionCount(orgId) });
});

/**
 * Etat des connexions temps reel.
 *
 * Cette route ne demandait RIEN et rendait `totalConnections` — le nombre
 * d'utilisateurs connectes sur TOUTE la plateforme, tous clients confondus.
 * Verifie en production: 200 sans session.
 *
 * Ce n'est pas une fuite de donnees personnelles, et c'est pourquoi elle a
 * dure: aucun nom, aucun identifiant. Mais interrogee chaque minute pendant un
 * mois, elle trace la courbe d'activite de l'entreprise — les heures de
 * travail de la clientele, les creux, la croissance. C'est une information
 * commerciale, et elle etait offerte a qui la demandait.
 *
 * Deux changements: une session est desormais exigee, et le total de la
 * plateforme n'est rendu qu'au super-administrateur. Un client n'a aucune
 * raison de voir l'activite des autres clients.
 */
router.get("/sync/status", (req, res): void => {
  const orgId = req.session?.organisationId;
  if (!orgId) { res.status(401).json({ error: "Non authentifie." }); return; }

  const estSuperAdmin = req.session?.userRole === "super_admin";
  res.json({
    orgConnections: broadcaster.connectionCount(orgId),
    ...(estSuperAdmin ? { totalConnections: broadcaster.totalConnections() } : {}),
  });
});

export default router;
