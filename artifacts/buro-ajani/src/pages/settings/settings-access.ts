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