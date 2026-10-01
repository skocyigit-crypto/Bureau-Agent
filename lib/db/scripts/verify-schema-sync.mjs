#!/usr/bin/env node
// Post-push verification: assert the schema sync produced the objects the app
// depends on and did NOT destroy the externally-owned session table.
//
// Runs at the end of `push` / `push-force` (and standalone via `pnpm verify`).
// Exits non-zero on any failed assertion so a drifted/broken sync is caught in
// CI / post-merge instead of surfacing later as a runtime 500.

import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to verify schema sync");
  process.exit(1);
}

// Tables that must exist for core features to work. agent_proposals backs
// GET /api/agent-queue/count (a missing table returned HTTP 500); bulk_scan_jobs
// backs the document bulk-scan flow.
// platform_invoice_sequences porte la numerotation continue des factures que
// la plateforme emet a ses clients: sans elle, aucune facture ne peut etre
// emise (art. 242 nonies A de l'annexe II au CGI).
const REQUIRED_TABLES = [
  "agent_proposals",
  "bulk_scan_jobs",
  "whatsapp_processed_messages",
  "platform_invoice_sequences",
  // Journal des reglements (art. 286-I-3 bis CGI). Sans cette table, aucun
  // encaissement ne peut etre enregistre ni verifie — et l inalterabilite ne
  // peut plus etre affirmee.
  "encaissements",
  // Clotures comptables: la condition de conservation du meme article. Sans
  // cette table, aucune suppression d ecriture ne serait detectable.
  "clotures_comptables",
  // Journal d'execution des agents : sans ces tables, le Bureau des taches et
  // le suivi des couts repondent 500, et l'orchestrateur ne peut rien tracer.
  "agent_runs",
  "agent_run_steps",
  // Etat des appels de la secretaire telephonique IA : sans elle, chaque appel
  // entrant echoue au premier tour (l'etat n'est plus en memoire).
  "voice_call_sessions",
  // Reclamations des taches periodiques (audit, insights IA) : sans elle,
  // ces taches echouent a chaque passage.
  "cron_executions",
  // Journal de chantier : le dossier d'un chantier l'ouvre a chaque
  // consultation. Table absente = l'ecran entier du chantier repond 500.
  "journal_chantier",
  // Les travaux supplementaires. Table absente = le montant engage du
  // chantier est FAUX (il oublie les avenants), pas absent.
  "avenants",
  // Plan de travaux : lu a chaque ouverture du Planning.
  "task_dependances",
];

// Columns added to existing tables by the same schema revision.
const REQUIRED_COLUMNS = [
  ["documents", "scan_verdict"],
  ["organisations", "reused_scan_count"],
  ["organisations", "ai_learning_last_run_at"],
  ["calendar_events", "google_event_id"],
  // Sans ces colonnes, toute lecture de facture leve une erreur SQL: le code
  // les selectionne nommement. C'est le cas typique ou le deploiement passe et
  // ou la panne n'apparait qu'a la premiere consultation d'une facture.
  ["invoices", "reference"],
  ["invoices", "vat_amount"],
  ["invoices", "total_ttc"],
  ["invoices", "buyer_snapshot"],
  // L'agent qui a propose une tache. Sans cette colonne, `creerTacheIa` echoue
  // a chaque tache creee par une IA — c'est-a-dire sur presque toutes: appels,
  // courriels, documents, chantiers.
  ["tasks", "created_by_agent"],
  // Reprise d'un appel par un humain : la secretaire IA relit ces colonnes a
  // chaque tour pour se taire apres la reprise, l'ecran « en direct » aussi.
  ["voice_call_sessions", "taken_over_by_user_id"],
  ["voice_call_sessions", "taken_over_at"],
  ["voice_call_sessions", "takeover_status"],
  // Relie chaque appel au modele a l'execution d'agent qui l'a fait : sans
  // elle, tout enregistrement d'usage leve une erreur SQL.
  ["ai_usage", "run_id"],
  // Anti-doublon des rendez-vous pris par telephone : la secretaire l'ecrit a
  // chaque rendez-vous.
  ["calendar_events", "external_ref"],
  // Choix de l'organisation pour ses relances (file d'approbation ou envoi) :
  // lu par le cron des relances a chaque passage.
  ["organisations", "reminders_require_approval"],
  // Flux du studio : lu par le moteur d'automatisation a chaque regle.
  ["automation_rules", "flow"],
  // Mentions du decret n° 2022-1299. `factures_client` est lu avec toutes ses
  // colonnes sur la liste des factures: une colonne absente ne prive pas d'une
  // mention, elle casse l'ecran entier.
  ["factures_client", "client_siren"],
  // Ajoutees par #58 et #65, et absentes de cette liste jusqu au 2026-09-05:
  // deux poussees de schema successives, faites depuis deux branches
  // differentes, sans que rien ne verifie que la seconde n avait pas defait la
  // premiere. Le verificateur ne prouve que ce qu on lui a demande de prouver.
  ["checkins", "location_check"],
  ["checkins", "geofence_id"],
  ["payments", "bank_fingerprint"],
  ["factures_client", "delivery_address"],
  ["factures_client", "operation_category"],
  ["factures_client", "vat_on_debits"],
  // Bornes horaires du suivi de presence. `organisations` est lu avec toutes
  // ses colonnes en 23 endroits, dont `middleware/license-check.ts` — qui se
  // trouve sur le chemin de CHAQUE requete authentifiee. Une colonne manquante
  // ici ne degrade pas une fonction: elle arrete l'application entiere.
  ["organisations", "location_tracking_days"],
  ["organisations", "location_tracking_start"],
  ["organisations", "location_tracking_end"],
  // Rattachement des ecritures a un chantier. Le dossier de chantier les
  // SELECTionne nommement pour additionner engage / depense / facture /
  // encaisse : une seule absente, et le dossier ne s'ouvre plus.
  ["depenses", "projet_id"],
  ["factures_client", "projet_id"],
  ["calls", "projet_id"],
  ["calendar_events", "projet_id"],
  // Lue par le cycle d abonnement et par stripe-sync a chaque echec de
  // paiement : absente, aucun abonnement ne peut plus etre suspendu ni relance.
  ["subscriptions", "mise_en_demeure_at"],
  // Le Planning selectionne les taches avec leur debut.
  ["tasks", "start_date"],
];

/**
 * Index DECLARES DANS LE SCHEMA, lus dans les fichiers eux-memes.
 *
 * Pourquoi les lire, et ne pas en tenir une liste a la main : une liste tenue
 * a la main ne protege que ce qu'on a pense a y mettre, et c'est exactement le
 * defaut releve plus haut pour les colonnes.
 *
 * POURQUOI CE CONTROLE EXISTE. Le 23/09/2026, une poussee de schema a echoue
 * en cours de route (violation de cle etrangere) et `drizzle-kit push` a
 * pourtant rendu un code de SUCCES : 222 index sur 333 n'ont jamais ete crees,
 * et ce verificateur a repondu « schema sync verified » parce qu'il ne
 * regardait que des tables et des colonnes.
 *
 * Ce ne sont pas des index de confort. Manquaient notamment :
 *   - `user_location_state_user_uniq`, sans lequel l'upsert de position part
 *     en erreur 500 (ON CONFLICT sans contrainte correspondante) ;
 *   - les unicites de numero de facture et d'evenement Stripe, c'est-a-dire
 *     les garde-fous qui empechent une facture en double et un double
 *     encaissement.
 *
 * Autrement dit, une base peut passer pour saine tout en ayant perdu
 * precisement ce qui garantit l'unicite. D'ou : on compare.
 */
function indexDeclaresDansLeSchema() {
  const dossier = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "schema");
  const noms = new Set();
  for (const fichier of readdirSync(dossier)) {
    if (!fichier.endsWith(".ts")) continue;
    const source = readFileSync(join(dossier, fichier), "utf8");
    // `index("nom")` et `uniqueIndex("nom")`, tels qu'ils sont ecrits.
    for (const m of source.matchAll(/\b(?:unique)?[Ii]ndex\(\s*"([^"]+)"/g)) noms.add(m[1]);
  }
  return [...noms];
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
const failures = [];

async function tableExists(name) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
    [name],
  );
  return rows.length > 0;
}

async function columnExists(table, column) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
    [table, column],
  );
  return rows.length > 0;
}

try {
  await client.connect();

  for (const t of REQUIRED_TABLES) {
    if (!(await tableExists(t))) failures.push(`missing required table: ${t}`);
  }

  for (const [t, c] of REQUIRED_COLUMNS) {
    if (await tableExists(t)) {
      if (!(await columnExists(t, c))) failures.push(`missing column: ${t}.${c}`);
    } else {
      failures.push(`missing required table (for column check): ${t}`);
    }
  }

  // Les index declares doivent exister. Un seul manquant suffit a rendre
  // fausse une unicite sur laquelle le code s'appuie : on echoue, en les
  // nommant, plutot que de laisser la panne arriver a la premiere ecriture
  // concurrente.
  const declares = indexDeclaresDansLeSchema();
  if (declares.length === 0) {
    // Le controle lui-meme est casse (schema deplace, lecture vide) : le dire,
    // au lieu de rendre un feu vert qui ne prouve rien.
    failures.push("aucun index declare trouve dans le schema : le controle des index ne mesure plus rien");
  } else {
    // Un index peut EXISTER sans tenir sa promesse, et de DEUX facons
    // differentes. La distinction a ete mesuree le 24/09/2026, sur une vraie
    // base, apres qu-une session voisine (BTP Ultra) a conteste la premiere
    // version de ce controle — elle avait raison :
    //
    //   indisvalid=false, indisready=true  -> l-index est encore TENU A JOUR.
    //     L-unicite s-applique toujours (doublon refuse, 23505), mais le
    //     planificateur ignore l-index : c-est une perte de performance et le
    //     signe d-une construction interrompue.
    //   indisready=false                   -> l-index n-est PLUS TENU A JOUR.
    //     Mesure : insertion d-un doublon ACCEPTEE, deux lignes sur la meme
    //     cle. C-est l-etat dangereux, celui qu-un `CREATE INDEX CONCURRENTLY`
    //     interrompu dans sa premiere phase laisse derriere lui.
    //
    // Les deux font echouer la verification, avec des mots differents : le
    // second est une unicite qui n-existe plus, le premier un index a
    // reconstruire. `pg_indexes` ne montre ni l-un ni l-autre — il les liste
    // comme les autres, et un `IF NOT EXISTS` les retrouve et passe.
    const { rows } = await client.query(`
      SELECT c.relname AS indexname, i.indisvalid AS valide, i.indisready AS prete
        FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
    `);
    const presents = new Set(rows.map((r) => r.indexname));
    const parNom = new Map(rows.map((r) => [r.indexname, r]));
    const manquants = declares.filter((n) => !presents.has(n));
    const nonTenus = declares.filter((n) => parNom.get(n)?.prete === false);
    const nonUtilisables = declares.filter(
      (n) => parNom.get(n)?.valide === false && parNom.get(n)?.prete !== false,
    );
    if (nonTenus.length > 0) {
      failures.push(
        `${nonTenus.length} index declares ne sont PLUS TENUS A JOUR (indisready=false) : ` +
          nonTenus.join(", ") +
          " — une unicite dans cet etat laisse passer les doublons ; corriger par DROP INDEX puis nouvelle poussee",
      );
    }
    if (nonUtilisables.length > 0) {
      failures.push(
        `${nonUtilisables.length} index declares sont INVALIDES (construction interrompue) : ` +
          nonUtilisables.join(", ") +
          " — l-unicite s-applique encore, mais le planificateur les ignore ; reconstruire (DROP INDEX puis nouvelle poussee)",
      );
    }
    if (manquants.length > 0) {
      failures.push(
        `${manquants.length} index declares absents de la base (poussee incomplete ?) : ` +
          manquants.slice(0, 15).join(", ") + (manquants.length > 15 ? ", ..." : ""),
      );
    }
  }

  // user_sessions is owned by connect-pg-simple and excluded from the Drizzle
  // schema. A correct push must leave it intact — never drop/rename it.
  if (!(await tableExists("user_sessions"))) {
    failures.push("user_sessions table is missing — session store was destroyed");
  }

  if (failures.length > 0) {
    console.error("[db] schema sync verification FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `[db] schema sync verified — required tables/columns present, ${indexDeclaresDansLeSchema().length} index declares presents, user_sessions intact`,
  );
} catch (err) {
  console.error("[db] schema sync verification error:", err?.message || err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
