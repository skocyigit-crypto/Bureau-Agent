/**
 * Chaque fichier qui appelle un modele d'IA appartient a une entree du
 * registre IA — une nouvelle fonction ne peut pas entrer sans classement.
 * Et ce que le registre affirme (annonce faite, route debranchee, analyse sur
 * le texte) est verifie dans le code, pas cru sur parole.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EXCLUSIONS_EXAMINEES, REGISTRE_IA } from "../services/registre-ia";

const SRC = path.join(import.meta.dirname, "..");
const RACINE = path.join(SRC, "..", "..", "..");
const lire = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** Un fichier appelle un modele s'il passe par l'une de ces portes. */
const APPEL_MODELE = /from "(?:\.\.\/services\/|\.\/)(?:ai-failover|ai-client)"|aiForOrg\(|integrations-openai-ai-server|integrations-anthropic|\.models\.generateContent\(/;

function fichiersQuiAppellentUnModele(): string[] {
  const out: string[] = [];
  const parcourir = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__") parcourir(f); continue; }
      if (!f.endsWith(".ts")) continue;
      if (APPEL_MODELE.test(fs.readFileSync(f, "utf8"))) out.push(path.relative(SRC, f).split(path.sep).join("/"));
    }
  };
  parcourir(SRC);
  return out.sort();
}

const declares = Object.values(REGISTRE_IA).flatMap((s) => s.fichiers);

describe("aucun appel a un modele n'echappe au registre", () => {
  const trouves = fichiersQuiAppellentUnModele();
  it("le releve trouve bien les appels (35 fichiers au 29/09)", () => {
    expect(trouves.length).toBeGreaterThanOrEqual(30);
  });
  it.each(trouves.map((f) => [f]))("%s est classe", (f) => {
    expect(declares, `${f} appelle un modele sans entree au registre IA`).toContain(f);
  });
  it("chaque fichier declare existe", () => {
    for (const f of declares) expect(fs.existsSync(path.join(SRC, f)), f).toBe(true);
  });
  it("aucun fichier n'est classe deux fois", () => {
    expect(new Set(declares).size).toBe(declares.length);
  });
});

describe("chaque systeme a un classement complet", () => {
  it("obligation et tenue ecrites pour tout ce qui n'est pas infrastructure", () => {
    for (const [id, s] of Object.entries(REGISTRE_IA)) {
      if (s.classe === "infrastructure") continue;
      expect(s.obligation.length, id).toBeGreaterThan(10);
      expect(s.tenue.length, id).toBeGreaterThan(10);
      expect(s.personnesExposees.length, id).toBeGreaterThan(3);
    }
  });
  it("l'evaluation des salaries est classee a haut risque (annexe III 4 b)", () => {
    expect(REGISTRE_IA.evaluation_salaries!.classe).toBe("haut_risque");
    expect(REGISTRE_IA.evaluation_salaries!.obligation).toMatch(/III 4 b/);
  });
  it("les systemes qui parlent a des tiers relevent de l'article 50", () => {
    for (const id of ["secretaire_telephonique", "demo_publique"]) {
      expect(REGISTRE_IA[id]!.classe).toBe("transparence");
      expect(REGISTRE_IA[id]!.obligation).toMatch(/50\(1\)/);
    }
  });
});

describe("ce que le registre affirme est vrai dans le code", () => {
  it("la secretaire annonce qu'elle est une IA", () => {
    expect(lire("routes/voice-receptionist.ts")).toMatch(/ANNONCE_IA/);
  });
  it("l'agent de demonstration se presente comme IA", () => {
    const demo = fs.readFileSync(path.join(RACINE, "artifacts", "tanitim", "src", "components", "AjanDemo.tsx"), "utf8");
    expect(demo).toMatch(/Assistant IA/);
  });
  it("la reconnaissance faciale est toujours debranchee", () => {
    const index = lire("routes/index.ts");
    expect(index).not.toMatch(/^\s*router\.use\("\/face"/m);
  });
  it("l'analyse de sentiment des appels porte sur le texte, pas sur la voix (sinon art. 5(1)(f) / 50(3))", () => {
    const src = lire("services/call-processor.ts");
    expect(src).toMatch(/wrapUntrusted\("TRANSCRIPTION"/);
    expect(src).not.toMatch(/inlineData|audio\/(?:wav|mpeg|mp3|ogg)/);
  });
  it("le niveau de risque du compte client est calcule sans modele", () => {
    const src = lire("services/sante-comptes-clients.ts");
    expect(src).not.toMatch(APPEL_MODELE);
    expect(src).toMatch(/export function niveauRisque/);
  });
  it("chaque exclusion examinee est motivee", () => {
    for (const e of EXCLUSIONS_EXAMINEES) expect(e.length).toBeGreaterThan(60);
  });
});
