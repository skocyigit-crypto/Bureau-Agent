/**
 * « Valable jusqu'au 30/09 » vaut jusqu'a la FIN du 30/09.
 *
 * L'interface envoie une date sans heure ; `new Date("2026-09-30")` rend
 * minuit UTC, soit 2 h du matin a Paris. Comparee telle quelle a l'instant
 * present, la validite s'eteignait le 30 a 2 h : le DERNIER JOUR etait perdu
 * en entier — et c'est le jour ou le client se decide.
 *
 * Ce que cela coutait : un devis encore valable refuse a la conversion, avec
 * « la validite de ce devis est depassee » ; le meme devis bascule en
 * « expire » par le passage automatique du matin, donc sorti des relances et
 * du taux d'acceptation.
 *
 * La regle est ecrite une fois (`finDeJournee`) et appliquee aux deux chemins :
 * la fonction qui juge, et la requete SQL qui bascule. Les deux doivent dire la
 * meme chose — sinon l'ecran affiche « valable » sur un devis que le passage
 * de nuit vient d'eteindre.
 *
 * (Regle rapprochee avec la session Assise, 24/09/2026 : une validite se juge
 * au jour ou l'on s'en sert, pas a l'instant ou on la lit.)
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, devisTable, organisationsTable } from "@workspace/db";
import { basculerDevisExpires, devisExpire } from "../services/devis-expires";
import { FUSEAU_ENTREPRISE, finDeJournee, jourLocal } from "../lib/jour-local";

const stamp = Date.now();
let orgId = 0;

/** Le 30 septembre 2026, tel que l'interface l'envoie : minuit UTC. */
const VALIDITE_30_SEPTEMBRE = new Date("2026-09-30T00:00:00.000Z");

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Validite ${stamp}`, slug: `validite-${stamp}`, email: `validite-${stamp}@example.test`,
    phone: "+33123456789", maxUsers: 5, actif: true,
  } as any).returning({ id: organisationsTable.id });
  orgId = o!.id;
}, 60_000);

afterAll(async () => {
  await db.delete(devisTable).where(eq(devisTable.organisationId, orgId));
  await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

beforeEach(async () => {
  await db.delete(devisTable).where(eq(devisTable.organisationId, orgId));
});

async function unDevis(validUntil: Date | null, statut = "envoye"): Promise<number> {
  const [d] = await db.insert(devisTable).values({
    organisationId: orgId, reference: `DV-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Travaux", clientName: "Client", status: statut, items: [],
    subtotal: "100.00", taxAmount: "20.00", totalAmount: "120.00", validUntil,
  } as any).returning({ id: devisTable.id });
  return d!.id;
}

const statutDe = async (id: number) =>
  (await db.select({ s: devisTable.status }).from(devisTable).where(eq(devisTable.id, id)))[0]!.s;

describe("la fin de journee, dans le fuseau de l'entreprise", () => {
  it("en ete, le 30 septembre s'acheve a 21h59:59.999 UTC", () => {
    expect(finDeJournee(VALIDITE_30_SEPTEMBRE).toISOString()).toBe("2026-09-30T21:59:59.999Z");
  });

  it("en hiver, une heure plus tard : le 15 janvier s'acheve a 22h59:59.999 UTC", () => {
    // L'ecart se mesure sur la journee visee, pas sur aujourd'hui : sans cela,
    // un correctif ecrit en ete se tromperait d'une heure tout l'hiver.
    expect(finDeJournee(new Date("2026-01-15T00:00:00.000Z")).toISOString()).toBe("2026-01-15T22:59:59.999Z");
  });

  it("la journee visee est bien celle du fuseau, pas celle d'UTC", () => {
    // 22h30 UTC le 29 = 00h30 le 30 a Paris : la journee qui s'acheve est le 30.
    const nuit = new Date("2026-09-29T22:30:00.000Z");
    expect(jourLocal(nuit)).toBe("2026-09-30");
    expect(finDeJournee(nuit).toISOString()).toBe("2026-09-30T21:59:59.999Z");
  });

  it("un autre fuseau reste possible, et change la journee visee", () => {
    // Minuit UTC le 30, c'est encore le 29 a New York (20 h). La journee qui
    // s'acheve y est donc le 29 — la demonstration que le fuseau ne decore pas
    // le calcul, il le decide.
    expect(jourLocal(VALIDITE_30_SEPTEMBRE, "America/New_York")).toBe("2026-09-29");
    expect(finDeJournee(VALIDITE_30_SEPTEMBRE, "America/New_York").toISOString()).toBe("2026-09-30T03:59:59.999Z");
    expect(FUSEAU_ENTREPRISE).toBe("Europe/Paris");
  });
});

describe("un devis valable jusqu'au 30/09", () => {
  const le30ALAube = new Date("2026-09-30T04:00:00.000Z");      // 6 h a Paris
  const le30AuSoir = new Date("2026-09-30T20:00:00.000Z");      // 22 h a Paris
  const le1erOctobre = new Date("2026-10-01T06:00:00.000Z");

  it("engage encore le 30 au matin — c'est le jour ou le client se decide", () => {
    expect(devisExpire("envoye", VALIDITE_30_SEPTEMBRE, le30ALAube)).toBe(false);
  });

  it("engage encore le 30 au soir", () => {
    expect(devisExpire("envoye", VALIDITE_30_SEPTEMBRE, le30AuSoir)).toBe(false);
  });

  it("n'engage plus le 1er octobre", () => {
    expect(devisExpire("envoye", VALIDITE_30_SEPTEMBRE, le1erOctobre)).toBe(true);
  });

  it("minuit passe a Paris, le 1er octobre a 00h30 : c'est fini", () => {
    // 22h30 UTC le 30 = 00h30 le 1er a Paris.
    expect(devisExpire("envoye", VALIDITE_30_SEPTEMBRE, new Date("2026-09-30T22:30:00.000Z"))).toBe(true);
  });

  it("un devis sans date de validite n'expire jamais", () => {
    expect(devisExpire("envoye", null, le1erOctobre)).toBe(false);
  });

  it("seul un devis ENVOYE peut expirer", () => {
    for (const statut of ["brouillon", "accepte", "refuse", "expire"]) {
      expect(devisExpire(statut, VALIDITE_30_SEPTEMBRE, le1erOctobre), statut).toBe(false);
    }
  });
});

describe("le passage automatique dit la meme chose que la regle", () => {
  it("il ne bascule pas un devis dont c'est le dernier jour", async () => {
    // Le defaut d'origine : le passage du matin eteignait un devis encore
    // valable, et l'ecran affichait « expire » toute la journee.
    const id = await unDevis(VALIDITE_30_SEPTEMBRE);
    await basculerDevisExpires(new Date("2026-09-30T06:00:00.000Z"));
    expect(await statutDe(id)).toBe("envoye");
  });

  it("il bascule le lendemain", async () => {
    const id = await unDevis(VALIDITE_30_SEPTEMBRE);
    await basculerDevisExpires(new Date("2026-10-01T06:00:00.000Z"));
    expect(await statutDe(id)).toBe("expire");
  });

  it("a 00h30 a Paris, le lendemain est deja le lendemain", async () => {
    const id = await unDevis(VALIDITE_30_SEPTEMBRE);
    await basculerDevisExpires(new Date("2026-09-30T22:30:00.000Z"));
    expect(await statutDe(id)).toBe("expire");
  });

  it("il laisse tranquilles les devis sans validite et les brouillons", async () => {
    const sansDate = await unDevis(null);
    const brouillon = await unDevis(VALIDITE_30_SEPTEMBRE, "brouillon");
    await basculerDevisExpires(new Date("2026-12-01T06:00:00.000Z"));
    expect(await statutDe(sansDate)).toBe("envoye");
    expect(await statutDe(brouillon)).toBe("brouillon");
  });

  it("les deux chemins s'accordent sur toute la journee", async () => {
    // La fonction juge, la requete bascule : si elles divergent d'une heure,
    // l'ecran et la base se contredisent une partie de la nuit.
    for (const instant of [
      "2026-09-30T00:30:00.000Z", "2026-09-30T12:00:00.000Z",
      "2026-09-30T21:00:00.000Z", "2026-09-30T21:59:59.000Z",
      "2026-09-30T22:00:00.000Z", "2026-10-01T10:00:00.000Z",
    ]) {
      const maintenant = new Date(instant);
      const id = await unDevis(VALIDITE_30_SEPTEMBRE);
      await basculerDevisExpires(maintenant);
      const bascule = (await statutDe(id)) === "expire";
      expect(bascule, `${instant} : la regle et la requete ne disent pas la meme chose`)
        .toBe(devisExpire("envoye", VALIDITE_30_SEPTEMBRE, maintenant));
    }
  });
});
