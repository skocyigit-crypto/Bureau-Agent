import crypto from "crypto";
import { db, appointmentOffersTable, calendarEventsTable, organisationsTable, contactsTable, organisationClosuresTable } from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { sendEmail } from "./email";
import { sendSms as providerSendSms } from "./telephony-providers";
import { computeFreeSlots, isSlotFree, isSlotWithinWorkingHours, type TimeSlot } from "./availability";
import { notifyOrgUsers } from "./whatsapp-notify";
import { logger } from "../lib/logger";
import {
  pushAppointmentToGoogleCalendar,
  updateAppointmentInGoogleCalendar,
  deleteAppointmentFromGoogleCalendar,
} from "./google-calendar-sync";

/**
 * Flux "propose-confirm" de rendez-vous.
 *
 * 1. L'agent propose des creneaux LIBRES -> on cree une `appointment_offer`
 *    (token public) puis on envoie le message (email/SMS) au client. L'envoi
 *    n'a lieu qu'apres approbation humaine (file agent_proposals).
 * 2. Le client ouvre le lien public et choisit un creneau -> on revalide que le
 *    creneau est libre, on reserve l'offre de maniere atomique, on ecrit
 *    l'evenement dans l'agenda (status `confirme`) et on confirme au client +
 *    on notifie l'organisation.
 */

const OFFER_TTL_DAYS = 7;

// Advisory-lock namespace for slot-booking serialization (see
// confirmOfferSelection/rescheduleOffer below) - distinct from
// call-processor.ts's CALL_LOCK_NAMESPACE (4242).
const SLOT_BOOKING_LOCK_NAMESPACE = 4243;

export function generateOfferToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** URL publique de base (sans slash final). Memes priorites que google-auth. */
export function publicBaseUrl(): string {
  const explicit = process.env.PUBLIC_URL || process.env.APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const first = replitDomains.split(",").map((d) => d.trim()).filter(Boolean)[0];
    if (first) {
      const base = first.startsWith("http") ? first : `https://${first}`;
      return base.replace(/\/$/, "");
    }
  }
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "http://localhost";
}

/** Lien public d'ouverture/selection d'une offre (page SPA de buro-ajani). */
export function offerLink(token: string): string {
  return `${publicBaseUrl()}/rdv/${encodeURIComponent(token)}`;
}

function fmtSlot(slot: TimeSlot, tz: string): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const dateStr = start.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  });
  const startStr = start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const endStr = end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  return `${dateStr} de ${startStr} a ${endStr}`;
}

export interface CreateOfferInput {
  orgId: number;
  createdBy?: number | null;
  relatedContactId?: number | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  reason?: string | null;
  durationMinutes: number;
  slots: TimeSlot[];
  channel: "email" | "sms";
}

/** Cree une offre en base (status `envoye`) — l'envoi reel est fait a part. */
export async function createOffer(input: CreateOfferInput) {
  const token = generateOfferToken();
  const expiresAt = new Date(Date.now() + OFFER_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [offer] = await db
    .insert(appointmentOffersTable)
    .values({
      organisationId: input.orgId,
      createdBy: input.createdBy ?? null,
      relatedContactId: input.relatedContactId ?? null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      reason: input.reason?.trim() || "Rendez-vous",
      durationMinutes: input.durationMinutes,
      slots: input.slots,
      channel: input.channel,
      token,
      status: "envoye",
      expiresAt,
    })
    .returning();
  return offer;
}

async function getOrgContext(orgId: number): Promise<{ name: string; tz: string }> {
  const [org] = await db
    .select({ name: organisationsTable.name, tz: organisationsTable.appointmentTimezone })
    .from(organisationsTable)
    .where(eq(organisationsTable.id, orgId))
    .limit(1);
  return { name: org?.name || "notre equipe", tz: org?.tz || "Europe/Paris" };
}

/** Envoie le message d'offre (email ou SMS) au client. Renvoie le resultat. */
export async function sendOfferMessage(
  offer: typeof appointmentOffersTable.$inferSelect,
): Promise<{ success: boolean; error?: string }> {
  const { name: orgName, tz } = await getOrgContext(offer.organisationId);
  const link = offerLink(offer.token);
  const slots = (offer.slots || []) as TimeSlot[];
  const slotLines = slots.map((s, i) => `${i + 1}. ${fmtSlot(s, tz)}`);

  if (offer.channel === "sms") {
    if (!offer.contactPhone) return { success: false, error: "Numero de telephone manquant." };
    const body =
      `${orgName}: pour votre rendez-vous (${offer.reason}), voici nos creneaux disponibles:\n` +
      slotLines.join("\n") +
      `\nChoisissez ici: ${link}`;
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;
    if (!sid || !tok || !from) return { success: false, error: "Twilio non configure (TWILIO_*)." };
    const r = await providerSendSms(
      "twilio",
      { accountSid: sid, authToken: tok, fromNumber: from },
      { to: offer.contactPhone, body },
    );
    if (!r.success) return { success: false, error: r.error || "Echec envoi SMS." };
    await markSent(offer.id);
    return { success: true };
  }

  // Email
  if (!offer.contactEmail) return { success: false, error: "Adresse email manquante." };
  const greeting = offer.contactName ? `Bonjour ${offer.contactName},` : "Bonjour,";
  const htmlSlots = slots
    .map(
      (s, i) =>
        `<tr><td style="padding:8px 0;"><a href="${link}?slot=${i}" style="display:inline-block;background:#0f1729;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">${fmtSlot(
          s,
          tz,
        )}</a></td></tr>`,
    )
    .join("");
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f1729;">
      <p>${greeting}</p>
      <p>Voici nos creneaux disponibles pour votre rendez-vous (<strong>${offer.reason}</strong>). Cliquez sur celui qui vous convient pour le confirmer&nbsp;:</p>
      <table role="presentation" style="margin:16px 0;">${htmlSlots}</table>
      <p style="font-size:13px;color:#475569;">Ou ouvrez ce lien&nbsp;: <a href="${link}">${link}</a></p>
      <p style="font-size:13px;color:#94a3b8;">${orgName}</p>
    </div>`;
  const text =
    `${greeting}\n\nVoici nos creneaux disponibles pour votre rendez-vous (${offer.reason}). Choisissez celui qui vous convient:\n\n` +
    slotLines.join("\n") +
    `\n\nConfirmez en ouvrant: ${link}\n\n${orgName}`;
  const r = await sendEmail(
    offer.contactEmail,
    `Vos creneaux de rendez-vous — ${orgName}`,
    html,
    text,
    { orgId: offer.organisationId },
  );
  if (!r.success) return { success: false, error: r.error || "Echec envoi email." };
  await markSent(offer.id);
  return { success: true };
}

async function markSent(offerId: number): Promise<void> {
  await db
    .update(appointmentOffersTable)
    .set({ sentAt: new Date() })
    .where(eq(appointmentOffersTable.id, offerId))
    .catch(() => {});
}

/** Libelle lisible d'un client pour les notifications internes. */
function clientLabel(offer: typeof appointmentOffersTable.$inferSelect): string {
  return offer.contactName || offer.contactEmail || offer.contactPhone || "client";
}

/** Envoi best-effort d'un message au client (email prioritaire, SMS sinon). */
async function notifyClient(
  offer: typeof appointmentOffersTable.$inferSelect,
  subject: string,
  html: string,
  text: string,
  sms: string,
): Promise<void> {
  try {
    if (offer.contactEmail) {
      await sendEmail(offer.contactEmail, subject, html, text, { orgId: offer.organisationId });
    } else if (offer.contactPhone) {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const tok = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_PHONE_NUMBER;
      if (sid && tok && from) {
        await providerSendSms(
          "twilio",
          { accountSid: sid, authToken: tok, fromNumber: from },
          { to: offer.contactPhone, body: sms },
        );
      }
    }
  } catch (err) {
    logger.warn({ err, offerId: offer.id }, "[appointment-offers] notification client echouee");
  }
}

/** Confirmation/reprogrammation au client (best-effort) + notification interne. */
function announceBooking(
  offer: typeof appointmentOffersTable.$inferSelect,
  whenStr: string,
  orgName: string,
  reprogramme: boolean,
): void {
  const greeting = `Bonjour${offer.contactName ? ` ${offer.contactName}` : ""},`;
  const verb = reprogramme ? "a bien ete reprogramme pour" : "est confirme pour";
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#0f1729;"><p>${greeting}</p><p>Votre rendez-vous (<strong>${offer.reason}</strong>) ${verb}&nbsp;:</p><p style="font-size:16px;font-weight:700;">${whenStr}</p><p style="font-size:13px;color:#94a3b8;">${orgName}</p></div>`;
  const text = `${greeting}\n\nVotre rendez-vous (${offer.reason}) ${verb}:\n${whenStr}\n\n${orgName}`;
  const subject = reprogramme ? `Rendez-vous reprogramme — ${orgName}` : `Rendez-vous confirme — ${orgName}`;
  const sms = `${orgName}: votre rendez-vous (${offer.reason}) est ${reprogramme ? "reprogramme" : "confirme"} pour ${whenStr}.`;
  void notifyClient(offer, subject, html, text, sms);
  void notifyOrgUsers(
    offer.organisationId,
    `${reprogramme ? "Rendez-vous reprogramme" : "Nouveau rendez-vous confirme"}: ${clientLabel(offer)} — ${whenStr} (${offer.reason})`,
    "appointment",
  ).catch(() => {});
}

export type ConfirmResult =
  | { ok: true; eventId: number; slot: TimeSlot }
  | { ok: false; code: "not_found" | "expired" | "already" | "invalid_slot" | "conflict" | "not_confirmed"; message: string };

export type CancelResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "not_confirmed"; message: string };

/**
 * Confirme la selection d'un creneau par le client.
 * - revalide la disponibilite (anti-double-reservation),
 * - reserve l'offre de maniere atomique (envoye -> confirme),
 * - ecrit l'evenement dans l'agenda (status `confirme`),
 * - confirme au client (best-effort) et notifie l'organisation.
 */
export async function confirmOfferSelection(token: string, slotIndex: number): Promise<ConfirmResult> {
  const [offer] = await db
    .select()
    .from(appointmentOffersTable)
    .where(eq(appointmentOffersTable.token, token))
    .limit(1);
  if (!offer) return { ok: false, code: "not_found", message: "Offre introuvable." };
  if (offer.status === "confirme") return { ok: false, code: "already", message: "Ce rendez-vous a deja ete confirme." };
  if (offer.status !== "envoye") return { ok: false, code: "expired", message: "Cette offre n'est plus valable." };
  if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) {
    await db.update(appointmentOffersTable).set({ status: "expire" }).where(eq(appointmentOffersTable.id, offer.id)).catch(() => {});
    return { ok: false, code: "expired", message: "Cette offre a expire." };
  }

  const slots = (offer.slots || []) as TimeSlot[];
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slots.length) {
    return { ok: false, code: "invalid_slot", message: "Creneau invalide." };
  }
  const slot = slots[slotIndex];
  const start = new Date(slot.start);
  const end = new Date(slot.end);

  // Revalidation de disponibilite + reservation, sous verrou avisoire par
  // organisation (pg_advisory_xact_lock, auto-libere a la fin de la
  // transaction). Sans ce verrou, deux offres DIFFERENTES envoyees a deux
  // clients differents pour un creneau qui se chevauche pouvaient toutes
  // les deux passer isSlotFree en concurrence puis toutes les deux inserer
  // un evenement — la clause WHERE status='envoye' ci-dessous ne protege
  // que contre la double confirmation de LA MEME offre, pas contre deux
  // offres distinctes sur des creneaux qui se chevauchent.
  let conflict: ConfirmResult | null = null;
  let claimed: { id: number }[] = [];
  let event: { id: number } | undefined;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SLOT_BOOKING_LOCK_NAMESPACE}, ${offer.organisationId})`);

    const free = await isSlotFree({
      orgId: offer.organisationId,
      userId: offer.createdBy ?? undefined,
      start,
      end,
    });
    if (!free) {
      conflict = { ok: false, code: "conflict", message: "Ce creneau vient d'etre reserve. Merci d'en choisir un autre." };
      return;
    }

    // Reservation atomique de l'offre: seule la transition envoye -> confirme
    // reussit (la clause WHERE status='envoye' empeche toute double confirmation).
    claimed = await tx
      .update(appointmentOffersTable)
      .set({ status: "confirme", selectedSlotIndex: slotIndex, selectedStart: start, selectedEnd: end, confirmedAt: new Date() })
      .where(and(eq(appointmentOffersTable.id, offer.id), eq(appointmentOffersTable.status, "envoye")))
      .returning({ id: appointmentOffersTable.id });
    if (claimed.length === 0) return;

    // Ecriture de l'evenement dans l'agenda interne.
    [event] = await tx
      .insert(calendarEventsTable)
      .values({
        organisationId: offer.organisationId,
        title: offer.reason || "Rendez-vous",
        description: "Rendez-vous confirme par le client via lien de selection.",
        type: "rendez_vous",
        startDate: start,
        endDate: end,
        status: "confirme",
        relatedContactId: offer.relatedContactId ?? null,
        contactName: offer.contactName ?? null,
        contactPhone: offer.contactPhone ?? null,
        contactEmail: offer.contactEmail ?? null,
        createdBy: offer.createdBy ?? null,
      })
      .returning({ id: calendarEventsTable.id });

    await tx
      .update(appointmentOffersTable)
      .set({ calendarEventId: event.id })
      .where(eq(appointmentOffersTable.id, offer.id));
  });

  if (conflict) return conflict;
  if (claimed.length === 0) {
    return { ok: false, code: "already", message: "Ce rendez-vous a deja ete confirme." };
  }
  if (!event) {
    return { ok: false, code: "conflict", message: "Erreur interne lors de la confirmation." };
  }

  // Miroir Google Agenda (best-effort — n'interrompt jamais le flux local).
  if (offer.createdBy) {
    void pushAppointmentToGoogleCalendar({
      calendarEventId: event.id,
      userId: offer.createdBy,
      title: offer.reason || "Rendez-vous",
      description: offer.contactName
        ? `Client : ${offer.contactName}${offer.contactEmail ? ` <${offer.contactEmail}>` : ""}${offer.contactPhone ? ` — ${offer.contactPhone}` : ""}`
        : undefined,
      startDate: start,
      endDate: end,
    }).catch(() => {});
  }

  // Confirmation au client (best-effort) + notification interne.
  const { name: orgName, tz } = await getOrgContext(offer.organisationId);
  const whenStr = fmtSlot(slot, tz);
  announceBooking(offer, whenStr, orgName, false);

  return { ok: true, eventId: event.id, slot };
}

/**
 * Annule un rendez-vous confirme depuis le lien public (capability `token`).
 * - transition atomique `confirme` -> `annule` (anti-double action),
 * - passe l'evenement d'agenda en `annule` (le creneau redevient libre),
 * - notifie l'organisation et le client (best-effort).
 * Idempotent: un rendez-vous deja annule renvoie `ok` sans rien refaire.
 */
export async function cancelOffer(token: string): Promise<CancelResult> {
  const [offer] = await db
    .select()
    .from(appointmentOffersTable)
    .where(eq(appointmentOffersTable.token, token))
    .limit(1);
  if (!offer) return { ok: false, code: "not_found", message: "Offre introuvable." };
  if (offer.status === "annule") return { ok: true }; // idempotent
  if (offer.status !== "confirme") {
    return { ok: false, code: "not_confirmed", message: "Aucun rendez-vous confirme a annuler." };
  }

  // Transition atomique: seule confirme -> annule reussit.
  const claimed = await db
    .update(appointmentOffersTable)
    .set({ status: "annule" })
    .where(and(eq(appointmentOffersTable.id, offer.id), eq(appointmentOffersTable.status, "confirme")))
    .returning({ id: appointmentOffersTable.id });
  if (claimed.length === 0) return { ok: true }; // course: deja annule ailleurs

  // L'evenement d'agenda passe en `annule` -> le creneau redevient libre.
  let gcalEventIdToDelete: string | null = null;
  if (offer.calendarEventId) {
    // Recupere le googleEventId avant la mise a jour (besoin de l'id Google).
    const [ev] = await db
      .select({ googleEventId: calendarEventsTable.googleEventId })
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.id, offer.calendarEventId),
          eq(calendarEventsTable.organisationId, offer.organisationId),
        ),
      )
      .limit(1)
      .catch(() => []);
    gcalEventIdToDelete = ev?.googleEventId ?? null;

    await db
      .update(calendarEventsTable)
      .set({ status: "annule" })
      .where(
        and(
          eq(calendarEventsTable.id, offer.calendarEventId),
          eq(calendarEventsTable.organisationId, offer.organisationId),
        ),
      )
      .catch(() => {});
  }

  // Suppression dans Google Agenda (best-effort).
  if (gcalEventIdToDelete && offer.createdBy) {
    void deleteAppointmentFromGoogleCalendar({
      userId: offer.createdBy,
      googleEventId: gcalEventIdToDelete,
    }).catch(() => {});
  }

  // Notifications (best-effort).
  const { name: orgName, tz } = await getOrgContext(offer.organisationId);
  const whenStr =
    offer.selectedStart && offer.selectedEnd
      ? fmtSlot({ start: offer.selectedStart.toISOString(), end: offer.selectedEnd.toISOString() }, tz)
      : "";
  const greeting = `Bonjour${offer.contactName ? ` ${offer.contactName}` : ""},`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#0f1729;"><p>${greeting}</p><p>Votre rendez-vous (<strong>${offer.reason}</strong>)${whenStr ? ` du ${whenStr}` : ""} a bien ete annule.</p><p style="font-size:13px;color:#94a3b8;">${orgName}</p></div>`;
  const text = `${greeting}\n\nVotre rendez-vous (${offer.reason})${whenStr ? ` du ${whenStr}` : ""} a bien ete annule.\n\n${orgName}`;
  const sms = `${orgName}: votre rendez-vous (${offer.reason})${whenStr ? ` du ${whenStr}` : ""} a bien ete annule.`;
  void notifyClient(offer, `Rendez-vous annule — ${orgName}`, html, text, sms);
  void notifyOrgUsers(
    offer.organisationId,
    `Rendez-vous annule par le client: ${clientLabel(offer)}${whenStr ? ` — ${whenStr}` : ""} (${offer.reason})`,
    "appointment",
  ).catch(() => {});

  return { ok: true };
}

/**
 * Reprogramme un rendez-vous confirme.
 * Accepte soit un index dans les creneaux d'origine (number), soit un
 * creneau libre issu du calcul de disponibilite en temps reel (TimeSlot).
 * - revalide la disponibilite du nouveau creneau (en ignorant l'evenement
 *   courant pour ne pas se bloquer soi-meme),
 * - deplace l'evenement d'agenda de maniere atomique (transition gardee sur
 *   `confirme`), le recree si l'evenement a disparu,
 * - renvoie une nouvelle confirmation au client + notifie l'organisation.
 */
export async function rescheduleOffer(token: string, slotRef: number | TimeSlot): Promise<ConfirmResult> {
  const [offer] = await db
    .select()
    .from(appointmentOffersTable)
    .where(eq(appointmentOffersTable.token, token))
    .limit(1);
  if (!offer) return { ok: false, code: "not_found", message: "Offre introuvable." };
  if (offer.status === "annule") return { ok: false, code: "expired", message: "Ce rendez-vous a ete annule." };
  if (offer.status !== "confirme") {
    return { ok: false, code: "not_confirmed", message: "Aucun rendez-vous a reprogrammer." };
  }

  let slot: TimeSlot;
  let resolvedIndex: number | null = null;

  if (typeof slotRef === "number") {
    const slots = (offer.slots || []) as TimeSlot[];
    if (!Number.isInteger(slotRef) || slotRef < 0 || slotRef >= slots.length) {
      return { ok: false, code: "invalid_slot", message: "Creneau invalide." };
    }
    slot = slots[slotRef];
    resolvedIndex = slotRef;
  } else {
    slot = slotRef;
    resolvedIndex = null;
  }

  const start = new Date(slot.start);
  const end = new Date(slot.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return { ok: false, code: "invalid_slot", message: "Creneau invalide." };
  }

  // Pour un creneau fourni par le client (non issu des slots d'offre originaux),
  // appliquer l'ensemble des contraintes metier :
  //   1. La duree doit correspondre exactement a offer.durationMinutes (empêche les
  //      creneaux trop courts/longs craftes cote client).
  //   2. La plage doit respecter les horaires d'ouverture et la marge de delai.
  if (resolvedIndex === null) {
    const expectedMs = offer.durationMinutes * 60 * 1000;
    if (end.getTime() - start.getTime() !== expectedMs) {
      return { ok: false, code: "invalid_slot", message: "La duree du creneau ne correspond pas a l'offre." };
    }
    const bookable = await isSlotWithinWorkingHours({
      orgId: offer.organisationId,
      start,
      end,
      leadMinutes: 60,
    });
    if (!bookable) {
      return { ok: false, code: "invalid_slot", message: "Ce creneau est en dehors des horaires d'ouverture." };
    }
  }

  // Meme verrou avisoire par organisation que confirmOfferSelection — sans
  // lui, deux reprogrammations (ou une reprogrammation + une nouvelle
  // confirmation) sur des creneaux qui se chevauchent pouvaient toutes deux
  // passer isSlotFree en concurrence.
  let conflict: ConfirmResult | null = null;
  let claimed: { id: number }[] = [];
  let eventId = offer.calendarEventId ?? null;
  let existingGoogleEventId: string | null = null;
  let isNewEvent = false;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SLOT_BOOKING_LOCK_NAMESPACE}, ${offer.organisationId})`);

    const free = await isSlotFree({
      orgId: offer.organisationId,
      userId: offer.createdBy ?? undefined,
      start,
      end,
      excludeEventId: offer.calendarEventId ?? undefined,
    });
    if (!free) {
      conflict = { ok: false, code: "conflict", message: "Ce creneau vient d'etre reserve. Merci d'en choisir un autre." };
      return;
    }

    // Deplacement atomique de l'offre: garde sur status='confirme'.
    claimed = await tx
      .update(appointmentOffersTable)
      .set({ selectedSlotIndex: resolvedIndex, selectedStart: start, selectedEnd: end })
      .where(and(eq(appointmentOffersTable.id, offer.id), eq(appointmentOffersTable.status, "confirme")))
      .returning({ id: appointmentOffersTable.id });
    if (claimed.length === 0) return;

    // Deplacement de l'evenement d'agenda (ou recreation s'il a disparu).
    if (eventId) {
      // Recupere le googleEventId existant avant le deplacement.
      const [ev] = await tx
        .select({ googleEventId: calendarEventsTable.googleEventId })
        .from(calendarEventsTable)
        .where(and(eq(calendarEventsTable.id, eventId), eq(calendarEventsTable.organisationId, offer.organisationId)))
        .limit(1)
        .catch(() => []);
      existingGoogleEventId = ev?.googleEventId ?? null;

      const moved = await tx
        .update(calendarEventsTable)
        .set({ startDate: start, endDate: end, status: "confirme" })
        .where(and(eq(calendarEventsTable.id, eventId), eq(calendarEventsTable.organisationId, offer.organisationId)))
        .returning({ id: calendarEventsTable.id });
      if (moved.length === 0) eventId = null;
    }
    if (!eventId) {
      isNewEvent = true;
      const [event] = await tx
        .insert(calendarEventsTable)
        .values({
          organisationId: offer.organisationId,
          title: offer.reason || "Rendez-vous",
          description: "Rendez-vous reprogramme par le client via lien de selection.",
          type: "rendez_vous",
          startDate: start,
          endDate: end,
          status: "confirme",
          relatedContactId: offer.relatedContactId ?? null,
          contactName: offer.contactName ?? null,
          contactPhone: offer.contactPhone ?? null,
          contactEmail: offer.contactEmail ?? null,
          createdBy: offer.createdBy ?? null,
        })
        .returning({ id: calendarEventsTable.id });
      eventId = event.id;
      await tx
        .update(appointmentOffersTable)
        .set({ calendarEventId: eventId })
        .where(eq(appointmentOffersTable.id, offer.id));
    }
  });

  if (conflict) return conflict;
  if (claimed.length === 0) {
    return { ok: false, code: "already", message: "Ce rendez-vous n'est plus modifiable." };
  }

  // Miroir Google Agenda (best-effort).
  if (offer.createdBy) {
    const gcalTitle = offer.reason || "Rendez-vous";
    const gcalDesc = offer.contactName
      ? `Client : ${offer.contactName}${offer.contactEmail ? ` <${offer.contactEmail}>` : ""}${offer.contactPhone ? ` — ${offer.contactPhone}` : ""}`
      : undefined;
    if (!isNewEvent && existingGoogleEventId) {
      // L'evenement local existe deja cote Google -> on le met a jour.
      void updateAppointmentInGoogleCalendar({
        userId: offer.createdBy,
        googleEventId: existingGoogleEventId,
        title: gcalTitle,
        description: gcalDesc,
        startDate: start,
        endDate: end,
      }).catch(() => {});
    } else {
      // Nouveau eventId local (recreation) ou pas encore de googleEventId -> on pousse.
      void pushAppointmentToGoogleCalendar({
        calendarEventId: eventId,
        userId: offer.createdBy,
        title: gcalTitle,
        description: gcalDesc,
        startDate: start,
        endDate: end,
      }).catch(() => {});
    }
  }

  // Nouvelle confirmation au client (best-effort) + notification interne.
  const { name: orgName, tz } = await getOrgContext(offer.organisationId);
  const whenStr = fmtSlot(slot, tz);
  announceBooking(offer, whenStr, orgName, true);

  return { ok: true, eventId, slot };
}

/** Donnees publiques (sans token interne) pour la page de selection. */
export async function getPublicOffer(token: string) {
  const [offer] = await db
    .select()
    .from(appointmentOffersTable)
    .where(eq(appointmentOffersTable.token, token))
    .limit(1);
  if (!offer) return null;
  const { name: orgName, tz } = await getOrgContext(offer.organisationId);
  const expired = offer.status === "expire" || (offer.expiresAt ? offer.expiresAt.getTime() < Date.now() : false);
  const slots = (offer.slots || []) as TimeSlot[];

  // Libelle du creneau selectionne. Pour les reprogrammations sur creneaux libres
  // en temps reel, selectedSlotIndex est null mais selectedStart/selectedEnd sont
  // renseignes — on formate directement depuis ces colonnes.
  let selectedSlotLabel: string | null = null;
  if (offer.selectedSlotIndex !== null && slots[offer.selectedSlotIndex]) {
    selectedSlotLabel = fmtSlot(slots[offer.selectedSlotIndex], tz);
  } else if (offer.selectedStart && offer.selectedEnd) {
    selectedSlotLabel = fmtSlot(
      { start: offer.selectedStart.toISOString(), end: offer.selectedEnd.toISOString() },
      tz,
    );
  }

  return {
    orgName,
    timezone: tz,
    reason: offer.reason,
    durationMinutes: offer.durationMinutes,
    contactName: offer.contactName,
    status: expired && offer.status === "envoye" ? "expire" : offer.status,
    selectedSlotIndex: offer.selectedSlotIndex,
    selectedSlotLabel,
    slots: slots.map((s) => ({ start: s.start, end: s.end, label: fmtSlot(s, tz) })),
  };
}

/**
 * Calcule les creneaux libres en temps reel pour une offre donnee (token).
 * Utilise pour le flux de reprogrammation : le client voit des creneaux
 * FRAIS (prochains N jours ouvrables) plutot que les creneaux originaux qui
 * peuvent etre passes ou deja pris.
 *
 * Retourne null si l'offre n'est pas trouvee ou si l'operation n'est pas
 * applicable (annule).
 */
export async function getPublicAvailableSlots(
  token: string,
  opts?: { days?: number; limit?: number },
): Promise<{ slots: Array<{ start: string; end: string; label: string }> } | null> {
  const [offer] = await db
    .select()
    .from(appointmentOffersTable)
    .where(eq(appointmentOffersTable.token, token))
    .limit(1);
  if (!offer) return null;
  if (offer.status === "annule") return null;

  const { tz } = await getOrgContext(offer.organisationId);
  const days = Math.min(Math.max(opts?.days ?? 14, 1), 60);
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 50);
  const from = new Date();
  const to = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const rawSlots = await computeFreeSlots({
    orgId: offer.organisationId,
    userId: offer.createdBy ?? null,
    from,
    to,
    durationMinutes: offer.durationMinutes,
    limit,
    leadMinutes: 60,
  });

  return {
    slots: rawSlots.map((s) => ({ start: s.start, end: s.end, label: fmtSlot(s, tz) })),
  };
}

/**
 * Retourne les plages de fermeture de l'organisation associee a un token public.
 * Aucune authentification requise — le token non-devinable sert de capability.
 * Retourne null si le token est inconnu.
 */
export async function getPublicClosures(
  token: string,
): Promise<Array<{ dateStart: string; dateEnd: string; label: string | null }> | null> {
  const [offer] = await db
    .select({ organisationId: appointmentOffersTable.organisationId })
    .from(appointmentOffersTable)
    .where(eq(appointmentOffersTable.token, token))
    .limit(1);
  if (!offer) return null;

  const rows = await db
    .select({
      dateStart: organisationClosuresTable.dateStart,
      dateEnd: organisationClosuresTable.dateEnd,
      label: organisationClosuresTable.label,
    })
    .from(organisationClosuresTable)
    .where(eq(organisationClosuresTable.organisationId, offer.organisationId))
    .orderBy(asc(organisationClosuresTable.dateStart));

  return rows;
}

/** Resout les coordonnees d'un contact (org-scoped) pour pre-remplir une offre. */
export async function resolveContactForOffer(orgId: number, contactId: number) {
  const [c] = await db
    .select({
      id: contactsTable.id,
      firstName: contactsTable.firstName,
      lastName: contactsTable.lastName,
      email: contactsTable.email,
      phone: contactsTable.phone,
      mobile: contactsTable.mobile,
    })
    .from(contactsTable)
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.organisationId, orgId)))
    .limit(1);
  if (!c) return null;
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null;
  return { id: c.id, name, email: c.email, phone: c.mobile || c.phone };
}
