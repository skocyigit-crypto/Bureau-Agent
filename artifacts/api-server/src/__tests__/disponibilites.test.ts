/**
 * Le calcul des creneaux libres: ce que le produit PROMET a un client au
 * telephone.
 *
 * 433 lignes, aucun test. C'est le moteur qui alimente la standardiste vocale
 * et la suggestion de rendez-vous: quand il se trompe, personne ne voit une
 * erreur — on voit une proposition. Deux formes de degat, egales et opposees:
 *
 *   - proposer un creneau DEJA PRIS: on s'engage deux fois sur la meme heure,
 *     et c'est le client sur place qui l'apprend;
 *   - ne PAS proposer un creneau libre: le rendez-vous n'est pas pris, et
 *     rien ne le signale — un manque a gagner invisible.
 *
 * Les verifications ci-dessous portent donc autant sur ce qu'il faut exclure
 * que sur ce qu'il faut offrir, avec une vraie base et une vraie organisation.
 *
 * Toutes les heures sont posees en UTC pour que le test ne dependant pas du
 * fuseau de la machine: la configuration par defaut du produit est
 * Europe/Paris, et un test qui passerait a Paris mais pas en integration
 * continue ne prouverait rien.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, calendarEventsTable, organisationsTable } from "@workspace/db";
import { computeFreeSlots, isSlotFree, isSlotWithinWorkingHours } from "../services/availability";

let orgId = 0;

/** Un mardi: jour ouvre par defaut (lundi-vendredi). */
const MARDI = "2026-10-06";
const heure = (h: number, m = 0) => new Date(`${MARDI}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: "Verification disponibilites",
      slug: `dispo-${Date.now()}`,
      email: `dispo-${Date.now()}@exemple-test.fr`,
      maxUsers: 3,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgId = org.id;
});

afterAll(async () => {
  if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

async function poserRendezVous(debut: Date, fin: Date, titre = "Occupe") {
  await db.insert(calendarEventsTable).values({
    organisationId: orgId,
    title: titre,
    type: "rendez_vous",
    startDate: debut,
    endDate: fin,
    status: "planifie",
  });
}

/** Fenetre large, loin dans le futur: le delai minimal ne doit pas interferer. */
function fenetre() {
  return { orgId, from: heure(6), to: heure(20), leadMinutes: 0 };
}

describe("ce que le moteur doit offrir", () => {
  it("propose des creneaux sur un jour ouvre", async () => {
    const creneaux = await computeFreeSlots({ ...fenetre(), durationMinutes: 30 });
    expect(creneaux.length, "aucun creneau propose sur une journee vide").toBeGreaterThan(0);
  });

  it("respecte la duree demandee", async () => {
    const [premier] = await computeFreeSlots({ ...fenetre(), durationMinutes: 45, limit: 1 });
    expect(premier).toBeDefined();
    const duree = (new Date(premier.end).getTime() - new Date(premier.start).getTime()) / 60000;
    expect(duree).toBe(45);
  });

  it("respecte le nombre demande", async () => {
    // Une standardiste qui enumere quinze creneaux au telephone est
    // inutilisable: la limite fait partie de la fonction.
    const creneaux = await computeFreeSlots({ ...fenetre(), durationMinutes: 30, limit: 2 });
    expect(creneaux).toHaveLength(2);
  });

  it("rend des creneaux dans l'ordre chronologique", async () => {
    const creneaux = await computeFreeSlots({ ...fenetre(), durationMinutes: 30, limit: 3 });
    const debuts = creneaux.map((c) => new Date(c.start).getTime());
    expect([...debuts].sort((a, b) => a - b)).toEqual(debuts);
  });

  it("rend des bornes ISO exploitables telles quelles", async () => {
    const [premier] = await computeFreeSlots({ ...fenetre(), limit: 1 });
    expect(Number.isFinite(new Date(premier.start).getTime())).toBe(true);
    expect(Number.isFinite(new Date(premier.end).getTime())).toBe(true);
  });
});

describe("ce que le moteur ne doit jamais proposer", () => {
  it("un creneau qui chevauche un rendez-vous existant", async () => {
    await poserRendezVous(heure(10), heure(11), "Visite chantier");

    const creneaux = await computeFreeSlots({ ...fenetre(), durationMinutes: 30, limit: 20 });

    for (const c of creneaux) {
      const d = new Date(c.start).getTime();
      const f = new Date(c.end).getTime();
      const chevauche = d < heure(11).getTime() && f > heure(10).getTime();
      expect(chevauche, `le creneau ${c.start} empiete sur un rendez-vous existant`).toBe(false);
    }
  });

  it("un creneau hors des heures d'ouverture", async () => {
    // Par defaut 9h-18h, heure de Paris. Un creneau a 6h du matin serait une
    // promesse que personne ne tiendra.
    const creneaux = await computeFreeSlots({ ...fenetre(), durationMinutes: 30, limit: 20 });
    expect(creneaux.length).toBeGreaterThan(0);

    for (const c of creneaux) {
      const dedans = await isSlotWithinWorkingHours({
        orgId,
        start: new Date(c.start),
        end: new Date(c.end),
      });
      expect(dedans, `${c.start} est propose hors des heures d'ouverture`).toBe(true);
    }
  });

  it("un creneau avant le delai minimal", async () => {
    // `leadMinutes` protege contre la proposition d'un rendez-vous dans dix
    // minutes, que ni le client ni l'artisan ne peuvent honorer.
    const dans2h = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const dans8j = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    const creneaux = await computeFreeSlots({
      orgId,
      from: dans2h,
      to: dans8j,
      durationMinutes: 30,
      leadMinutes: 24 * 60,
      limit: 5,
    });

    const plancher = Date.now() + 24 * 60 * 60 * 1000;
    for (const c of creneaux) {
      expect(
        new Date(c.start).getTime(),
        `${c.start} tombe avant le delai minimal demande`,
      ).toBeGreaterThanOrEqual(plancher - 60_000);
    }
  });

  it("rien du tout quand la fenetre est vide ou inversee", async () => {
    // Une fenetre a l'envers ne doit pas produire de creneaux fantomes.
    const creneaux = await computeFreeSlots({
      orgId,
      from: heure(15),
      to: heure(9),
      durationMinutes: 30,
    });
    expect(creneaux).toEqual([]);
  });
});

describe("la verification d'un creneau precis", () => {
  it("declare occupe un creneau qui recouvre un rendez-vous", async () => {
    await poserRendezVous(heure(14), heure(15), "Reunion");
    const libre = await isSlotFree({ orgId, start: heure(14, 30), end: heure(15, 30) });
    expect(libre, "un creneau chevauchant est annonce libre").toBe(false);
  });

  it("declare libre un creneau qui suit bout a bout", async () => {
    // Le cas le plus frequent d'une journee remplie: refuser ici couterait des
    // rendez-vous que rien n'empeche de prendre.
    const libre = await isSlotFree({ orgId, start: heure(15), end: heure(16) });
    expect(libre).toBe(true);
  });

  it("refuse un creneau hors des heures d'ouverture", async () => {
    const dedans = await isSlotWithinWorkingHours({ orgId, start: heure(3), end: heure(4) });
    expect(dedans).toBe(false);
  });

  it("accepte un creneau en pleine journee ouvree", async () => {
    // L'inverse du precedent: une garde trop large refuserait tout.
    const dedans = await isSlotWithinWorkingHours({ orgId, start: heure(9), end: heure(10) });
    expect(dedans).toBe(true);
  });
});
