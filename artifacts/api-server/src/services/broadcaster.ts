import type { Response } from "express";

export type SyncEventType =
  | "call" | "task" | "contact" | "message" | "checkin"
  | "calendar" | "prospect" | "note" | "projet" | "dashboard"
  | "reminder"
  | "ping";

export interface SyncEvent {
  type: SyncEventType;
  action: "created" | "updated" | "deleted" | "ping";
  resourceId?: number;
  triggeredBy?: number;
  meta?: Record<string, unknown>;
  ts: number;
}

class Broadcaster {
  private clients = new Map<number, Set<Response>>();

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
    const orgClients = this.clients.get(orgId);
    if (!orgClients || orgClients.size === 0) return;

    const payload: SyncEvent = { ...event, ts: Date.now() };
    const data = `data: ${JSON.stringify(payload)}\n\n`;

    for (const res of orgClients) {
      try {
        res.write(data);
      } catch {
        orgClients.delete(res);
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
