/**
 * webhook-service.ts — Moteur de webhooks sortants génériques (Faz 1).
 *
 * Rôle :
 *  1) FAN-OUT : s'abonne au flux d'événements interne (broadcaster.onEvent) et,
 *     pour chaque événement métier d'une organisation, crée une livraison
 *     (webhook_deliveries) par endpoint actif souscrit, puis tente la livraison
 *     immédiatement (HTTP POST signé HMAC-SHA256).
 *  2) RETRY : un worker périodique rejoue les livraisons en échec selon un
 *     backoff exponentiel, jusqu'à maxAttempts, puis abandonne (status=failed).
 *  3) CIRCUIT BREAKER : un endpoint durablement injoignable
 *     (failureCount >= seuil) est désactivé automatiquement.
 *
 * Sécurité :
 *  - Le secret de signature est CHIFFRÉ au repos (lib/crypto) et déchiffré juste
 *    avant l'envoi ; il n'est jamais journalisé.
 *  - Signature façon Stripe : HMAC-SHA256 sur `${timestampSec}.${body}` —
 *    le timestamp dans le calcul permet au receveur de rejeter les rejeux.
 *  - Isolation multi-tenant : les requêtes sont scoppées par organisation_id et
 *    la FK composite en base interdit déjà tout couplage cross-tenant.
 *
 * Hypothèse mono-instance (un seul process) : voir billing-cron pour le pattern
 * advisory lock si l'on passe à un déploiement multi-instances.
 */

import crypto from "crypto";
import { and, or, eq, lte, lt, arrayOverlaps, inArray, sql } from "drizzle-orm";
import {
  db,
  webhookEndpointsTable,
  webhookDeliveriesTable,
  type WebhookEndpoint,
  type WebhookDelivery,
} from "@workspace/db";
import { decryptSensitiveData } from "../lib/crypto";
import { assertSafePublicUrl } from "../lib/ssrf-guard";
import { logger } from "../lib/logger";
import { broadcaster, type SyncEvent } from "./broadcaster";

const DELIVERY_TIMEOUT_MS = 10_000; // budget par tentative HTTP
const RETRY_TICK_MS = 60_000; // le worker scanne la file chaque minute
const RETRY_INITIAL_DELAY_MS = 30_000; // 1er scan différé après le boot
const BACKOFF_BASE_SEC = 60; // 1re retentative ~1 min après l'échec
const MAX_BACKOFF_SEC = 6 * 60 * 60; // plafond du backoff : 6 h
const CIRCUIT_BREAKER_THRESHOLD = 15; // échecs consécutifs avant désactivation
const RETRY_BATCH = 50; // livraisons traitées par tick
const STALE_PENDING_MS = 2 * 60 * 1000; // filet de sécurité crash : pending orphelin
const MAX_STORED_BODY = 1000; // tronquage des corps/erreurs stockés
const USER_AGENT = "AgentDeBureau-Webhooks/1";

// Enveloppe JSON effectivement envoyée à l'endpoint (et stockée dans payload).
interface WebhookEnvelope extends Record<string, unknown> {
  id: string;
  event: string;
  created: number; // timestamp UNIX en secondes (utilisé dans la signature)
  data: {
    type: SyncEvent["type"];
    action: SyncEvent["action"];
    resourceId?: number;
    triggeredBy?: number;
    meta?: Record<string, unknown>;
  };
}

/** Nom d'événement externe stable, ex "contact.created". null = à ignorer. */
export function eventName(event: Pick<SyncEvent, "type" | "action">): string | null {
  if (event.type === "ping" || event.action === "ping") return null;
  return `${event.type}.${event.action}`;
}

/** Backoff exponentiel borné, en secondes, à partir du n° de tentative. */
export function backoffSeconds(attemptNo: number): number {
  const delay = BACKOFF_BASE_SEC * Math.pow(2, Math.max(0, attemptNo - 1));
  return Math.min(delay, MAX_BACKOFF_SEC);
}

/** Signature HMAC-SHA256 (hex) sur `${timestampSec}.${body}`. */
export function signPayload(secret: string, timestampSec: number, body: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestampSec}.${body}`)
    .digest("hex");
}

function truncate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > MAX_STORED_BODY ? value.slice(0, MAX_STORED_BODY) : value;
}

// ---------------------------------------------------------------------------
// Fan-out : à chaque événement, créer + tenter une livraison par endpoint souscrit.
// ---------------------------------------------------------------------------

async function enqueueEventDeliveries(orgId: number, event: SyncEvent): Promise<void> {
  const type = eventName(event);
  if (!type) return;

  let endpoints: WebhookEndpoint[];
  try {
    endpoints = await db
      .select()
      .from(webhookEndpointsTable)
      .where(
        and(
          eq(webhookEndpointsTable.organisationId, orgId),
          eq(webhookEndpointsTable.active, true),
          // L'endpoint est souscrit s'il liste ce type OU le joker "*".
          arrayOverlaps(webhookEndpointsTable.events, [type, "*"]),
        ),
      );
  } catch (err) {
    logger.error({ err, orgId, type }, "[webhook] lookup endpoints failed");
    return;
  }
  if (endpoints.length === 0) return;

  const createdSec = Math.floor(Date.now() / 1000);
  for (const endpoint of endpoints) {
    const envelope: WebhookEnvelope = {
      id: crypto.randomUUID(),
      event: type,
      created: createdSec,
      data: {
        type: event.type,
        action: event.action,
        resourceId: event.resourceId,
        triggeredBy: event.triggeredBy,
        meta: event.meta,
      },
    };
    try {
      const [row] = await db
        .insert(webhookDeliveriesTable)
        .values({
          organisationId: orgId,
          endpointId: endpoint.id,
          eventType: type,
          eventId: envelope.id,
          payload: envelope,
          status: "pending",
        })
        .returning();
      if (row) void attemptDelivery(row, endpoint);
    } catch (err) {
      logger.error(
        { err, orgId, endpointId: endpoint.id, type },
        "[webhook] enqueue delivery failed",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Tentative de livraison HTTP (chemin commun fan-out immédiat ET retry worker).
// ---------------------------------------------------------------------------

async function attemptDelivery(
  delivery: WebhookDelivery,
  endpoint: WebhookEndpoint,
): Promise<void> {
  const attemptNo = delivery.attempts + 1;

  // Anti-SSRF : refuser toute cible interne/privée AVANT de déchiffrer le secret
  // ou d'émettre la requête. Échec TERMINAL (une URL interne ne deviendra jamais
  // valide ; inutile de la retenter).
  try {
    await assertSafePublicUrl(endpoint.url);
  } catch (err) {
    await handleFailure(
      delivery,
      endpoint,
      attemptNo,
      0,
      { error: `url_bloquee_ssrf: ${(err as Error).message}` },
      { forceTerminal: true },
    );
    return;
  }

  let secret: string;
  try {
    secret = decryptSensitiveData(endpoint.secret);
  } catch (err) {
    logger.error(
      { err, endpointId: endpoint.id, deliveryId: delivery.id },
      "[webhook] secret decrypt failed",
    );
    // Secret indéchiffrable : échec terminal, inutile de retenter.
    await handleFailure(
      delivery,
      endpoint,
      attemptNo,
      0,
      { error: "secret_decrypt_failed" },
      { forceTerminal: true },
    );
    return;
  }

  const body = JSON.stringify(delivery.payload);
  // Timestamp de SIGNATURE = maintenant, RECALCULÉ à chaque tentative. Beaucoup
  // de receveurs (style Stripe) rejettent un timestamp trop ancien (anti-rejeu,
  // typiquement ±5 min) : une retentative après backoff doit donc être resignée
  // avec l'heure courante, sinon un endpoint sain rejetterait nos retries. Le
  // temps MÉTIER de l'événement reste disponible dans le corps (payload.created).
  const nowSec = Math.floor(Date.now() / 1000);
  const signature = signPayload(secret, nowSec, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        "x-webhook-id": delivery.eventId ?? String(delivery.id),
        "x-webhook-event": delivery.eventType,
        "x-webhook-timestamp": String(nowSec),
        "x-webhook-signature": `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    const durationMs = Date.now() - start;

    if (res.ok) {
      let snippet: string | null = null;
      try {
        snippet = truncate(await res.text());
      } catch {
        /* corps illisible : sans importance en cas de succès */
      }
      await handleSuccess(delivery, endpoint, attemptNo, res.status, durationMs, snippet);
    } else {
      let snippet: string | null = null;
      try {
        snippet = truncate(await res.text());
      } catch {
        /* ignore */
      }
      await handleFailure(delivery, endpoint, attemptNo, durationMs, {
        responseStatus: res.status,
        responseBody: snippet,
        error: `HTTP ${res.status}`,
      });
    }
  } catch (err) {
    const durationMs = Date.now() - start;
    const aborted = err instanceof Error && err.name === "AbortError";
    await handleFailure(delivery, endpoint, attemptNo, durationMs, {
      error: aborted ? `timeout après ${DELIVERY_TIMEOUT_MS}ms` : (err as Error).message,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function handleSuccess(
  delivery: WebhookDelivery,
  endpoint: WebhookEndpoint,
  attemptNo: number,
  responseStatus: number,
  durationMs: number,
  responseBody: string | null,
): Promise<void> {
  const now = new Date();
  await db
    .update(webhookDeliveriesTable)
    .set({
      status: "success",
      attempts: attemptNo,
      responseStatus,
      responseBody,
      durationMs,
      error: null,
      deliveredAt: now,
      nextRetryAt: null,
    })
    .where(eq(webhookDeliveriesTable.id, delivery.id));
  // Réinitialise le circuit breaker de l'endpoint.
  await db
    .update(webhookEndpointsTable)
    .set({ failureCount: 0, lastStatus: "success", lastDeliveryAt: now })
    .where(eq(webhookEndpointsTable.id, endpoint.id));
}

async function handleFailure(
  delivery: WebhookDelivery,
  endpoint: WebhookEndpoint,
  attemptNo: number,
  durationMs: number,
  info: { responseStatus?: number; responseBody?: string | null; error: string },
  opts?: { forceTerminal?: boolean },
): Promise<void> {
  const now = new Date();
  // forceTerminal : échec définitif quel que soit attemptNo (URL SSRF, secret
  // indéchiffrable...) — aucune retentative ne pourra réussir.
  const willRetry = !opts?.forceTerminal && attemptNo < delivery.maxAttempts;
  const nextRetryAt = willRetry
    ? new Date(now.getTime() + backoffSeconds(attemptNo) * 1000)
    : null;

  await db
    .update(webhookDeliveriesTable)
    .set({
      status: willRetry ? "retrying" : "failed",
      attempts: attemptNo,
      responseStatus: info.responseStatus ?? null,
      responseBody: info.responseBody ?? null,
      error: truncate(info.error),
      durationMs,
      nextRetryAt,
    })
    .where(eq(webhookDeliveriesTable.id, delivery.id));

  // Incrément ATOMIQUE du compteur d'échec + bascule conditionnelle du circuit
  // breaker dans la MÊME requête : évite les pertes d'incréments (read/modify/
  // write) entre livraisons concurrentes vers le même endpoint. Le CASE et
  // l'incrément lisent tous deux la valeur PRÉ-update (sémantique SQL), donc le
  // seuil est évalué de façon cohérente.
  const [updated] = await db
    .update(webhookEndpointsTable)
    .set({
      failureCount: sql`${webhookEndpointsTable.failureCount} + 1`,
      lastStatus: "failed",
      lastDeliveryAt: now,
      active: sql`CASE WHEN ${webhookEndpointsTable.failureCount} + 1 >= ${CIRCUIT_BREAKER_THRESHOLD} THEN false ELSE ${webhookEndpointsTable.active} END`,
    })
    .where(eq(webhookEndpointsTable.id, endpoint.id))
    .returning({
      failureCount: webhookEndpointsTable.failureCount,
      active: webhookEndpointsTable.active,
    });

  if (updated && !updated.active && updated.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    logger.warn(
      { endpointId: endpoint.id, orgId: endpoint.organisationId, failureCount: updated.failureCount },
      "[webhook] endpoint désactivé (circuit breaker) après échecs répétés",
    );
  }
}

// ---------------------------------------------------------------------------
// Worker de retry : rejoue les livraisons dues (backoff échu) + filet crash.
// ---------------------------------------------------------------------------

let retryRunning = false;
let retryTimer: NodeJS.Timeout | null = null;

async function processRetryQueue(): Promise<void> {
  if (retryRunning) return; // empêche tout chevauchement de ticks
  retryRunning = true;
  try {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_PENDING_MS);
    const due = await db
      .select()
      .from(webhookDeliveriesTable)
      .where(
        or(
          // Retentatives programmées dont l'échéance est atteinte.
          and(
            eq(webhookDeliveriesTable.status, "retrying"),
            lte(webhookDeliveriesTable.nextRetryAt, now),
          ),
          // Filet de sécurité : pending jamais résolu (crash entre insert et envoi).
          and(
            eq(webhookDeliveriesTable.status, "pending"),
            lt(webhookDeliveriesTable.createdAt, staleBefore),
          ),
        ),
      )
      .orderBy(webhookDeliveriesTable.createdAt)
      .limit(RETRY_BATCH);

    if (due.length === 0) return;

    for (const delivery of due) {
      const [endpoint] = await db
        .select()
        .from(webhookEndpointsTable)
        .where(eq(webhookEndpointsTable.id, delivery.endpointId));

      if (!endpoint || !endpoint.active) {
        // Endpoint supprimé (la cascade FK l'aurait normalement nettoyé) ou
        // désactivé (circuit breaker) : on abandonne la livraison.
        await db
          .update(webhookDeliveriesTable)
          .set({
            status: "failed",
            error: endpoint ? "endpoint_inactive" : "endpoint_introuvable",
            nextRetryAt: null,
          })
          .where(eq(webhookDeliveriesTable.id, delivery.id));
        continue;
      }
      await attemptDelivery(delivery, endpoint);
    }
    logger.info({ processed: due.length }, "[webhook] retry queue traitée");
  } catch (err) {
    logger.error({ err }, "[webhook] retry queue tick failed");
  } finally {
    retryRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Retry manuel : un admin rejoue une livraison depuis l'écran « API & Webhooks ».
//
// CONCURRENCE : on NE rejoue PAS l'envoi directement depuis le chemin HTTP.
// On se contente de remettre la livraison dans la file (status=retrying, due
// maintenant) et on laisse le WORKER de retry l'exécuter. Le worker est l'UNIQUE
// exécuteur d'une livraison (un seul tick à la fois grâce à `retryRunning`), ce
// qui élimine par construction tout double envoi : un fan-out immédiat ici
// pourrait entrer en collision avec le tick du worker (le filet "pending
// périmé" rattraperait une ligne remise à pending dont le createdAt est ancien).
// Coût : la nouvelle tentative part au prochain tick (<= RETRY_TICK_MS).
// ---------------------------------------------------------------------------

export async function manualRetryDelivery(
  orgId: number,
  endpointId: number,
  deliveryId: number,
): Promise<
  | { ok: true; delivery: WebhookDelivery }
  | { ok: false; code: "not_found" | "inactive" }
> {
  // Endpoint scoppé org : un endpoint coupé par le circuit breaker doit d'abord
  // être réactivé (ce qui remet failureCount à zéro) — sinon le worker
  // abandonnerait aussitôt la livraison (cf. processRetryQueue).
  const [endpoint] = await db
    .select()
    .from(webhookEndpointsTable)
    .where(
      and(
        eq(webhookEndpointsTable.id, endpointId),
        eq(webhookEndpointsTable.organisationId, orgId),
      ),
    );
  if (!endpoint) return { ok: false, code: "not_found" };
  if (!endpoint.active) return { ok: false, code: "inactive" };

  // Re-mise en file ATOMIQUE et scoppée (org + endpoint + id). Le garde de statut
  // empêche de « ressusciter » une livraison déjà réussie et fait converger des
  // clics concurrents vers la même ligne (budget complet restauré : attempts=0).
  const [reset] = await db
    .update(webhookDeliveriesTable)
    .set({
      status: "retrying",
      attempts: 0,
      error: null,
      responseStatus: null,
      responseBody: null,
      nextRetryAt: new Date(), // éligible dès le prochain tick du worker
      deliveredAt: null,
    })
    .where(
      and(
        eq(webhookDeliveriesTable.id, deliveryId),
        eq(webhookDeliveriesTable.endpointId, endpointId),
        eq(webhookDeliveriesTable.organisationId, orgId),
        inArray(webhookDeliveriesTable.status, ["failed", "retrying", "pending"]),
      ),
    )
    .returning();
  if (!reset) return { ok: false, code: "not_found" };

  return { ok: true, delivery: reset };
}

// ---------------------------------------------------------------------------
// Démarrage : branche le fan-out sur le broadcaster + lance le worker de retry.
// ---------------------------------------------------------------------------

export function startWebhookEngine(): void {
  // 1) Fan-out non-bloquant : l'écouteur planifie le travail async et rend la
  // main immédiatement (le chemin d'émission d'événement ne doit jamais bloquer).
  broadcaster.onEvent((orgId, event) => {
    void enqueueEventDeliveries(orgId, event);
  });

  // 2) Worker de retry périodique.
  if (!retryTimer) {
    setTimeout(() => void processRetryQueue(), RETRY_INITIAL_DELAY_MS);
    retryTimer = setInterval(() => void processRetryQueue(), RETRY_TICK_MS);
    if (typeof retryTimer.unref === "function") retryTimer.unref();
  }

  logger.info(
    { retryTickMs: RETRY_TICK_MS, breakerThreshold: CIRCUIT_BREAKER_THRESHOLD },
    "[webhook] moteur démarré (fan-out + retry worker)",
  );
}
