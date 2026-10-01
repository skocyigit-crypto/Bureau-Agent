/**
 * Fin de contrat : les donnees du client s'effacent 30 jours apres la
 * resiliation, comme le DPA le promet.
 *
 * DPA art. 8 : « A la resiliation, le client dispose de trente (30) jours pour
 * exporter ses donnees [...]. Passe ce delai, l'editeur les efface, sous
 * reserve des conservations imposees par la loi : donnees de facturation
 * pendant dix (10) ans [...] et journaux d'audit de securite [...] conserves
 * de maniere permanente. » Les CGU disent de meme. Rien ne l'appliquait
 * (mesure du 29/09) : un client parti gardait chez nous ses contacts, ses
 * appels, ses messages, ses cles d'integration — sans terme.
 *
 * CHAQUE TABLE A UN DESTIN ECRIT. `DESTIN_DES_TABLES` est type sur la liste
 * des tables de locataire (`TENANT_TABLES`, elle-meme comparee au schema par
 * tenant-backup-coverage.test.ts) : une table ajoutee sans destin ne compile
 * pas. Effacer par defaut serait conforme au RGPD mais pourrait emporter une
 * piece comptable ; conserver par defaut garderait sans terme. On oblige donc
 * a choisir.
 *
 * UNE LIGNE CONSERVEE GARDE CE QU'ELLE DESIGNE. Mesure sur le schema :
 * `compte_client.contact_id -> contacts` est en ON DELETE CASCADE. Effacer les
 * contacts aurait efface en cascade le grand livre client qu'on doit garder
 * dix ans. Le graphe des cles etrangeres est donc relu dans le catalogue a
 * chaque passage, et une ligne referencee par une ligne conservee n'est pas
 * effacee (le contact d'une facture fait partie de la facture).
 *
 * PREMIERE ACTIVATION EN SIMULATION. L'effacement est irreversible et porte
 * sur des donnees reelles ; on ne peut pas mesurer d'ici quelles organisations
 * de production sont concernees. Tant que `PURGE_FIN_CONTRAT` ne vaut pas
 * `effacer`, le travail calcule ce qu'il effacerait, l'inscrit dans
 * `license_audit_log` (une fois par resiliation) et n'efface rien. On relit
 * cette liste, puis on bascule.
 */
import { sql } from "drizzle-orm";
import { TENANT_TABLES, EXCLUDED_TABLES } from "./tenant-backup";
import { logger } from "../lib/logger";
import { withHeartbeat } from "./health-agents";

type TableLocataire = (typeof TENANT_TABLES)[number] | keyof typeof EXCLUDED_TABLES;
export type Destin = "effacer" | { conserver: string };

const FACTURATION_EDITEUR = "facturation de l'editeur : 10 ans (obligation comptable, DPA art. 8)";
const PIECE_COMPTABLE = "piece comptable du client : 10 ans (C. com. art. L123-22, DPA art. 8)";
const AUDIT = "journal d'audit de securite : conserve de maniere permanente (DPA art. 8)";

export const DESTIN_DES_TABLES: Record<TableLocataire, Destin> = {
  // ── Conserve ──────────────────────────────────────────────────────────────
  audit_logs: { conserver: AUDIT },
  license_audit_log: { conserver: AUDIT },
  users: { conserver: "donnees de compte : anonymisees 3 ans apres la resiliation (account-retention-cron)" },
  subscriptions: { conserver: FACTURATION_EDITEUR },
  invoices: { conserver: FACTURATION_EDITEUR },
  payments: { conserver: FACTURATION_EDITEUR },
  factures_client: { conserver: PIECE_COMPTABLE },
  encaissements: { conserver: PIECE_COMPTABLE + " ; inalterabilite et conservation, CGI 286-I-3° bis" },
  clotures_comptables: { conserver: PIECE_COMPTABLE + " ; preuve qu'aucune ecriture n'a disparu" },
  invoice_sequences: { conserver: PIECE_COMPTABLE + " ; la numerotation continue fait partie de la facture" },
  compte_client: { conserver: PIECE_COMPTABLE + " ; grand livre client" },
  depenses: { conserver: PIECE_COMPTABLE + " ; pieces justificatives d'achat" },
  comptes_depense: { conserver: PIECE_COMPTABLE + " ; sans lui, les depenses ne se relient plus aux comptes" },
  payment_reminders: { conserver: PIECE_COMPTABLE + " ; historique de recouvrement des factures conservees" },
  legal_agreements: { conserver: "preuve de l'acceptation des CGU et du DPA : duree de prescription contractuelle" },
  violations_donnees: { conserver: "registre des violations : obligation de l'editeur (RGPD art. 33.2 et 33.5)" },

  // ── Efface ────────────────────────────────────────────────────────────────
  admin_reports: "effacer", agent_proposals: "effacer", agent_run_steps: "effacer", agent_runs: "effacer",
  ai_agent_reports: "effacer", ai_inline_suggest_events: "effacer", ai_insights: "effacer",
  ai_learned_preferences: "effacer", ai_recurring_patterns: "effacer", ai_user_profile_facts: "effacer",
  ai_providers: "effacer", ai_usage: "effacer", api_keys: "effacer", app_audit_findings: "effacer",
  appointment_offers: "effacer", assistant_conversations: "effacer", assistant_messages: "effacer",
  automation_rules: "effacer", notifications: "effacer", bulk_scan_jobs: "effacer", calendar_events: "effacer",
  calls: "effacer", checkins: "effacer", commandant_conversations: "effacer", commandant_messages: "effacer",
  commandes_fournisseur: "effacer", contacts: "effacer", daily_reports: "effacer",
  data_subject_requests: "effacer", deleted_rows: "effacer", demo_handoffs: "effacer", devis: "effacer",
  documents: "effacer", email_providers: "effacer", face_profiles: "effacer", face_recognition_logs: "effacer",
  google_oauth_tokens: "effacer", google_app_credentials: "effacer", integration_connections: "effacer",
  invitations: "effacer", document_chunks: "effacer", geofences: "effacer", plateformes_agreees: "effacer",
  raccordements_chorus_pro: "effacer", user_location_state: "effacer", location_events: "effacer",
  messages: "effacer", notes_internes: "effacer", objectifs_commerciaux: "effacer",
  organisation_closures: "effacer", performance_reports: "effacer", platform_connections: "effacer",
  platform_sync_logs: "effacer", proactive_suggestions: "effacer", projets: "effacer",
  // Dossier de chantier : suit le chantier et le devis, effaces eux aussi.
  journal_chantier: "effacer", avenants: "effacer", task_dependances: "effacer", prospects: "effacer",
  push_tokens: "effacer", security_lists: "effacer", security_scans: "effacer", stock_mouvements: "effacer",
  stock_articles: "effacer", super_agent_state: "effacer", super_agent_logs: "effacer", tasks: "effacer",
  telephony_providers: "effacer", telephony_call_logs: "effacer", telephony_sms_logs: "effacer",
  treasury_settings: "effacer", webhook_deliveries: "effacer", webhook_endpoints: "effacer",
  whatsapp_processed_messages: "effacer", whatsapp_conversations: "effacer", whatsapp_messages: "effacer",
  // Les sauvegardes contiennent tout le reste : les garder 60 jours de plus
  // viderait la promesse de son sens.
  organisation_backups: "effacer",
  voice_call_sessions: "effacer",
};

export const DELAI_EXPORT_JOURS = 30;
export const STATUTS_RESILIES = ["annulee", "cancelled"] as const;
export const ACTION_EFFACEE = "donnees_effacees_fin_contrat";
export const ACTION_SIMULEE = "purge_fin_contrat_simulee";

export function modeEffacement(env: NodeJS.ProcessEnv = process.env): "effacer" | "simulation" {
  return env.PURGE_FIN_CONTRAT === "effacer" ? "effacer" : "simulation";
}

export const tablesAEffacer = (): string[] =>
  Object.entries(DESTIN_DES_TABLES).filter(([, d]) => d === "effacer").map(([t]) => t);
export const tablesConservees = (): string[] =>
  Object.entries(DESTIN_DES_TABLES).filter(([, d]) => d !== "effacer").map(([t]) => t);

interface CleEtrangere { enfant: string; colonne: string; parent: string; colonneParent: string }

/** Le graphe des cles etrangeres, relu dans le catalogue (jamais suppose). */
async function clesEtrangeres(): Promise<CleEtrangere[]> {
  const { db } = await import("@workspace/db");
  const r = await db.execute(sql`
    SELECT cl.relname AS enfant, a.attname AS colonne, pcl.relname AS parent, pa.attname AS "colonneParent"
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_class pcl ON pcl.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1`);
  return (r as unknown as { rows: CleEtrangere[] }).rows;
}

/**
 * La condition d'effacement d'une table : ses lignes de l'organisation, sauf
 * celles qu'une ligne CONSERVEE designe.
 *
 * Seules les tables conservees protegent. Une table hors locataire qui pend a
 * une table effacee (`automation_logs -> automation_rules`, en cascade) suit
 * son parent ; la compter comme « conservee » aurait empeche d'effacer toute
 * regle ayant un journal.
 */
export function conditionEffacement(table: string, organisationId: number, cles: CleEtrangere[], conservees: ReadonlySet<string>) {
  const protections = cles
    .filter((c) => c.parent === table && conservees.has(c.enfant))
    .map((c) => sql`AND NOT EXISTS (SELECT 1 FROM ${sql.identifier(c.enfant)} k WHERE k.${sql.identifier(c.colonne)} = t.${sql.identifier(c.colonneParent)})`);
  return sql`t.organisation_id = ${organisationId} ${sql.join(protections, sql` `)}`;
}

export type Bilan = Record<string, number>;

/**
 * Compte (simulation) ou efface (reel) les donnees d'une organisation.
 * En reel, tout se passe dans UNE transaction : un echec ne laisse pas une
 * organisation a moitie effacee.
 */
export async function purgerOrganisation(organisationId: number, mode: "effacer" | "simulation"): Promise<Bilan> {
  const { db } = await import("@workspace/db");
  const cles = await clesEtrangeres();
  const aEffacer = tablesAEffacer();
  const conservees = new Set(tablesConservees());
  const bilan: Bilan = {};
  const executer = async (exec: typeof db.execute) => {
    for (const table of aEffacer) {
      const cond = conditionEffacement(table, organisationId, cles, conservees);
      if (mode === "simulation") {
        const r = await exec(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} t WHERE ${cond}`);
        const n = (r as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
        if (n > 0) bilan[table] = n;
      } else {
        const r = await exec(sql`DELETE FROM ${sql.identifier(table)} t WHERE ${cond}`);
        const n = (r as unknown as { rowCount?: number }).rowCount ?? 0;
        if (n > 0) bilan[table] = n;
      }
    }
  };
  if (mode === "simulation") await executer(db.execute.bind(db));
  else await db.transaction(async (tx) => executer(tx.execute.bind(tx) as typeof db.execute));
  return bilan;
}

/**
 * Les organisations resiliees depuis plus de 30 jours, pas encore traitees
 * pour CETTE resiliation. Un client revenu puis reparti est traite a nouveau :
 * le marqueur est compare a `cancelled_at`.
 */
export async function organisationsEchues(maintenant = new Date(), mode: "effacer" | "simulation" = modeEffacement()) {
  const { db } = await import("@workspace/db");
  const limite = new Date(maintenant.getTime() - DELAI_EXPORT_JOURS * 86400_000);
  const marqueur = mode === "effacer" ? ACTION_EFFACEE : ACTION_SIMULEE;
  const r = await db.execute(sql`
    SELECT s.organisation_id AS "organisationId", s.cancelled_at AS "resilieeLe"
    FROM subscriptions s
    JOIN organisations o ON o.id = s.organisation_id
    WHERE s.status IN ('annulee', 'cancelled')
      AND s.cancelled_at IS NOT NULL
      AND s.cancelled_at < ${limite}
      AND o.id <> 1
      AND o.slug <> 'agent-de-bureau-sas'
      AND NOT EXISTS (
        SELECT 1 FROM license_audit_log l
        WHERE l.organisation_id = s.organisation_id
          AND l.action = ${marqueur}
          AND l.created_at >= s.cancelled_at
      )`);
  return (r as unknown as { rows: { organisationId: number; resilieeLe: Date }[] }).rows;
}

const TICK_MS = 24 * 60 * 60 * 1000;
let minuterie: NodeJS.Timeout | null = null;

/**
 * Travail quotidien. Premier passage differe de 10 minutes : le demarrage
 * n'est pas le moment d'un travail irreversible, et un delai de 30 jours ne
 * se joue pas a la minute.
 */
export function startPurgeFinContratCron(): void {
  if (minuterie) return;
  const tick = async () => {
    try {
      const r = await executerPurgeFinContrat();
      if (r.traitees > 0) logger.warn(r, "[purge-fin-contrat] passage");
    } catch (err) {
      logger.error({ err }, "[purge-fin-contrat] passage en echec");
    }
  };
  setTimeout(() => { void tick(); }, 10 * 60_000).unref?.();
  minuterie = setInterval(withHeartbeat("purge-fin-contrat", TICK_MS, tick), TICK_MS);
  minuterie.unref?.();
  logger.info({ mode: modeEffacement(), delaiJours: DELAI_EXPORT_JOURS }, "[purge-fin-contrat] demarre");
}

/** Un passage du travail quotidien. */
export async function executerPurgeFinContrat(maintenant = new Date()): Promise<{ mode: string; traitees: number }> {
  const { tryWithLock, CRON_LOCK_NAMESPACE } = await import("../lib/cron-lock");
  const { logLicenseEvent } = await import("./license-audit");
  const mode = modeEffacement();
  const echues = await organisationsEchues(maintenant, mode);
  let traitees = 0;
  for (const { organisationId, resilieeLe } of echues) {
    await tryWithLock(CRON_LOCK_NAMESPACE.purgeFinContrat, organisationId, async () => {
      // Relu sous verrou : une autre instance a pu passer entre-temps.
      const encore = (await organisationsEchues(maintenant, mode)).some((o) => o.organisationId === organisationId);
      if (!encore) return;
      const bilan = await purgerOrganisation(organisationId, mode);
      await logLicenseEvent(organisationId, mode === "effacer" ? ACTION_EFFACEE : ACTION_SIMULEE,
        mode === "effacer"
          ? `Donnees effacees ${DELAI_EXPORT_JOURS} jours apres la resiliation (DPA art. 8)`
          : `Simulation : ce qui serait efface ${DELAI_EXPORT_JOURS} jours apres la resiliation`,
        { metadata: { resilieeLe, bilan, lignes: Object.values(bilan).reduce((a, b) => a + b, 0) } });
      logger.warn({ organisationId, mode, bilan }, "[purge-fin-contrat] organisation traitee");
      traitees++;
    });
  }
  return { mode, traitees };
}
