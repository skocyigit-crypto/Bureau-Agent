/**
 * APPEL EN DIRECT : ce que la secretaire IA est en train de traiter, vu par
 * l'equipe, et la REPRISE de l'appel par un humain.
 *
 * Ce qu'est un appel « en direct » est defini UNE fois ici (`conditionAppelEnDirect`)
 * et partage avec le tableau de bord du jour (masa-bugun) : l'indicateur de la
 * barre du haut et l'ecran « Aujourd'hui » ne doivent jamais se contredire.
 *
 * Reprise : la revendication est un UPDATE conditionnel (`takeover_status IS
 * NULL`) — deux clics simultanes, une seule reprise. Puis la redirection
 * Twilio (Calls/{CallSid}.json, TwiML <Dial>). Si Twilio refuse, la
 * revendication est rendue et la vraie raison remontee : un bouton qui dit
 * « repris » alors que l'appel continue avec l'IA serait pire que pas de bouton.
 *
 * AUCUN compte Twilio reel n'a servi a verifier la redirection : le format de
 * la requete suit la documentation publique de Twilio, les tests simulent la
 * reponse. Le transport HTTP est injectable pour cela.
 *
 * Aucun secret ne sort d'ici : la configuration du fournisseur (jeton
 * dechiffre) est lue, utilisee, jamais renvoyee.
 */
import { and, desc, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, telephonyProvidersTable, usersTable, voiceCallSessionsTable } from "@workspace/db";
import { decryptProviderConfig } from "./telephony-providers";
import { cibleDeTransfert, lireEquipes } from "./equipes-transfert";

/** Le balayage (voice-receptionist) clot les sessions muettes depuis 30 min. */
export const FENETRE_APPEL_DIRECT_MS = 30 * 60 * 1000;
const STATUTS_DIRECT = ["en_cours", "transfert"];
const TWILIO_TIMEOUT_MS = 15_000;

/** Un appel est en direct : de cette organisation, non clos, non finalise, actif depuis moins de 30 min. */
export function conditionAppelEnDirect(orgId: number, maintenant: Date = new Date()): SQL {
  return and(
    eq(voiceCallSessionsTable.organisationId, orgId),
    inArray(voiceCallSessionsTable.status, STATUTS_DIRECT),
    isNull(voiceCallSessionsTable.finalizedAt),
    gt(voiceCallSessionsTable.updatedAt, new Date(maintenant.getTime() - FENETRE_APPEL_DIRECT_MS)),
  )!;
}

// ── Transport Twilio injectable ─────────────────────────────────────────────

export type TwilioHttp = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const fetchReel: TwilioHttp = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS) });
let twilioHttp: TwilioHttp = fetchReel;

/** Pour les tests uniquement : aucun compte Twilio n'existe pour verifier en vrai. */
export function definirTwilioHttpPourTests(f: TwilioHttp | null): void {
  twilioHttp = f ?? fetchReel;
}

// ── Lecture ────────────────────────────────────────────────────────────────

type Etat = Record<string, any>;

export function masquerNumero(n: unknown): string | null {
  const s = String(n ?? "").replace(/\s+/g, "");
  if (!s) return null;
  if (s.length <= 4) return "••••";
  return `${s.slice(0, 3)}••••${s.slice(-2)}`;
}

function etapeCourante(etat: Etat, takeoverStatus: string | null): string | null {
  if (takeoverStatus === "reussi" || takeoverStatus === "en_cours") return "reprise_humaine";
  if (etat.transfert?.statut === "en_cours") return "transfert";
  if (etat.rdvPropose) return "rdv_propose";
  if (etat.rdvCree) return "rdv_cree";
  if (etat.rappelMessageId) return "rappel_cree";
  return "ecoute";
}

function dernierJournal(etat: Etat): string | null {
  const j = Array.isArray(etat.journal) ? etat.journal : [];
  const d = j.length ? j[j.length - 1] : null;
  return typeof d === "string" ? d : null;
}

export async function listerAppelsEnDirect(orgId: number, maintenant: Date = new Date()) {
  const rows = await db.select({
    callSid: voiceCallSessionsTable.callSid,
    status: voiceCallSessionsTable.status,
    state: voiceCallSessionsTable.state,
    createdAt: voiceCallSessionsTable.createdAt,
    updatedAt: voiceCallSessionsTable.updatedAt,
    takeoverStatus: voiceCallSessionsTable.takeoverStatus,
  }).from(voiceCallSessionsTable)
    .where(conditionAppelEnDirect(orgId, maintenant))
    .orderBy(desc(voiceCallSessionsTable.createdAt))
    .limit(20);
  // Projection explicite : jamais l'etat brut (il porte la config IA de l'appel).
  return rows.map((r) => {
    const e = (r.state ?? {}) as Etat;
    return {
      callSid: r.callSid,
      status: r.status,
      appelant: typeof e.callerName === "string" && e.callerName ? e.callerName : null,
      numeroMasque: masquerNumero(e.callerNumber),
      contactId: typeof e.callerContactId === "number" ? e.callerContactId : null,
      debut: r.createdAt,
      derniereActivite: r.updatedAt,
      etape: etapeCourante(e, r.takeoverStatus),
      dernierJournal: dernierJournal(e),
      reprise: r.takeoverStatus,
    };
  });
}

export async function detailAppel(orgId: number, callSid: string, maintenant: Date = new Date()) {
  const [r] = await db.select({
    callSid: voiceCallSessionsTable.callSid,
    status: voiceCallSessionsTable.status,
    state: voiceCallSessionsTable.state,
    createdAt: voiceCallSessionsTable.createdAt,
    updatedAt: voiceCallSessionsTable.updatedAt,
    finalizedAt: voiceCallSessionsTable.finalizedAt,
    takeoverStatus: voiceCallSessionsTable.takeoverStatus,
    takenOverAt: voiceCallSessionsTable.takenOverAt,
    takenOverByUserId: voiceCallSessionsTable.takenOverByUserId,
  }).from(voiceCallSessionsTable)
    .where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId)))
    .limit(1);
  if (!r) return null;
  const e = (r.state ?? {}) as Etat;
  const enDirect = STATUTS_DIRECT.includes(r.status) && !r.finalizedAt
    && r.updatedAt.getTime() > maintenant.getTime() - FENETRE_APPEL_DIRECT_MS;
  let reprisPar: string | null = null;
  if (r.takenOverByUserId) {
    const [u] = await db.select({ prenom: usersTable.prenom, nom: usersTable.nom }).from(usersTable)
      .where(and(eq(usersTable.id, r.takenOverByUserId), eq(usersTable.organisationId, orgId))).limit(1);
    reprisPar = u ? [u.prenom, u.nom].filter(Boolean).join(" ") : null;
  }
  const tours = (Array.isArray(e.turns) ? e.turns : [])
    .filter((t: any) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .map((t: any) => ({ role: t.role as "user" | "assistant", texte: t.text as string }));
  return {
    callSid: r.callSid,
    status: r.status,
    enDirect,
    debut: r.createdAt,
    derniereActivite: r.updatedAt,
    appelant: {
      nom: typeof e.callerName === "string" && e.callerName ? e.callerName : null,
      numero: typeof e.callerNumber === "string" ? e.callerNumber : null,
      contactId: typeof e.callerContactId === "number" ? e.callerContactId : null,
      appelsPrecedents: typeof e.callCount === "number" ? e.callCount : 0,
      contexte: typeof e.callerContext === "string" ? e.callerContext : "",
    },
    demande: typeof e.demande === "string" ? e.demande : "",
    tours,
    journal: (Array.isArray(e.journal) ? e.journal : []).filter((x: unknown) => typeof x === "string") as string[],
    etape: etapeCourante(e, r.takeoverStatus),
    rdvPropose: e.rdvPropose ? { debutIso: e.rdvPropose.debutIso ?? null, motif: e.rdvPropose.motif ?? null } : null,
    transfert: e.transfert ? { statut: e.transfert.statut ?? null, equipe: e.transfert.equipe ?? null } : null,
    urgent: e.urgent === true,
    reprise: { statut: r.takeoverStatus, le: r.takenOverAt, par: reprisPar },
  };
}

// ── Capacite de reprise ─────────────────────────────────────────────────────

export type RaisonImpossible = "aucun_fournisseur" | "fournisseur_incomplet" | "aucun_numero";

/** E.164 ; un numero francais saisi « 06 12 34 56 78 » est accepte. */
export function numeroE164(brut: unknown): string | null {
  let s = String(brut ?? "").replace(/[\s.\-()]/g, "");
  if (/^0[1-9]\d{8}$/.test(s)) s = `+33${s.slice(1)}`;
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

interface FournisseurLu { id: number; accountSid: string; authToken: string; fromNumber: string; ia: Record<string, unknown> }

async function fournisseurTwilio(orgId: number, providerId?: number | null): Promise<FournisseurLu | "incomplet" | null> {
  const rows = await db.select({ id: telephonyProvidersTable.id, config: telephonyProvidersTable.config, isDefault: telephonyProvidersTable.isDefault })
    .from(telephonyProvidersTable)
    .where(and(
      eq(telephonyProvidersTable.organisationId, orgId),
      eq(telephonyProvidersTable.provider, "twilio"),
      eq(telephonyProvidersTable.isActive, true),
    ))
    .orderBy(desc(telephonyProvidersTable.isDefault), desc(telephonyProvidersTable.id));
  if (!rows.length) return null;
  // Le fournisseur qui porte l'appel d'abord : c'est son compte qui connait le CallSid.
  const r = rows.find((x) => providerId != null && x.id === providerId) ?? rows[0]!;
  const c = decryptProviderConfig("twilio", (r.config as Record<string, any>) ?? {}) as Record<string, any>;
  const accountSid = String(c.accountSid ?? "").trim();
  const authToken = String(c.authToken ?? "").trim();
  const fromNumber = numeroE164(c.fromNumber) ?? "";
  if (!accountSid || !authToken || !fromNumber) return "incomplet";
  return { id: r.id, accountSid, authToken, fromNumber, ia: (c.aiReceptionist as Record<string, unknown>) ?? {} };
}

export interface CibleReprise { id: string; libelle: string; numeroMasque: string }

async function ciblesDisponibles(orgId: number, userId: number, ia: Record<string, unknown>): Promise<Array<CibleReprise & { numero: string }>> {
  const out: Array<CibleReprise & { numero: string }> = [];
  const [u] = await db.select({ telephone: usersTable.telephone }).from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId))).limit(1);
  const moi = numeroE164(u?.telephone);
  if (moi) out.push({ id: "moi", libelle: "moi", numero: moi, numeroMasque: masquerNumero(moi)! });
  const defaut = cibleDeTransfert(ia, {});
  const numDefaut = !defaut.equipe ? numeroE164(defaut.numeros[0]) : null;
  if (numDefaut) out.push({ id: "defaut", libelle: "defaut", numero: numDefaut, numeroMasque: masquerNumero(numDefaut)! });
  for (const e of lireEquipes(ia)) {
    const n = numeroE164(e.numeros[0]);
    if (n) out.push({ id: `equipe:${e.nom}`, libelle: e.nom, numero: n, numeroMasque: masquerNumero(n)! });
  }
  return out;
}

export async function capaciteReprise(orgId: number, userId: number) {
  const f = await fournisseurTwilio(orgId);
  if (f === null) return { fournisseur: null, reprisePossible: false, raison: "aucun_fournisseur" as RaisonImpossible, cibles: [] as CibleReprise[] };
  if (f === "incomplet") return { fournisseur: "twilio", reprisePossible: false, raison: "fournisseur_incomplet" as RaisonImpossible, cibles: [] as CibleReprise[] };
  const cibles = (await ciblesDisponibles(orgId, userId, f.ia)).map(({ numero: _n, ...c }) => c);
  if (!cibles.length) return { fournisseur: "twilio", reprisePossible: false, raison: "aucun_numero" as RaisonImpossible, cibles };
  return { fournisseur: "twilio", reprisePossible: true, raison: null, cibles };
}

// ── Reprise ────────────────────────────────────────────────────────────────

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type IssueReprise =
  | { ok: true; cible: CibleReprise }
  | { ok: false; code: "introuvable" | "deja_repris" | "termine" | RaisonImpossible | "cible_inconnue" | "twilio"; raison?: string };

async function ajouterJournal(orgId: number, callSid: string, ligne: string) {
  await db.update(voiceCallSessionsTable).set({
    state: sql`jsonb_set(${voiceCallSessionsTable.state}, '{journal}', coalesce(${voiceCallSessionsTable.state}->'journal', '[]'::jsonb) || to_jsonb(${ligne}::text))`,
  }).where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId)));
}

export async function reprendreAppel(orgId: number, userId: number, callSid: string, cibleId: string, maintenant: Date = new Date()): Promise<IssueReprise> {
  const [s] = await db.select({ providerId: voiceCallSessionsTable.providerId })
    .from(voiceCallSessionsTable)
    .where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId))).limit(1);
  if (!s) return { ok: false, code: "introuvable" };

  // Capacite AVANT la revendication : sans fournisseur, rien n'est revendique.
  const f = await fournisseurTwilio(orgId, s.providerId);
  if (f === null) return { ok: false, code: "aucun_fournisseur" };
  if (f === "incomplet") return { ok: false, code: "fournisseur_incomplet" };
  const cibles = await ciblesDisponibles(orgId, userId, f.ia);
  if (!cibles.length) return { ok: false, code: "aucun_numero" };
  const cible = cibles.find((c) => c.id === cibleId);
  if (!cible) return { ok: false, code: "cible_inconnue" };

  const pris = await db.update(voiceCallSessionsTable).set({
    takeoverStatus: "en_cours", takenOverByUserId: userId, takenOverAt: maintenant,
  }).where(and(
    eq(voiceCallSessionsTable.callSid, callSid),
    conditionAppelEnDirect(orgId, maintenant),
    isNull(voiceCallSessionsTable.takeoverStatus),
  )).returning({ id: voiceCallSessionsTable.id });
  if (!pris.length) {
    const [etat] = await db.select({ t: voiceCallSessionsTable.takeoverStatus }).from(voiceCallSessionsTable)
      .where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId))).limit(1);
    return { ok: false, code: etat?.t ? "deja_repris" : "termine" };
  }

  // L'appelant voit le numero de l'entreprise (callerId = numero Twilio),
  // jamais le portable personnel du collaborateur.
  const twiml = `<Response><Dial callerId="${xml(f.fromNumber)}"><Number>${xml(cible.numero)}</Number></Dial></Response>`;
  let raison: string | null = null;
  try {
    const resp = await twilioHttp(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(f.accountSid)}/Calls/${encodeURIComponent(callSid)}.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${f.accountSid}:${f.authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Twiml: twiml }).toString(),
      },
    );
    if (!resp.ok) {
      const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      raison = typeof data.message === "string" && data.message ? data.message.slice(0, 300) : `Twilio HTTP ${resp.status}`;
    }
  } catch (err) {
    raison = (err as Error)?.name === "TimeoutError" ? "Twilio ne repond pas (delai depasse)" : String((err as Error)?.message ?? err).slice(0, 300);
  }
  // Le message d'erreur de Twilio ne doit jamais porter le jeton : on l'efface par prudence.
  if (raison) raison = raison.split(f.authToken).join("***");

  if (raison) {
    await db.update(voiceCallSessionsTable).set({ takeoverStatus: null, takenOverByUserId: null, takenOverAt: null })
      .where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId), eq(voiceCallSessionsTable.takeoverStatus, "en_cours")));
    return { ok: false, code: "twilio", raison };
  }
  await db.update(voiceCallSessionsTable).set({ takeoverStatus: "reussi", status: "transfert", updatedAt: new Date() })
    .where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId)));
  await ajouterJournal(orgId, callSid, `Appel repris par un collaborateur (${cible.numeroMasque})`);
  const { numero: _n, ...publique } = cible;
  return { ok: true, cible: publique };
}

/** Lie une action faite depuis l'ecran a l'appel (registre `actions`, cle unique). */
export async function lierActionAppel(orgId: number, callSid: string, type: string, id: number): Promise<void> {
  const cle = `ecran:${type}:${id}`;
  await db.update(voiceCallSessionsTable).set({
    actions: sql`${voiceCallSessionsTable.actions} || jsonb_build_object(${cle}::text, true)`,
  }).where(and(eq(voiceCallSessionsTable.callSid, callSid), eq(voiceCallSessionsTable.organisationId, orgId)));
}
