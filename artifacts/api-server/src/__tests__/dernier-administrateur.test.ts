/**
 * Une organisation ne doit pas pouvoir se retrouver sans administrateur.
 *
 * C'est l'invariant que toutes les plateformes multi-locataires protegent
 * explicitement — Microsoft Entra refuse de supprimer le dernier administrateur
 * global pour cette raison precise: un locataire orphelin ne se repare pas de
 * l'interieur. Ici, il faudrait que l'editeur intervienne a la main dans la
 * base d'un client. Autant dire une panne qui se compte en journees.
 *
 * L'etat trouve: la protection EXISTE, mais par accident heureux. Trois
 * gardes s'y emploient sans qu'aucune ne porte ce nom:
 *
 *   - `assertCallerOutranks` refuse d'agir sur un rang SUPERIEUR OU EGAL au
 *     sien: un administrateur ne peut donc ni supprimer, ni retrograder, ni
 *     desactiver un autre administrateur — ni lui-meme, son propre rang lui
 *     etant egal;
 *   - `assertNotSelf` double la protection sur la suppression et la
 *     desactivation;
 *   - `assertRoleAllowed` empeche d'attribuer un role que l'appelant n'a pas.
 *
 * L'invariant tient donc a un `<=`. Remplace un jour par `<` — pour permettre
 * a deux administrateurs de se gerer mutuellement, ce qui est une demande
 * parfaitement raisonnable — et le dernier administrateur peut se retrograder
 * lui-meme. Rien n'echouerait au moment du changement: la panne arriverait
 * plus tard, chez un client, et serait irreparable de son cote.
 *
 * Ce fichier transforme donc l'accident heureux en regle exprimee. Il ne
 * change pas le comportement: il le rend defendu.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const garde = readFileSync(join(SRC, "middleware", "tenant-guard.ts"), "utf8");
const auth = readFileSync(join(SRC, "routes", "auth.ts"), "utf8");

describe("la regle qui empeche une organisation de perdre son dernier administrateur", () => {
  it("agir sur un rang EGAL au sien est refuse", () => {
    // Le coeur de l'invariant. Avec `<`, un administrateur pourrait agir sur
    // un autre administrateur — et sur lui-meme, puisque son rang est le sien.
    expect(
      /callerRank <= targetRank/.test(garde),
      "la comparaison de rang s'est relachee: un administrateur peut agir sur ses pairs, " +
        "donc se retrograder lui-meme et laisser l'organisation sans administrateur",
    ).toBe(true);
  });

  it("le super-administrateur reste au-dessus de la regle", () => {
    // Sans cette echappatoire, l'editeur ne pourrait plus reparer un compte
    // client — exactement le cas ou l'on a besoin de lui.
    expect(garde).toMatch(/if \(isSuperAdmin\(req\)\) return true;/);
  });

  it("la suppression exige les quatre gardes", () => {
    const bloc = auth.slice(auth.indexOf('router.delete("/auth/users/:id"'));
    // Fenetre fixe: decouper au premier `});` s'arrete dans la premiere
    // garde imbriquee et ne verifierait presque rien.
    const corps = bloc.slice(0, 2000);

    for (const g of ["assertNotSelf", "assertOrgOwnsUser", "assertTargetNotSuperAdmin", "assertCallerOutranks"]) {
      expect(corps, `la suppression d'un utilisateur ne passe plus par ${g}`).toContain(g);
    }
  });

  it("la modification verifie le rang avant d'ecrire quoi que ce soit", () => {
    const bloc = auth.slice(auth.indexOf('router.patch("/auth/users/:id"'));
    const corps = bloc.slice(0, 2000);

    expect(corps).toContain("assertCallerOutranks");
    expect(corps).toContain("assertRoleAllowed");
    // Se desactiver soi-meme est refuse explicitement, en plus du rang.
    expect(corps).toMatch(/clean\.actif === false && !assertNotSelf/);
  });
});

describe("la hierarchie des roles", () => {
  const middleware = readFileSync(join(SRC, "middleware", "auth.ts"), "utf8");

  it("compte quatre roles, dans cet ordre", () => {
    // Un role insere au mauvais rang deplacerait silencieusement ce que
    // chacun peut faire a chacun.
    const bloc = middleware.slice(middleware.indexOf("const ROLE_HIERARCHY"));
    const paires = [...bloc.matchAll(/(\w+):\s*(\d)/g)].slice(0, 4);

    expect(paires.map((m) => [m[1], Number(m[2])])).toEqual([
      ["lecture_seule", 1],
      ["agent", 2],
      ["administrateur", 3],
      ["super_admin", 4],
    ]);
  });
});
