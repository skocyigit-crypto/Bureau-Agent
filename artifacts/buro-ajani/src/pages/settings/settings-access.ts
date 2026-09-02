export function getAvailableSettingsTabs(isAdmin: boolean, isSuperAdmin: boolean) {
  return [
    ...(isAdmin ? ["profil", "abonnement", "equipe", "google"] : []),
    "appels",
    ...(isAdmin ? ["sauvegardes"] : []),
    "preferences-ia",
    "installation",
    "notifications",
    ...(isAdmin ? ["securite", "intelligence-artificielle", "api-webhooks", "email-expediteur", "cles-ia"] : []),
    ...(isSuperAdmin ? ["mises-a-jour"] : []),
  ] as const;
}

/**
 * Onglet demande par l'URL (`/parametres?tab=abonnement`). Les banniere d'essai
 * et de licence, ainsi que les insights serveur, pointent vers un onglet precis:
 * sans cette resolution l'utilisateur atterrissait sur "profil" et devait
 * retrouver l'onglet a la main, juste au moment ou on lui demande de payer.
 *
 * Un onglet inconnu — ou interdit pour son role — retombe sur `fallback`
 * plutot que d'afficher un onglet vide.
 */
export function resolveSettingsTabFromQuery(
  search: string,
  available: readonly string[],
  fallback: string,
): string {
  let requested: string | null = null;
  try {
    requested = new URLSearchParams(search).get("tab");
  } catch {
    return fallback;
  }
  if (!requested) return fallback;
  return available.includes(requested) ? requested : fallback;
}