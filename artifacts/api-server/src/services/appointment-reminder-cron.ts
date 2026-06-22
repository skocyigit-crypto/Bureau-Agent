/**
 * Cron de rappel pre-rendez-vous.
 *
 * Toutes les 15 minutes, cherche les offres confirmees dont le debut
 * (`selected_start`) est dans la fenetre de rappel et dont `reminder_sent_at`
 * est NULL, puis envoie un rappel (email ou SMS) au client.
 *
 * ## Garantie "au plus une fois" (at-most-once)
 *
 * On ne fait PAS "SELECT … WHERE reminder_sent_at IS NULL" suivi d'un UPDATE
 * apres l'envoi, ce qui permettrait a deux instances de selectionner la meme
 * ligne et d'envoyer deux rappels, ou a un crash apres envoi de laisser la
 * ligne non marquee.
 *
 * A la place:
 *   UPDATE appointment_offers
 *     SET reminder_sent_at = NOW()
 *    WHERE status = 'confirme'
 *      AND reminder_sent_at IS NULL
 *      AND selected_start > NOW()
 *      AND selected_start <= $horizon
 *    RETURNING *
 *
 * L'UPDATE Postgres est atomique au niveau de l'instruction: une seule
 * instance peut revendiquer chaque ligne. On envoie ensuite uniquement pour
 * les lignes retournees. Si l'envoi echoue, reminder_sent_at reste positionne
 * (semantique at-most-once: on prefere manquer un rappel plutot que d'en
 * envoyer deux).
 *
 * Fenetre de rappel configurable via APPOINTMENT_REMINDER_HOURS (defaut: 24).
 */
import { db, appointmentOffersTable, organisationsTable } from "@workspace/db";
import { and, eq, isNull, lte, gt, inArray, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { sendEmail } from "./email";
import { sendSms as providerSendSms } from "./telephony-providers";
import { publicBaseUrl } from "./appointment-offers";

const TICK_MS = 15 * 60 * 1000; // 15 minutes

/** Avance en heures avant le rendez-vous ou le rappel est envoye. */
function reminderHours(): number {
  const raw = process.env["APPOINTMENT_REMINDER_HOURS"];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

function fmtDateTime(date: Date, tz: string): string {
  return date.toLocaleString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

async function sendReminderForOffer(
  offer: typeof appointmentOffersTable.$inferSelect,
  orgName: string,
  tz: string,
): Promise<void> {
  if (!offer.selectedStart) return;

  const link = `${publicBaseUrl()}/rdv/${encodeURIComponent(offer.token)}`;
  const whenStr = fmtDateTime(offer.selectedStart, tz);
  const greeting = offer.contactName ? `Bonjour ${offer.contactName},` : "Bonjour,";
  const subject = `Rappel de votre rendez-vous — ${orgName}`;

  if (offer.contactEmail) {
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f1729;">
        <p>${greeting}</p>
        <p>Ceci est un rappel pour votre rendez-vous <strong>${offer.reason}</strong> prevu le&nbsp;:</p>
        <p style="font-size:18px;font-weight:700;margin:16px 0;">${whenStr}</p>
        <p>Pour annuler ou reprogrammer, cliquez ici&nbsp;:</p>
        <p><a href="${link}" style="display:inline-block;background:#0f1729;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">Gerer mon rendez-vous</a></p>
        <p style="font-size:13px;color:#475569;">Ou copiez ce lien dans votre navigateur&nbsp;: <a href="${link}">${link}</a></p>
        <p style="font-size:13px;color:#94a3b8;">${orgName}</p>
      </div>`;
    const text =
      `${greeting}\n\nRappel: votre rendez-vous (${offer.reason}) est prevu le ${whenStr}.\n\n` +
      `Pour annuler ou reprogrammer: ${link}\n\n${orgName}`;
    const r = await sendEmail(offer.contactEmail, subject, html, text, { orgId: offer.organisationId });
    if (!r.success) {
      // Le marqueur reminder_sent_at est deja pose (at-most-once). On logue
      // l'echec pour investigation mais on ne retente pas (evite le double envoi).
      logger.warn({ offerId: offer.id, error: r.error }, "[appointment-reminder] echec envoi email — rappel marque, pas de retente");
    }
  } else if (offer.contactPhone) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;
    if (!sid || !tok || !from) {
      logger.warn({ offerId: offer.id }, "[appointment-reminder] Twilio non configure — rappel SMS marque, pas envoye");
      return;
    }
    const body =
      `${orgName}: rappel de votre rendez-vous (${offer.reason}) le ${whenStr}. ` +
      `Annuler/reprogrammer: ${link}`;
    const r = await providerSendSms(
      "twilio",
      { accountSid: sid, authToken: tok, fromNumber: from },
      { to: offer.contactPhone, body },
    );
    if (!r.success) {
      logger.warn({ offerId: offer.id, error: r.error }, "[appointment-reminder] echec envoi SMS — rappel marque, pas de retente");
    }
  } else {
    // Pas de coordonnees: marqueur pose, on ne retente pas.
    logger.warn({ offerId: offer.id }, "[appointment-reminder] pas de coordonnees client — rappel marque, pas envoye");
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const hours = reminderHours();
    const horizon = new Date(Date.now() + hours * 60 * 60 * 1000);

    // Revendication atomique: un seul UPDATE par offre, quelle que soit
    // l'instance qui execute ce tick. Les lignes retournees appartiennent
    // exclusivement a ce processus.
    const claimed = await withDbRetry(
      () =>
        db
          .update(appointmentOffersTable)
          .set({ reminderSentAt: new Date() })
          .where(
            and(
              eq(appointmentOffersTable.status, "confirme"),
              isNull(appointmentOffersTable.reminderSentAt),
              gt(appointmentOffersTable.selectedStart, sql`NOW()`),
              lte(appointmentOffersTable.selectedStart, horizon),
            ),
          )
          .returning(),
      { label: "appointment-reminder:claim" },
    );

    if (claimed.length === 0) return;

    logger.info({ count: claimed.length, horizonHours: hours }, "[appointment-reminder] offres revendiquees pour rappel");

    // Recupere les infos d'organisation pour toutes les orgs concernees.
    const orgIds = [...new Set(claimed.map((o) => o.organisationId))];
    const orgs = await withDbRetry(
      () =>
        db
          .select({ id: organisationsTable.id, name: organisationsTable.name, tz: organisationsTable.appointmentTimezone })
          .from(organisationsTable)
          .where(inArray(organisationsTable.id, orgIds)),
      { label: "appointment-reminder:orgs" },
    );
    const orgMap = new Map(orgs.map((o) => [o.id, { name: o.name || "notre equipe", tz: o.tz || "Europe/Paris" }]));

    for (const offer of claimed) {
      try {
        const { name: orgName, tz } = orgMap.get(offer.organisationId) ?? { name: "notre equipe", tz: "Europe/Paris" };
        await sendReminderForOffer(offer, orgName, tz);
      } catch (err) {
        logger.error({ err, offerId: offer.id }, "[appointment-reminder] erreur lors de l'envoi du rappel");
      }
    }
  } catch (err) {
    logger.error({ err }, "[appointment-reminder] erreur dans le tick");
  } finally {
    running = false;
  }
}

export function startAppointmentReminderCron(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => { void tick(); }, TICK_MS);
  logger.info(
    { reminderHours: reminderHours(), tickMinutes: TICK_MS / 60000 },
    "[appointment-reminder] demarrage — rappels pre-rendez-vous (configurable via APPOINTMENT_REMINDER_HOURS)",
  );
}

export function stopAppointmentReminderCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
