/**
 * La palette (Ctrl+K) ne doit proposer que des destinations ouvrables.
 *
 * La barre laterale cache depuis toujours les entrees d'administration aux
 * roles qui n'y ont pas droit. La palette, elle, les offrait a TOUT LE MONDE:
 * un compte en lecture seule y trouvait « Utilisateurs », « Licence »,
 * « Organisations », les ouvrait, et se faisait refuser a chaque fois.
 *
 * Ce n'est pas un trou de securite — le serveur refuse en 403, et c'est lui
 * qui protege; les refus etaient d'ailleurs visibles en production (quatre sur
 * `/api/license-management/dashboard` en 24 h). C'est un defaut de justesse:
 * un produit qui propose des portes qu'il claque ensuite se lit comme un
 * produit casse, et c'est l'acheteur qui le lit.
 *
 * Le test verifie les deux sens. Cacher est facile; ce qui est facile a casser
 * ensuite, c'est de cacher AUSSI a ceux qui ont le droit.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "agent" }));

vi.mock("@/components/workspace-user", () => ({
  useWorkspaceUser: () => ({ user: { role: state.role } }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));
vi.mock("@/i18n", () => ({
  // Les libelles passent par i18n; on rend la cle elle-meme, ce qui donne un
  // texte stable a chercher sans dependre d'une traduction.
  useTranslation: () => ({ t: (cle: string) => cle }),
}));

import { CommandPalette } from "@/components/command-palette";

/** Les commandes reservees, et le role minimal qui les ouvre. */
const RESERVEES = [
  { id: "users", minimum: "administrateur" },
  { id: "audit", minimum: "administrateur" },
  { id: "abonnement", minimum: "administrateur" },
  { id: "organisations", minimum: "super_admin" },
] as const;

function ouvrirLaPalette() {
  render(<CommandPalette />);
  // La palette ecoute sur document, pas sur un element rendu.
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
}

function visible(id: string): boolean {
  return screen.queryByText(`commandPalette.cmd.${id}`) !== null;
}

describe("la palette de commandes", () => {
  beforeEach(() => { state.role = "agent"; });

  it.each(["agent", "lecture_seule"])(
    "ne propose aucune commande d'administration au role %s",
    (role) => {
      state.role = role;
      ouvrirLaPalette();

      // Garde-fou: si la palette ne s'ouvrait pas, tout serait "absent" et le
      // test passerait sans rien verifier.
      expect(visible("dashboard"), "la palette ne s'est pas ouverte").toBe(true);

      for (const { id } of RESERVEES) {
        expect(visible(id), `« ${id} » est propose a un role qui sera refuse`).toBe(false);
      }
    },
  );

  it("propose les commandes d'administration a l'administrateur", () => {
    state.role = "administrateur";
    ouvrirLaPalette();

    for (const { id, minimum } of RESERVEES) {
      expect(
        visible(id),
        `« ${id} » devrait etre ouvert a l'administrateur`,
      ).toBe(minimum === "administrateur");
    }
  });

  it("reserve « organisations » au super-administrateur", () => {
    state.role = "super_admin";
    ouvrirLaPalette();

    for (const { id } of RESERVEES) {
      expect(visible(id), `« ${id} » devrait etre ouvert au super-admin`).toBe(true);
    }
  });
});
