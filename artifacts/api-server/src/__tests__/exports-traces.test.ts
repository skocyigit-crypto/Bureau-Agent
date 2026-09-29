/**
 * Chaque extraction de donnees laisse une trace dans le journal d'audit, et
 * chaque trace porte l'organisation.
 *
 * Mesure du 29/09 : sur 22 routes d'extraction, deux ecrivaient une trace —
 * alors que le DPA (annexe 2) et la politique de confidentialite annoncent un
 * journal couvrant « connexion, export, suppression ». Et cinq traces
 * d'evaluation de salaries existaient SANS `organisation_id` : ecrites, mais
 * invisibles dans le journal que l'administrateur consulte, qui filtre par
 * organisation.
 *
 * La liste des routes n'est pas tenue a la main : elle est relue dans les
 * fichiers de routes a chaque execution. Une nouvelle route d'export entre
 * donc d'office dans le controle.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blocks } from "../../scripts/tenant-scope-check.mjs";
import { mentionsDe, nomAmbigu } from "../services/mentions-personne";

const ROUTES = path.join(import.meta.dirname, "..", "routes");
const SRC = path.join(import.meta.dirname, "..");

/**
 * Routes d'extraction volontairement tracees autrement, avec la raison.
 * Une exception tacite serait indistinguable d'un oubli.
 */
const TRACEES_AUTREMENT: Record<string, { raison: string; trace: RegExp | null }> = {
  "GET /documents/:id/download": {
    raison: "consultation d'UN document deja visible dans l'application, pas une extraction en masse",
    trace: null,
  },
  "GET /license-management/orgs/:id/export": {
    raison: "super-admin : tracee dans license_audit_log (append-only), le journal de la plateforme",
    trace: /logAudit\(/,
  },
  "GET /performance/metriques/export/csv": {
    raison: "tracee sous l'action dediee `performance_export_csv` (evaluation de salaries), avec l'organisation",
    trace: /"performance_export_csv"/,
  },
};

// `/csv$` : un telechargement CSV qui ne dit pas « export » dans son chemin
// (`/data-protection/registre/csv`) en est un quand meme.
const EST_EXTRACTION = /(^|\/)(export|download|my-data)(\/|$|-)|\/export\/|\/csv$/;

function routesDExtraction(): { cle: string; fichier: string; texte: string }[] {
  const out: { cle: string; fichier: string; texte: string }[] = [];
  for (const f of fs.readdirSync(ROUTES).filter((x) => x.endsWith(".ts"))) {
    const src = fs.readFileSync(path.join(ROUTES, f), "utf8");
    for (const b of blocks(src)) {
      const [verbe, chemin] = b.name.split(" ");
      if (!chemin || !EST_EXTRACTION.test(chemin)) continue;
      out.push({ cle: `${verbe} ${chemin}`, fichier: f, texte: b.text });
    }
  }
  return out;
}

describe("chaque route d'extraction ecrit sa trace", () => {
  const routes = routesDExtraction();

  it("le releve trouve bien les routes d'extraction (22 au 29/09)", () => {
    // Un plancher, pas une egalite : une route ajoutee ne doit pas faire
    // tomber ce test, une route qui disparait du releve si.
    expect(routes.length).toBeGreaterThanOrEqual(22);
  });

  it.each(routesDExtraction().map((r) => [r.cle, r]))("%s", (cle, r) => {
    const exception = TRACEES_AUTREMENT[cle];
    if (exception) {
      expect(exception.raison.length).toBeGreaterThan(20);
      if (exception.trace) expect(r.texte, `${cle} : exception declaree mais la trace annoncee manque`).toMatch(exception.trace);
      return;
    }
    expect(r.texte, `${cle} (${r.fichier}) extrait des donnees sans trace d'audit`).toContain("tracerExtraction(");
  });

  it("la trace precede la reponse (Cloud Run coupe le processeur apres)", () => {
    for (const r of routes) {
      if (TRACEES_AUTREMENT[r.cle]) continue;
      const trace = r.texte.indexOf("await tracerExtraction(");
      const reponse = r.texte.search(/res\.(setHeader|set)\(\s*(\{|"Content-Type")|res\.json\(\{\s*\n\s*message/);
      expect(trace, `${r.cle} : trace non attendue (await manquant)`).toBeGreaterThan(-1);
      if (reponse > -1) expect(trace, `${r.cle} : la trace vient apres la reponse`).toBeLessThan(reponse);
    }
  });

  it("chaque exception nomme une route qui existe encore", () => {
    const cles = new Set(routes.map((r) => r.cle));
    for (const cle of Object.keys(TRACEES_AUTREMENT)) expect(cles, cle).toContain(cle);
  });
});

/** Nombre d'arguments de premier niveau de chaque appel `logAudit(`. */
function appelsLogAudit(src: string): { ligne: number; args: number }[] {
  const out: { ligne: number; args: number }[] = [];
  const re = /\blogAudit\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue;
    let depth = 0, args = 1, i = re.lastIndex, chaine: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (chaine) { if (c === "\\") { i++; continue; } if (c === chaine) chaine = null; continue; }
      if (c === '"' || c === "'" || c === "`") { chaine = c; continue; }
      if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); continue; }
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
      else if (c === "," && depth === 0) args++;
    }
    if (src.slice(re.lastIndex, i).trimEnd().endsWith(",")) args--;
    out.push({ ligne: src.slice(0, m.index).split("\n").length, args });
  }
  return out;
}

describe("chaque trace d'audit porte l'organisation", () => {
  const fichiers: string[] = [];
  const parcourir = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__") parcourir(f); continue; }
      if (f.endsWith(".ts")) fichiers.push(f);
    }
  };
  parcourir(SRC);

  it("aucun appel a logAudit ne s'arrete avant l'argument organisation", () => {
    const fautifs: string[] = [];
    for (const f of fichiers) {
      const src = fs.readFileSync(f, "utf8");
      // license-management a SA fonction locale `logAudit` (license_audit_log,
      // 5 arguments) : ce n'est pas celle du journal d'audit.
      if (!/import \{[^}]*\blogAudit\b[^}]*\} from "(\.\/|\.\.\/routes\/)audit"/.test(src)) continue;
      for (const a of appelsLogAudit(src)) {
        if (a.args < 9) fautifs.push(`${path.relative(SRC, f)}:${a.ligne} (${a.args} arguments)`);
      }
    }
    expect(fautifs, "trace ecrite sans organisation : invisible pour l'administrateur").toEqual([]);
  });

  it("le compteur d'arguments sait lire un appel sur plusieurs lignes avec virgule finale", () => {
    const src = `logAudit(\n  a,\n  b, // commentaire, avec virgule\n  "c,d",\n  { e: [1, 2] },\n  f, g, h,\n  req.get("user-agent"),\n  org,\n);`;
    expect(appelsLogAudit(src)).toEqual([{ ligne: 1, args: 9 }]);
  });

  it("et voit l'appel a qui il manque l'organisation", () => {
    expect(appelsLogAudit(`logAudit(a, b, "x", "y", z, {}, req.ip, ua).catch(() => {});`)[0]!.args).toBe(8);
  });
});

describe("les passages d'un rapport d'equipe qui nomment la personne", () => {
  const rapport = {
    scout: { risk_seviyesi: "moyen", resume: "Equipe stable ; Paul Durand en surcharge." },
    diagnose: {
      bireysel_teshis: [
        { nom: "Marie Martin", durum: "dikkat", teshis: "Retards repetes sur les rappels." },
        { nom: "Paul Durand", durum: "kritik", teshis: "Heures supplementaires elevees." },
      ],
    },
    prescribe: { actions: ["Former Marie Martin a l'outil de rappel", "Recruter un renfort"] },
  };

  it("rend la fiche de la personne", () => {
    const p = mentionsDe(rapport, "Marie Martin");
    expect(p).toContainEqual({ chemin: "diagnose.bireysel_teshis[0]", valeur: rapport.diagnose.bireysel_teshis[0] });
  });
  it("ne rend jamais la fiche d'un collegue", () => {
    const p = JSON.stringify(mentionsDe(rapport, "Marie Martin"));
    expect(p).not.toContain("Heures supplementaires");
  });
  it("rend une recommandation isolee qui la nomme", () => {
    expect(mentionsDe(rapport, "Marie Martin")).toContainEqual({ chemin: "prescribe.actions[0]", valeur: "Former Marie Martin a l'outil de rappel" });
  });
  it("ne rend pas une recommandation qui ne la nomme pas", () => {
    expect(JSON.stringify(mentionsDe(rapport, "Marie Martin"))).not.toContain("Recruter");
  });
  it("une personne absente du rapport n'obtient rien", () => {
    expect(mentionsDe(rapport, "Claire Petit")).toEqual([]);
  });
  it("la casse ne fait pas manquer une mention", () => {
    expect(mentionsDe({ n: "RAPPEL POUR MARIE MARTIN" }, "Marie Martin")).toHaveLength(1);
  });
  it("les accents sont compares tels quels (Hélène n'est pas Helene)", () => {
    expect(mentionsDe({ n: "Hélène Roux absente" }, "Hélène Roux")).toHaveLength(1);
    expect(mentionsDe({ n: "Helene Roux absente" }, "Hélène Roux")).toEqual([]);
  });
  it("un nom trop court ne ramene pas tout le rapport", () => {
    expect(mentionsDe(rapport, " A ")).toEqual([]);
  });
  it("une fiche est rendue a plat : la liste d'equipe qu'elle contient reste dehors", () => {
    const r = { fiche: { nom: "Marie Martin", equipe: [{ nom: "Paul Durand", teshis: "surcharge" }], notes: ["Marie Martin : a revoir"] } };
    const p = mentionsDe(r, "Marie Martin");
    expect(p).toEqual([
      { chemin: "fiche", valeur: { nom: "Marie Martin" } },
      { chemin: "fiche.notes[0]", valeur: "Marie Martin : a revoir" },
    ]);
  });
  it("le resume du rapport compte aussi", () => {
    expect(mentionsDe({ summary: "1 critique(s) : Paul Durand", details: {} }, "Paul Durand"))
      .toEqual([{ chemin: "summary", valeur: "1 critique(s) : Paul Durand" }]);
  });
  it("un resume qui la cite ne fait pas rendre tout le rapport (evaluations des collegues)", () => {
    // Defaut du premier jet : la racine etait traitee comme une fiche.
    const r = { summary: "Critiques : Marie Martin", details: rapport };
    const p = JSON.stringify(mentionsDe(r, "Marie Martin"));
    expect(p).not.toContain("Heures supplementaires");
    expect(p).not.toContain("Recruter");
  });
  it("les espaces multiples ne font pas manquer une mention", () => {
    expect(mentionsDe({ n: "suivi de Marie  Martin" }, "Marie Martin")).toHaveLength(1);
  });
});

describe("un homonyme bloque l'extraction", () => {
  const moi = { id: 1, prenom: "Marie", nom: "Martin" };
  it("un autre compte du meme nom : ambigu", () => {
    expect(nomAmbigu(moi, [moi, { id: 2, prenom: "Marie", nom: "Martin" }])).toBe(true);
  });
  it("seule dans l'organisation : pas ambigu", () => {
    expect(nomAmbigu(moi, [moi, { id: 2, prenom: "Paul", nom: "Martin" }])).toBe(false);
  });
  it("la casse et les espaces ne cachent pas l'homonymie", () => {
    expect(nomAmbigu(moi, [{ id: 3, prenom: "marie ", nom: "MARTIN" }])).toBe(true);
  });
  it("son propre compte ne compte pas comme homonyme", () => {
    expect(nomAmbigu(moi, [moi])).toBe(false);
  });
});
