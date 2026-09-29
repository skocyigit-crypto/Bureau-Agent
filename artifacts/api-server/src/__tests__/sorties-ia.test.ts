/**
 * Ce qu'un modele rend est lu avant d'etre ecrit (services/sortie-ia.ts) :
 * element invalide ecarte, lot garde ; rendez-vous propose en attente, a
 * l'heure de Paris ; priorites ramenees aux trois que l'application connait.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  dansNJours, extraireObjetJson, listeValide, prioriteTache, rendezVousPropose, RendezVousExtrait, TacheExtraite,
} from "../services/sortie-ia";
import { instantMural } from "../lib/jour-local";

const SRC = path.join(import.meta.dirname, "..");
const lire = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

describe("extraireObjetJson", () => {
  it("lit un objet entoure de texte et d'une cloture", () => {
    expect(extraireObjetJson("Voici :\n```json\n{\"a\": 1}\n```")).toEqual({ a: 1 });
  });
  it("un JSON casse donne null, pas une exception", () => {
    expect(extraireObjetJson("{\"a\": ")).toBeNull();
  });
  it("un tableau n'est pas un objet", () => {
    expect(extraireObjetJson("[1,2]")).toBeNull();
  });
  it("rien a lire : null", () => {
    expect(extraireObjetJson(undefined)).toBeNull();
  });
});

describe("listeValide", () => {
  it("un element invalide est ecarte, les autres gardes", () => {
    const l = listeValide([{ title: "Rappeler" }, { title: "" }, { title: 42 }, { title: "Devis" }], TacheExtraite);
    expect(l.map((t) => t.title)).toEqual(["Rappeler", "Devis"]);
  });
  it("un titre demesure est ecarte", () => {
    expect(listeValide([{ title: "x".repeat(301) }], TacheExtraite)).toEqual([]);
  });
  it("un champ facultatif farfelu n'ecarte pas la tache", () => {
    expect(listeValide([{ title: "Rappeler", dueInDays: "demain", priority: { a: 1 } }], TacheExtraite))
      .toEqual([{ title: "Rappeler", dueInDays: undefined, priority: undefined }]);
  });
  it("le nombre est borne", () => {
    expect(listeValide(Array.from({ length: 30 }, (_, i) => ({ title: `T${i}` })), TacheExtraite, 5)).toHaveLength(5);
  });
  it("pas une liste : rien", () => {
    expect(listeValide("tasks", TacheExtraite)).toEqual([]);
  });
});

describe("heure de Paris", () => {
  it("ete : 14:30 a Paris = 12:30 UTC", () => {
    expect(instantMural("2026-10-01", "14:30")!.toISOString()).toBe("2026-10-01T12:30:00.000Z");
  });
  it("hiver : 14:30 a Paris = 13:30 UTC", () => {
    expect(instantMural("2026-12-01", "14:30")!.toISOString()).toBe("2026-12-01T13:30:00.000Z");
  });
  it("jour du changement d'heure (25/10/2026) : 10:00 = 09:00 UTC", () => {
    expect(instantMural("2026-10-25", "10:00")!.toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });
  it("date impossible ou heure mal formee : null", () => {
    expect(instantMural("2026-02-30", "10:00")).toBeNull();
    expect(instantMural("2026-10-01", "25:00")).toBeNull();
    expect(instantMural("demain", "10:00")).toBeNull();
  });
});

describe("rendez-vous propose par un modele", () => {
  const maintenant = new Date("2026-09-29T08:00:00Z");
  const rdv = RendezVousExtrait.parse({ title: "Visite chantier", date: "2026-10-01", time: "14:30" });
  it("en attente, marque IA, a l'heure de Paris", () => {
    const v = rendezVousPropose(rdv, { organisationId: 1, source: "appel #3", maintenant })!;
    expect(v.status).toBe("en_attente");
    expect(v.description).toMatch(/Propose par l'IA \(appel #3\)/);
    expect(v.startDate.toISOString()).toBe("2026-10-01T12:30:00.000Z");
    expect(v.endDate.getTime() - v.startDate.getTime()).toBe(3600_000);
  });
  it("dans le passe : aucun rendez-vous", () => {
    expect(rendezVousPropose({ ...rdv, date: "2026-09-01" }, { organisationId: 1, source: "x", maintenant })).toBeNull();
  });
  it("a plus de deux ans : aucun rendez-vous", () => {
    expect(rendezVousPropose({ ...rdv, date: "2029-01-01" }, { organisationId: 1, source: "x", maintenant })).toBeNull();
  });
  it("une date mal formee n'est pas un rendez-vous", () => {
    expect(RendezVousExtrait.safeParse({ title: "x", date: "01/10/2026" }).success).toBe(false);
  });
  it("sans heure : l'heure par defaut, a Paris", () => {
    const v = rendezVousPropose({ title: "x", date: "2026-10-02" }, { organisationId: 1, source: "x", maintenant, heureParDefaut: "09:00" })!;
    expect(v.startDate.toISOString()).toBe("2026-10-02T07:00:00.000Z");
  });
});

describe("priorites et delais", () => {
  it.each([["urgente", "haute"], ["High", "haute"], ["critique", "haute"], ["faible", "basse"], ["normale", "moyenne"], ["urgentissime", "moyenne"], [undefined, "moyenne"], [3, "moyenne"]])(
    "%s -> %s", (entree, attendu) => expect(prioriteTache(entree)).toBe(attendu),
  );
  it("dans N jours, borne a un an", () => {
    expect(dansNJours(9999, new Date("2026-09-29T08:00:00Z"))).toBe("2027-09-29");
    expect(dansNJours(-5, new Date("2026-09-29T08:00:00Z"))).toBe("2026-09-29");
  });
});

describe("les chemins qui ecrivent passent par cette lecture", () => {
  it("plus aucun `JSON.parse(m[0])` / `jsonMatch[0]` dans les chemins corriges", () => {
    for (const f of ["routes/ai-commandant.ts", "routes/ai-agents.ts"]) {
      const src = lire(f);
      for (const bloc of ["/commandant/call-compile", "/commandant/auto-create-from-interaction", "/commandant/meeting-compile", "/ai/super-agent/process-report"]) {
        const i = src.indexOf(`"${bloc}"`);
        if (i < 0) continue;
        const corps = src.slice(i, src.indexOf("\nrouter.", i + 10));
        expect(corps, `${bloc} lit encore la sortie sans schema`).not.toMatch(/JSON\.parse\((jsonMatch|m)\[0\]\)/);
      }
    }
  });
  it("aucun rendez-vous IA n'est insere « confirme »", () => {
    for (const f of ["routes/ai-commandant.ts", "routes/ai-agents.ts", "services/call-processor.ts"]) {
      expect(lire(f), f).not.toMatch(/calendarEventsTable\)\.values\(\{[^}]*status: "confirme"/);
    }
  });
  it("le Super Agent reclame chaque courriel avant de l'analyser, et le rend en cas d'echec", () => {
    const src = lire("routes/ai-agents.ts");
    const boucle = src.slice(src.indexOf("for (const msg of messages.slice(0, 10))"));
    expect(boucle.indexOf("reclamerExecution(\"super-agent-courriel\"")).toBeGreaterThan(-1);
    expect(boucle.indexOf("reclamerExecution(\"super-agent-courriel\"")).toBeLessThan(boucle.indexOf("superAgentAI("));
    expect(boucle).toMatch(/catch \(err\) \{[\s\S]{0,400}abandonnerExecution\("super-agent-courriel"/);
  });
  it("les notifications de l'analyse d'appel portent l'organisation", () => {
    const src = lire("services/call-processor.ts");
    for (const m of src.matchAll(/insert\(notificationsTable\)\.values\(\{([\s\S]{0,120})/g)) {
      expect(m[1]).toMatch(/organisationId/);
    }
  });
});
