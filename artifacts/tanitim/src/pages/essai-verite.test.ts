/**
 * L'essai promis doit etre l'essai livre.
 *
 * Mesure le 17/09 : la page repondait « 14 jours d'essai gratuit sur le plan
 * Professionnel, avec toutes les fonctionnalites debloquees : IA, devis,
 * facturation… ». Or `routes/register.ts` cree TOUJOURS le plan `essai`, et ce
 * plan porte `aiEnabled: false`, `stockEnabled: false`,
 * `automationEnabled: false` : la fonction mise en avant etait eteinte pendant
 * tout l'essai, et les plafonds annonces (ceux du plan Professionnel)
 * n'etaient pas ceux accordes.
 *
 * Une allegation fausse sur les caracteristiques essentielles du service est
 * une pratique commerciale trompeuse (C. conso. art. L121-2, applicable entre
 * professionnels par L121-5).
 *
 * Les valeurs sont lues dans la SOURCE du schema, pas recopiees : un test qui
 * recopie ne verifie que sa propre copie.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCHEMA = fs.readFileSync(
  path.resolve(__dirname, "../../../../lib/db/src/schema/subscriptions.ts"),
  "utf8",
);
const PAGE = fs.readFileSync(path.resolve(__dirname, "home.tsx"), "utf8");
/** Le texte affiche, commentaires retires : un commentaire ne vend rien. */
const TEXTE = PAGE.replace(/\/\/[^\n]*/g, "").replace(/\/\*[^]*?\*\//g, "");

function blocPlan(cle: string): string {
  const debut = SCHEMA.indexOf(`  ${cle}: {`);
  if (debut < 0) throw new Error(`plan introuvable dans le schema: ${cle}`);
  const fin = SCHEMA.indexOf("\n  },", debut);
  return SCHEMA.slice(debut, fin < 0 ? undefined : fin);
}
function nombre(cle: string, champ: string): number {
  const ligne = blocPlan(cle).split("\n").find((l) => l.trim().startsWith(`${champ}:`));
  const valeur = ligne?.match(/(-?\d+(?:\.\d+)?)/)?.[1];
  if (valeur === undefined) throw new Error(`${champ} introuvable pour ${cle}`);
  return Number(valeur);
}
function activee(cle: string, champ: string): boolean {
  const ligne = blocPlan(cle).split("\n").find((l) => l.trim().startsWith(`${champ}:`));
  if (!ligne) throw new Error(`${champ} introuvable pour ${cle}`);
  return /true/.test(ligne);
}
/** « 100000 » s'ecrit « 100 000 » sur la page, espace insecable ou non. */
function formats(n: number): string[] {
  const brut = String(n);
  const groupe = brut.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return [brut, groupe, groupe.replace(/ /g, " "), groupe.replace(/ /g, "&nbsp;")];
}

describe("l'essai promis est l'essai livre", () => {
  it("le plan cree a l'inscription est bien `essai`", () => {
    const register = fs.readFileSync(
      path.resolve(__dirname, "../../../api-server/src/routes/register.ts"),
      "utf8",
    );
    expect(
      /const planKey: PlanKey = "essai"/.test(register),
      "l'inscription ne cree plus le plan `essai` : ce test compare la page au mauvais plan",
    ).toBe(true);
  });

  it("la page ne dit pas que l'essai ouvre le plan Professionnel", () => {
    const phrases = TEXTE.split(/[.!?]/).filter((p) => /essai/i.test(p) && /plan Professionnel/i.test(p));
    expect(phrases, "la page annonce un essai sur le plan Professionnel alors que l'inscription cree le plan Essai").toEqual([]);
  });

  it("la page n'annonce pas l'IA pendant l'essai tant qu'elle y est eteinte", () => {
    if (activee("essai", "aiEnabled")) return;
    // Balises retirees : une liste de fonctionnalites d'un plan payant et un
    // bouton « Essai gratuit » se suivent dans le meme bloc JSX sans que la
    // page promette quoi que ce soit.
    const phrases = TEXTE.replace(/<[^>]*>/g, " ")
      .split(/[.!?]/)
      .filter((p) => /essai/i.test(p) && /\bIA\b|intelligence artificielle/i.test(p));
    // Une promesse, c'est « inclus / debloque / compris pendant l'essai ».
    const promesses = phrases.filter((p) => /inclus|débloqu|debloqu|compris|toutes les fonctionnalit/i.test(p));
    expect(promesses, "l'essai annonce l'IA alors que PLANS.essai a aiEnabled: false").toEqual([]);
  });

  it("la page n'annonce pas « toutes les fonctionnalites » pendant l'essai", () => {
    const toutDebloque = /essai[^.]{0,120}toutes les fonctionnalit/i.test(TEXTE);
    const toutActif = activee("essai", "aiEnabled") && activee("essai", "stockEnabled") && activee("essai", "automationEnabled");
    expect(toutDebloque && !toutActif, "« toutes les fonctionnalites debloquees » alors que le plan essai en eteint").toBe(false);
  });

  it("les plafonds de l'essai annonces sont ceux du schema", () => {
    for (const champ of ["maxUsers", "maxContacts", "maxCallsPerMonth"] as const) {
      const n = nombre("essai", champ);
      expect(
        formats(n).some((f) => TEXTE.includes(f)),
        `plafond d'essai ${champ} = ${n} absent de la page`,
      ).toBe(true);
    }
  });

  it("la duree annoncee est celle du schema", () => {
    const jours = nombre("essai", "trialDays");
    expect(TEXTE.includes(`${jours} jours`), `la page n'annonce pas ${jours} jours d'essai`).toBe(true);
  });
});
