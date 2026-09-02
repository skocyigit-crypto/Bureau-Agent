/**
 * Agents de sante des RESULTATS: le produit fabrique-t-il encore quelque chose.
 *
 * Pourquoi ce fichier existe. Les huit agents deja en place surveillent
 * l'infrastructure — pool Postgres, latence, memoire, joignabilite de Resend et
 * de Gemini, battements des taches, lignes orphelines. Ils sont bons a cela, et
 * `health-alert.ts` reveille bien quelqu'un quand un constat passe en echec.
 *
 * Mais l'historique des pannes de cette application raconte autre chose. La
 * chaine de vente est restee coupee du 31 juillet au 2 septembre; les rappels
 * de facture ne partaient plus; la cle d'IA des clients n'etait jamais
 * utilisee. Pendant tout ce temps la base repondait en quelques millisecondes,
 * la memoire etait basse, Resend et Gemini etaient joignables et tous les
 * battements etaient a l'heure. Aucun agent d'infrastructure ne pouvait voir
 * quoi que ce soit, parce qu'il n'y avait rien de casse: il n'y avait plus
 * rien de PRODUIT.
 *
 * C'est le mode de panne que `health-alert.ts` nomme lui-meme dans son
 * en-tete — « rien ne casse, tout s'arrete » — et que rien ne mesurait.
 *
 * Principe de conception: chaque constat est CONDITIONNEL. « Zero facture ce
 * mois-ci » n'est pas une panne pour une organisation qui n'a pas de client;
 * ca en devient une quand des factures sont echues et qu'aucune relance ne
 * part. On compare donc toujours une ENTREE eligible a une SORTIE produite, et
 * on se tait quand il n'y avait rien a faire. Un agent qui crie sans raison
 * finit ignore, et c'est alors le vrai signal qu'on perd.
 */
import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import {
  db,
  aiUsageTable,
  facturesClientTable,
  organisationBackupsTable,
  organisationsTable,
  paymentRemindersTable,
} from "@workspace/db";
import type { CheckResult, HealthAgent } from "./health-agents";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

async function countRows(query: Promise<Array<{ n: number }>>): Promise<number> {
  const [row] = await query;
  return Number(row?.n ?? 0);
}

/**
 * Relances de facture: des factures sont-elles echues sans qu'aucune relance
 * ne parte. C'est exactement la forme qu'avait la panne du 31 juillet.
 */
async function invoiceReminders(): Promise<CheckResult> {
  const overdue = await countRows(
    db.select({ n: sql<number>`count(*)::int` })
      .from(facturesClientTable)
      .where(and(
        ne(facturesClientTable.status, "payee"),
        ne(facturesClientTable.status, "annulee"),
        lt(facturesClientTable.dueDate, ago(7 * DAY)),
      )),
  );

  if (overdue === 0) {
    return {
      check: "invoice_reminders",
      status: "ok",
      severity: "basse",
      summary: "Aucune facture echue depuis plus de 7 jours: rien a relancer.",
      metrics: { overdue, sent7d: 0 },
    };
  }

  const sent = await countRows(
    db.select({ n: sql<number>`count(*)::int` })
      .from(paymentRemindersTable)
      .where(gte(paymentRemindersTable.sentAt, ago(7 * DAY))),
  );

  // Des factures a relancer ET pas une seule relance en sept jours: la chaine
  // est coupee. C'est le seul cas ou l'on reveille quelqu'un.
  const broken = sent === 0;
  return {
    check: "invoice_reminders",
    status: broken ? "echec" : "ok",
    severity: broken ? "haute" : "basse",
    summary: broken
      ? `${overdue} facture(s) echue(s) depuis plus de 7 jours et aucune relance envoyee sur la meme periode.`
      : `${overdue} facture(s) echue(s), ${sent} relance(s) envoyee(s) sur 7 jours.`,
    remediation: broken
      ? "Verifier le cron `invoice-reminder` dans le panneau de sante, puis le fournisseur d'e-mail de l'organisation concernee."
      : "",
    metrics: { overdue, sent7d: sent },
  };
}

/**
 * Sauvegardes par locataire: chaque organisation active doit avoir une
 * sauvegarde automatique recente. Le cron tourne a 02:00 UTC, on laisse donc
 * deux jours de marge avant de crier.
 */
async function tenantBackups(): Promise<CheckResult> {
  const activeOrgs = await countRows(
    db.select({ n: sql<number>`count(*)::int` })
      .from(organisationsTable)
      .where(eq(organisationsTable.actif, true)),
  );

  if (activeOrgs === 0) {
    return {
      check: "tenant_backups",
      status: "ok",
      severity: "basse",
      summary: "Aucune organisation active: aucune sauvegarde attendue.",
      metrics: { activeOrgs, backups48h: 0 },
    };
  }

  const recent = await countRows(
    db.select({ n: sql<number>`count(*)::int` })
      .from(organisationBackupsTable)
      .where(and(
        eq(organisationBackupsTable.origin, "auto"),
        gte(organisationBackupsTable.createdAt, ago(2 * DAY)),
      )),
  );

  const broken = recent === 0;
  return {
    check: "tenant_backups",
    status: broken ? "echec" : recent < activeOrgs ? "degrade" : "ok",
    severity: broken ? "critique" : recent < activeOrgs ? "moyenne" : "basse",
    summary: broken
      ? `${activeOrgs} organisation(s) active(s) et aucune sauvegarde automatique depuis 48 h.`
      : `${recent} sauvegarde(s) automatique(s) sur 48 h pour ${activeOrgs} organisation(s) active(s).`,
    remediation: broken
      ? "Verifier le cron `tenant-backup`. Sans lui, une suppression accidentelle devient definitive."
      : "",
    metrics: { activeOrgs, backups48h: recent },
  };
}

/**
 * Activite d'IA: le produit se vend comme assistant IA. Un arret complet des
 * appels alors qu'il y en avait la semaine precedente est une panne, meme si
 * chaque fournisseur repond correctement aux sondes de `dependencies`.
 */
async function aiActivity(): Promise<CheckResult> {
  const [current, previous] = await Promise.all([
    countRows(
      db.select({ n: sql<number>`count(*)::int` })
        .from(aiUsageTable)
        .where(gte(aiUsageTable.createdAt, ago(7 * DAY))),
    ),
    countRows(
      db.select({ n: sql<number>`count(*)::int` })
        .from(aiUsageTable)
        .where(and(
          gte(aiUsageTable.createdAt, ago(14 * DAY)),
          lt(aiUsageTable.createdAt, ago(7 * DAY)),
        )),
    ),
  ]);

  // On ne compare qu'a soi-meme: une application sans usage d'IA la semaine
  // precedente n'a rien perdu cette semaine.
  const stopped = previous > 0 && current === 0;
  const collapsed = previous >= 20 && current > 0 && current < previous / 10;

  return {
    check: "ai_activity",
    status: stopped ? "echec" : collapsed ? "degrade" : "ok",
    severity: stopped ? "haute" : collapsed ? "moyenne" : "basse",
    summary: stopped
      ? `Aucun appel d'IA sur 7 jours, contre ${previous} la semaine precedente.`
      : collapsed
        ? `${current} appel(s) d'IA sur 7 jours, contre ${previous} la semaine precedente.`
        : `${current} appel(s) d'IA sur 7 jours (${previous} la semaine precedente).`,
    remediation: stopped || collapsed
      ? "Verifier les quotas d'IA, la politique de cles (AI_REQUIRE_OWN_KEY) et l'agent Fournisseurs d'IA."
      : "",
    metrics: { calls7d: current, callsPrev7d: previous },
  };
}

/**
 * Erreurs d'IA enregistrees: `ai_usage` garde le statut de chaque appel. Une
 * proportion elevee d'echecs se voit ici avant que les utilisateurs ne la
 * signalent, et surtout elle distingue « le fournisseur repond a la sonde » de
 * « nos appels reels echouent » — deux choses differentes, et c'est la seconde
 * qui coute des clients.
 */
async function aiFailureRate(): Promise<CheckResult> {
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    failed: sql<number>`count(*) filter (where ${aiUsageTable.status} <> 'success')::int`,
  }).from(aiUsageTable).where(gte(aiUsageTable.createdAt, ago(24 * HOUR)));

  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  if (total === 0) {
    return {
      check: "ai_failure_rate",
      status: "ok",
      severity: "basse",
      summary: "Aucun appel d'IA sur 24 h.",
      metrics: { total24h: 0, failed24h: 0 },
    };
  }

  const pct = (failed / total) * 100;
  return {
    check: "ai_failure_rate",
    status: pct >= 25 ? "echec" : pct >= 5 ? "degrade" : "ok",
    severity: pct >= 50 ? "critique" : pct >= 25 ? "haute" : pct >= 5 ? "moyenne" : "basse",
    summary: `${failed} appel(s) d'IA en echec sur ${total} en 24 h (${pct.toFixed(1)} %).`,
    remediation: pct >= 5
      ? "Comparer avec l'agent Fournisseurs d'IA: une sonde verte et des appels rouges pointent vers les cles ou les quotas, pas vers le fournisseur."
      : "",
    metrics: { total24h: total, failed24h: failed, pctFailed: Number(pct.toFixed(2)) },
  };
}

export const outcomeAgent: HealthAgent = {
  id: "outcome",
  name: "Resultats produits",
  domain: "Les chaines de valeur produisent-elles encore (relances, sauvegardes, IA)",
  run: async (): Promise<CheckResult[]> => {
    // En sequence, pas en parallele: cet agent partage les quinze connexions du
    // pool avec sept autres, et aucune de ces mesures n'est urgente.
    const results: CheckResult[] = [];
    results.push(await invoiceReminders());
    results.push(await tenantBackups());
    results.push(await aiActivity());
    results.push(await aiFailureRate());
    return results;
  },
};
