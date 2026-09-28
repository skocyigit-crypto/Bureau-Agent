/**
 * La liste des sous-traitants dit ce que le code appelle.
 *
 * Mesure du 28/09 : le serveur envoyait le titre et le texte de chaque
 * notification mobile aux serveurs d'Expo (exp.host) et des coordonnees GPS a
 * Nominatim (OpenStreetMap) ; ni l'annexe 1 du DPA ni la politique de
 * confidentialite ne les nommaient. L'article 28.2 du RGPD interdit de
 * recruter un sous-traitant ulterieur sans en informer le responsable — une
 * liste incomplete revient a le faire en silence.
 *
 * Ce controle lit le code du serveur : un service TOUJOURS actif (sans cle a
 * configurer) qui y apparait doit etre nomme dans les deux pages. Les services
 * qui ne tournent qu'avec une cle absente de la production (VirusTotal, Google
 * Safe Browsing, SMTP de repli) n'y sont pas : les activer impose d'abord de
 * les ajouter ici et dans l'annexe.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const SERVEUR = join(RACINE, "artifacts", "api-server", "src");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom === "__tests__") continue;
      out.push(...sources(chemin));
    } else if (nom.endsWith(".ts")) {
      out.push(readFileSync(chemin, "utf8"));
    }
  }
  return out;
}

const CODE = sources(SERVEUR).join("\n");
const DPA = readFileSync(join(import.meta.dirname, "dpa.tsx"), "utf8");
const POLITIQUE = readFileSync(join(import.meta.dirname, "confidentialite.tsx"), "utf8");

/** Signature dans le code -> nom que les deux pages doivent porter. */
const TOUJOURS_ACTIFS: Array<{ signature: RegExp; nom: string }> = [
  { signature: /api\.resend\.com|from "resend"/, nom: "Resend" },
  { signature: /exp\.host\/--\/api\/v2\/push/, nom: "Expo" },
  { signature: /nominatim\.openstreetmap\.org/, nom: "OpenStreetMap" },
];

describe("sous-traitants : la liste suit le code", () => {
  it("l'instrument lit le code du serveur (garde-fou)", () => {
    expect(CODE.length).toBeGreaterThan(500_000);
    expect(CODE).toMatch(/router\.post\(/);
  });

  for (const { signature, nom } of TOUJOURS_ACTIFS) {
    it(`${nom} : appele par le serveur`, () => {
      // Si la signature disparait du code, ce controle doit le dire plutot que
      // de continuer a « verifier » un service qui n'est plus appele.
      expect(CODE, `signature de ${nom} introuvable dans le serveur`).toMatch(signature);
    });

    it(`${nom} : nomme dans l'annexe 1 du DPA`, () => {
      const annexe = DPA.slice(DPA.indexOf("Annexe 1"), DPA.indexOf("Annexe 2"));
      expect(annexe.length).toBeGreaterThan(100);
      expect(annexe).toContain(nom);
    });

    it(`${nom} : nomme dans la politique de confidentialite`, () => {
      expect(POLITIQUE).toContain(nom);
    });
  }

  it("la politique renvoie a la bonne annexe du DPA", () => {
    // Elle renvoyait a « l'annexe 2 », qui est celle des mesures de securite.
    expect(POLITIQUE).toContain("annexe 1 du <a href=\"/dpa\"");
    expect(DPA).toMatch(/Annexe 1 — Sous-traitants ultérieurs/);
  });
});
