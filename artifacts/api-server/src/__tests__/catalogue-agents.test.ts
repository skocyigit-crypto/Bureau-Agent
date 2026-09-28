/**
 * Le catalogue dit vrai : ce qu'il declare d'un agent est ce que l'agent
 * utilise, et ce qu'il applique ne laisse rien passer par defaut.
 *
 * Les listes des agents existants viennent de LEUR module (la secretaire,
 * l'auto-audit, le registre de l'assistant, les outils SaaS) : ce controle
 * compare ces sources au catalogue, pour qu'une copie ne puisse pas deriver
 * en silence.
 */
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_AGENTS, agentDuCatalogue, outilAutorise, palierOutil, exigeApprobation,
} from "../services/catalogue-agents";
import { getAllTools, getTool } from "../services/assistant-tools";
import { listSaasTools } from "../services/saas-tools";
import { ALLOWED_TOOLS as OUTILS_SECRETAIRE } from "../services/autonomous-secretary";
import { ALLOWED_TOOLS as OUTILS_AUTO_AUDIT } from "../services/app-audit";
import { KB_CATEGORIES_PUBLIQUES } from "../services/knowledge-base";

const noms = (id: string) => new Set(agentDuCatalogue(id)!.outils.map((o) => o.nom));

describe("le catalogue lui-meme", () => {
  it("l'instrument voit les agents (garde-fou)", () => {
    expect(CATALOGUE_AGENTS.length).toBeGreaterThanOrEqual(7);
  });

  it("chaque agent a un identifiant unique, une mission et un modele", () => {
    const ids = CATALOGUE_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of CATALOGUE_AGENTS) {
      expect(a.mission.length, a.id).toBeGreaterThan(20);
      expect(a.modele.length, a.id).toBeGreaterThan(0);
    }
  });

  it("chaque outil declare existe dans un registre reel", () => {
    const saas = new Set(listSaasTools().map((t) => t.name));
    for (const a of CATALOGUE_AGENTS) {
      for (const o of a.outils) {
        expect(Boolean(getTool(o.nom)) || saas.has(o.nom), `${a.id} → ${o.nom}`).toBe(true);
      }
    }
  });
});

describe("les agents existants : le catalogue lit leur module", () => {
  it("secretaire autonome = sa liste d'outils", () => {
    expect(noms("secretaire-autonome")).toEqual(new Set(OUTILS_SECRETAIRE));
  });

  it("auto-audit = sa liste d'outils", () => {
    expect(noms("auto-audit")).toEqual(new Set(OUTILS_AUTO_AUDIT));
  });

  it("assistant = tout le registre (c'est son etat reel, a restreindre)", () => {
    expect(noms("assistant")).toEqual(new Set(getAllTools().map((t) => t.name)));
  });

  it("agent plateforme = les outils SaaS", () => {
    expect(noms("agent-saas")).toEqual(new Set(listSaasTools().map((t) => t.name)));
  });

  it("aucune limite declaree pour un agent que l'orchestrateur ne fait pas tourner", () => {
    for (const a of CATALOGUE_AGENTS) {
      if (a.execution === "orchestrateur") expect(a.limites, a.id).not.toBeNull();
      else expect(a.limites, `${a.id} : limite declaree mais non appliquee`).toBeNull();
    }
  });
});

describe("paliers et refus par defaut", () => {
  it("envoyer est externe, supprimer est destructif, lire est une lecture", () => {
    expect(palierOutil("send_email")).toBe("externe");
    expect(palierOutil("send_sms")).toBe("externe");
    expect(palierOutil("delete_call")).toBe("destructif");
    expect(palierOutil("list_tasks")).toBe("lecture");
    expect(palierOutil("create_task")).toBe("interne");
    expect(palierOutil("saas_send_invoice_reminder")).toBe("externe");
  });

  it("seuls l'externe et le destructif exigent une approbation", () => {
    expect(exigeApprobation("externe")).toBe(true);
    expect(exigeApprobation("destructif")).toBe(true);
    expect(exigeApprobation("interne")).toBe(false);
    expect(exigeApprobation("lecture")).toBe(false);
  });

  it("tout outil externe ou destructif du registre exige aussi une confirmation dans l'assistant", () => {
    const sortants = getAllTools().filter((t) => exigeApprobation(palierOutil(t.name)));
    expect(sortants.length).toBeGreaterThanOrEqual(3);
    for (const t of sortants) expect(t.requiresConfirmation, t.name).toBe(true);
  });

  it("refus par defaut : agent inconnu, outil non declare", () => {
    expect(outilAutorise("agent-inconnu", "create_task")).toBe(false);
    expect(outilAutorise("classificateur", "create_task")).toBe(false);
    expect(outilAutorise("agent-support", "create_prospect")).toBe(false);
    expect(outilAutorise("agent-support", "delete_call")).toBe(false);
    expect(outilAutorise("agent-vente", "create_prospect")).toBe(true);
  });

  it("un agent qui repond a un tiers ne lit que les documents publics", () => {
    for (const id of ["agent-support", "agent-vente"]) {
      expect(agentDuCatalogue(id)!.sources.baseConnaissances, id).toEqual(KB_CATEGORIES_PUBLIQUES);
    }
  });

  it("le classificateur n'a aucun outil", () => {
    expect(agentDuCatalogue("classificateur")!.outils).toEqual([]);
  });
});
