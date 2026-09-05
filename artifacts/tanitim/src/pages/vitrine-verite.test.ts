/**
 * La vitrine ne doit pas vendre ce que l'application ne fait pas.
 *
 * Trois ecarts ont ete trouves entre la page et le produit, et le troisieme
 * etait dementi par l'application elle-meme:
 *
 *   - « CGU/CGV/DPA/SLA » listait un SLA parmi les documents fournis. Il
 *     n'existe aucune route `/sla`, et l'article 6 des CGV pose au contraire
 *     que « l'editeur ne souscrit aucun engagement chiffre de disponibilite ».
 *   - « Multi-Agent IA (7 agents) » alors que `routes/ai-agents.ts` en declare
 *     dix. Sous-vendre est moins grave que sur-vendre, mais c'est le meme
 *     defaut: un chiffre qui ne vient pas de la source.
 *   - « Gestion de stock — inventaire complet avec scan QR/code-barres »
 *     alors que le backoffice de l'application marque le module Stock
 *     `enabled: false`, statut « a venir », qu'aucun ecran de gestion
 *     n'existe et qu'aucun code ne lit de code-barres.
 *
 * Ces tests relient la page a la SOURCE plutot qu'a une copie. Un test qui
 * recopie les valeurs ne verifie que sa propre copie, et se tait le jour ou le
 * produit bouge.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = path.resolve(__dirname, "../../../..");

const PAGE = fs.readFileSync(path.resolve(__dirname, "home.tsx"), "utf8");

/** Le texte affiche, commentaires retires: un commentaire ne vend rien. */
const TEXTE = PAGE.replace(/\/\/[^\n]*/g, "").replace(/\/\*[^]*?\*\//g, "");

const APP = path.join(RACINE, "artifacts");

describe("la vitrine dit ce que l'application fait", () => {
  it("n'annonce pas de document qui n'existe pas", () => {
    // Le routeur de la vitrine est la liste exhaustive des pages publiees.
    const routeur = fs.readFileSync(path.resolve(__dirname, "../App.tsx"), "utf8");
    const documents = ["cgu", "cgv", "dpa", "sla", "confidentialite"];
    for (const doc of documents) {
      const publie = routeur.includes(`path="/${doc}"`);
      const annonce = new RegExp(`\\b${doc}\\b`, "i").test(
        TEXTE.match(/label: "CGU[^"]*"/i)?.[0] ?? "",
      );
      expect(
        annonce && !publie,
        `la page annonce le document « ${doc} » parmi ceux fournis, mais aucune route /${doc} ne le publie`,
      ).toBe(false);
    }
  });

  it("annonce le nombre d'agents que le serveur declare", () => {
    const source = fs.readFileSync(
      path.join(APP, "api-server/src/routes/ai-agents.ts"),
      "utf8",
    );
    const bloc = source.slice(source.indexOf("const AGENTS = ["));
    const reels = (bloc.slice(0, bloc.indexOf("\n];")).match(/id: "/g) ?? []).length;
    expect(reels, "impossible de compter les agents dans ai-agents.ts").toBeGreaterThan(0);

    const annonce = TEXTE.match(/Multi-Agent IA \((\d+) agents\)/);
    expect(annonce, "la mention du nombre d'agents a disparu de la page").toBeTruthy();
    expect(
      Number(annonce![1]),
      `la page annonce ${annonce![1]} agents, le serveur en declare ${reels}`,
    ).toBe(reels);
  });

  it("ne vend pas un module que l'application marque « a venir »", () => {
    // Le backoffice porte l'etat reel de chaque module. Vendre ce qu'il declare
    // non livre est le cas le plus net: l'application se contredit elle-meme.
    const backoffice = fs.readFileSync(
      path.join(APP, "buro-ajani/src/pages/admin.tsx"),
      "utf8",
    );
    const stockDesactive =
      /modules\.stock\.label[^]*?enabled:\s*false/.test(backoffice);
    if (stockDesactive) {
      expect(
        /Gestion de stock|Inventaire complet/.test(TEXTE),
        "le backoffice marque le module Stock « a venir », la vitrine le vend comme livre",
      ).toBe(false);
    }
  });

  it("n'annonce pas de scan de code-barres tant qu'aucun code n'en lit", () => {
    // `hasBarcodeDetector` dans le panneau navigateur teste une capacite du
    // navigateur; ce n'est pas une fonction d'inventaire.
    const lecteurs = ["api-server/src", "buro-ajani/src", "mobile"]
      .map((d) => path.join(APP, d))
      .filter((d) => fs.existsSync(d))
      .some((d) => chercher(d, /BarcodeScanner|scanBarcode|CameraScanner/));
    if (!lecteurs) {
      expect(
        /scan QR|code-barres/i.test(TEXTE),
        "la page annonce un scan QR/code-barres qu'aucun code ne realise",
      ).toBe(false);
    }
  });
});

/** Recherche recursive d'un motif dans les sources d'un dossier. */
function chercher(dir: string, motif: RegExp): boolean {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (chercher(p, motif)) return true;
    } else if (/\.(tsx?|jsx?)$/.test(e.name)) {
      if (motif.test(fs.readFileSync(p, "utf8"))) return true;
    }
  }
  return false;
}
