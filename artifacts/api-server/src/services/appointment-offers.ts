import crypto from "crypto";
import { db, appointmentOffersTable, calendarEventsTable, organisationsTable, contactsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { sendEmail } from "./email";
import { sendSms as providerSendSms } from "./telephony-providers";
import { isSlotFree, type TimeSlot } from "./availability";
import { notifyOrgUsers } from "./whatsapp-notify";
import { logger } from "../lib/logger";

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

export type ConfirmResult =
  | { ok: true; eventId: number; slot: TimeSlot }
  | { ok: false; code: "not_found" | "expired" | "already" | "invalid_slot" | "conflict"; message: string };

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

  // Revalidation de disponibilite (le creneau a pu etre pris depuis l'envoi).
  const free = await isSlotFree({
    orgId: offer.organisationId,
    userId: offer.createdBy ?? undefined,
    start,
    end,
  });
  if (!free) return { ok: false, code: "conflict", message: "Ce creneau vient d'etre reserve. Merci d'en choisir un autre." };

  // Reservation atomique de l'offre: seule la transition envoye -> confirme
  // reussit (la clause WHERE status='envoye' empeche toute double confirmation).
  const claimed = await db
    .update(appointmentOffersTable)
    .set({ status: "confirme", selectedSlotIndex: slotIndex, selectedStart: start, selectedEnd: end, confirmedAt: new Date() })
    .where(and(eq(appointmentOffersTable.id, offer.id), eq(appointmentOffersTable.status, "envoye")))
    .returning({ id: appointmentOffersTable.id });
  if (claimed.length === 0) {
    return { ok: false, code: "already", message: "Ce rendez-vous a deja ete confirme." };
  }

  // Ecriture de l'evenement dans l'agenda interne.
  const [event] = await db
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

  await db
    .update(appointmentOffersTable)
    .set({ calendarEventId: event.id })
    .where(eq(appointmentOffersTable.id, offer.id))
    .catch(() => {});

  // Confirmation au client (best-effort) + notification interne.
  const { name: orgName, tz } = await getOrgContext(offer.organisationId);
  const whenStr = fmtSlot(slot, tz);
  void (async () => {
    try {
      if (offer.contactEmail) {
        const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#0f1729;"><p>Bonjour${offer.contactName ? ` ${offer.contactName}` : ""},</p><p>Votre rendez-vous (<strong>${offer.reason}</strong>) est confirme pour&nbsp;:</p><p style="font-size:16px;font-weight:700;">${whenStr}</p><p style="font-size:13px;color:#94a3b8;">${orgName}</p></div>`;
        await sendEmail(
          offer.contactEmail,
          `Rendez-vous confirme — ${orgName}`,
          html,
          `Bonjour${offer.contactName ? ` ${offer.contactName}` : ""},\n\nVotre rendez-vous (${offer.reason}) est confirme pour:\n${whenStr}\n\n${orgName}`,
          { orgId: offer.organisationId },
        );
      } else if (offer.contactPhone) {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const tok = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_PHONE_NUMBER;
        if (sid && tok && from) {
          await providerSendSms(
            "twilio",
            { accountSid: sid, authToken: tok, fromNumber: from },
            { to: offer.contactPhone, body: `${orgName}: votre rendez-vous (${offer.reason}) est confirme pour ${whenStr}.` },
          );
        }
      }
    } catch (err) {
      logger.warn({ err, offerId: offer.id }, "[appointment-offers] confirmation client echouee");
    }
  })();

  void notifyOrgUsers(
    offer.organisationId,
    `Nouveau rendez-vous confirme: ${offer.contactName || offer.contactEmail || offer.contactPhone || "client"} — ${whenStr} (${offer.reason})`,
    "appointment",
  ).catch(() => {});

  return { ok: true, eventId: event.id, slot };
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
  return {
    orgName,
    timezone: tz,
    reason: offer.reason,
    durationMinutes: offer.durationMinutes,
    contactName: offer.contactName,
    status: expired && offer.status === "envoye" ? "expire" : offer.status,
    selectedSlotIndex: offer.selectedSlotIndex,
    slots: slots.map((s) => ({ start: s.start, end: s.end, label: fmtSlot(s, tz) })),
  };
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
