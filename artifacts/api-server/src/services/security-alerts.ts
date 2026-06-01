// Alertes de securite temps reel. Sur detection d'une menace DANGEREUSE
// (lien, fichier, message WhatsApp, appel, email), on:
//   1. journalise l'alerte dans un buffer memoire court par organisation;
//   2. pousse un evenement SSE temps reel (broadcaster) pour rafraichir les UI;
//   3. (optionnel) notifie les membres via WhatsApp/push (notifyOrgUsers).
//
// Tout est fail-soft: une alerte ne doit jamais casser le flux qui l'emet
// (un scan, un webhook Twilio, etc.). Buffer in-memory volontaire, aligne sur
// security-scans.ts (pas de migration DB pour cette couche).

import { broadcaster } from "./broadcaster";
import { notifyOrgUsers } from "./whatsapp-notify";
import { logger } from "../lib/logger";
import type { ScanKind, ScanVerdict } from "./security-scans";

export interface SecurityAlert {
  id: string;
  orgId: number;
  kind: ScanKind;
  verdict: ScanVerdict;
  target: string;
  message: string;
  at: string;
}

const MAX_ALERTS_PER_ORG = 100;
// Borne dure du nombre d'organisations gardees en memoire (eviction LRU).
// Evite une croissance illimitee du keyspace sur un process long-lived.
const MAX_ORGS = 2000;
// Fenetre de regroupement des notifications WhatsApp par org: au plus une
// notif push par org et par fenetre, pour eviter le spam lors d'une rafale
// (ex: 5 fichiers dangereux dans un seul message WhatsApp). Le buffer et le
// flux SSE temps reel ne sont JAMAIS limites — seul le push externe l'est.
const WHATSAPP_THROTTLE_MS = 60_000;

const alertsByOrg = new Map<number, SecurityAlert[]>();
const lastWhatsAppByOrg = new Map<number, number>();

/** Rafraichit la recence d'une org (LRU) et evince les plus anciennes au besoin. */
function touchOrg(orgId: number, list: SecurityAlert[]): void {
  // Re-inserer en fin de Map pour materialiser l'ordre d'usage.
  alertsByOrg.delete(orgId);
  alertsByOrg.set(orgId, list);
  while (alertsByOrg.size > MAX_ORGS) {
    const oldest = alertsByOrg.keys().next().value;
    if (oldest === undefined) break;
    alertsByOrg.delete(oldest);
    lastWhatsAppByOrg.delete(oldest);
  }
}

const KIND_LABEL: Record<ScanKind, string> = {
  url: "Lien",
  file: "Fichier",
  whatsapp: "Message WhatsApp",
  call: "Appel",
  email: "Email",
};

export function getRecentAlerts(orgId: number, limit = 20): SecurityAlert[] {
  const list = alertsByOrg.get(orgId) ?? [];
  return list.slice(-limit).reverse();
}

/**
 * Emet une alerte de securite. N'agit que sur les verdicts "dangerous"
 * (les "suspicious" restent dans le journal de scans sans alerter). Renvoie
 * l'alerte creee, ou null si aucun verdict dangereux.
 */
export function emitSecurityAlert(input: {
  orgId: number;
  kind: ScanKind;
  verdict: ScanVerdict;
  target: string;
  detail?: string;
  /** Notifier les membres via WhatsApp (par defaut false: l'utilisateur est souvent deja devant l'ecran). */
  notifyWhatsApp?: boolean;
  excludeUserId?: number | null;
}): SecurityAlert | null {
  if (input.verdict !== "dangerous") return null;

  const label = KIND_LABEL[input.kind] ?? "Element";
  const base = `Alerte securite — ${label} dangereux detecte : ${input.target}`;
  const alert: SecurityAlert = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    orgId: input.orgId,
    kind: input.kind,
    verdict: input.verdict,
    target: input.target.slice(0, 300),
    message: (input.detail ? `${base} (${input.detail})` : base).slice(0, 400),
    at: new Date().toISOString(),
  };

  const list = alertsByOrg.get(input.orgId) ?? [];
  list.push(alert);
  if (list.length > MAX_ALERTS_PER_ORG) list.splice(0, list.length - MAX_ALERTS_PER_ORG);
  touchOrg(input.orgId, list);

  // SSE temps reel (fail-soft) — jamais limite.
  try {
    broadcaster.broadcast(input.orgId, {
      type: "security",
      action: "created",
      meta: {
        kind: alert.kind,
        verdict: alert.verdict,
        target: alert.target,
        message: alert.message,
      },
    });
  } catch (err) {
    logger.warn({ err, orgId: input.orgId }, "[security-alerts] broadcast SSE echoue");
  }

  // Notification WhatsApp/push aux membres (fail-soft, non bloquant), avec
  // regroupement par org pour eviter le spam lors d'une rafale de menaces.
  if (input.notifyWhatsApp) {
    const now = Date.now();
    const last = lastWhatsAppByOrg.get(input.orgId) ?? 0;
    if (now - last >= WHATSAPP_THROTTLE_MS) {
      lastWhatsAppByOrg.set(input.orgId, now);
      void notifyOrgUsers(input.orgId, alert.message, "message", input.excludeUserId ?? undefined).catch(
        (err) => logger.warn({ err, orgId: input.orgId }, "[security-alerts] notif WhatsApp echouee"),
      );
    }
  }

  return alert;
}
