/**
 * La SURFACE qu'une cle API peut atteindre est declaree, pas devinee.
 *
 * « L'agent a pour consigne de ne pas faire X » n'est pas un controle ;
 * « il n'existe pas de route pour X » en est un. La barriere
 * (middleware/auth.ts) est une liste de prefixes refuses : elle tient pour
 * une route ajoutee sous un prefixe existant, mais un routeur tout neuf —
 * disons /team-management — serait atteignable par une cle sans que
 * personne ne s'en apercoive. Une liste de refus pourrit en silence.
 *
 * Ce test inverse la charge de la preuve. Il relit l'inventaire des routes
 * REELLEMENT montees (lib/api-spec/runtime-routes.generated.json, tenu a
 * jour par la porte de CI), retient celles dont le nom evoque une identite,
 * un compte, une cle, un paiement ou la plateforme, et exige que chacune
 * soit :
 *   - refusee aux cles, ou
 *   - declaree ci-dessous avec sa raison.
 *
 * Ajouter une route sensible sans faire l'un des deux fait rougir la suite.
 * (Idee reprise de la session BTP, qui a ferme la meme chaine chez elle.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { routeInterditeAuxCles } from "../middleware/auth";

const INVENTAIRE = join(import.meta.dirname, "..", "..", "..", "..", "lib", "api-spec", "runtime-routes.generated.json");

type Operation = { method: string; path: string; sources: string[] };

/** Un nom qui evoque l'identite, les comptes, les cles, l'argent, la plateforme. */
const NOM_SENSIBLE = /user|account|compte|auth|key|cle|token|password|mot-de-passe|mfa|session|invitation|webhook|organisation|licen|admin|permission|role|abonnement|billing|stripe|paiement|payment/i;

/**
 * Ce qui porte un nom sensible SANS en etre : chaque ligne dit pourquoi une
 * cle d'integration peut l'atteindre. Retirer une entree d'ici sans fermer
 * la route fait rougir le test.
 */
const DECLAREES: Record<string, string> = {
  "/admin-reports": "Signalement d'un probleme par un employe du bureau : une donnee metier, aucun pouvoir sur les comptes.",
  "/admin-reports/{id}": "Suivi d'un signalement du bureau : une donnee metier, aucun pouvoir sur les comptes.",
  "/admin-reports/{id}/read": "Marque un signalement comme lu : une donnee metier, aucun pouvoir sur les comptes.",
  "/admin-reports/stats": "Compte les signalements du bureau : une lecture de donnee metier, aucun pouvoir sur les comptes.",
  "/ai-learning/recompute-user": "Recalcule les preferences apprises d'un membre : une donnee de personnalisation, jamais son identite.",
  "/ai-learning/user-profile": "Lit les preferences apprises d'un membre : une donnee de personnalisation, jamais son identite.",
  "/ai-learning/users": "Liste les membres qui ont des preferences apprises : ni role, ni acces, ni secret.",
  "/ai-usage/key-status": "Dit seulement SI l'organisation a ses propres cles de modele (des booleens), jamais leur valeur.",
  "/appointments/offer/{token}": "Prise de rendez-vous par le client, ouverte par un jeton signe : ni session, ni cle API en jeu.",
  "/appointments/offer/{token}/available-slots": "Creneaux offerts au client par un jeton signe : ni session, ni cle API en jeu.",
  "/appointments/offer/{token}/cancel": "Annulation par le client depuis son lien signe : ni session, ni cle API en jeu.",
  "/appointments/offer/{token}/closures": "Fermetures annoncees au client depuis son lien signe : ni session, ni cle API en jeu.",
  "/appointments/offer/{token}/reschedule": "Report demande par le client depuis son lien signe : ni session, ni cle API en jeu.",
  "/appointments/offer/{token}/select": "Choix d'un creneau par le client depuis son lien signe : ni session, ni cle API en jeu.",
  "/commandant/payment-overview": "Lecture du suivi des reglements DU BUREAU (ses factures, ses encaissements) : sa propre donnee comptable, pas la facturation de la plateforme.",
  "/depenses/comptes": "Plan de comptes des depenses du bureau : une donnee comptable que les integrations tiennent a jour.",
  "/depenses/comptes/{categorie}": "Une ligne du plan de comptes des depenses : une donnee comptable que les integrations tiennent a jour.",
};

function inventaire(): Operation[] {
  return (JSON.parse(readFileSync(INVENTAIRE, "utf8")).operations ?? []) as Operation[];
}

describe("la surface atteignable par une cle API", () => {
  const routes = inventaire();

  it("l'inventaire est lisible et fourni — sinon ce test ne mesure rien", () => {
    expect(routes.length, "inventaire vide : lancez `pnpm --filter @workspace/api-spec routes:write`").toBeGreaterThan(300);
  });

  it("chaque route au nom sensible est refusee aux cles, ou declaree avec sa raison", () => {
    const sensibles = routes.filter((o) => NOM_SENSIBLE.test(o.path));
    expect(sensibles.length, "le releve ne trouve plus rien de sensible : le motif a ete casse").toBeGreaterThan(50);

    const orphelines = sensibles
      .filter((o) => !routeInterditeAuxCles(o.method, `/api${o.path}`))
      .filter((o) => !(o.path in DECLAREES))
      .map((o) => `${o.method.toUpperCase()} ${o.path}  (${o.sources[0] ?? "?"})`);

    expect(
      [...new Set(orphelines)].sort(),
      "Route au nom sensible atteignable par une cle API. Fermez-la dans INTERDIT_AUX_CLES " +
        "(middleware/auth.ts), ou declarez-la dans DECLAREES en disant pourquoi une integration peut l'atteindre.",
    ).toEqual([]);
  });

  it("aucune declaration ne dort : ce qui est declare existe encore et reste ouvert", () => {
    const chemins = new Set(routes.map((o) => o.path));
    const disparues = Object.keys(DECLAREES).filter((p) => !chemins.has(p));
    expect(disparues, "declaration sans route : retirez-la, sinon la liste ment").toEqual([]);

    const desormaisFermees = Object.keys(DECLAREES).filter((p) => routeInterditeAuxCles("POST", `/api${p}`));
    expect(desormaisFermees, "declaree ouverte mais desormais refusee : retirez la declaration").toEqual([]);
  });

  it("chaque raison dit quelque chose", () => {
    const muettes = Object.entries(DECLAREES).filter(([, raison]) => raison.trim().length < 30).map(([p]) => p);
    expect(muettes, "une declaration sans raison lisible ne protege personne").toEqual([]);
  });

  it("les familles fermees le restent, methode par methode", () => {
    for (const prefixe of ["/auth/users", "/auth/mfa/setup", "/api-keys", "/invitations", "/webhooks", "/organisations", "/license-management/record-payment", "/admin/audit", "/billing/invoices", "/stripe/create-portal-session", "/google-oauth/disconnect"]) {
      for (const methode of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
        expect(routeInterditeAuxCles(methode, `/api${prefixe}`), `${methode} ${prefixe}`).toBe(true);
      }
    }
  });

  it("et les dossiers restent ouverts : une integration doit pouvoir travailler", () => {
    for (const p of ["/contacts", "/appels", "/devis", "/factures-client", "/projets", "/taches", "/prospects"]) {
      expect(routeInterditeAuxCles("POST", `/api${p}`), p).toBe(false);
    }
  });
});
