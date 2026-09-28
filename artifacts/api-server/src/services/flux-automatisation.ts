/**
 * Studio de flux : une automatisation dessinee comme un graphe
 *   declencheur → agent → condition → approbation → action.
 *
 * Avant (mesure du 28/09), une regle etait UN declencheur et une liste plate
 * d'actions : ni branche, ni condition generale (seul « inactivityDays »
 * etait lu), ni etape d'approbation explicite, et rien ne se modifiait apres
 * la creation. Le tableau de conception demandait un editeur glisser-deposer
 * ET une vue liste accessible du meme flux ; le schema de routage demandait
 * « nouvelle demande → classificateur → support / vente → action externe ? →
 * approbation humaine → resultat enregistre ».
 *
 * Ce module porte le MODELE (valide cote serveur, jamais cru sur parole),
 * la conversion des regles existantes, et l'EXECUTION. L'execution recoit ses
 * effets (action, classification, specialiste) en dependances : pas de cycle
 * d'import avec le moteur, et un test peut la faire tourner sans base ni
 * modele.
 */
import { z } from "zod";
import { ACTIONS } from "./automation-declencheurs";

export const TYPES_NOEUD = ["declencheur", "agent", "condition", "approbation", "action"] as const;
export const OPERATEURS = ["egal", "different", "contient", "superieur", "inferieur", "vide", "non_vide"] as const;
export const AGENTS_FLUX = ["classificateur", "agent-support", "agent-vente"] as const;
/** Declencheur des flux de demandes entrantes (Bureau des taches, formulaire...). */
export const DECLENCHEUR_DEMANDE = "nouvelle_demande";
export const MAX_NOEUDS = 30;

const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i, "identifiant de noeud invalide");
const Position = z.object({ x: z.number().finite(), y: z.number().finite() }).optional();
const Champ = z.string().regex(/^(element|agent)\.[a-zA-Z_][a-zA-Z0-9_]{0,40}$/, "champ : element.<nom> ou agent.<nom>");

const NoeudDeclencheur = z.object({ id: Id, type: z.literal("declencheur"), position: Position });
const NoeudAgent = z.object({ id: Id, type: z.literal("agent"), agent: z.enum(AGENTS_FLUX), position: Position });
const NoeudCondition = z.object({
  id: Id, type: z.literal("condition"), champ: Champ, operateur: z.enum(OPERATEURS),
  valeur: z.union([z.string().max(200), z.number().finite()]).optional(), position: Position,
});
const NoeudApprobation = z.object({ id: Id, type: z.literal("approbation"), position: Position });
const NoeudAction = z.object({
  id: Id, type: z.literal("action"),
  action: z.object({
    type: z.enum(ACTIONS),
    params: z.record(z.string(), z.union([z.string().max(2000), z.number().finite(), z.boolean()])).optional(),
  }),
  position: Position,
});

export const SchemaNoeud = z.discriminatedUnion("type", [NoeudDeclencheur, NoeudAgent, NoeudCondition, NoeudApprobation, NoeudAction]);
export const SchemaLien = z.object({ de: Id, vers: Id, branche: z.enum(["oui", "non"]).optional() });
export const SchemaFlux = z.object({
  noeuds: z.array(SchemaNoeud).min(2).max(MAX_NOEUDS),
  liens: z.array(SchemaLien).max(MAX_NOEUDS * 2),
});

export type Noeud = z.infer<typeof SchemaNoeud>;
export type Lien = z.infer<typeof SchemaLien>;
export type Flux = z.infer<typeof SchemaFlux>;
export type ErreurFlux = { noeud?: string; message: string };

/** Ordre topologique, ou null s'il y a un cycle. */
export function ordreTopologique(flux: Flux): string[] | null {
  const entrants = new Map(flux.noeuds.map((n) => [n.id, 0]));
  for (const l of flux.liens) entrants.set(l.vers, (entrants.get(l.vers) ?? 0) + 1);
  const file = flux.noeuds.filter((n) => (entrants.get(n.id) ?? 0) === 0).map((n) => n.id);
  const ordre: string[] = [];
  while (file.length) {
    const id = file.shift()!;
    ordre.push(id);
    for (const l of flux.liens.filter((x) => x.de === id)) {
      const reste = (entrants.get(l.vers) ?? 0) - 1;
      entrants.set(l.vers, reste);
      if (reste === 0) file.push(l.vers);
    }
  }
  return ordre.length === flux.noeuds.length ? ordre : null;
}

/**
 * Valide la forme ET le sens d'un flux pour un declencheur donne. Les erreurs
 * nomment le noeud concerne : l'ecran les affiche a cote de l'etape et les
 * annonce.
 */
export function validerFlux(brut: unknown, declencheur: string): { ok: true; flux: Flux } | { ok: false; erreurs: ErreurFlux[] } {
  const lu = SchemaFlux.safeParse(brut);
  if (!lu.success) {
    return { ok: false, erreurs: lu.error.issues.slice(0, 10).map((i) => ({ message: `${i.path.join(".")} : ${i.message}` })) };
  }
  const flux = lu.data;
  const erreurs: ErreurFlux[] = [];
  const ids = new Set<string>();
  for (const n of flux.noeuds) {
    if (ids.has(n.id)) erreurs.push({ noeud: n.id, message: "Identifiant en double." });
    ids.add(n.id);
  }
  const declencheurs = flux.noeuds.filter((n) => n.type === "declencheur");
  if (declencheurs.length !== 1) erreurs.push({ message: "Un flux a exactement un declencheur." });
  const vus = new Set<string>();
  for (const l of flux.liens) {
    if (!ids.has(l.de) || !ids.has(l.vers)) { erreurs.push({ message: `Lien vers une etape inconnue (${l.de} → ${l.vers}).` }); continue; }
    if (l.de === l.vers) erreurs.push({ noeud: l.de, message: "Une etape ne se relie pas a elle-meme." });
    const cle = `${l.de}>${l.vers}`;
    if (vus.has(cle)) erreurs.push({ noeud: l.de, message: "Lien en double." });
    vus.add(cle);
  }
  if (erreurs.length) return { ok: false, erreurs };

  const parId = new Map(flux.noeuds.map((n) => [n.id, n]));
  const racine = declencheurs[0]!;
  if (flux.liens.some((l) => l.vers === racine.id)) erreurs.push({ noeud: racine.id, message: "Le declencheur ne recoit aucun lien." });
  if (!ordreTopologique(flux)) erreurs.push({ message: "Le flux forme une boucle : une etape ne peut pas revenir en arriere." });

  for (const n of flux.noeuds) {
    const sortants = flux.liens.filter((l) => l.de === n.id);
    if (n.type === "condition") {
      const oui = sortants.filter((l) => l.branche === "oui").length;
      const non = sortants.filter((l) => l.branche === "non").length;
      if (oui !== 1) erreurs.push({ noeud: n.id, message: "Une condition a exactement une branche « oui »." });
      if (non > 1) erreurs.push({ noeud: n.id, message: "Une condition a au plus une branche « non »." });
      if (sortants.some((l) => !l.branche)) erreurs.push({ noeud: n.id, message: "Chaque lien d'une condition porte « oui » ou « non »." });
      if (n.operateur !== "vide" && n.operateur !== "non_vide" && n.valeur === undefined) {
        erreurs.push({ noeud: n.id, message: "Cette condition compare a une valeur : indiquez-la." });
      }
      if ((n.operateur === "superieur" || n.operateur === "inferieur") && typeof n.valeur === "string" && n.valeur.trim() !== "" && !Number.isFinite(Number(n.valeur))) {
        erreurs.push({ noeud: n.id, message: "« Superieur » et « inferieur » comparent des nombres." });
      }
    } else if (sortants.some((l) => l.branche)) {
      erreurs.push({ noeud: n.id, message: "Seule une condition a des branches « oui » / « non »." });
    }
    if (n.type === "agent" && declencheur !== DECLENCHEUR_DEMANDE) {
      erreurs.push({ noeud: n.id, message: "Un agent lit une demande : il n'est disponible que pour le declencheur « Nouvelle demande »." });
    }
    if (n.type === "condition" && n.champ.startsWith("agent.")) {
      const agentAvant = flux.noeuds.some((a) => a.type === "agent" && atteint(flux, a.id, n.id));
      if (!agentAvant) erreurs.push({ noeud: n.id, message: "Cette condition lit la reponse d'un agent : placez un agent avant elle." });
    }
  }

  // Chaque etape est atteignable depuis le declencheur.
  for (const n of flux.noeuds) {
    if (n.id !== racine.id && !atteint(flux, racine.id, n.id)) erreurs.push({ noeud: n.id, message: "Etape isolee : aucun chemin ne l'atteint depuis le declencheur." });
  }
  if (!flux.noeuds.some((n) => n.type === "action" || n.type === "agent")) {
    erreurs.push({ message: "Le flux ne fait rien : ajoutez au moins une action ou un agent." });
  }
  void parId;
  return erreurs.length ? { ok: false, erreurs } : { ok: true, flux };
}

function atteint(flux: Flux, de: string, vers: string): boolean {
  const pile = [de];
  const vus = new Set<string>();
  while (pile.length) {
    const id = pile.pop()!;
    if (id === vers) return true;
    if (vus.has(id)) continue;
    vus.add(id);
    for (const l of flux.liens) if (l.de === id) pile.push(l.vers);
  }
  return false;
}

/** Une regle existante (declencheur + actions + approbation) vue comme un flux lineaire. */
export function fluxDepuisRegle(regle: {
  actions: unknown; requiresApproval?: boolean | null;
}): Flux {
  const actions = Array.isArray(regle.actions) ? regle.actions as Array<{ type: string; params?: Record<string, unknown> }> : [];
  const noeuds: Noeud[] = [{ id: "declencheur", type: "declencheur", position: { x: 0, y: 0 } }];
  const liens: Lien[] = [];
  let precedent = "declencheur";
  let y = 120;
  if (regle.requiresApproval === true) {
    noeuds.push({ id: "approbation", type: "approbation", position: { x: 0, y } });
    liens.push({ de: precedent, vers: "approbation" });
    precedent = "approbation";
    y += 120;
  }
  actions.slice(0, MAX_NOEUDS - 2).forEach((a, i) => {
    if (!(ACTIONS as readonly string[]).includes(a.type)) return;
    const id = `action-${i + 1}`;
    const params = Object.fromEntries(Object.entries(a.params ?? {}).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))) as Record<string, string | number | boolean>;
    noeuds.push({ id, type: "action", action: { type: a.type as (typeof ACTIONS)[number], params }, position: { x: 0, y } });
    liens.push({ de: precedent, vers: id });
    precedent = id;
    y += 120;
  });
  return { noeuds, liens };
}

/** Les actions du flux, dans l'ordre : garde la colonne `actions` lisible par les ecrans existants. */
export function actionsDuFlux(flux: Flux): Array<{ type: string; params?: Record<string, unknown> }> {
  const ordre = ordreTopologique(flux) ?? flux.noeuds.map((n) => n.id);
  const parId = new Map(flux.noeuds.map((n) => [n.id, n]));
  return ordre.map((id) => parId.get(id)!).filter((n): n is Extract<Noeud, { type: "action" }> => n.type === "action")
    .map((n) => ({ type: n.action.type, params: n.action.params }));
}

/**
 * Flux propose pour « Nouvelle demande » : le schema de routage du tableau de
 * conception, que l'organisation peut ensuite modifier.
 */
export function fluxDemandeParDefaut(): Flux {
  return {
    noeuds: [
      { id: "declencheur", type: "declencheur", position: { x: 0, y: 0 } },
      { id: "classer", type: "agent", agent: "classificateur", position: { x: 0, y: 120 } },
      { id: "est-support", type: "condition", champ: "agent.type", operateur: "egal", valeur: "support", position: { x: 0, y: 240 } },
      { id: "support", type: "agent", agent: "agent-support", position: { x: -220, y: 360 } },
      { id: "est-vente", type: "condition", champ: "agent.type", operateur: "egal", valeur: "vente", position: { x: 220, y: 360 } },
      { id: "vente", type: "agent", agent: "agent-vente", position: { x: 120, y: 480 } },
      {
        id: "a-trier", type: "action", position: { x: 360, y: 480 },
        action: { type: "create_task", params: { title: "Demande a trier : {{sujet}}", description: "{{contenu}}", priority: "moyenne" } },
      },
    ],
    liens: [
      { de: "declencheur", vers: "classer" },
      { de: "classer", vers: "est-support" },
      { de: "est-support", vers: "support", branche: "oui" },
      { de: "est-support", vers: "est-vente", branche: "non" },
      { de: "est-vente", vers: "vente", branche: "oui" },
      { de: "est-vente", vers: "a-trier", branche: "non" },
    ],
  };
}

// ── Execution ──────────────────────────────────────────────────────────────

export type DonneesFlux = { element: Record<string, unknown>; agent: Record<string, unknown> };

function lireChamp(donnees: DonneesFlux, champ: string): unknown {
  const [racine, cle] = champ.split(".") as ["element" | "agent", string];
  return donnees[racine]?.[cle];
}

/** Evaluation deterministe d'une condition : le modele ne decide jamais d'une branche. */
export function evaluerCondition(n: Extract<Noeud, { type: "condition" }>, donnees: DonneesFlux): boolean {
  const v = lireChamp(donnees, n.champ);
  const texte = v === null || v === undefined ? "" : String(v);
  const attendu = n.valeur === undefined ? "" : String(n.valeur);
  switch (n.operateur) {
    case "egal": return texte.trim().toLowerCase() === attendu.trim().toLowerCase();
    case "different": return texte.trim().toLowerCase() !== attendu.trim().toLowerCase();
    case "contient": return attendu !== "" && texte.toLowerCase().includes(attendu.toLowerCase());
    case "superieur": { const a = Number(texte), b = Number(attendu); return texte !== "" && Number.isFinite(a) && Number.isFinite(b) && a > b; }
    case "inferieur": { const a = Number(texte), b = Number(attendu); return texte !== "" && Number.isFinite(a) && Number.isFinite(b) && a < b; }
    case "vide": return texte.trim() === "";
    case "non_vide": return texte.trim() !== "";
  }
}

export interface DependancesFlux {
  /** Execute (ou met en file) une action ; vrai si elle a eu un effet. `approbation` force la file. */
  executerAction(action: { type: string; params?: Record<string, unknown> }, element: Record<string, unknown>, approbation: boolean | null): Promise<boolean>;
  /** Vrai si cette action ira en file avec cette politique (pour le compte rendu). */
  iraEnFile(actionType: string, approbation: boolean | null): boolean;
  /** Noeud agent « classificateur ». */
  classer?(): Promise<{ type: string; confiance: number; resume: string }>;
  /** Noeud agent specialiste. */
  specialiste?(id: "agent-support" | "agent-vente"): Promise<{ ok: boolean; brouillon: string | null; actionsEnAttente: number; actionsExecutees: number; erreur?: string }>;
}

export interface RapportFlux {
  parcours: string[];
  actions: Array<{ noeud: string; type: string; effet: "executee" | "en_file" | "sans_effet" }>;
  agent: Record<string, unknown>;
  erreur: string | null;
}

/**
 * Parcourt le flux dans l'ordre topologique. Une etape est active si au moins
 * un lien EMPRUNTE y mene (une condition n'emprunte que sa branche). Une
 * approbation rencontree force la file pour toutes les actions qui la suivent.
 */
export async function executerFlux(
  flux: Flux,
  entree: { element: Record<string, unknown>; approbationRegle: boolean | null },
  deps: DependancesFlux,
): Promise<RapportFlux> {
  const ordre = ordreTopologique(flux);
  const rapport: RapportFlux = { parcours: [], actions: [], agent: {}, erreur: null };
  if (!ordre) { rapport.erreur = "Flux en boucle."; return rapport; }
  const parId = new Map(flux.noeuds.map((n) => [n.id, n]));
  const donnees: DonneesFlux = { element: entree.element, agent: rapport.agent };
  const actifs = new Set<string>();
  const forceFile = new Set<string>();
  const empruntes = new Set<Lien>();

  for (const id of ordre) {
    const n = parId.get(id)!;
    const entrants = flux.liens.filter((l) => l.vers === id);
    const actif = n.type === "declencheur" || entrants.some((l) => empruntes.has(l));
    if (!actif) continue;
    actifs.add(id);
    rapport.parcours.push(id);
    const force = n.type === "approbation" || entrants.some((l) => empruntes.has(l) && forceFile.has(l.de));
    if (force) forceFile.add(id);

    let branche: "oui" | "non" | null = null;
    try {
      switch (n.type) {
        case "declencheur":
        case "approbation":
          break;
        case "condition":
          branche = evaluerCondition(n, donnees) ? "oui" : "non";
          break;
        case "agent": {
          if (n.agent === "classificateur") {
            if (!deps.classer) throw new Error("Classificateur indisponible pour ce declencheur.");
            const c = await deps.classer();
            Object.assign(rapport.agent, { type: c.type, confiance: c.confiance, resume: c.resume });
          } else {
            if (!deps.specialiste) throw new Error("Agent indisponible pour ce declencheur.");
            const s = await deps.specialiste(n.agent);
            if (!s.ok) throw new Error(s.erreur ?? "L'agent n'a pas pu repondre.");
            Object.assign(rapport.agent, { brouillon: s.brouillon, actionsEnAttente: s.actionsEnAttente, actionsExecutees: s.actionsExecutees });
          }
          break;
        }
        case "action": {
          const politique = force ? true : entree.approbationRegle;
          const enFile = deps.iraEnFile(n.action.type, politique);
          const effet = await deps.executerAction(n.action, entree.element, politique);
          rapport.actions.push({ noeud: id, type: n.action.type, effet: !effet ? "sans_effet" : enFile ? "en_file" : "executee" });
          break;
        }
      }
    } catch (err) {
      // Une etape en echec arrete le flux : ce qui la suit dependait d'elle.
      rapport.erreur = `${id} : ${err instanceof Error ? err.message : "erreur"}`;
      return rapport;
    }
    for (const l of flux.liens.filter((x) => x.de === id)) {
      if (n.type === "condition" ? l.branche === branche : true) empruntes.add(l);
    }
  }
  void actifs;
  return rapport;
}
