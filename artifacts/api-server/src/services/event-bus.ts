/**
 * Relai d'evenements entre les instances Cloud Run.
 *
 * Le probleme, mesure: `broadcaster` vit dans la memoire du processus, et le
 * service tourne avec `maxScale=3`. `--session-affinity` colle un navigateur a
 * UNE instance, mais l'evenement, lui, nait la ou arrive le travail — un
 * webhook Twilio/WhatsApp, un cron, ou l'action d'un collegue servie par une
 * autre instance. Le flux temps reel ne montrait donc que les evenements nes
 * sur sa propre instance: deux collegues connectes en meme temps ne voyaient
 * pas les actions l'un de l'autre, et aucune erreur n'apparaissait nulle part.
 *
 * Ce module publie chaque evenement sur un canal Postgres et rejoue ceux des
 * autres instances vers les clients SSE locaux — et vers eux SEULS. Les
 * ecouteurs serveur (push mobile, webhooks sortants) ont deja tourne sur
 * l'instance d'origine; les rejouer ici enverrait la meme notification une
 * fois par instance. C'est d'ailleurs ce que craignaient les commentaires
 * « hypothese mono-instance » de push-notifications.ts et webhook-service.ts:
 * la crainte etait juste, la conclusion non — un evenement n'a jamais qu'un
 * seul emetteur.
 */
import { randomUUID } from "node:crypto";
import { listenForNotifications, publishNotification, type NotificationListener } from "@workspace/db";
import { logger } from "../lib/logger";
import { broadcaster, type SyncEvent } from "./broadcaster";

const CHANNEL = "sync_events";

/**
 * Identifie l'instance emettrice. Sans lui, chaque instance rejouerait son
 * propre evenement aux navigateurs qu'elle sert deja: doublon garanti.
 */
const INSTANCE_ID = randomUUID();

interface BusMessage {
  o: number;          // organisationId
  e: SyncEvent;       // l'evenement
  i: string;          // instance emettrice
}

let listener: NotificationListener | null = null;
let lastPublishWarn = 0;

function warnThrottled(message: string, err: unknown): void {
  const now = Date.now();
  // Une panne du bus se repete a chaque evenement: sans limitation, elle
  // remplirait les journaux plus vite qu'elle ne les rend lisibles.
  if (now - lastPublishWarn < 60_000) return;
  lastPublishWarn = now;
  logger.warn({ err }, message);
}

/**
 * Publie un evenement pour les autres instances. Volontairement « fire and
 * forget »: la diffusion locale a deja eu lieu quand on arrive ici, et une
 * base indisponible doit degrader le temps reel distant, pas faire echouer
 * l'action qui a produit l'evenement.
 */
function publish(orgId: number, event: SyncEvent): void {
  const message: BusMessage = { o: orgId, e: event, i: INSTANCE_ID };
  void publishNotification(CHANNEL, JSON.stringify(message), (err) =>
    warnThrottled("[event-bus] publication impossible — temps reel limite a cette instance", err));
}

export function startEventBus(): void {
  if (listener) return;

  broadcaster.setRelay(publish);

  listener = listenForNotifications(
    CHANNEL,
    (payload) => {
      let message: BusMessage;
      try {
        message = JSON.parse(payload) as BusMessage;
      } catch (err) {
        logger.warn({ err }, "[event-bus] message illisible ignore");
        return;
      }
      // Notre propre evenement: les clients locaux l'ont deja recu.
      if (message.i === INSTANCE_ID) return;
      if (typeof message.o !== "number" || !message.e) return;
      broadcaster.dispatchRemote(message.o, message.e);
    },
    (err) => logger.warn({ err }, "[event-bus] connexion d'ecoute perdue — reconnexion"),
  );

  logger.info({ instance: INSTANCE_ID }, "[event-bus] relai d'evenements inter-instances actif");
}

/** Utile aux tests et a l'arret propre. */
export async function stopEventBus(): Promise<void> {
  broadcaster.setRelay(null);
  const current = listener;
  listener = null;
  await current?.stop();
}

/** Reservee aux tests. */
export const __eventBusInstanceId = INSTANCE_ID;
