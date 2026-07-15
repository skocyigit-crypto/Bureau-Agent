// L'application reelle (buro-ajani) est servie sur un sous-domaine separe de
// ce site vitrine (agentdebureau.fr) — cf. le load balancer HTTPS mis en
// place pour app.agentdebureau.fr. Toute action "essai gratuit"/"connexion"
// doit donc pointer vers cette origine externe, pas vers une route interne
// au routeur de ce site.
export const APP_URL = "https://app.agentdebureau.fr";
export const REGISTER_URL = `${APP_URL}/register`;
