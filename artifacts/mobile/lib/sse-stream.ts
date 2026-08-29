import { fetch as expoFetch } from "expo/fetch";
import { MOBILE_APP_ORIGIN } from "@/lib/api-config";
import { decodeSseData, parseSseBuffer } from "@/lib/sse-parser";

export interface SseHandlers {
  onEvent: (event: string, data: any) => void;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * Plafond du tampon d'evenement non delimite.
 *
 * `parseSseBuffer` ne rend un evenement qu'apres `\n\n`. Un flux qui n'envoie
 * jamais ce delimiteur — reponse mal formee, proxy qui reecrit le corps — fait
 * grossir le tampon sans limite: sur mobile cela finit en manque de memoire,
 * c'est-a-dire un plantage de l'app plutot qu'une erreur exploitable. On
 * s'arrete donc net avec un message clair. La borne est tres au-dessus de tout
 * evenement legitime (le serveur emet des fragments de reponse, pas des
 * megaoctets d'un bloc).
 */
const MAX_BUFFER_CHARS = 1_000_000;

export async function streamSse(
  url: string,
  body: any,
  handlers: SseHandlers,
): Promise<void> {
  // Origin est injecte ici (pas seulement par l'appelant) car les builds
  // natifs ne l'envoient jamais eux-memes — son absence fait 403 cote
  // serveur. Defense structurelle: un futur appel a streamSse() ne peut
  // plus oublier cet en-tete.
  const res = await expoFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Origin: MOBILE_APP_ORIGIN,
      ...(handlers.headers ?? {}),
    },
    body: JSON.stringify(body ?? {}),
    signal: handlers.signal as any,
  });

  if (!res.ok || !res.body) {
    let errText = "";
    try { errText = await res.text(); } catch {}
    throw new Error(errText || `Erreur ${res.status}`);
  }

  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (handlers.signal?.aborted) break;
      const { value, done } = await reader.read();
      // Rien a vidanger a la fin: le tampon est analyse apres chaque morceau,
      // donc il ne peut rester ici qu'un evenement incomplet — et un caractere
      // multi-octets coupe est toujours complete par le morceau suivant,
      // puisque le delimiteur `\n\n` qui clot un evenement est en ASCII.
      if (done) break;
      if (handlers.signal?.aborted) break;
      buffer += decoder.decode(value, { stream: true });

      // Decoupage et decodage: logique pure, testee dans `@/lib/sse-parser`.
      const { events, rest } = parseSseBuffer(buffer);
      buffer = rest;
      for (const { event, data } of events) {
        if (handlers.signal?.aborted) break;
        handlers.onEvent(event, decodeSseData(data));
      }

      if (buffer.length > MAX_BUFFER_CHARS) {
        throw new Error(
          "Flux SSE invalide: aucun evenement complet recu, reponse interrompue.",
        );
      }
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
}
