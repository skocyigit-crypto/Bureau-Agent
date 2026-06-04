import type { Response } from "express";

export type SyncEventType =
  | "call" | "task" | "contact" | "message" | "checkin"
  | "calendar" | "prospect" | "note" | "projet" | "dashboard"
  | "reminder"
  | "security"
  | "whatsapp"
  | "ping";

export interface SyncEvent {
  type: SyncEventType;
  action: "created" | "updated" | "deleted" | "ping";
  resourceId?: number;
  triggeredBy?: number;
  meta?: Record<string, unknown>;
  ts: number;
}

// Écouteur d'événements serveur-à-serveur (différent des clients SSE navigateur).
// Sert au fan-out vers les webhooks sortants : appelé pour CHAQUE événement émis,
// même quand aucun client SSE n'est connecté.
type EventListener = (orgId: number, event: SyncEvent) => void;

class Broadcaster {
  private clients = new Map<number, Set<Response>>();
  private listeners = new Set<EventListener>();

  // Enregistre un écouteur process-local (ex: service webhook). Retourne une
  // fonction de désinscription. Les écouteurs doivent être non-bloquants et
  // gérer leurs propres erreurs (toute exception est isolée ci-dessous).
  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribe(orgId: number, res: Response): () => void {
    if (!this.clients.has(orgId)) {
      this.clients.set(orgId, new Set());
    }
    this.clients.get(orgId)!.add(res);

    return () => {
      const orgClients = this.clients.get(orgId);
      if (orgClients) {
        orgClients.delete(res);
        if (orgClients.size === 0) this.clients.delete(orgId);
      }
    };
  }

  broadcast(orgId: number, event: Omit<SyncEvent, "ts">, excludeUserId?: number): void {
    const payload: SyncEvent = { ...event, ts: Date.now() };

    // 1) Diffusion temps réel aux clients SSE navigateur de l'organisation.
    const orgClients = this.clients.get(orgId);
    if (orgClients && orgClients.size > 0) {
      const data = `data: ${JSON.stringify(payload)}\n\n`;
      for (const res of orgClients) {
        try {
          res.write(data);
        } catch {
          orgClients.delete(res);
        }
      }
    }

    // 2) Fan-out aux écouteurs process-local (webhooks sortants). DOIT s'exécuter
    // même sans client SSE connecté, et ne doit JAMAIS jeter dans le chemin
    // d'émission de l'événement (chaque écouteur est isolé).
    for (const listener of this.listeners) {
      try {
        listener(orgId, payload);
      } catch {
        // Un écouteur défaillant ne doit pas casser la diffusion.
      }
    }
  }

  connectionCount(orgId: number): number {
    return this.clients.get(orgId)?.size ?? 0;
  }

  totalConnections(): number {
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }
}

export const broadcaster = new Broadcaster();
