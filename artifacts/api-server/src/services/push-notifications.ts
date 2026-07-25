/**
 * push-notifications.ts — Notifications push distantes (Expo) vers l'app mobile.
 *
 * POURQUOI : l'application mobile ne produisait que des notifications LOCALES,
 * planifiees par son propre flux SSE. Elles n'existent donc que tant que le JS
 * de l'app tourne : des que l'OS suspend le process (cas normal sur iOS quelques
 * secondes apres la mise en arriere-plan, et systematiquement quand l'app est
 * fermee), plus aucune alerte n'arrivait. Un nouveau message, une tache urgente
 * ou un appel manque restaient invisibles jusqu'a la prochaine ouverture
 * manuelle de l'app — ce qui vide de son sens la promesse "temps reel".
 *
 * COMMENT : on se branche sur le meme flux d'evenements interne que les
 * webhooks sortants (`broadcaster.onEvent`) — donc aucun appelant metier a
 * modifier — et on relaie les evenements pertinents a l'API push d'Expo pour
 * tous les appareils enregistres de l'organisation.
 *
 * Regles :
 *  - Isolation multi-tenant : seuls les jetons de l'organisation concernee sont
 *    cibles, et l'auteur de l'action (`triggeredBy`) ne recoit pas sa propre
 *    notification.
 *  - Best-effort : une panne d'Expo ne doit jamais casser le chemin d'emission
 *    de l'evenement (tout est isole et logge).
 *  - Auto-nettoyage : un jeton rejete par Expo en `DeviceNotRegistered`
 *    (app desinstallee, jeton revoque) est supprime, sinon la table grossit
 *    indefiniment et chaque envoi paie le cout des jetons morts.
 *
 * Hypothese mono-instance, comme webhook-service : plusieurs instances Cloud Run
 * enverraient la meme notification plusieurs fois. Voir billing-cron pour le
 * pattern advisory lock si ce deploiement change.
 */

import { eq, inArray, ne, and } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { broadcaster, type SyncEvent } from "./broadcaster";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const SEND_TIMEOUT_MS = 10_000;
/** Expo accepte au maximum 100 messages par requete. */
const CHUNK_SIZE = 100;

interface PushContent {
  title: string;
  body: string;
  /** Route mobile ouverte au tap — doit exister dans la liste blanche de app/_layout.tsx. */
  route: string;
}

/**
 * Traduit un evenement metier en notification, ou null s'il ne merite pas
 * d'interrompre l'utilisateur (mises a jour de listes, pings, suppressions...).
 *
 * Volontairement conservateur : mieux vaut manquer une notification que
 * transformer l'app en source de bruit — c'est la premiere raison pour
 * laquelle un utilisateur desactive les notifications au niveau de l'OS,
 * et cette desactivation, elle, est definitive.
 */
export function pushContentForEvent(event: SyncEvent): PushContent | null {
  if (event.action !== "created" && event.type !== "reminder" && event.type !== "security") {
    return null;
  }
  switch (event.type) {
    case "message":
      return { title: "Nouveau message", body: "Vous avez recu un nouveau message.", route: "/messages" };
    case "task":
      return { title: "Nouvelle tache", body: "Une tache vient de vous etre assignee.", route: "/(tabs)/tasks" };
    case "call":
      return { title: "Nouvel appel", body: "Un appel vient d'etre enregistre.", route: "/(tabs)/calls" };
    case "calendar":
      return { title: "Nouveau rendez-vous", body: "Un rendez-vous a ete ajoute a votre agenda.", route: "/calendar" };
    case "reminder":
      return {
        title: typeof event.meta?.title === "string" ? event.meta.title : "Rappel",
        body: typeof event.meta?.body === "string" ? event.meta.body : "Vous avez un rappel imminent.",
        route: "/calendar",
      };
    case "proposition": {
      // Supervision humaine: l'agent a prepare une action et attend un
      // arbitrage. On ne pousse QUE les priorites hautes — un cron peut mettre
      // dix propositions en file d'un coup, dix notifications transformeraient
      // la file d'approbation en source de bruit. Les autres restent visibles
      // par le badge (sondage `/agent-queue/count`), le flux SSE et le resume
      // quotidien, qui rappelle ce qui dort dans la file.
      const priority = typeof event.meta?.priority === "string" ? event.meta.priority : "moyenne";
      if (priority !== "haute" && priority !== "urgente" && priority !== "critique") return null;
      const title = typeof event.meta?.title === "string" ? event.meta.title : "";
      return {
        title: "Action a approuver",
        body: title || "L'agent propose une action et attend votre validation.",
        route: "/file-approbation",
      };
    }
    case "security":
      return {
        title: "Alerte securite",
        body: typeof event.meta?.body === "string" ? event.meta.body : "Un fichier suspect a ete detecte.",
        route: "/documents",
      };
    default:
      return null;
  }
}

interface ExpoTicket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

/** Decoupe une liste en tranches de `size` (limite de l'API Expo). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Envoie un lot a Expo et renvoie les jetons a supprimer (appareils qui
 * n'existent plus). Ne jette jamais.
 */
async function sendChunk(tokens: string[], content: PushContent, resourceId?: number): Promise<string[]> {
  const messages = tokens.map((to) => ({
    to,
    title: content.title,
    body: content.body,
    sound: "default" as const,
    // Meme contrat que les notifications locales : `_layout.tsx` lit `route`
    // (liste blanche) et `resourceId` pour ouvrir directement la ressource.
    data: { route: content.route, ...(resourceId !== undefined ? { resourceId } : {}) },
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "[push] Expo a refuse le lot");
      return [];
    }
    const payload = (await res.json()) as { data?: ExpoTicket[] };
    const tickets = payload.data ?? [];
    const dead: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
        dead.push(tokens[i]);
      } else if (ticket?.status === "error") {
        logger.warn({ err: ticket.message, code: ticket.details?.error }, "[push] ticket en erreur");
      }
    });
    return dead;
  } catch (err) {
    logger.warn({ err }, "[push] envoi Expo echoue");
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Notifie tous les appareils enregistres d'une organisation, sauf ceux de
 * l'auteur de l'action. Best-effort : n'echoue jamais bruyamment.
 */
export async function sendPushForEvent(orgId: number, event: SyncEvent): Promise<void> {
  const content = pushContentForEvent(event);
  if (!content) return;

  try {
    const conditions = [eq(pushTokensTable.organisationId, orgId)];
    if (typeof event.triggeredBy === "number") {
      conditions.push(ne(pushTokensTable.userId, event.triggeredBy));
    }
    const rows = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(and(...conditions));
    if (rows.length === 0) return;

    const tokens = rows.map((r) => r.token);
    const dead: string[] = [];
    for (const part of chunk(tokens, CHUNK_SIZE)) {
      dead.push(...(await sendChunk(part, content, event.resourceId)));
    }
    if (dead.length > 0) {
      await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, dead));
      logger.info({ count: dead.length }, "[push] jetons desinstalles supprimes");
    }
  } catch (err) {
    logger.error({ err, orgId }, "[push] notification non envoyee");
  }
}

let unsubscribe: (() => void) | null = null;

/**
 * Branche le relai push sur le flux d'evenements interne. Idempotent.
 * A appeler une fois au demarrage du serveur.
 */
export function startPushNotifications(): void {
  if (unsubscribe) return;
  unsubscribe = broadcaster.onEvent((orgId, event) => {
    // L'ecouteur doit rester non-bloquant : on ne rend jamais la main a
    // l'emetteur de l'evenement en attendant le reseau.
    void sendPushForEvent(orgId, event);
  });
  logger.info("[push] relai de notifications distantes actif");
}

/** Utile aux tests et a l'arret propre. */
export function stopPushNotifications(): void {
  unsubscribe?.();
  unsubscribe = null;
}
