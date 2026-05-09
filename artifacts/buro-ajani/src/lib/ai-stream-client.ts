export interface SseHandlers {
  onEvent: (event: string, data: any) => void;
  signal: AbortSignal;
}

export async function streamSse(path: string, body: any, handlers: SseHandlers): Promise<void> {
  const url = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    credentials: "include",
    body: JSON.stringify(body),
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(errText || `Erreur ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
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
      try { handlers.onEvent(event, JSON.parse(dataStr)); } catch { handlers.onEvent(event, dataStr); }
    }
  }
}
