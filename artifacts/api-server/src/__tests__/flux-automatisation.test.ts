/**
 * Studio de flux : le modele est valide cote serveur, et l'execution suit
 * le dessin — branches, approbation, agents.
 *
 * Sans base ni modele : les effets (action, classification, specialiste)
 * sont des dependances simulees qui journalisent ce qu'on leur demande.
 */
import { describe, expect, it } from "vitest";
import {
  actionsDuFlux, evaluerCondition, executerFlux, fluxDemandeParDefaut, fluxDepuisRegle, validerFlux,
  type DependancesFlux, type Flux,
} from "../services/flux-automatisation";

const D = "nouvelle_demande";
const lineaire = (): Flux => ({
  noeuds: [
    { id: "d", type: "declencheur" },
    { id: "a1", type: "action", action: { type: "create_task", params: { title: "T" } } },
  ],
  liens: [{ de: "d", vers: "a1" }],
});
const erreurs = (flux: unknown, declencheur = "schedule") => {
  const v = validerFlux(flux, declencheur);
  return v.ok ? [] : v.erreurs.map((e) => e.message);
};

function deps(opts: { classe?: string; confiance?: number; echecSpecialiste?: boolean } = {}) {
  const journal: string[] = [];
  const d: DependancesFlux = {
    executerAction: async (a, _el, appr) => { journal.push(`${a.type}:${appr === true ? "file" : appr === false ? "direct" : "defaut"}`); return true; },
    iraEnFile: (type, appr) => appr === true || (appr === null && (type === "send_email" || type === "send_sms")),
    classer: async () => { journal.push("classer"); return { type: opts.classe ?? "support", confiance: opts.confiance ?? 0.9, resume: "r" }; },
    specialiste: async (id) => {
      journal.push(id);
      return opts.echecSpecialiste ? { ok: false, brouillon: null, actionsEnAttente: 0, actionsExecutees: 0, erreur: "panne" }
        : { ok: true, brouillon: "Bonjour", actionsEnAttente: 1, actionsExecutees: 0 };
    },
  };
  return { d, journal };
}

describe("validation du flux", () => {
  it("un flux lineaire simple est valide", () => {
    expect(erreurs(lineaire())).toEqual([]);
  });

  it("le modele de routage des demandes est valide pour « Nouvelle demande »", () => {
    expect(erreurs(fluxDemandeParDefaut(), D)).toEqual([]);
  });

  it("exactement un declencheur", () => {
    const f = lineaire();
    f.noeuds.push({ id: "d2", type: "declencheur" });
    f.liens.push({ de: "d2", vers: "a1" });
    expect(erreurs(f).join()).toMatch(/exactement un declencheur/);
  });

  it("une boucle est refusee", () => {
    const f = lineaire();
    f.noeuds.push({ id: "a2", type: "action", action: { type: "send_notification" } });
    f.liens.push({ de: "a1", vers: "a2" }, { de: "a2", vers: "a1" });
    expect(erreurs(f).join()).toMatch(/boucle/);
  });

  it("une etape isolee est refusee", () => {
    const f = lineaire();
    f.noeuds.push({ id: "seule", type: "action", action: { type: "send_notification" } });
    expect(erreurs(f).join()).toMatch(/isolee/);
  });

  it("une condition a une branche « oui », des liens etiquetes, et une valeur quand elle compare", () => {
    const f: Flux = {
      noeuds: [
        { id: "d", type: "declencheur" },
        { id: "c", type: "condition", champ: "element.priority", operateur: "egal" },
        { id: "a", type: "action", action: { type: "send_notification" } },
      ],
      liens: [{ de: "d", vers: "c" }, { de: "c", vers: "a" }],
    };
    const e = erreurs(f).join(" | ");
    expect(e).toMatch(/exactement une branche « oui »/);
    expect(e).toMatch(/porte « oui » ou « non »/);
    expect(e).toMatch(/indiquez-la/);
  });

  it("« superieur » compare des nombres", () => {
    const f: Flux = {
      noeuds: [
        { id: "d", type: "declencheur" },
        { id: "c", type: "condition", champ: "element.montant", operateur: "superieur", valeur: "beaucoup" },
        { id: "a", type: "action", action: { type: "send_notification" } },
      ],
      liens: [{ de: "d", vers: "c" }, { de: "c", vers: "a", branche: "oui" }],
    };
    expect(erreurs(f).join()).toMatch(/comparent des nombres/);
  });

  it("un agent n'est disponible que pour une demande entrante", () => {
    expect(erreurs(fluxDemandeParDefaut(), "task_overdue").join()).toMatch(/Nouvelle demande/);
  });

  it("une condition sur la reponse d'un agent exige un agent avant elle", () => {
    const f: Flux = {
      noeuds: [
        { id: "d", type: "declencheur" },
        { id: "c", type: "condition", champ: "agent.type", operateur: "egal", valeur: "vente" },
        { id: "a", type: "action", action: { type: "send_notification" } },
      ],
      liens: [{ de: "d", vers: "c" }, { de: "c", vers: "a", branche: "oui" }],
    };
    expect(erreurs(f, D).join()).toMatch(/placez un agent avant elle/);
  });

  it("un flux qui ne fait rien est refuse", () => {
    const f: Flux = { noeuds: [{ id: "d", type: "declencheur" }, { id: "p", type: "approbation" }], liens: [{ de: "d", vers: "p" }] };
    expect(erreurs(f).join()).toMatch(/ne fait rien/);
  });

  it("forme invalide : type d'action inconnu, champ hors element/agent, trop d'etapes", () => {
    expect(erreurs({ noeuds: [{ id: "d", type: "declencheur" }, { id: "x", type: "action", action: { type: "delete_all" } }], liens: [] }).length).toBeGreaterThan(0);
    expect(erreurs({ noeuds: [{ id: "d", type: "declencheur" }, { id: "c", type: "condition", champ: "process.env", operateur: "vide" }], liens: [] }).length).toBeGreaterThan(0);
    const trop = { noeuds: Array.from({ length: 31 }, (_, i) => ({ id: `n${i}`, type: i ? "approbation" : "declencheur" })), liens: [] };
    expect(erreurs(trop).length).toBeGreaterThan(0);
  });
});

describe("regles existantes vues comme un flux", () => {
  it("declencheur puis les actions, dans l'ordre ; « sur approbation » devient une etape", () => {
    const f = fluxDepuisRegle({ actions: [{ type: "create_task", params: { title: "A" } }, { type: "send_sms", params: { message: "B" } }], requiresApproval: true });
    expect(f.noeuds.map((n) => n.type)).toEqual(["declencheur", "approbation", "action", "action"]);
    expect(validerFlux(f, "task_overdue").ok).toBe(true);
    expect(actionsDuFlux(f).map((a) => a.type)).toEqual(["create_task", "send_sms"]);
  });

  it("un type d'action inconnu en base n'est pas repris", () => {
    const f = fluxDepuisRegle({ actions: [{ type: "inconnu" }, { type: "send_notification" }] });
    expect(actionsDuFlux(f).map((a) => a.type)).toEqual(["send_notification"]);
  });
});

describe("conditions : evaluees par le code", () => {
  const d = { element: { priority: "Haute", montant: 1200, note: "" }, agent: { type: "vente" } };
  const c = (champ: string, operateur: any, valeur?: string | number) => evaluerCondition({ id: "c", type: "condition", champ, operateur, valeur }, d);
  it("egalite sans casse, difference, contient", () => {
    expect(c("element.priority", "egal", "haute")).toBe(true);
    expect(c("element.priority", "different", "basse")).toBe(true);
    expect(c("agent.type", "contient", "ven")).toBe(true);
  });
  it("nombres, vide et non vide — et un champ absent n'est jamais « superieur »", () => {
    expect(c("element.montant", "superieur", 1000)).toBe(true);
    expect(c("element.montant", "inferieur", 1000)).toBe(false);
    expect(c("element.note", "vide")).toBe(true);
    expect(c("element.absent", "non_vide")).toBe(false);
    expect(c("element.absent", "superieur", -1)).toBe(false);
  });
});

describe("execution : le flux suit le dessin", () => {
  it("demande de support : classificateur puis agent support, jamais l'agent vente ni la tache « a trier »", async () => {
    const { d, journal } = deps({ classe: "support" });
    const r = await executerFlux(fluxDemandeParDefaut(), { element: { sujet: "Panne" }, approbationRegle: null }, d);
    expect(journal).toEqual(["classer", "agent-support"]);
    expect(r.parcours).toEqual(["declencheur", "classer", "est-support", "support"]);
    expect(r.agent.type).toBe("support");
  });

  it("demande « autre » : aucune devolution, une tache a trier pour un humain", async () => {
    const { d, journal } = deps({ classe: "autre" });
    const r = await executerFlux(fluxDemandeParDefaut(), { element: { sujet: "?" }, approbationRegle: null }, d);
    expect(journal).toEqual(["classer", "create_task:defaut"]);
    expect(r.actions).toEqual([{ noeud: "a-trier", type: "create_task", effet: "executee" }]);
  });

  it("une approbation force la file pour ce qui la SUIT, pas pour ce qui la precede", async () => {
    const f: Flux = {
      noeuds: [
        { id: "d", type: "declencheur" },
        { id: "avant", type: "action", action: { type: "send_notification" } },
        { id: "ok", type: "approbation" },
        { id: "apres", type: "action", action: { type: "create_task" } },
      ],
      liens: [{ de: "d", vers: "avant" }, { de: "avant", vers: "ok" }, { de: "ok", vers: "apres" }],
    };
    const { d, journal } = deps();
    const r = await executerFlux(f, { element: {}, approbationRegle: false }, d);
    expect(journal).toEqual(["send_notification:direct", "create_task:file"]);
    expect(r.actions.map((a) => a.effet)).toEqual(["executee", "en_file"]);
  });

  it("un agent en echec arrete le flux : rien de ce qui en depend ne s'execute", async () => {
    const f: Flux = {
      noeuds: [
        { id: "d", type: "declencheur" },
        { id: "s", type: "agent", agent: "agent-support" },
        { id: "a", type: "action", action: { type: "send_notification" } },
      ],
      liens: [{ de: "d", vers: "s" }, { de: "s", vers: "a" }],
    };
    const { d, journal } = deps({ echecSpecialiste: true });
    const r = await executerFlux(f, { element: {}, approbationRegle: null }, d);
    expect(r.erreur).toMatch(/panne/);
    expect(journal).toEqual(["agent-support"]);
    expect(r.actions).toEqual([]);
  });

  it("un e-mail sans approbation explicite va en file par defaut (action sortante)", async () => {
    const f: Flux = {
      noeuds: [{ id: "d", type: "declencheur" }, { id: "m", type: "action", action: { type: "send_email", params: { subject: "S", body: "B" } } }],
      liens: [{ de: "d", vers: "m" }],
    };
    const { d } = deps();
    const r = await executerFlux(f, { element: { email: "x@y.fr" }, approbationRegle: null }, d);
    expect(r.actions[0]!.effet).toBe("en_file");
  });
});
