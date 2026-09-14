/**
 * Un changement de droits doit dire DE QUOI vers QUOI.
 *
 * Trouve en comparant l'implantation des roles a dix recherches sur la
 * gestion des acces en SaaS. Toutes disent la meme chose du journal d'audit:
 * il doit porter l'acteur, la cible, et la valeur AVANT et APRES — nommement
 * `previousRole` / `newRole` pour un changement de role.
 *
 * Ici, la modification d'un compte etait consignee ainsi:
 *
 *     update_user  user 42  { fields: ["role"] }
 *
 * Quels champs ont bouge, jamais de quoi vers quoi. Le journal ne repondait
 * donc pas a la seule question qui compte sur les droits: « qui a nomme Jean
 * administrateur, et qu'etait-il avant ? »
 *
 * Le role decide de ce qu'on peut lire, de ce qu'on peut detruire, et du
 * nombre de sieges factures. Le jour d'un litige — « je n'ai jamais nomme
 * cette personne » — « le champ role a change » ne tranche rien.
 *
 * La suppression, elle, consignait deja le role de la cible: la regle etait
 * connue, elle n'etait appliquee qu'a une voie sur deux. C'est le motif qui
 * revient dans ce depot, et la raison d'etre de ce test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { diffAuditUtilisateur } from "../lib/diff-audit-utilisateur";

const AVANT = { role: "agent", actif: true, nom: "Durand", telephone: "0600000000" };

describe("ce que le journal doit retenir", () => {
  it("une promotion est consignee avec l'ancien et le nouveau role", () => {
    const d = diffAuditUtilisateur(AVANT, { role: "administrateur", updatedAt: new Date() });

    expect(d.changements?.role).toEqual({ avant: "agent", apres: "administrateur" });
    expect(d.fields).toContain("role");
  });

  it("une desactivation est consignee de la meme facon", () => {
    // Desactiver, c'est retirer tout pouvoir: la trace compte autant qu'une
    // promotion.
    const d = diffAuditUtilisateur(AVANT, { actif: false, updatedAt: new Date() });
    expect(d.changements?.actif).toEqual({ avant: true, apres: false });
  });

  it("les deux a la fois", () => {
    const d = diffAuditUtilisateur(AVANT, { role: "lecture_seule", actif: false });
    expect(Object.keys(d.changements ?? {}).sort()).toEqual(["actif", "role"]);
  });

  it("`updatedAt` n'est pas un changement dont on rend compte", () => {
    const d = diffAuditUtilisateur(AVANT, { updatedAt: new Date() });
    expect(d.fields).toEqual([]);
    expect(d.changements).toBeUndefined();
  });
});

describe("ce que le journal ne doit PAS retenir", () => {
  it("les valeurs des champs personnels", () => {
    // Recopier l'ancien et le nouveau nom, telephone ou adresse dans un
    // journal conserve des annees reviendrait a dupliquer des donnees
    // personnelles alors que la modification est deja tracee. Le RGPD demande
    // le minimum necessaire a la finalite, et la finalite ici est la securite.
    const d = diffAuditUtilisateur(AVANT, { nom: "Dupond", telephone: "0611111111" });

    expect(d.fields.sort()).toEqual(["nom", "telephone"]);
    expect(d.changements).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain("0611111111");
    expect(JSON.stringify(d)).not.toContain("Dupond");
  });

  it("un champ reecrit a l'identique", () => {
    // Consigner « role: agent -> agent » remplirait le journal de lignes ou
    // rien ne s'est passe, et c'est ainsi qu'on cesse de le lire.
    const d = diffAuditUtilisateur(AVANT, { role: "agent" });
    expect(d.changements).toBeUndefined();
  });

  it("ne casse pas si l'etat d'avant est inconnu", () => {
    const d = diffAuditUtilisateur(null, { role: "administrateur" });
    expect(d.changements?.role).toEqual({ avant: null, apres: "administrateur" });
  });
});

describe("la voie de modification s'en sert vraiment", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "routes", "auth.ts"),
    "utf8",
  );

  it("`update_user` ne consigne plus seulement la liste des champs", () => {
    expect(
      /"update_user",\s*"user",\s*String\(id\),\s*\{\s*fields: Object\.keys\(updateData\)\s*\}/.test(source),
      "le journal est revenu a la seule liste des champs modifies",
    ).toBe(false);
    expect(source).toContain("diffAuditUtilisateur(targetUser, updateData)");
  });

  it("`delete_user` consigne toujours le role de la cible", () => {
    // Contre-epreuve de portee: si cette voie-la avait perdu son role, le
    // defaut ne serait pas un oubli isole mais une habitude.
    expect(source).toMatch(/"delete_user"[\s\S]{0,200}targetRole: targetUser\.role/);
  });
});
