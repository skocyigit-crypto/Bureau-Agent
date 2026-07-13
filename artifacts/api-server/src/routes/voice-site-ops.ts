import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import {
  db,
  projetsTable,
  tasksTable,
  stockArticlesTable,
  stockMouvementsTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import {
  safeJsonParse,
  aiCallWithRetry,
  sanitizePromptInput,
  GEMINI_FLASH_MODEL,
} from "../services/ai-utils";
import { assertAiQuota, AiQuotaExceededError } from "../services/ai-quota";
import { logger } from "../lib/logger";
import { logAudit } from "./audit";

// ─────────────────────────────────────────────────────────────────────────────
// Voice Site Operations (saisie vocale chantier) — premier pilier BTP.
//
// Un chef de chantier dicte (ou tape) une note en francais a propos d'un
// chantier (= projet). L'IA en extrait une LISTE d'actions structurees :
//   1. stock_deduction  -> sortie de stock + mouvement (lie au chantier)
//   2. work_order       -> creation / cloture d'une tache (liee au chantier)
//   3. progress_update  -> mise a jour de l'avancement (%) + note du chantier
//
// Les actions d'ecriture ne sont JAMAIS executees en ligne : on renvoie un
// jeton signe (HMAC-SHA256, TTL 5 min, anti-rejeu) que l'UI fait confirmer via
// POST /voice/site-ops/confirm. Modele calque sur routes/voice-command.ts.
// Multi-tenant : toutes les resolutions et ecritures sont bornees a orgId.
// ─────────────────────────────────────────────────────────────────────────────

let ai: any = null;
try {
  const mod = require("@workspace/integrations-gemini-ai");
  ai = mod.ai;
} catch (e) {
  logger.warn({ err: e }, "[VoiceSiteOps] Gemini AI indisponible:");
}

const router: IRouter = Router();

const PENDING_TTL_MS = 5 * 60_000;

// Statuts de tache "ouverts" (non clos). Une cloture vocale ne cible que ceux-ci.
const OPEN_TASK_STATUSES = ["en_attente", "en_cours"] as const;

// ───────────────────────── Pending action token ──────────────────────────────
// Identique a voice-command.ts (secrets partages, rotation, anti-rejeu).
function getPendingSecrets(): string[] {
  const out: string[] = [];
  const list = process.env.SESSION_SECRETS;
  if (list) {
    for (const p of list.split(",").map((s) => s.trim())) {
      if (p.length >= 16) out.push(p);
    }
  }
  for (const env of ["SESSION_SECRET", "JWT_SECRET"]) {
    const v = process.env[env];
    if (v && v.length >= 16 && !out.includes(v)) out.push(v);
  }
  if (out.length > 0) return out;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRETS (or SESSION_SECRET / JWT_SECRET) is required in production for voice action signing",
    );
  }
  return ["dev-voice-pending-secret-do-not-use-in-prod"];
}

const usedTokens = new Map<string, number>();
function consumeTokenOnce(sig: string, exp: number): boolean {
  const now = Date.now();
  if (usedTokens.size > 10_000) {
    for (const [k, e] of usedTokens) if (e < now) usedTokens.delete(k);
  }
  if (usedTokens.has(sig)) return false;
  usedTokens.set(sig, exp);
  return true;
}

function signPendingAction(payload: object): string {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getPendingSecrets()[0])
    .update(json)
    .digest("base64url");
  return `${json}.${sig}`;
}

function verifyPendingAction(token: string): any | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [json, sig] = token.split(".");
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  let matched = false;
  for (const secret of getPendingSecrets()) {
    const expected = crypto.createHmac("sha256", secret).update(json).digest();
    if (expected.length === sigBuf.length && crypto.timingSafeEqual(expected, sigBuf)) {
      matched = true;
    }
  }
  if (!matched) return null;
  try {
    const payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ───────────────────────── Fuzzy matching (accent-insensitive) ───────────────
function normalize(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Candidate {
  id: number;
  haystacks: string[];
}

// Renvoie l'id du meilleur candidat, ou un statut d'ambiguite/absence.
function bestMatch(
  query: string,
  candidates: Candidate[],
): { id: number | null; ambiguous: boolean } {
  const q = normalize(query);
  if (!q) return { id: null, ambiguous: false };
  const qTokens = q.split(" ").filter(Boolean);

  let best: { id: number; score: number } | null = null;
  let secondScore = 0;

  for (const c of candidates) {
    let score = 0;
    for (const h of c.haystacks) {
      const n = normalize(h);
      if (!n) continue;
      if (n === q) {
        score = Math.max(score, 1000);
        continue;
      }
      if (n.includes(q) || q.includes(n)) {
        score = Math.max(score, 500 + Math.min(n.length, q.length));
        continue;
      }
      // chevauchement de tokens
      const nTokens = new Set(n.split(" ").filter(Boolean));
      let overlap = 0;
      for (const t of qTokens) if (nTokens.has(t)) overlap++;
      if (overlap > 0) score = Math.max(score, overlap * 10);
    }
    if (best === null || score > best.score) {
      secondScore = best?.score ?? 0;
      best = { id: c.id, score };
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (!best || best.score === 0) return { id: null, ambiguous: false };
  // Ambiguite : deux candidats a egalite proche sur un score faible.
  if (best.score < 500 && secondScore > 0 && best.score - secondScore < 10) {
    return { id: null, ambiguous: true };
  }
  return { id: best.id, ambiguous: false };
}

// ───────────────────────── Types ─────────────────────────────────────────────
type ActionStatus =
  | "ready"
  | "needs_chantier"
  | "chantier_not_found"
  | "chantier_ambiguous"
  | "article_not_found"
  | "task_not_found"
  | "invalid";

interface ResolvedAction {
  kind: "stock_deduction" | "work_order" | "progress_update";
  status: ActionStatus;
  summary: string;
  // chantier (projet)
  projetId?: number | null;
  projetTitle?: string | null;
  // stock_deduction
  articleId?: number | null;
  articleName?: string | null;
  articleReference?: string | null;
  quantity?: number;
  quantityAvailable?: number | null;
  // work_order
  mode?: "create" | "complete";
  title?: string | null;
  taskId?: number | null;
  // progress_update
  progress?: number | null;
  note?: string | null;
}

interface AiAction {
  type?: string;
  article?: string;
  quantity?: number | string;
  chantier?: string;
  title?: string;
  mode?: string;
  progress?: number | string;
  note?: string;
}

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ───────────────────────── AI extraction ─────────────────────────────────────
const SYSTEM_INSTRUCTION = `Tu es un assistant de chantier pour une entreprise du BTP francaise.
Le chef de chantier dicte une note libre en francais. Tu extrais une LISTE
d'actions structurees. Reponds UNIQUEMENT en JSON valide, sans texte autour.

Format: {"actions":[ ... ]}. Chaque action a un "type" parmi:
- "stock_deduction": consommation de materiel. Champs: {"type","article","quantity","chantier"}.
    article = nom du materiel (ex: "ciment", "sacs de platre", "tuyau PVC 100").
    quantity = nombre entier (>0).
- "work_order": ordre de travaux / tache. Champs: {"type","mode","title","chantier"}.
    mode = "create" (nouvelle tache a faire) ou "complete" (tache terminee).
    title = description courte de la tache (ex: "coffrage 2e etage").
- "progress_update": avancement du chantier. Champs: {"type","chantier","progress","note"}.
    progress = pourcentage 0-100 si mentionne, sinon omis. note = remarque libre.

"chantier" = nom du chantier/projet cite (ex: "Rivoli", "villa Martin"). Si non cite, omets-le.
Une seule note peut contenir plusieurs actions. N'invente jamais de quantite ou
de chantier non mentionnes. Si la note ne contient aucune action exploitable,
renvoie {"actions":[]}.`;

async function extractActions(text: string, lang: string): Promise<AiAction[]> {
  if (!ai) return [];
  const safeText = sanitizePromptInput(text, 1500);
  const langLabel = lang === "tr" ? "turc" : lang === "en" ? "anglais" : "francais";
  try {
    const result = await aiCallWithRetry<any>(
      () =>
        ai!.models.generateContent({
          model: GEMINI_FLASH_MODEL,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Langue de la note: ${langLabel}.\nNote du chef de chantier:\n"""${safeText}"""`,
                },
              ],
            },
          ],
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      { label: "voice-site-ops" },
    );
    const parsed = safeJsonParse<{ actions?: AiAction[] }>(result.text, { actions: [] });
    return Array.isArray(parsed.actions) ? parsed.actions : [];
  } catch (err) {
    logger.error({ err }, "[VoiceSiteOps] extraction IA echouee");
    return [];
  }
}

// ───────────────────────── POST /voice/site-ops (parse) ──────────────────────
router.post("/voice/site-ops", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(403).json({ error: "Organisation requise." });

  const text = String((req.body as any)?.text || "").trim();
  const language = String((req.body as any)?.language || "fr");
  const presetProjetId = toInt((req.body as any)?.projetId);

  if (!text) return res.status(400).json({ error: "Note vide." });
  if (text.length > 4000) return res.status(400).json({ error: "Note trop longue." });

  try {
    await assertAiQuota(orgId);
  } catch (err) {
    if (err instanceof AiQuotaExceededError) {
      return res.status(429).json({ error: "Quota IA depasse pour cette organisation." });
    }
    throw err;
  }

  try {
    const [projets, articles] = await Promise.all([
      db
        .select({
          id: projetsTable.id,
          title: projetsTable.title,
          clientName: projetsTable.clientName,
          address: projetsTable.address,
          progress: projetsTable.progress,
        })
        .from(projetsTable)
        .where(eq(projetsTable.organisationId, orgId)),
      db
        .select({
          id: stockArticlesTable.id,
          name: stockArticlesTable.name,
          reference: stockArticlesTable.reference,
          quantity: stockArticlesTable.quantity,
          unit: stockArticlesTable.unit,
        })
        .from(stockArticlesTable)
        .where(eq(stockArticlesTable.organisationId, orgId)),
    ]);

    const projetCandidates: Candidate[] = projets.map((p) => ({
      id: p.id,
      haystacks: [p.title, p.clientName || "", p.address || ""],
    }));
    const articleCandidates: Candidate[] = articles.map((a) => ({
      id: a.id,
      haystacks: [a.name, a.reference || ""],
    }));
    const projetById = new Map(projets.map((p) => [p.id, p]));
    const articleById = new Map(articles.map((a) => [a.id, a]));

    const presetProjet =
      presetProjetId && projetById.has(presetProjetId) ? projetById.get(presetProjetId)! : null;

    const aiActions = await extractActions(text, language);

    // Pour "work_order complete", on tente de retrouver une tache ouverte du
    // chantier dont le titre correspond a la note.
    const resolveChantier = (chantierName?: string) => {
      if (presetProjet) return { id: presetProjet.id, title: presetProjet.title, status: "ready" as const };
      if (!chantierName) return { id: null, title: null, status: "needs_chantier" as const };
      const m = bestMatch(chantierName, projetCandidates);
      if (m.ambiguous) return { id: null, title: null, status: "chantier_ambiguous" as const };
      if (m.id == null) return { id: null, title: null, status: "chantier_not_found" as const };
      const p = projetById.get(m.id)!;
      return { id: p.id, title: p.title, status: "ready" as const };
    };

    const resolved: ResolvedAction[] = [];

    for (const a of aiActions) {
      const type = String(a.type || "").trim();

      if (type === "stock_deduction") {
        const ch = resolveChantier(a.chantier);
        const qty = toInt(a.quantity);
        const am = a.article ? bestMatch(a.article, articleCandidates) : { id: null, ambiguous: false };
        const article = am.id != null ? articleById.get(am.id)! : null;

        let status: ActionStatus = "ready";
        if (!qty || qty <= 0) status = "invalid";
        else if (!article) status = "article_not_found";
        else if (ch.status !== "ready") status = ch.status;

        resolved.push({
          kind: "stock_deduction",
          status,
          projetId: ch.id,
          projetTitle: ch.title,
          articleId: article?.id ?? null,
          articleName: article?.name ?? (a.article || null),
          articleReference: article?.reference ?? null,
          quantity: qty ?? 0,
          quantityAvailable: article?.quantity ?? null,
          summary:
            `Sortie de stock : ${qty ?? "?"} ${article?.unit || ""} ${article?.name || a.article || "?"}`.trim() +
            (ch.title ? ` — chantier ${ch.title}` : ""),
        });
        continue;
      }

      if (type === "work_order") {
        const ch = resolveChantier(a.chantier);
        const mode: "create" | "complete" = a.mode === "complete" ? "complete" : "create";
        const title = String(a.title || "").trim();

        let status: ActionStatus = "ready";
        let taskId: number | null = null;
        if (!title) status = "invalid";
        else if (ch.status !== "ready") status = ch.status;

        if (status === "ready" && mode === "complete" && ch.id != null) {
          // Retrouver une tache OUVERTE du chantier correspondant au titre.
          // On exclut les taches deja terminees/annulees : on ne "recloture" pas.
          const openTasks = await db
            .select({ id: tasksTable.id, title: tasksTable.title })
            .from(tasksTable)
            .where(
              and(
                eq(tasksTable.organisationId, orgId),
                eq(tasksTable.projetId, ch.id),
                inArray(tasksTable.status, OPEN_TASK_STATUSES),
              ),
            );
          const tm = bestMatch(title, openTasks.map((t) => ({ id: t.id, haystacks: [t.title] })));
          if (tm.id == null) status = "task_not_found";
          else taskId = tm.id;
        }

        resolved.push({
          kind: "work_order",
          status,
          mode,
          title,
          taskId,
          projetId: ch.id,
          projetTitle: ch.title,
          summary:
            (mode === "complete" ? `Cloturer la tache : ${title}` : `Nouvelle tache : ${title}`) +
            (ch.title ? ` — chantier ${ch.title}` : ""),
        });
        continue;
      }

      if (type === "progress_update") {
        const ch = resolveChantier(a.chantier);
        const progress = a.progress != null ? toInt(a.progress) : null;
        const note = a.note ? String(a.note).trim().slice(0, 1000) : null;

        let status: ActionStatus = "ready";
        if (progress == null && !note) status = "invalid";
        else if (ch.status !== "ready") status = ch.status;

        const clamped = progress == null ? null : Math.max(0, Math.min(100, progress));

        resolved.push({
          kind: "progress_update",
          status,
          projetId: ch.id,
          projetTitle: ch.title,
          progress: clamped,
          note,
          summary:
            `Avancement chantier ${ch.title || "?"}` +
            (clamped != null ? ` → ${clamped}%` : "") +
            (note ? ` (${note.slice(0, 60)})` : ""),
        });
        continue;
      }

      // Type inconnu : ignore silencieusement.
    }

    // Jeton ne contenant QUE les actions applicables (status "ready").
    const ready = resolved.filter((r) => r.status === "ready");
    const exp = Date.now() + PENDING_TTL_MS;
    const token =
      ready.length > 0
        ? signPendingAction({
            v: 1,
            orgId,
            userId: req.session?.userId ?? null,
            exp,
            actions: ready,
          })
        : null;

    req.log.info(
      { op: "voice-site-ops", total: resolved.length, ready: ready.length },
      "[VoiceSiteOps] note analysee",
    );

    return res.json({
      actions: resolved,
      readyCount: ready.length,
      token,
      expiresAt: token ? exp : null,
      transcript: text,
    });
  } catch (err) {
    req.log.error({ err }, "[VoiceSiteOps] echec analyse note");
    return res.status(500).json({ error: "Analyse impossible. Reessayez." });
  }
});

// ───────────────────────── POST /voice/site-ops/confirm (apply) ──────────────
router.post("/voice/site-ops/confirm", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(403).json({ error: "Organisation requise." });
  const userId = req.session?.userId;
  const userEmail = req.session?.userEmail;

  const token = String((req.body as any)?.token || "");
  const acceptRaw = (req.body as any)?.accept;
  const accept: number[] | null = Array.isArray(acceptRaw)
    ? acceptRaw.map((n: unknown) => toInt(n)).filter((n): n is number => n != null)
    : null;

  const payload = verifyPendingAction(token);
  if (!payload) return res.status(400).json({ error: "Action expiree ou invalide. Repetez la note." });
  if (payload.orgId !== orgId) return res.status(403).json({ error: "Organisation differente." });
  if (payload.userId != null) {
    if (!userId || payload.userId !== userId) {
      return res.status(403).json({ error: "Utilisateur different." });
    }
  }

  const [, sig] = token.split(".");
  if (!consumeTokenOnce(sig, payload.exp)) {
    return res.status(409).json({ error: "Cette note a deja ete appliquee." });
  }

  const actions: ResolvedAction[] = Array.isArray(payload.actions) ? payload.actions : [];
  const ip = req.ip;
  const ua = req.get("user-agent") || undefined;

  const results: { index: number; kind: string; ok: boolean; message: string }[] = [];

  for (let i = 0; i < actions.length; i++) {
    if (accept && !accept.includes(i)) continue;
    const a = actions[i];
    try {
      if (a.kind === "stock_deduction") {
        await db.transaction(async (tx) => {
          const [article] = await tx
            .select()
            .from(stockArticlesTable)
            .where(and(eq(stockArticlesTable.id, a.articleId!), eq(stockArticlesTable.organisationId, orgId)))
            .limit(1)
            .for("update");
          if (!article) throw new Error("article introuvable");
          const before = article.quantity;
          const qty = a.quantity ?? 0;
          const after = Math.max(0, before - qty);
          await tx
            .update(stockArticlesTable)
            .set({ quantity: after, updatedAt: new Date() })
            .where(and(eq(stockArticlesTable.id, article.id), eq(stockArticlesTable.organisationId, orgId)));
          await tx.insert(stockMouvementsTable).values({
            organisationId: orgId,
            articleId: article.id,
            articleName: article.name,
            articleReference: article.reference,
            type: "sortie",
            delta: after - before,
            quantityBefore: before,
            quantityAfter: after,
            reason: "Saisie vocale chantier",
            projetId: a.projetId ?? null,
            userId: userId ?? null,
          });
        });
        await logAudit(
          userId,
          userEmail,
          "voice_site_stock_deduction",
          "stock_mouvement",
          String(a.articleId),
          { article: a.articleName, quantity: a.quantity, projetId: a.projetId },
          ip,
          ua,
          orgId,
        );
        results.push({ index: i, kind: a.kind, ok: true, message: a.summary });
        continue;
      }

      if (a.kind === "work_order") {
        if (a.mode === "complete") {
          if (a.taskId == null) throw new Error("tache introuvable");
          // Garde anti-recloture : la tache doit encore etre ouverte au moment
          // de l'application (elle a pu etre cloturee entre parse et confirm).
          const updated = await db
            .update(tasksTable)
            .set({ status: "termine", updatedBy: userId ?? null, updatedAt: new Date() })
            .where(
              and(
                eq(tasksTable.id, a.taskId),
                eq(tasksTable.organisationId, orgId),
                inArray(tasksTable.status, OPEN_TASK_STATUSES),
              ),
            )
            .returning({ id: tasksTable.id });
          if (updated.length === 0) {
            results.push({ index: i, kind: a.kind, ok: false, message: "Tache deja cloturee ou introuvable." });
            continue;
          }
          await logAudit(
            userId,
            userEmail,
            "voice_site_work_order_complete",
            "task",
            String(a.taskId),
            { title: a.title, projetId: a.projetId },
            ip,
            ua,
            orgId,
          );
        } else {
          const [row] = await db
            .insert(tasksTable)
            .values({
              organisationId: orgId,
              title: a.title || "Tache chantier",
              status: "en_attente",
              projetId: a.projetId ?? null,
              createdBy: userId ?? null,
              updatedBy: userId ?? null,
            })
            .returning();
          await logAudit(
            userId,
            userEmail,
            "voice_site_work_order_create",
            "task",
            String(row?.id),
            { title: a.title, projetId: a.projetId },
            ip,
            ua,
            orgId,
          );
        }
        results.push({ index: i, kind: a.kind, ok: true, message: a.summary });
        continue;
      }

      if (a.kind === "progress_update") {
        if (a.projetId == null) throw new Error("chantier introuvable");
        const [projet] = await db
          .select({ progress: projetsTable.progress, notes: projetsTable.notes })
          .from(projetsTable)
          .where(and(eq(projetsTable.id, a.projetId), eq(projetsTable.organisationId, orgId)))
          .limit(1);
        if (!projet) throw new Error("chantier introuvable");
        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (a.progress != null) set.progress = Math.max(0, Math.min(100, a.progress));
        if (a.note) {
          const stamp = new Date().toISOString().slice(0, 10);
          const line = `[${stamp}] ${a.note}`;
          set.notes = projet.notes ? `${projet.notes}\n${line}` : line;
        }
        await db
          .update(projetsTable)
          .set(set)
          .where(and(eq(projetsTable.id, a.projetId), eq(projetsTable.organisationId, orgId)));
        await logAudit(
          userId,
          userEmail,
          "voice_site_progress_update",
          "projet",
          String(a.projetId),
          { progress: a.progress, note: a.note },
          ip,
          ua,
          orgId,
        );
        results.push({ index: i, kind: a.kind, ok: true, message: a.summary });
        continue;
      }

      results.push({ index: i, kind: a.kind, ok: false, message: "Type non supporte." });
    } catch (err) {
      req.log.error({ err, index: i, kind: a.kind }, "[VoiceSiteOps] application action echouee");
      results.push({ index: i, kind: a.kind, ok: false, message: "Echec de l'application." });
    }
  }

  const applied = results.filter((r) => r.ok).length;
  return res.json({ applied, results });
});

export default router;
