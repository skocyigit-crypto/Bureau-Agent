/**
 * Cible de navigation d'une notification (locale ou push distante).
 *
 * Cette logique vit ici, hors de `app/_layout.tsx`, pour deux raisons :
 *  - c'est une frontiere de securite : le payload d'une notification est une
 *    entree externe, et sans liste blanche il pourrait envoyer l'utilisateur
 *    vers une route arbitraire de l'app;
 *  - c'est du pur calcul, donc testable — `_layout.tsx` ne l'est pas
 *    (dependances React Native / Expo au chargement du module).
 */

/** Routes qu'une notification est autorisee a ouvrir. */
export const ALLOWED_NOTIFICATION_ROUTES: ReadonlySet<string> = new Set([
  "/messages",
  "/(tabs)/tasks",
  "/(tabs)/calls",
  // Rappels imminents (evenement SSE "reminder") -> ecran calendrier.
  "/calendar",
  // Rappels "tache en retard" / "projet en retard".
  "/tasks",
  "/projets",
  // Alerte de menace documentaire -> liste des documents, filtree via `scan`.
  "/documents",
  // Action IA en attente de validation (evenement "proposition") -> file
  // d'approbation, seul endroit ou le dirigeant peut trancher.
  "/file-approbation",
]);

/** Longueur max du filtre de liste relaye (`scan`) — borne anti-abus. */
const MAX_SCAN_LENGTH = 32;

export interface NotificationTarget {
  pathname: string;
  resourceId?: number;
  scan?: string;
}

export interface NotificationData {
  route?: unknown;
  resourceId?: unknown;
  scan?: unknown;
}

/**
 * Traduit le payload `data` d'une notification en cible de navigation.
 * Renvoie null si la route est absente, non-textuelle ou hors liste blanche.
 *
 * `resourceId` accepte le nombre comme la chaine : les notifications locales
 * posent un nombre, tandis que le transport push distant serialise en JSON et
 * peut rendre une chaine. Sans cette tolerance, le tap sur une notification
 * push ouvrait la liste au lieu de la ressource concernee.
 */
export function extractNotificationTarget(
  data: NotificationData | undefined | null,
): NotificationTarget | null {
  const route = data?.route;
  if (typeof route !== "string" || !ALLOWED_NOTIFICATION_ROUTES.has(route)) return null;

  let resourceId: number | undefined;
  if (typeof data?.resourceId === "number" && Number.isFinite(data.resourceId)) {
    resourceId = data.resourceId;
  } else if (typeof data?.resourceId === "string") {
    const parsed = parseInt(data.resourceId, 10);
    if (Number.isFinite(parsed)) resourceId = parsed;
  }

  let scan: string | undefined;
  if (
    typeof data?.scan === "string" &&
    data.scan.length > 0 &&
    data.scan.length <= MAX_SCAN_LENGTH
  ) {
    scan = data.scan;
  }

  return { pathname: route, resourceId, scan };
}
