// L'application reelle (buro-ajani) est servie sur un sous-domaine separe de
// ce site vitrine (agentdebureau.fr) — cf. le load balancer HTTPS mis en
// place pour app.agentdebureau.fr. Toute action "essai gratuit"/"connexion"
// doit donc pointer vers cette origine externe, pas vers une route interne
// au routeur de ce site.
export const APP_URL = "https://app.agentdebureau.fr";
export const REGISTER_URL = `${APP_URL}/register`;

/**
 * Lien d'inscription portant le plan choisi.
 *
 * Les cartes de tarifs envoyaient toutes vers la meme page: le visiteur
 * cliquait « Starter » ou « Professionnel » et son choix disparaissait. L'essai
 * reste le meme pour tous — c'est ce que les cartes annoncent — mais l'intention
 * est transmise, affichee sur le formulaire, puis consignee au moment de la
 * creation du compte.
 */
export function registerUrlForPlan(plan: "starter" | "professionnel"): string {
  return `${REGISTER_URL}?plan=${plan}`;
}
