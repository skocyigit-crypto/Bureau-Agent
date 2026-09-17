/**
 * Lignes extraites d'un document (IA) avant import dans un module.
 *
 * Mesure le 17/09 : l'import faisait confiance au navigateur pour les
 * doublons (`duplicateOf`), enregistrait « Terminé » ou « urgent » tels quels
 * (taches invisibles dans les filtres), transformait « demain » en date
 * invalide dont l'erreur SQL brute revenait a l'ecran, et acceptait un
 * contact sans telephone.
 */
import { lireLigneContact } from "./import-contacts";

const STATUTS_TACHE = ["en_attente", "en_cours", "termine", "annule"] as const;
const PRIORITES_TACHE = ["haute", "moyenne", "basse"] as const;

function normaliser(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[\s-]+/g, "_");
}

const ALIAS_STATUT: Record<string, (typeof STATUTS_TACHE)[number]> = {
  a_faire: "en_attente", todo: "en_attente", nouveau: "en_attente", en_attente: "en_attente",
  en_cours: "en_cours", in_progress: "en_cours",
  termine: "termine", fait: "termine", done: "termine", terminee: "termine",
  annule: "annule", annulee: "annule", cancelled: "annule",
};
const ALIAS_PRIORITE: Record<string, (typeof PRIORITES_TACHE)[number]> = {
  haute: "haute", urgent: "haute", urgente: "haute", high: "haute",
  moyenne: "moyenne", normale: "moyenne", normal: "moyenne", medium: "moyenne",
  basse: "basse", faible: "basse", low: "basse",
};

function texte(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export type TacheLue =
  | { ok: true; valeurs: { title: string; description: string | null; status: string; priority: string; dueDate: Date | null; assignedTo: string | null } }
  | { ok: false; erreur: string };

export function lireLigneTache(f: Record<string, unknown>): TacheLue {
  const title = texte(f.title, 500);
  if (!title) return { ok: false, erreur: "titre manquant" };
  const status = f.status ? ALIAS_STATUT[normaliser(f.status)] : "en_attente";
  if (!status) return { ok: false, erreur: `statut « ${String(f.status).slice(0, 30)} » inconnu` };
  const priority = f.priority ? ALIAS_PRIORITE[normaliser(f.priority)] : "moyenne";
  if (!priority) return { ok: false, erreur: `priorité « ${String(f.priority).slice(0, 30)} » inconnue` };
  let dueDate: Date | null = null;
  if (f.dueDate) {
    const d = new Date(String(f.dueDate));
    if (Number.isNaN(d.getTime())) return { ok: false, erreur: `échéance « ${String(f.dueDate).slice(0, 30)} » illisible` };
    dueDate = d;
  }
  return { ok: true, valeurs: { title, description: texte(f.description, 5000), status, priority, dueDate, assignedTo: texte(f.assignedTo, 200) } };
}

/** Contact : memes regles que l'import CSV, plus mobile et adresse. */
export function lireLigneContactDocument(f: Record<string, unknown>) {
  const lue = lireLigneContact({ ...f, lastName: f.lastName ?? f.name });
  if (!lue.ok) return lue;
  return {
    ...lue,
    valeurs: { ...lue.valeurs, mobile: texte(f.mobile, 30), address: texte(f.address, 500) },
  };
}
