import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Surveiller ce que le produit PRODUIT, pas seulement ce qui tourne.
 *
 * Le 2 septembre 2026, en relisant le journal des incidents de cette
 * application, un motif est apparu: la chaine de vente est restee coupee du
 * 31 juillet au 2 septembre, les rappels de facture ne partaient plus, la cle
 * d'IA des clients n'etait jamais utilisee. Pendant tout ce temps les huit
 * agents de sante etaient au vert — et ils avaient raison: la base repondait,
 * la memoire tenait, Resend et Gemini etaient joignables. Rien n'etait casse.
 * Il n'y avait simplement plus rien de produit.
 *
 * D'ou la regle que ces tests fixent, et qui est la partie difficile: le
 * constat doit etre CONDITIONNEL. « Zero relance » n'est une panne que s'il y
 * avait des factures a relancer. Un agent qui crie sur une organisation sans
 * client serait desactive en une semaine, et on perdrait le signal qu'on
 * voulait justement gagner.
 */

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

/**
 * Chaque `db.select(...)` de l'agent rend la valeur suivante de la file. Les
 * requetes sont volontairement sequentielles dans l'agent, donc l'ordre est
 * stable et lisible: c'est ce qui rend ce faux suffisant sans Postgres.
 */
const rows = vi.hoisted(() => ({ queue: [] as any[][] }));

vi.mock("@workspace/db", () => {
  const chain = () => {
    const self: any = {
      from: () => self,
      where: () => Promise.resolve(rows.queue.shift() ?? []),
      then: (r: any) => Promise.resolve(rows.queue.shift() ?? []).then(r),
    };
    return self;
  };
  return {
    db: { select: () => chain() },
    aiUsageTable: { createdAt: "created_at", status: "status" },
    facturesClientTable: { status: "status", dueDate: "due_date" },
    organisationBackupsTable: { origin: "origin", createdAt: "created_at" },
    organisationsTable: { actif: "actif" },
    paymentRemindersTable: { sentAt: "sent_at" },
  };
});

const { outcomeAgent } = await import("../services/health-agents-outcome");

/** Etat « tout va bien » par defaut; chaque test ne remplace que sa partie. */
function queue(opts: {
  overdue?: number;
  reminders?: number;
  activeOrgs?: number;
  backups?: number;
  ai7d?: number;
  aiPrev7d?: number;
  aiTotal24h?: number;
  aiFailed24h?: number;
}) {
  const o = {
    overdue: 0, reminders: 0, activeOrgs: 1, backups: 1,
    ai7d: 5, aiPrev7d: 5, aiTotal24h: 10, aiFailed24h: 0, ...opts,
  };
  rows.queue = [];
  // invoiceReminders: factures echues, puis relances (seulement si echues > 0)
  rows.queue.push([{ n: o.overdue }]);
  if (o.overdue > 0) rows.queue.push([{ n: o.reminders }]);
  // tenantBackups: organisations actives, puis sauvegardes (si orgs > 0)
  rows.queue.push([{ n: o.activeOrgs }]);
  if (o.activeOrgs > 0) rows.queue.push([{ n: o.backups }]);
  // aiActivity: semaine courante, semaine precedente
  rows.queue.push([{ n: o.ai7d }]);
  rows.queue.push([{ n: o.aiPrev7d }]);
  // aiFailureRate
  rows.queue.push([{ total: o.aiTotal24h, failed: o.aiFailed24h }]);
}

async function run(opts: Parameters<typeof queue>[0]) {
  queue(opts);
  const results = await outcomeAgent.run();
  return Object.fromEntries(results.map((r) => [r.check, r]));
}

beforeEach(() => { rows.queue = []; });

describe("relances de facture", () => {
  it("se tait quand il n'y a rien a relancer", async () => {
    const r = await run({ overdue: 0 });
    expect(r.invoice_reminders.status).toBe("ok");
  });

  it("alerte quand des factures sont echues et qu'aucune relance ne part", async () => {
    // La forme exacte de la panne du 31 juillet: la chaine tourne, elle ne
    // produit plus rien.
    const r = await run({ overdue: 12, reminders: 0 });
    expect(r.invoice_reminders.status).toBe("echec");
    expect(r.invoice_reminders.severity).toBe("haute");
    expect(r.invoice_reminders.summary).toContain("12");
  });

  it("ne dit rien quand les relances partent, meme s'il reste des impayes", async () => {
    // Un impaye n'est pas une panne technique: le client n'a pas paye, c'est
    // tout. Confondre les deux rendrait l'alerte permanente.
    const r = await run({ overdue: 12, reminders: 3 });
    expect(r.invoice_reminders.status).toBe("ok");
  });
});

describe("sauvegardes par locataire", () => {
  it("alerte en critique quand aucune sauvegarde n'a eu lieu en 48 h", async () => {
    const r = await run({ activeOrgs: 4, backups: 0 });
    expect(r.tenant_backups.status).toBe("echec");
    expect(r.tenant_backups.severity).toBe("critique");
  });

  it("signale en degrade une couverture partielle", async () => {
    // Trois sauvegardes pour quatre organisations: une est passee a la trappe.
    const r = await run({ activeOrgs: 4, backups: 3 });
    expect(r.tenant_backups.status).toBe("degrade");
  });

  it("n'attend aucune sauvegarde sans organisation active", async () => {
    const r = await run({ activeOrgs: 0 });
    expect(r.tenant_backups.status).toBe("ok");
  });
});

describe("activite d'IA", () => {
  it("alerte quand les appels tombent a zero apres une semaine active", async () => {
    const r = await run({ ai7d: 0, aiPrev7d: 340 });
    expect(r.ai_activity.status).toBe("echec");
  });

  it("ne compare qu'a soi-meme: une application sans usage n'a rien perdu", async () => {
    const r = await run({ ai7d: 0, aiPrev7d: 0 });
    expect(r.ai_activity.status).toBe("ok");
  });

  it("voit un effondrement, pas seulement un arret net", async () => {
    const r = await run({ ai7d: 3, aiPrev7d: 400 });
    expect(r.ai_activity.status).toBe("degrade");
  });

  it("ne prend pas une petite variation pour une panne", async () => {
    const r = await run({ ai7d: 280, aiPrev7d: 340 });
    expect(r.ai_activity.status).toBe("ok");
  });
});

describe("taux d'echec des appels d'IA", () => {
  it("distingue « le fournisseur repond a la sonde » de « nos appels echouent »", async () => {
    const r = await run({ aiTotal24h: 100, aiFailed24h: 60 });
    expect(r.ai_failure_rate.status).toBe("echec");
    expect(r.ai_failure_rate.severity).toBe("critique");
  });

  it("reste calme sans appel du tout", async () => {
    const r = await run({ aiTotal24h: 0, aiFailed24h: 0 });
    expect(r.ai_failure_rate.status).toBe("ok");
  });
});
