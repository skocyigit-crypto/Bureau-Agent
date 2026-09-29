/**
 * Fin de contrat : 30 jours apres la resiliation, les donnees du client
 * s'effacent — sauf la facturation (10 ans) et les journaux d'audit.
 *
 * Le piege mesure sur le schema : `compte_client.contact_id -> contacts` est
 * en CASCADE. Effacer les contacts sans precaution effacerait le grand livre
 * client qu'on doit garder. Le test le verifie sur la vraie base.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db, organisationsTable, subscriptionsTable, usersTable, contactsTable, callsTable, messagesTable,
  facturesClientTable, compteClientTable, licenseAuditLogTable, auditLogsTable, organisationBackupsTable,
  automationRulesTable,
} from "@workspace/db";
import { TENANT_TABLES, EXCLUDED_TABLES } from "../services/tenant-backup";
import {
  ACTION_EFFACEE, ACTION_SIMULEE, DESTIN_DES_TABLES, executerPurgeFinContrat, modeEffacement,
  organisationsEchues, purgerOrganisation, tablesConservees,
} from "../services/purge-fin-contrat";

describe("chaque table a un destin ecrit", () => {
  it("toutes les tables de locataire, et elles seules", () => {
    const attendues = [...TENANT_TABLES, ...Object.keys(EXCLUDED_TABLES)].sort();
    expect(Object.keys(DESTIN_DES_TABLES).sort()).toEqual(attendues);
  });
  it("chaque conservation donne sa raison", () => {
    for (const [t, d] of Object.entries(DESTIN_DES_TABLES)) {
      if (d !== "effacer") expect(d.conserver.length, t).toBeGreaterThan(20);
    }
  });
  it.each(["invoices", "payments", "subscriptions", "factures_client", "encaissements", "clotures_comptables", "invoice_sequences", "compte_client"])(
    "la piece comptable %s est conservee", (t) => expect(tablesConservees()).toContain(t),
  );
  it.each(["audit_logs", "license_audit_log"])("le journal %s est conserve", (t) => expect(tablesConservees()).toContain(t));
  it.each(["contacts", "calls", "messages", "api_keys", "google_oauth_tokens", "organisation_backups", "telephony_call_logs"])(
    "la donnee client %s est effacee", (t) => expect(DESTIN_DES_TABLES[t as keyof typeof DESTIN_DES_TABLES]).toBe("effacer"),
  );
});

describe("l'effacement reel ne part qu'explicitement", () => {
  it("par defaut : simulation", () => expect(modeEffacement({})).toBe("simulation"));
  it("une valeur approchante ne suffit pas", () => {
    for (const v of ["1", "true", "EFFACER", "oui", " effacer"]) expect(modeEffacement({ PURGE_FIN_CONTRAT: v })).toBe("simulation");
  });
  it("seule la valeur exacte bascule", () => expect(modeEffacement({ PURGE_FIN_CONTRAT: "effacer" })).toBe("effacer"));
});

describe("sur la base", () => {
  const stamp = Date.now();
  const jours = (n: number) => new Date(Date.now() - n * 86400_000);
  const ids = { partie: 0, recente: 0, active: 0, voisine: 0 };
  const lignes = { contactFacture: 0, contactCompte: 0, contactLibre: 0, facture: 0, compte: 0, regle: 0, user: 0 };

  async function organisation(nom: string, statut: string, resiliee: Date | null) {
    const [o] = await db.insert(organisationsTable).values({ name: `Fin ${nom} ${stamp}`, slug: `fin-${nom}-${stamp}`, maxUsers: 3, actif: true }).returning({ id: organisationsTable.id });
    await db.insert(subscriptionsTable).values({ organisationId: o!.id, plan: "essai", status: statut, cancelledAt: resiliee } as any);
    await db.insert(contactsTable).values({ organisationId: o!.id, firstName: "Libre", lastName: nom, phone: "0600" });
    await db.insert(callsTable).values({ organisationId: o!.id, phoneNumber: "0600", direction: "entrant", status: "termine" });
    return o!.id;
  }

  beforeAll(async () => {
    ids.partie = await organisation("partie", "annulee", jours(31));
    ids.recente = await organisation("recente", "annulee", jours(29));
    ids.active = await organisation("active", "active", jours(90));
    ids.voisine = await organisation("voisine", "active", null);
    const o = ids.partie;
    const [cf] = await db.insert(contactsTable).values({ organisationId: o, firstName: "Facture", lastName: "Client", phone: "0601" }).returning({ id: contactsTable.id });
    const [cc] = await db.insert(contactsTable).values({ organisationId: o, firstName: "Grand", lastName: "Livre", phone: "0602" }).returning({ id: contactsTable.id });
    lignes.contactFacture = cf!.id; lignes.contactCompte = cc!.id;
    const [f] = await db.insert(facturesClientTable).values({ organisationId: o, contactId: cf!.id, reference: `F-${stamp}`, title: "Facture", clientName: "Facture Client" } as any).returning({ id: facturesClientTable.id });
    lignes.facture = f!.id;
    const [c] = await db.insert(compteClientTable).values({ organisationId: o, contactId: cc!.id, clientName: "Grand Livre" }).returning({ id: compteClientTable.id });
    lignes.compte = c!.id;
    await db.insert(organisationBackupsTable).values({ organisationId: o, checksum: "x", content: Buffer.from("sauvegarde") });
    const [r] = await db.insert(automationRulesTable).values({ organisationId: o, name: "Regle", type: "custom", trigger: "task_overdue", conditions: {}, actions: [] } as any).returning({ id: automationRulesTable.id });
    lignes.regle = r!.id;
    await db.insert(messagesTable).values({ organisationId: o, phoneNumber: "0603", content: "Message" });
    const [u] = await db.insert(usersTable).values({ organisationId: o, email: `fin-${stamp}@exemple.test`, passwordHash: "x", prenom: "F", nom: "In", role: "administrateur", actif: true }).returning({ id: usersTable.id });
    lignes.user = u!.id;
    await db.insert(auditLogsTable).values({ organisationId: o, userId: u!.id, action: "login", resource: "user" });
  }, 60_000);

  afterAll(async () => { /* organisations de test horodatees ; journaux append-only */ });

  const compter = async (table: any, orgId: number) =>
    (await db.select().from(table).where(eq(table.organisationId, orgId))).length;

  it("seule l'organisation resiliee depuis plus de 30 jours est echue", async () => {
    const echues = (await organisationsEchues(new Date(), "simulation")).map((e) => e.organisationId);
    expect(echues).toContain(ids.partie);
    expect(echues).not.toContain(ids.recente);
    expect(echues).not.toContain(ids.active);
    expect(echues).not.toContain(ids.voisine);
  });

  it("la simulation compte sans rien effacer", async () => {
    const bilan = await purgerOrganisation(ids.partie, "simulation");
    expect(bilan.contacts).toBe(1); // le contact libre ; les deux autres sont designes par des pieces conservees
    expect(bilan.calls).toBe(1);
    expect(await compter(contactsTable, ids.partie)).toBe(3);
  });

  it("le passage quotidien en simulation laisse une trace, une seule fois par resiliation", async () => {
    const avant = process.env.PURGE_FIN_CONTRAT;
    delete process.env.PURGE_FIN_CONTRAT;
    await executerPurgeFinContrat();
    await executerPurgeFinContrat();
    process.env.PURGE_FIN_CONTRAT = avant;
    const traces = await db.select().from(licenseAuditLogTable)
      .where(and(eq(licenseAuditLogTable.organisationId, ids.partie), eq(licenseAuditLogTable.action, ACTION_SIMULEE)));
    expect(traces).toHaveLength(1);
    expect((traces[0]!.metadata as { bilan: Record<string, number> }).bilan.contacts).toBe(1);
    expect(await compter(contactsTable, ids.partie)).toBe(3);
  });

  describe("effacement reel", () => {
    beforeAll(async () => { await purgerOrganisation(ids.partie, "effacer"); });

    it("les donnees client sont effacees", async () => {
      expect(await compter(callsTable, ids.partie)).toBe(0);
      expect(await compter(messagesTable, ids.partie)).toBe(0);
      expect(await compter(automationRulesTable, ids.partie)).toBe(0);
    });
    it("le contact libre est efface", async () => {
      const restants = await db.select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.organisationId, ids.partie));
      expect(restants.map((r) => r.id).sort()).toEqual([lignes.contactFacture, lignes.contactCompte].sort());
    });
    it("la facture est conservee avec son client", async () => {
      const [f] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, lignes.facture));
      expect(f?.contactId).toBe(lignes.contactFacture);
    });
    it("le grand livre client survit (la cascade depuis contacts aurait tout emporte)", async () => {
      expect(await db.select().from(compteClientTable).where(eq(compteClientTable.id, lignes.compte))).toHaveLength(1);
    });
    it("le journal d'audit et les comptes sont intacts", async () => {
      expect(await compter(auditLogsTable, ids.partie)).toBe(1);
      expect(await db.select().from(usersTable).where(eq(usersTable.id, lignes.user))).toHaveLength(1);
    });
    it("les sauvegardes de l'organisation ne gardent pas ce qui a ete efface", async () => {
      expect(await compter(organisationBackupsTable, ids.partie)).toBe(0);
    });
    it("les autres organisations ne perdent rien", async () => {
      for (const o of [ids.recente, ids.active, ids.voisine]) {
        expect(await compter(contactsTable, o)).toBe(1);
        expect(await compter(callsTable, o)).toBe(1);
      }
    });
  });

  it("un marqueur d'effacement plus ancien que la resiliation ne vaut pas pour elle", async () => {
    await db.insert(licenseAuditLogTable).values({ organisationId: ids.recente, action: ACTION_EFFACEE, details: "ancien", createdAt: jours(200) });
    await db.update(subscriptionsTable).set({ cancelledAt: jours(40) } as any).where(eq(subscriptionsTable.organisationId, ids.recente));
    const echues = (await organisationsEchues(new Date(), "effacer")).map((e) => e.organisationId);
    expect(echues).toContain(ids.recente);
  });
});
