import pg from "pg";
import { pool } from "./index";

/**
 * Bus d'evenements inter-instances, porte par LISTEN/NOTIFY de Postgres.
 *
 * Pourquoi: le service tourne avec `maxScale=3` et le diffuseur d'evenements
 * vit dans la memoire du processus. `--session-affinity` colle bien un
 * navigateur a UNE instance, mais ne dit rien de l'instance qui PRODUIT
 * l'evenement: un webhook Twilio/WhatsApp, un cron, ou simplement l'action
 * d'un collegue arrivent sur n'importe laquelle des trois. Le flux temps reel
 * d'un utilisateur ne voyait donc que les evenements nes sur sa propre
 * instance — deux collegues connectes en meme temps ne voyaient pas les
 * actions l'un de l'autre, sans aucune erreur nulle part.
 *
 * Pas de dependance nouvelle: Postgres est deja la, et une connexion dediee
 * suffit. Elle ne peut PAS venir du pool — `LISTEN` s'attache a la session, et
 * une connexion rendue au pool serait reutilisee pour des requetes ordinaires
 * en gardant son abonnement. C'est donc +1 connexion par instance, budget
 * compris (cf. le calcul de POOL_MAX dans index.ts: 2 x 3 x 8 = 48 sur 60,
 * +6 au pire d'un rollout = 54).
 */

/** Limite dure de `pg_notify`: 8000 octets de charge utile. */
const MAX_PAYLOAD_BYTES = 7500;

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface NotificationListener {
  /** Ferme la connexion dediee et arrete les tentatives de reconnexion. */
  stop: () => Promise<void>;
}

/**
 * Publie une charge utile sur un canal. Passe par le pool (une instruction
 * courte), et NE JETTE JAMAIS: la diffusion locale a deja eu lieu, une panne
 * du bus doit degrader le temps reel des autres instances, pas casser
 * l'action de l'utilisateur qui a produit l'evenement.
 *
 * Renvoie `false` quand rien n'a ete publie (charge trop grosse, ou erreur).
 */
export async function publishNotification(
  channel: string,
  payload: string,
  onError?: (err: unknown) => void,
): Promise<boolean> {
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
    onError?.(new Error(`payload too large for pg_notify (${Buffer.byteLength(payload, "utf8")} bytes)`));
    return false;
  }
  try {
    // `pg_notify` plutot que `NOTIFY`: le canal et la charge sont des
    // parametres, donc rien n'est interpole dans du SQL.
    await pool.query("SELECT pg_notify($1, $2)", [channel, payload]);
    return true;
  } catch (err) {
    onError?.(err);
    return false;
  }
}

/**
 * Ouvre une connexion dediee qui ecoute `channel` et rappelle `onPayload` pour
 * chaque notification. Se reconnecte seule avec un delai croissant: une
 * coupure reseau ne doit pas eteindre le temps reel jusqu'au prochain
 * redemarrage.
 */
export function listenForNotifications(
  channel: string,
  onPayload: (payload: string) => void,
  onError?: (err: unknown) => void,
): NotificationListener {
  let client: pg.Client | null = null;
  let stopped = false;
  let delay = RECONNECT_MIN_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
    // Ne pas retenir le processus en vie uniquement pour ce minuteur.
    timer.unref?.();
    delay = Math.min(delay * 2, RECONNECT_MAX_MS);
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    const next = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      keepAlive: true,
      // Surtout PAS de statement_timeout ici: la connexion passe sa vie
      // inactive a attendre des notifications.
    });
    next.on("error", (err) => {
      onError?.(err);
      client = null;
      next.end().catch(() => {});
      scheduleReconnect();
    });
    next.on("notification", (msg) => {
      if (msg.channel === channel && msg.payload) onPayload(msg.payload);
    });
    try {
      await next.connect();
      // `channel` vient du code appelant, jamais d'une entree utilisateur, mais
      // il est quand meme cite: un identifiant SQL ne peut pas etre parametre.
      await next.query(`LISTEN ${JSON.stringify(channel)}`);
      if (stopped) { await next.end().catch(() => {}); return; }
      client = next;
      delay = RECONNECT_MIN_MS;
    } catch (err) {
      onError?.(err);
      await next.end().catch(() => {});
      scheduleReconnect();
    }
  };

  void connect();

  return {
    stop: async () => {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      const current = client;
      client = null;
      if (current) await current.end().catch(() => {});
    },
  };
}
