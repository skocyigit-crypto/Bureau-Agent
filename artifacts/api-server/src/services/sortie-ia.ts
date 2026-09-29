/**
 * Lire ce qu'un modele rend avant d'ecrire en base.
 *
 * Mesure du 29/09 : une douzaine de routes faisaient
 * `JSON.parse(texte.match(/\{[\s\S]*\}/)[0])` puis inseraient tel quel des
 * taches et des rendez-vous tires d'un e-mail, d'un appel ou d'un rapport —
 * donc d'un texte ecrit par un TIERS. Aucun schema : un titre de 10 000
 * caracteres, une priorite « urgentissime », une date « demain » ou un tableau
 * a la place d'une chaine allaient jusqu'a l'insertion (qui echouait, ou pire,
 * reussissait). Seul l'orchestrateur validait avec zod.
 *
 * Deux regles ici :
 *  - un element invalide est ECARTE, le lot ne l'est pas : trois taches
 *    correctes et une farfelue donnent trois taches ;
 *  - un rendez-vous propose par un modele n'est jamais « confirme » : il
 *    arrive `en_attente`, marque comme propose par l'IA, a l'heure de Paris.
 */
import { z } from "zod";
import { instantMural, jourLocal } from "../lib/jour-local";

/** Le premier objet JSON du texte (cloture ```json toleree), ou `null`. */
export function extraireObjetJson(texte: string | null | undefined): Record<string, unknown> | null {
  if (!texte) return null;
  const sansCloture = texte.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const m = sansCloture.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v: unknown = JSON.parse(m[0]);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Les elements valides d'une liste rendue par un modele ; le reste est ecarte. */
export function listeValide<S extends z.ZodType>(valeur: unknown, schema: S, max = 10): z.output<S>[] {
  if (!Array.isArray(valeur)) return [];
  const out: z.output<S>[] = [];
  for (const v of valeur) {
    const r = schema.safeParse(v);
    if (r.success) out.push(r.data);
    if (out.length >= max) break;
  }
  return out;
}

/** Une chaine courte, ou rien. */
export function texteOuVide(valeur: unknown, max: number): string {
  return typeof valeur === "string" ? valeur.trim().slice(0, max) : "";
}

// Un champ facultatif mal forme est ignore (`.catch(undefined)`) plutot que
// de faire ecarter tout l'element : un titre correct avec une duree absurde
// reste une tache.
export const TacheExtraite = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000).optional().catch(undefined),
  priority: z.string().max(30).optional().catch(undefined),
  dueInDays: z.coerce.number().optional().catch(undefined),
});
export type TacheExtraite = z.infer<typeof TacheExtraite>;

export const RendezVousExtrait = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().catch(undefined),
  duration: z.coerce.number().int().min(5).max(480).optional().catch(undefined),
  type: z.enum(["rendez_vous", "reunion", "visite", "appel"]).optional().catch(undefined),
});
export type RendezVousExtrait = z.infer<typeof RendezVousExtrait>;

export const RappelExtrait = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().max(1000).optional().catch(undefined),
});

/** Un modele ne fixe pas de rendez-vous dans le passe, ni a plus de deux ans. */
const HORIZON_MS = 2 * 365 * 86400_000;

/**
 * Les valeurs d'insertion d'un rendez-vous propose par un modele, ou `null`
 * si la date ne tient pas. Statut `en_attente` : un humain confirme.
 */
export function rendezVousPropose(
  rdv: RendezVousExtrait,
  opts: { organisationId: number; source: string; relatedContactId?: number | null; maintenant?: Date; heureParDefaut?: string },
) {
  const debut = instantMural(rdv.date, rdv.time ?? opts.heureParDefaut ?? "10:00");
  const maintenant = opts.maintenant ?? new Date();
  if (!debut || debut.getTime() < maintenant.getTime() - 3600_000 || debut.getTime() > maintenant.getTime() + HORIZON_MS) return null;
  return {
    organisationId: opts.organisationId,
    title: rdv.title,
    type: rdv.type ?? "rendez_vous",
    startDate: debut,
    endDate: new Date(debut.getTime() + (rdv.duration ?? 60) * 60_000),
    status: "en_attente" as const,
    description: `Propose par l'IA (${opts.source}) — a confirmer.`,
    relatedContactId: opts.relatedContactId ?? null,
  };
}

/** La date AAAA-MM-JJ dans `n` jours, a Paris. */
export function dansNJours(n: number, maintenant: Date = new Date()): string {
  const jours = Number.isFinite(n) ? Math.min(365, Math.max(0, Math.round(n))) : 14;
  return jourLocal(new Date(maintenant.getTime() + jours * 86400_000));
}

const PRIORITES: Record<string, "haute" | "moyenne" | "basse"> = {
  haute: "haute", urgente: "haute", urgent: "haute", critique: "haute", elevee: "haute", "élevée": "haute", high: "haute",
  moyenne: "moyenne", normale: "moyenne", medium: "moyenne", normal: "moyenne",
  basse: "basse", faible: "basse", low: "basse",
};

/** Les trois priorites que l'application connait ; le reste devient « moyenne ». */
export function prioriteTache(v: unknown): "haute" | "moyenne" | "basse" {
  return (typeof v === "string" && PRIORITES[v.trim().toLowerCase()]) || "moyenne";
}
