/**
 * Delai de notification d'une violation au client : 24 heures.
 *
 * Le DPA promettait « au plus tard 72 heures ». Or 72 heures, c'est AUSSI le
 * delai du client envers la CNIL (art. 33.1) : un editeur qui prevenait a la
 * 72e heure laissait son client en infraction. La CNIL attend du sous-traitant
 * 24 a 48 h ; 24 h est la pratique des editeurs SaaS. Voir aussi
 * services/violation-donnees.ts (objectif 24 h).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DPA = fs.readFileSync(path.resolve(__dirname, "dpa.tsx"), "utf8").replace(/\s+/g, " ");

describe("DPA — notification d'une violation", () => {
  it("engage l'editeur a 24 heures", () => expect(DPA).toContain("au plus tard vingt-quatre (24) heures après en avoir pris connaissance"));
  it("ne promet plus 72 heures au client", () => expect(DPA).not.toMatch(/notifie le client dans les meilleurs délais et au plus tard soixante-douze/));
  it("rappelle le delai CNIL du client", () => expect(DPA).toContain("article 33 du RGPD"));
  it("liste les elements utiles a la notification", () => {
    for (const e of ["nature de la violation", "nombre approximatif", "conséquences probables", "mesures prises"]) expect(DPA).toContain(e);
  });
  it("prevoit une notification par etapes", () => expect(DPA).toContain("au fur et à mesure"));
  it("date de mise a jour revue", () => expect(DPA).toContain("Dernière mise à jour : 17 septembre 2026"));
});
