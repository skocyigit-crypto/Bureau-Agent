import { fetch as expoFetch } from "expo/fetch";
import { MOBILE_APP_ORIGIN } from "@/lib/api-config";

export interface SseHandlers {
  onEvent: (event: string, data: any) => void;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

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
      if (done) break;
      if (handlers.signal?.aborted) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!block.trim() || block.startsWith(":")) continue;
        let event = "message";
        let dataStr = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        if (handlers.signal?.aborted) break;
        try {
          handlers.onEvent(event, JSON.parse(dataStr));
        } catch (err) {
          // Donnee SSE non-JSON: on la transmet en texte brut mais on
          // trace le parse rate pour ne pas masquer un format inattendu.
          console.warn(`[sse-stream] payload "${event}" non-JSON, transmis en texte brut:`, err);
          handlers.onEvent(event, dataStr);
        }
      }
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
}
