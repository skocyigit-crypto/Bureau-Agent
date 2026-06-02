/**
 * Suivi du verdict antivirus apres l'enregistrement d'un document (Tache #164).
 *
 * Quand l'utilisateur enregistre une piece jointe Gmail ou importe un fichier
 * Drive depuis le mobile, le backend lance une analyse antivirus en arriere-plan
 * (voir `document-ingest.ts` -> `scanDocumentInBackground`). Le verdict
 * (`safe` / `dangerous`) est ensuite ecrit sur le document.
 *
 * Cette fonction sonde `GET /api/documents/:id` jusqu'a ce que `scanVerdict`
 * soit renseigne, puis affiche une alerte de suivi a l'utilisateur. Les
 * resultats dangereux sont clairement mis en avant.
 *
 * La fonction est volontairement « fire-and-forget » : on ne bloque pas l'UI
 * pendant l'attente. En cas de timeout (analyse trop longue), on reste
 * silencieux — l'alerte initiale « analyse en cours » a deja informe
 * l'utilisateur, et l'ecran Documents affiche le badge definitif.
 */
import { Alert } from "react-native";
import { API_BASE } from "./api-config";

type FetchAuth = (url: string, options?: RequestInit) => Promise<Response>;

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 20; // ~30 s au total

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sonde le verdict d'analyse d'un document puis affiche une alerte de suivi.
 *
 * @param fetchAuth  helper authentifie du contexte Auth
 * @param documentId id du document retourne par l'endpoint d'enregistrement
 * @param fileName   nom du fichier (pour les messages utilisateur)
 */
export async function trackScanResult(
  fetchAuth: FetchAuth,
  documentId: number | string,
  fileName: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await wait(POLL_INTERVAL_MS);
    try {
      const res = await fetchAuth(`${API_BASE}/api/documents/${documentId}`);
      if (!res.ok) continue;
      const doc = (await res.json()) as {
        scanVerdict?: string | null;
        scanDetail?: string | null;
      };
      const verdict = doc?.scanVerdict;

      if (verdict === "safe") {
        Alert.alert(
          "Analyse antivirus terminee",
          `${fileName} : aucune menace detectee. Le fichier est sur.`,
        );
        return;
      }
      if (verdict === "dangerous") {
        const detail =
          doc?.scanDetail && doc.scanDetail.trim() !== ""
            ? `\n\nDetail : ${doc.scanDetail}`
            : "";
        Alert.alert(
          "Menace detectee",
          `ATTENTION : ${fileName} a ete signale comme DANGEREUX par l'analyse antivirus. ` +
            `N'ouvrez pas ce fichier.${detail}`,
        );
        return;
      }
      // verdict null/none -> analyse encore en cours, on continue a sonder.
    } catch {
      // Erreur reseau transitoire : on retente au prochain tour.
    }
  }
  // Timeout : on reste silencieux (l'alerte initiale et le badge Documents suffisent).
}
