/**
 * Ce que chaque plan donne vraiment.
 *
 * Mesure du 18/09 : `aiEnabled`, `stockEnabled` et `automationEnabled` etaient
 * ecrits en base a la souscription, affiches en badges dans l'espace client —
 * et lus par personne. Aucun middleware, aucune route ne les consultait. Deux
 * consequences opposees, toutes deux fausses :
 *
 *  - le plan Starter (29 EUR) accedait a tout ce que le plan Professionnel
 *    (79 EUR) facture. L'echelle de prix n'avait aucune traduction technique,
 *    ce qui, pour un produit mis en vente, est autant un probleme de valeur
 *    qu'un probleme de verite ;
 *  - a l'inverse, l'ecran d'abonnement annoncait « IA inactive » a l'essai,
 *    alors que les ecrans d'IA fonctionnaient. Le logiciel se decrivait mal
 *    lui-meme.
 *
 * SOURCE DE VERITE : `PLANS[sub.plan]`, pas les colonnes.
 *
 * Les colonnes ne sont qu'une photographie de `PLANS` prise au moment de
 * l'ecriture — rien dans ce depot ne les modifie ensuite, et aucune route ne
 * permet de les regler organisation par organisation. Les lire ferait donc
 * dependre les droits d'aujourd'hui d'une copie figee hier : les comptes
 * existants resteraient bloques sur l'ancienne definition du plan, et il
 * faudrait une migration de donnees a chaque ajustement d'offre. En cas de
 * plan inconnu, on n'invente rien : aucune fonction n'est ouverte.
 */

import { PLANS, type PlanKey } from "@workspace/db";

export type FonctionPayante = "ia" | "stock" | "automations";

/**
 * Chemins couverts par une fonction payante.
 *
 * Le prefixe est compare a `req.originalUrl`, comme le fait deja
 * `licenseCheck`. La liste est VOLONTAIREMENT explicite : ouvrir par defaut
 * ce qui n'y figure pas est le seul comportement sur lequel on peut revenir
 * sans casser un client — l'inverse bloque un ecran sans que personne ne
 * l'ait decide.
 */
export const CHEMINS_PAR_FONCTION: Record<FonctionPayante, string[]> = {
  ia: [
    "/api/ai",
    "/api/commandant",
    "/api/document-ai",
    "/api/voice",
    "/api/smart-reports",
    "/api/discovery",
    "/api/instant-answer",
  ],
  stock: [
    "/api/stock",
    "/api/inventaire",
  ],
  automations: [
    "/api/automations",
    "/api/autopilot",
  ],
};

/** La fonction dont ce chemin releve, ou `null` s'il est inclus partout. */
export function fonctionRequise(chemin: string): FonctionPayante | null {
  for (const [fonction, prefixes] of Object.entries(CHEMINS_PAR_FONCTION) as [FonctionPayante, string[]][]) {
    if (prefixes.some((p) => chemin === p || chemin.startsWith(p + "/") || chemin.startsWith(p + "?"))) {
      return fonction;
    }
  }
  return null;
}

/** Le plan ouvre-t-il cette fonction ? */
export function planOuvre(plan: string, fonction: FonctionPayante): boolean {
  const config = PLANS[plan as PlanKey];
  if (!config) return false;
  if (fonction === "ia") return config.aiEnabled;
  if (fonction === "stock") return config.stockEnabled;
  return config.automationEnabled;
}

const MESSAGES: Record<FonctionPayante, string> = {
  ia: "L'assistant et les analyses par intelligence artificielle ne sont pas inclus dans votre plan.",
  stock: "Le suivi de stock n'est pas inclus dans votre plan.",
  automations: "Les automatisations ne sont pas inclus dans votre plan.",
};

export interface VerdictFonction {
  allowed: boolean;
  reason?: string;
  message?: string;
}

/**
 * Verdict pour un chemin donne. Le refus nomme la fonction manquante : un
 * « acces refuse » sans motif envoie le client au support, alors que la seule
 * chose a lui dire est quel plan la contient.
 */
export function accesFonction(plan: string, chemin: string): VerdictFonction {
  const fonction = fonctionRequise(chemin);
  if (!fonction) return { allowed: true };
  if (planOuvre(plan, fonction)) return { allowed: true };
  return {
    allowed: false,
    reason: `fonction_non_incluse:${fonction}`,
    message: `${MESSAGES[fonction]} Choisissez un plan qui l'inclut depuis votre espace d'abonnement.`,
  };
}
