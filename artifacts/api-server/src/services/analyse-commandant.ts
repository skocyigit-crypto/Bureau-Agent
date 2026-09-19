/**
 * Mettre en forme ce qu'un modele a repondu, avant de l'envoyer a un ecran.
 *
 * `/commandant/overdue-reminders` renvoyait `aiAnalysis: parsed`, c'est-a-dire
 * le JSON du modele tel quel — et, quand ce JSON etait illisible, un objet de
 * repli qui ne porte QUE `dailySummary` :
 *
 *     catch { parsed = { dailySummary: aiResponse }; }
 *
 * Les ecrans, eux, font `data.aiAnalysis.criticalAlerts.map(...)`. Sur ce
 * chemin de repli — un modele qui repond en prose, une reponse tronquee, une
 * limite de jetons atteinte : rien d'exceptionnel — la lecture porte sur
 * `undefined`, et c'est une TypeError pendant le rendu. L'ecran entier tombe,
 * pas seulement la section.
 *
 * Un modele n'est pas une source de donnees de confiance : ce qu'il rend se
 * normalise avant d'etre transmis, comme n'importe quelle entree exterieure.
 * La promesse faite a l'ecran (« ces quatre listes existent ») est donc tenue
 * ici, une fois, plutot que verifiee a chaque point d'affichage.
 */
export interface AnalyseCommandant {
  dailySummary: string;
  criticalAlerts: string[];
  taskReminders: unknown[];
  invoiceReminders: unknown[];
  eventReminders: unknown[];
}

function liste(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Les alertes sont AFFICHEES comme du texte: ce qui n'en est pas est ecarte. */
function alertes(v: unknown): string[] {
  return liste(v)
    .map((a) => (typeof a === "string" ? a : a == null ? "" : String(a)))
    .filter((a) => a.trim().length > 0);
}

export function normaliserAnalyse(brut: unknown): AnalyseCommandant {
  const o = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  return {
    // Un resume absent vaut une chaine vide, pas « undefined » affiche tel quel.
    dailySummary: typeof o.dailySummary === "string" ? o.dailySummary : "",
    criticalAlerts: alertes(o.criticalAlerts),
    taskReminders: liste(o.taskReminders),
    invoiceReminders: liste(o.invoiceReminders),
    eventReminders: liste(o.eventReminders),
  };
}

/**
 * Meme precaution pour l'assistance en appel.
 *
 * Le repli de `safeJsonParse` fournit bien `suggestedResponses: []` — mais il
 * ne sert QUE si le JSON est illisible. Un modele qui rend un JSON valide en
 * oubliant la cle passe a travers, et l'ecran fait alors
 * `data.aiResponse.suggestedResponses.map(...)` sur `undefined`.
 */
export interface ReponseAppel {
  greeting: string;
  suggestedResponses: string[];
  recommendedActions: unknown[];
}

export function normaliserReponseAppel(brut: unknown): ReponseAppel {
  const o = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  return {
    greeting: typeof o.greeting === "string" ? o.greeting : "",
    // Affichees telles quelles: ce qui n'est pas du texte n'a rien a y faire.
    suggestedResponses: alertes(o.suggestedResponses),
    recommendedActions: liste(o.recommendedActions),
  };
}
