// Logique de decision (pure, sans React/RN) du scan antivirus en lot, partagee
// entre l'UI et ses tests. Le scan a deux modes qui partagent le meme etat
// bulkScan* : "selected" = flux SSE sur une selection, "all" = scan "Tout
// analyser" lance en arriere-plan. L'annulation doit appeler le bon endpoint
// selon ce mode, et le bouton « Annuler » du scan « Tout analyser » ne doit
// s'afficher que pendant ce scan. Verrouiller ces decisions ici evite une
// regression silencieuse du probleme « je clique stop mais rien ne se passe ».

export type BulkScanKind = "selected" | "all" | null;

/**
 * Endpoint d'annulation a appeler selon le type de scan en cours :
 *   - "all"      -> arrete le job « Tout analyser » en arriere-plan ;
 *   - "selected" -> arrete le scan SSE de la selection ;
 *   - null       -> aucun scan, rien a annuler.
 */
export function bulkScanCancelEndpoint(kind: BulkScanKind): string | null {
  if (kind === "all") return "/api/documents/scan-unscanned/cancel";
  if (kind === "selected") return "/api/documents/bulk/scan/cancel";
  return null;
}

/**
 * Le bouton « Annuler » dedie au scan « Tout analyser » ne s'affiche que pendant
 * ce scan precis (pas pendant un scan de selection ni a l'arret).
 */
export function showAllScanCancel(state: {
  bulkScanning: boolean;
  bulkScanKind: BulkScanKind;
}): boolean {
  return state.bulkScanning && state.bulkScanKind === "all";
}

/**
 * Une demande d'annulation n'est valable que si un scan tourne et qu'on n'a pas
 * deja demande l'arret (anti double-clic / no-op quand rien ne tourne).
 */
export function canRequestCancel(state: {
  bulkScanning: boolean;
  bulkScanCancelling: boolean;
}): boolean {
  return state.bulkScanning && !state.bulkScanCancelling;
}
