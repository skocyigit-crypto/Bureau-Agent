import type { Response } from "express";

export type SyncEventType =
  | "call" | "task" | "contact" | "message" | "checkin"
  | "calendar" | "prospect" | "note" | "projet" | "dashboard"
  | "reminder"
  | "security"
  // Une action IA vient d'entrer dans la file d'approbation. Sans cet
  // évènement, la supervision humaine dépendait entièrement du fait que
  // quelqu'un ouvre l'écran: une proposition non vue expirait au bout de
  // 14 jours sans que personne n'ait jamais su qu'elle existait.
  | "proposition"
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

  /**
   * Écouteur du bus inter-instances (branché au démarrage). Reçoit chaque
   * évènement émis pour qu'il atteigne aussi les navigateurs connectés aux
   * AUTRES instances.
   */
  private relay: ((orgId: number, event: SyncEvent, excludeUserId?: number) => void) | null = null;

  setRelay(relay: ((orgId: number, event: SyncEvent, excludeUserId?: number) => void) | null): void {
    this.relay = relay;
  }

  /**
   * Évènement né sur une AUTRE instance. Il ne va qu'aux clients SSE: les
   * écouteurs serveur (push mobile, webhooks sortants) ont déjà tourné sur
   * l'instance d'origine, et les rejouer ici enverrait la même notification
   * autant de fois qu'il y a d'instances.
   */
  dispatchRemote(orgId: number, event: SyncEvent): void {
    this.writeToClients(orgId, event);
  }

  // `excludeUserId` n'est pas filtre ici, et ne l'a jamais ete: un client SSE
  // est identifie par sa reponse HTTP, pas par un utilisateur. Le champ reste
  // dans la signature publique parce que les appelants le passent deja.
  private writeToClients(orgId: number, payload: SyncEvent): void {
    const orgClients = this.clients.get(orgId);
    if (!orgClients || orgClients.size === 0) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of orgClients) {
      try {
        res.write(data);
      } catch {
        orgClients.delete(res);
      }
    }
  }

  broadcast(orgId: number, event: Omit<SyncEvent, "ts">, excludeUserId?: number): void {
    const payload: SyncEvent = { ...event, ts: Date.now() };

    // 1) Diffusion temps réel aux clients SSE navigateur de l'organisation.
    this.writeToClients(orgId, payload);

    // 1bis) Les navigateurs des autres instances. Sans ce relai, l'affinité de
    // session ne suffisait pas: elle colle un navigateur à une instance, mais
    // l'évènement naît là où arrive le webhook, le cron ou l'action du
    // collègue — donc souvent ailleurs.
    if (this.relay) {
      try {
        this.relay(orgId, payload, excludeUserId);
      } catch {
        // Le temps réel des autres instances ne doit jamais casser celui-ci.
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
