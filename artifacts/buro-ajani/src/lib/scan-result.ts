/**
 * Suivi du verdict antivirus apres l'enregistrement d'un document (Tache #175).
 *
 * Pendant de la logique mobile (`artifacts/mobile/lib/scan-result.ts`, Tache
 * #164) cote web. Quand l'utilisateur enregistre une piece jointe Gmail ou
 * importe un fichier Drive depuis l'app web, le backend lance une analyse
 * antivirus en arriere-plan (voir `document-ingest.ts` ->
 * `scanDocumentInBackground`). Le verdict (`safe` / `dangerous`) est ensuite
 * ecrit sur le document.
 *
 * Cette fonction sonde `GET /api/documents/:id` jusqu'a ce que `scanVerdict`
 * soit renseigne, puis affiche un toast de suivi a l'utilisateur. Les
 * resultats dangereux sont clairement mis en avant (toast destructif).
 *
 * La fonction est volontairement « fire-and-forget » : on ne bloque pas l'UI
 * pendant l'attente. En cas de timeout (analyse trop longue), on reste
 * silencieux — le toast initial « analyse en cours » a deja informe
 * l'utilisateur, et la page Documents affiche le badge definitif.
 */

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 20; // ~30 s au total

type ToastFn = (opts: {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}) => void;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sonde le verdict d'analyse d'un document puis affiche un toast de suivi.
 *
 * @param toast      fonction toast (hook `useToast`)
 * @param documentId id du document retourne par l'endpoint d'enregistrement
 * @param fileName   nom du fichier (pour les messages utilisateur)
 */
export async function trackScanResult(
  toast: ToastFn,
  documentId: number | string,
  fileName: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await wait(POLL_INTERVAL_MS);
    try {
      const res = await fetch(`${baseUrl}/api/documents/${documentId}`, {
        credentials: "include",
      });
      if (!res.ok) continue;
      const doc = (await res.json()) as {
        scanVerdict?: string | null;
        scanDetail?: string | null;
      };
      const verdict = doc?.scanVerdict;

      if (verdict === "safe") {
        toast({
          title: "Analyse antivirus terminée",
          description: `${fileName} : aucune menace détectée. Le fichier est sûr.`,
        });
        return;
      }
      if (verdict === "dangerous") {
        const detail =
          doc?.scanDetail && doc.scanDetail.trim() !== ""
            ? ` Détail : ${doc.scanDetail}`
            : "";
        toast({
          title: "Menace détectée",
          description:
            `ATTENTION : ${fileName} a été signalé comme DANGEREUX par l'analyse antivirus. ` +
            `N'ouvrez pas ce fichier.${detail}`,
          variant: "destructive",
        });
        return;
      }
      // verdict null/none -> analyse encore en cours, on continue a sonder.
    } catch {
      // Erreur reseau transitoire : on retente au prochain tour.
    }
  }
  // Timeout : on reste silencieux (le toast initial et le badge Documents suffisent).
}
