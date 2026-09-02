/**
 * Depot partage des bannissements d'IP du Guardian.
 *
 * Le probleme, mesure sur le service en production: `maxScale=3`. Trois
 * processus servent le meme domaine et un visiteur ne retombe pas forcement
 * sur le meme. La liste de bannissements vivait dans une `Map` de module —
 * donc une liste par processus. Un attaquant banni sur une instance restait
 * servi par les deux autres, et le compteur d'escalade (5 min -> 15 -> 1 h ->
 * 6 h -> 1 jour, definitif au sixieme manquement) se remettait a zero d'une
 * instance a l'autre: reparti sur trois, il pouvait accumuler quinze
 * manquements sans jamais devenir definitif.
 *
 * Deux contraintes ont dicte la forme de ce module, et elles tirent en sens
 * inverse.
 *
 * 1. Le Guardian s'execute sur CHAQUE requete. Il ne peut pas attendre la
 *    base: la `Map` en memoire reste le chemin de lecture, et elle reste
 *    synchrone. Ce module ne fait que l'alimenter.
 *
 * 2. Pas de `setInterval`. Cloud Run n'alloue du processeur que pendant le
 *    traitement d'une requete; ce depot a deja appris la lecon avec les agents
 *    de sante, dont le minuteur interne mesurait un processus prive de CPU
 *    (3,5 s pour un `SELECT 1`). La resynchronisation est donc PARESSEUSE:
 *    declenchee par une requete quand elle date de plus de `REFRESH_MS`, et
 *    jamais attendue.
 *
 * Enfin, ce module ne doit jamais casser le Guardian. Si la table n'existe pas
 * encore (le schema de production se pousse a la main, cf.
 * `deploy/gcp-schema-push.sh`), il se desactive proprement et le Guardian
 * retrouve exactement son comportement d'avant — par instance, mais vivant.
 * Un pare-feu qui tombe parce que sa table manque serait pire que le defaut
 * qu'on corrige.
 */
import { sql } from "drizzle-orm";
import { db, ipBansTable } from "@workspace/db";
import { logger } from "../lib/logger";

export interface SharedBan {
  count: number;
  /** `Infinity` pour un bannissement definitif — la forme attendue par le Guardian. */
  until: number;
  permanent: boolean;
  reasons: string[];
}

/** Au-dela, on considere la copie locale comme perimee et on relit la base. */
const REFRESH_MS = 30_000;
/** Apres une panne (table absente, base injoignable), on ne reessaie pas en boucle. */
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;

let lastRefreshAt = 0;
let refreshing = false;
let disabledUntil = 0;
let warnedUnavailable = false;

function markUnavailable(err: unknown): void {
  disabledUntil = Date.now() + RETRY_AFTER_FAILURE_MS;
  if (!warnedUnavailable) {
    warnedUnavailable = true;
    logger.warn(
      { err },
      "[ip-ban-store] Table indisponible: le Guardian retombe sur des bannissements par instance. " +
      "Si la table `ip_bans` manque, pousser le schema (deploy/gcp-schema-push.sh).",
    );
  }
}

function available(): boolean {
  return Date.now() >= disabledUntil;
}

/** `Infinity` cote Guardian, `null` + `permanent` cote base. */
function toRow(ip: string, ban: SharedBan) {
  return {
    ip,
    count: ban.count,
    until: ban.permanent || !Number.isFinite(ban.until) ? null : new Date(ban.until),
    permanent: ban.permanent,
    reasons: ban.reasons,
    updatedAt: new Date(),
  };
}

function fromRow(row: { count: number; until: Date | null; permanent: boolean; reasons: string[] }): SharedBan {
  return {
    count: row.count,
    until: row.permanent || row.until === null ? Infinity : new Date(row.until).getTime(),
    permanent: row.permanent,
    reasons: row.reasons ?? [],
  };
}

/**
 * Enregistre un bannissement pour toutes les instances.
 *
 * Le compteur est incremente EN BASE (`ip_bans.count + 1`) et non recopie
 * depuis la memoire locale: c'est tout l'objet de l'exercice. Trois instances
 * qui bannissent chacune deux fois doivent totaliser six manquements — donc un
 * bannissement definitif — et non trois compteurs a deux.
 *
 * Ne jette jamais et n'est jamais attendu par le chemin de la requete.
 */
export async function persistBan(ip: string, ban: SharedBan): Promise<void> {
  if (!available()) return;
  const row = toRow(ip, ban);
  try {
    await db.insert(ipBansTable).values(row).onConflictDoUpdate({
      target: ipBansTable.ip,
      set: {
        count: sql`${ipBansTable.count} + 1`,
        until: row.until,
        permanent: row.permanent,
        reasons: row.reasons,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    markUnavailable(err);
  }
}

/** Bannissements encore actifs, tels que la base les connait. */
export async function loadActiveBans(): Promise<Map<string, SharedBan>> {
  const out = new Map<string, SharedBan>();
  if (!available()) return out;
  try {
    const rows = await db.select({
      ip: ipBansTable.ip,
      count: ipBansTable.count,
      until: ipBansTable.until,
      permanent: ipBansTable.permanent,
      reasons: ipBansTable.reasons,
    }).from(ipBansTable).where(
      sql`${ipBansTable.permanent} = true OR ${ipBansTable.until} > now()`,
    );
    for (const row of rows) out.set(row.ip, fromRow(row));
    // Une lecture reussie efface le souvenir de la panne precedente: sinon un
    // incident passager rendrait l'avertissement definitivement muet.
    warnedUnavailable = false;
  } catch (err) {
    markUnavailable(err);
  }
  return out;
}

/**
 * Resynchronisation paresseuse, appelee depuis le chemin d'une requete.
 *
 * Ne rend rien et n'est pas attendue: le Guardian de CETTE requete travaille
 * sur la copie qu'il a, et c'est la suivante qui profitera de la mise a jour.
 * Une seconde d'ecart sur un bannissement ne change rien; bloquer chaque
 * requete sur une lecture en base, si.
 */
export function refreshIfStale(apply: (bans: Map<string, SharedBan>) => void): void {
  if (refreshing || !available()) return;
  if (Date.now() - lastRefreshAt < REFRESH_MS) return;
  refreshing = true;
  lastRefreshAt = Date.now();
  void loadActiveBans()
    .then((bans) => { if (bans.size > 0 || available()) apply(bans); })
    .catch(() => {})
    .finally(() => { refreshing = false; });
}

/** Purge les lignes expirees. Appelee par un cron, jamais par une requete. */
export async function purgeExpiredBans(): Promise<number> {
  if (!available()) return 0;
  try {
    const res: any = await db.delete(ipBansTable).where(
      sql`${ipBansTable.permanent} = false AND ${ipBansTable.until} IS NOT NULL AND ${ipBansTable.until} < now() - interval '7 days'`,
    );
    return Number(res?.rowCount ?? 0);
  } catch (err) {
    markUnavailable(err);
    return 0;
  }
}

/** Pour les tests: remet le module dans son etat initial. */
export function resetIpBanStoreState(): void {
  lastRefreshAt = 0;
  refreshing = false;
  disabledUntil = 0;
  warnedUnavailable = false;
}
