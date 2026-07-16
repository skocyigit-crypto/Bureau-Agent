// F7 — Synthese hebdomadaire de securite par email.
//
// Pour chaque organisation active AYANT opte (weeklySecurityEmail = true) et
// disposant d'une adresse email, on calcule le score de securite et le nombre
// de menaces bloquees sur 7 jours, puis on envoie un recapitulatif.
//
// Fenetre hebdomadaire persistee en base (organisations.lastSecurityDigestAt)
// pour rester durable aux redemarrages : un envoi par semaine garanti, sans
// doublon meme si le serveur redemarre plusieurs fois.

import { db, organisationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "./email";
import { computeSecurityScore } from "./security-score";
import { loadSecurityScoreInput } from "./security-score-input";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000; // fenetre minimale entre deux envois
const TICK_MS = 24 * 60 * 60 * 1000; // verifie une fois par jour les orgs en retard
let timer: NodeJS.Timeout | null = null;

const RATING_LABEL: Record<string, string> = {
  excellent: "Excellent",
  bon: "Bon",
  moyen: "Moyen",
  faible: "Faible",
};
const RATING_COLOR: Record<string, string> = {
  excellent: "#16a34a",
  bon: "#0ea5e9",
  moyen: "#f59e0b",
  faible: "#dc2626",
};

async function sendDigest(orgId: number, orgEmail: string, orgName: string) {
  const input = await loadSecurityScoreInput(orgId, logger);
  const score = computeSecurityScore(input);
  const { dangerous, suspicious } = score.threats7d;
  const ratingLabel = RATING_LABEL[score.rating] ?? score.rating;
  const ratingColor = RATING_COLOR[score.rating] ?? "#0ea5e9";

  const recoHtml = score.recommendations.length
    ? `<h3 style="color:#0f1729;font-size:15px;margin:20px 0 8px;">Recommandations</h3>
       <ul style="padding-left:18px;margin:0;">
         ${score.recommendations
           .map(
             (r) =>
               `<li style="margin-bottom:6px;"><strong>${r.title}</strong><br/>
                <span style="color:#64748b;font-size:13px;">${r.detail}</span></li>`,
           )
           .join("")}
       </ul>`
    : `<p style="color:#16a34a;">Aucune action requise — votre protection est bien configuree.</p>`;

  const strengthsHtml = score.strengths.length
    ? `<ul style="padding-left:18px;margin:8px 0;color:#16a34a;font-size:13px;">
         ${score.strengths.map((s) => `<li>${s}</li>`).join("")}
       </ul>`
    : "";

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f9;padding:24px;">
    <div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:32px;">
      <h2 style="color:#0f1729;margin-top:0;">Synthese securite hebdomadaire</h2>
      <p style="color:#475569;">Bonjour <strong>${orgName}</strong>, voici le bilan de votre protection pour les 7 derniers jours.</p>
      <div style="text-align:center;margin:24px 0;">
        <div style="display:inline-block;border:6px solid ${ratingColor};border-radius:50%;width:96px;height:96px;line-height:84px;">
          <span style="font-size:32px;font-weight:bold;color:${ratingColor};">${score.score}</span>
        </div>
        <div style="margin-top:8px;font-weight:bold;color:${ratingColor};">${ratingLabel} — ${score.score}/100</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr>
          <td style="padding:12px;background:#fef2f2;border-radius:8px;text-align:center;">
            <div style="font-size:24px;font-weight:bold;color:#dc2626;">${dangerous}</div>
            <div style="font-size:12px;color:#991b1b;">Menaces bloquees</div>
          </td>
          <td style="width:12px;"></td>
          <td style="padding:12px;background:#fffbeb;border-radius:8px;text-align:center;">
            <div style="font-size:24px;font-weight:bold;color:#d97706;">${suspicious}</div>
            <div style="font-size:12px;color:#92400e;">Elements suspects</div>
          </td>
        </tr>
      </table>
      ${strengthsHtml}
      ${recoHtml}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;">Vous recevez cet email car la synthese hebdomadaire de securite est activee pour votre organisation. Vous pouvez la desactiver dans Securite &gt; Reglages.</p>
    </div></body></html>`;

  const text = `Synthese securite hebdomadaire — ${orgName}

Score de securite: ${score.score}/100 (${ratingLabel})
Menaces bloquees (7j): ${dangerous}
Elements suspects (7j): ${suspicious}

${score.recommendations.length ? "Recommandations:\n" + score.recommendations.map((r) => `- ${r.title}: ${r.detail}`).join("\n") : "Aucune action requise."}

Vous pouvez desactiver cette synthese dans Securite > Reglages.`;

  const result = await sendEmail(
    orgEmail,
    `[Ajant Bureau] Synthese securite — score ${score.score}/100`,
    html,
    text,
  );
  if (result.success) {
    await db
      .update(organisationsTable)
      .set({ lastSecurityDigestAt: new Date() })
      .where(eq(organisationsTable.id, orgId));
    logger.info({ orgId, score: score.score, dangerous }, "[security-digest] synthese envoyee");
  } else {
    logger.warn({ orgId, err: result.error }, "[security-digest] envoi echoue");
  }
}

async function tick() {
  try {
    const orgs = await withDbRetry(
      () =>
        db
          .select({
            id: organisationsTable.id,
            email: organisationsTable.email,
            name: organisationsTable.name,
            lastSecurityDigestAt: organisationsTable.lastSecurityDigestAt,
          })
          .from(organisationsTable)
          .where(and(eq(organisationsTable.actif, true), eq(organisationsTable.weeklySecurityEmail, true))),
      { label: "security-digest:orgs" },
    );

    for (const org of orgs) {
      if (!org.email) continue;
      const last = org.lastSecurityDigestAt ? org.lastSecurityDigestAt.getTime() : 0;
      if (Date.now() - last < WEEK_MS) continue;
      try {
        await sendDigest(org.id, org.email, org.name);
      } catch (err) {
        logger.warn({ orgId: org.id, err }, "[security-digest] erreur organisation");
      }
    }
  } catch (err) {
    logger.error({ err }, "[security-digest] tick failed");
  }
}

export function startSecurityDigestCron(): void {
  if (timer) return;
  // Premier passage 2 min apres le demarrage, puis une fois par jour.
  setTimeout(() => { void tick(); }, 2 * 60 * 1000);
  timer = setInterval(() => { void tick(); }, TICK_MS);
  logger.info("[security-digest] cron demarre — synthese hebdo (opt-in), fenetre 7j persistee");
}

export function stopSecurityDigestCron(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
