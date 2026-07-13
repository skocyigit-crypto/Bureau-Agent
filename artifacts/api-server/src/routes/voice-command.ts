import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { db, callsTable, contactsTable, tasksTable, calendarEventsTable, projetsTable, messagesTable } from "@workspace/db";
import { eq, desc, and, sql, or } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { safeJsonParse, aiCallWithRetry, sanitizePromptInput } from "../services/ai-utils";
import { assertAiQuota, AiQuotaExceededError } from "../services/ai-quota";
import { logger } from "../lib/logger";
import { logAudit } from "./audit";

let ai: any = null;
try {
  const mod = require("@workspace/integrations-gemini-ai");
  ai = mod.ai;
} catch (e) { logger.warn({ err: e }, "[VoiceCommand] Gemini AI not available:"); }

const router: IRouter = Router();

// ───────────────────────── i18n (multilingue FR / TR / EN) ───────────────────
// Toutes les reponses parlees ("spoken") passent par t(lang, key, vars). Les
// gabarits utilisent {var} et {plural:n} pour la marque du pluriel. Le francais
// et l'anglais marquent le pluriel, le turc non.
type Lang = "fr" | "tr" | "en";
const SUPPORTED_LANGS: Lang[] = ["fr", "tr", "en"];

function normalizeLang(input: unknown): Lang {
  const v = String(input || "").toLowerCase().slice(0, 2);
  return (SUPPORTED_LANGS as string[]).includes(v) ? (v as Lang) : "fr";
}

function plural(n: number, lang: Lang): string {
  if (lang === "tr") return "";
  if (lang === "en") return n === 1 ? "" : "s";
  return n > 1 ? "s" : "";
}

const I18N: Record<string, Record<Lang, string>> = {
  // Read intents
  briefing: {
    fr: "Bonjour! Voici votre briefing du jour. Vous avez {c} appel{cS} aujourd'hui, {t} tache{tS} en attente, {ct} contact{ctS} au total, et {ev} evenement{evS} au calendrier.",
    tr: "Merhaba! Gunluk ozetiniz: bugun {c} arama, bekleyen {t} gorev, toplam {ct} kisi ve takvimde {ev} etkinlik var.",
    en: "Hello! Here's your daily briefing. You have {c} call{cS} today, {t} task{tS} pending, {ct} contact{ctS} total, and {ev} event{evS} on the calendar.",
  },
  count_calls: {
    fr: "Vous avez {n} appel{nS} aujourd'hui.",
    tr: "Bugun {n} aramaniz var.",
    en: "You have {n} call{nS} today.",
  },
  count_tasks: {
    fr: "Vous avez {n} tache{nS} en attente.",
    tr: "Bekleyen {n} goreviniz var.",
    en: "You have {n} task{nS} pending.",
  },
  count_contacts: {
    fr: "Vous avez {n} contact{nS} au total.",
    tr: "Toplam {n} kisiniz var.",
    en: "You have {n} contact{nS} in total.",
  },
  count_projets: {
    fr: "Vous avez {a} projet{aS} actif{aS} sur {t} au total.",
    tr: "Toplam {t} projeden {a} tanesi aktif.",
    en: "You have {a} active project{aS} out of {t} total.",
  },
  projets_overdue_some: {
    fr: "Attention: {n} projet{nS} {verb} en retard sur le planning.",
    tr: "Dikkat: planlamada {n} proje gecikmis durumda.",
    en: "Warning: {n} project{nS} {verb} behind schedule.",
  },
  projets_overdue_none: {
    fr: "Aucun projet n'est en retard. Bravo!",
    tr: "Hicbir proje gecikmemis. Tebrikler!",
    en: "No projects are behind schedule. Well done!",
  },
  recent_calls_some: {
    fr: "Vos {n} derniers appels: {names}.",
    tr: "Son {n} aramaniz: {names}.",
    en: "Your last {n} calls: {names}.",
  },
  recent_calls_none: {
    fr: "Aucun appel recent.",
    tr: "Yakin zamanda arama yok.",
    en: "No recent calls.",
  },
  urgent_tasks_some: {
    fr: "Vous avez {n} tache{nS} urgente{nS}: {titles}.",
    tr: "{n} acil goreviniz var: {titles}.",
    en: "You have {n} urgent task{nS}: {titles}.",
  },
  urgent_tasks_none: {
    fr: "Aucune tache urgente en attente.",
    tr: "Bekleyen acil gorev yok.",
    en: "No urgent tasks pending.",
  },
  call_ask: {
    fr: "Quel contact souhaitez-vous appeler?",
    tr: "Hangi kisiyi aramak istiyorsunuz?",
    en: "Which contact would you like to call?",
  },
  call_found: {
    fr: "J'ai trouve {name}. Son numero est {phone}. Lancement de l'appel.",
    tr: "{name} bulundu. Numara: {phone}. Arama baslatiliyor.",
    en: "Found {name}. The number is {phone}. Starting the call.",
  },
  call_notfound: {
    fr: "Je n'ai pas trouve de contact nomme {name}.",
    tr: "{name} adli kisi bulunamadi.",
    en: "I couldn't find a contact named {name}.",
  },
  search_ask: {
    fr: "Que souhaitez-vous rechercher?",
    tr: "Ne aramak istiyorsunuz?",
    en: "What would you like to search for?",
  },
  search_some: {
    fr: "J'ai trouve {total} resultat{tS}: {c} contact{cS} et {tk} tache{tkS}.",
    tr: "{total} sonuc bulundu: {c} kisi ve {tk} gorev.",
    en: "Found {total} result{tS}: {c} contact{cS} and {tk} task{tkS}.",
  },
  search_none: {
    fr: "Aucun resultat pour \"{q}\".",
    tr: "\"{q}\" icin sonuc yok.",
    en: "No results for \"{q}\".",
  },
  calendar_some: {
    fr: "Vous avez {n} evenement{nS} aujourd'hui: {titles}.",
    tr: "Bugun {n} etkinliginiz var: {titles}.",
    en: "You have {n} event{nS} today: {titles}.",
  },
  calendar_none: {
    fr: "Aucun evenement prevu aujourd'hui.",
    tr: "Bugun icin planlanmis etkinlik yok.",
    en: "No events scheduled today.",
  },
  performance: {
    fr: "Cette semaine: {c} appels passes et {t} taches terminees.",
    tr: "Bu hafta: {c} arama yapildi ve {t} gorev tamamlandi.",
    en: "This week: {c} calls made and {t} tasks completed.",
  },
  greeting_morning: { fr: "Bonjour", tr: "Gunaydin", en: "Good morning" },
  greeting_afternoon: { fr: "Bon apres-midi", tr: "Iyi ogleden sonralar", en: "Good afternoon" },
  greeting_evening: { fr: "Bonsoir", tr: "Iyi aksamlar", en: "Good evening" },
  greeting_full: {
    fr: "{g}! Comment puis-je vous aider?",
    tr: "{g}! Size nasil yardimci olabilirim?",
    en: "{g}! How can I help you?",
  },
  time: {
    fr: "Il est {h} heure{hS}{minPart}.",
    tr: "Saat {h}{minPart}.",
    en: "It is {h}{minPart}.",
  },
  time_min: { fr: " et {m} minute{mS}", tr: ":{mm}", en: ":{mm}" },
  thanks: {
    fr: "Je vous en prie! N'hesitez pas si vous avez besoin d'autre chose.",
    tr: "Rica ederim! Baska bir seye ihtiyaciniz olursa cekinmeyin.",
    en: "You're welcome! Let me know if you need anything else.",
  },
  help: {
    fr: "Vous pouvez me demander: le briefing du jour, compter vos appels/taches/projets, voir les projets en retard, les taches urgentes, creer une tache ou un contact, planifier un rendez-vous, envoyer un message, enregistrer un appel, appeler un contact, chercher dans vos donnees, ou consulter l'agenda. Les actions d'ecriture demandent une confirmation.",
    tr: "Sunlari isteyebilirsiniz: gunluk ozet, aramalari/gorevleri/projeleri saymak, gecikmis projeleri ve acil gorevleri gormek, gorev veya kisi olusturmak, randevu planlamak, mesaj gondermek, arama kaydetmek, kisi aramak, verilerde arama yapmak veya takvime bakmak. Yazma islemleri onay gerektirir.",
    en: "You can ask me: today's briefing, count your calls/tasks/projects, see overdue projects or urgent tasks, create a task or contact, schedule a meeting, send a message, log a call, call a contact, search your data, or view the calendar. Write actions require confirmation.",
  },
  unknown: {
    fr: "Je n'ai pas compris \"{text}\". Dites \"aide\".",
    tr: "\"{text}\" ifadesini anlamadim. \"Yardim\" diyebilirsiniz.",
    en: "I didn't understand \"{text}\". Say \"help\".",
  },
  server_error: {
    fr: "Une erreur est survenue. Veuillez reessayer.",
    tr: "Bir hata olustu. Lutfen tekrar deneyin.",
    en: "An error occurred. Please try again.",
  },
  // Pending action summaries
  pending_create_task_spoken: {
    fr: "Voulez-vous que je cree la tache \"{title}\" ? Confirmez pour valider.",
    tr: "\"{title}\" gorevini olusturmami ister misiniz? Onaylayin.",
    en: "Do you want me to create the task \"{title}\"? Please confirm.",
  },
  pending_create_task_summary: {
    fr: "Creer une tache : {title}",
    tr: "Gorev olustur: {title}",
    en: "Create a task: {title}",
  },
  pending_create_contact_spoken: {
    fr: "Voulez-vous que je cree le contact {name} ? Confirmez pour valider.",
    tr: "{name} adli kisiyi olusturmami ister misiniz? Onaylayin.",
    en: "Do you want me to create the contact {name}? Please confirm.",
  },
  pending_create_contact_summary: {
    fr: "Creer un contact : {name}",
    tr: "Kisi olustur: {name}",
    en: "Create a contact: {name}",
  },
  pending_schedule_spoken: {
    fr: "Voulez-vous planifier \"{title}\" avec {who} ? Confirmez pour valider.",
    tr: "{who} ile \"{title}\" toplantisini planlamami ister misiniz? Onaylayin.",
    en: "Do you want to schedule \"{title}\" with {who}? Please confirm.",
  },
  pending_schedule_summary: {
    fr: "Planifier : {title}",
    tr: "Planla: {title}",
    en: "Schedule: {title}",
  },
  pending_message_spoken: {
    fr: "Voulez-vous envoyer un message a {who} ? Confirmez pour valider.",
    tr: "{who} kisisine mesaj gondermek istiyor musunuz? Onaylayin.",
    en: "Do you want to send a message to {who}? Please confirm.",
  },
  pending_message_summary: {
    fr: "Envoyer un message a {who}",
    tr: "{who} kisisine mesaj gonder",
    en: "Send a message to {who}",
  },
  pending_log_call_spoken: {
    fr: "Voulez-vous enregistrer un appel avec {who} ? Confirmez pour valider.",
    tr: "{who} ile yapilan bir aramayi kaydetmek istiyor musunuz? Onaylayin.",
    en: "Do you want to log a call with {who}? Please confirm.",
  },
  pending_log_call_summary: {
    fr: "Enregistrer un appel avec {who}",
    tr: "{who} ile arama kaydet",
    en: "Log a call with {who}",
  },
  // Field labels
  field_title: { fr: "Titre", tr: "Baslik", en: "Title" },
  field_priority: { fr: "Priorite", tr: "Oncelik", en: "Priority" },
  field_status: { fr: "Statut", tr: "Durum", en: "Status" },
  field_priority_medium: { fr: "moyenne", tr: "orta", en: "medium" },
  field_status_pending: { fr: "en attente", tr: "beklemede", en: "pending" },
  field_name: { fr: "Nom", tr: "Isim", en: "Name" },
  field_phone: { fr: "Telephone", tr: "Telefon", en: "Phone" },
  field_email: { fr: "Email", tr: "E-posta", en: "Email" },
  field_contact: { fr: "Contact", tr: "Kisi", en: "Contact" },
  field_date: { fr: "Date", tr: "Tarih", en: "Date" },
  field_recipient: { fr: "Destinataire", tr: "Alici", en: "Recipient" },
  field_content: { fr: "Contenu", tr: "Icerik", en: "Content" },
  field_note: { fr: "Note", tr: "Not", en: "Note" },
  field_unspecified: { fr: "(non specifie)", tr: "(belirtilmemis)", en: "(unspecified)" },
  field_no_note: { fr: "(aucune)", tr: "(yok)", en: "(none)" },
  field_default_date: { fr: "demain 10h00 (par defaut)", tr: "yarin 10:00 (varsayilan)", en: "tomorrow 10:00 (default)" },
  field_empty_body: { fr: "(message vide)", tr: "(bos mesaj)", en: "(empty message)" },
  // Confirm action responses
  done_task: {
    fr: "La tache \"{title}\" a ete creee.",
    tr: "\"{title}\" gorevi olusturuldu.",
    en: "The task \"{title}\" has been created.",
  },
  done_contact: {
    fr: "Le contact {name} a ete cree.",
    tr: "{name} adli kisi olusturuldu.",
    en: "Contact {name} has been created.",
  },
  done_meeting: {
    fr: "Rendez-vous \"{title}\" planifie pour demain a 10 heures.",
    tr: "\"{title}\" randevusu yarin saat 10:00 icin planlandi.",
    en: "Meeting \"{title}\" scheduled for tomorrow at 10:00.",
  },
  done_message: {
    fr: "Message a {who} enregistre.",
    tr: "{who} kisisine mesaj kaydedildi.",
    en: "Message to {who} saved.",
  },
  done_call: {
    fr: "Appel avec {who} enregistre.",
    tr: "{who} ile yapilan arama kaydedildi.",
    en: "Call with {who} logged.",
  },
  err_empty_msg: {
    fr: "Message vide. Veuillez recommencer.",
    tr: "Bos mesaj. Lutfen tekrar deneyin.",
    en: "Empty message. Please try again.",
  },
  err_no_phone: {
    fr: "Aucun numero trouve pour {who}.",
    tr: "{who} icin numara bulunamadi.",
    en: "No phone number found for {who}.",
  },
  err_expired: {
    fr: "Action expiree ou invalide. Repetez votre commande.",
    tr: "Eylem suresi doldu veya gecersiz. Komutu tekrar edin.",
    en: "Action expired or invalid. Repeat your command.",
  },
  err_wrong_org: {
    fr: "Action refusee : organisation differente.",
    tr: "Eylem reddedildi: farkli organizasyon.",
    en: "Action denied: different organisation.",
  },
  err_wrong_user: {
    fr: "Action refusee : utilisateur different.",
    tr: "Eylem reddedildi: farkli kullanici.",
    en: "Action denied: different user.",
  },
  err_replay: {
    fr: "Cette action a deja ete executee.",
    tr: "Bu eylem zaten gerceklestirildi.",
    en: "This action has already been executed.",
  },
  err_exec: {
    fr: "Une erreur est survenue lors de l'execution.",
    tr: "Yurutme sirasinda bir hata olustu.",
    en: "An error occurred during execution.",
  },
  err_unsupported: {
    fr: "Intent non supporte.",
    tr: "Desteklenmeyen komut.",
    en: "Unsupported intent.",
  },
  // Generic fallbacks
  no_contact_generic: { fr: "le contact", tr: "kisi", en: "the contact" },
  no_recipient_generic: { fr: "destinataire", tr: "alici", en: "recipient" },
};

function t(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const tpl = I18N[key]?.[lang] ?? I18N[key]?.fr ?? "";
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function getLang(req: Request): Lang {
  // Priorite: body.language > header X-Voice-Lang > defaut "fr"
  return normalizeLang((req.body && (req.body as any).language) || req.get("X-Voice-Lang"));
}

// ───────────────────────── Pending action token ──────────────────────────────
// Write intents are NEVER executed inline. The parsed action is signed into a
// token (HMAC-SHA256, 5-min TTL) and returned to the client; the UI must show
// a confirmation card and call POST /voice/confirm to execute.
const PENDING_TTL_MS = 5 * 60_000;
const WRITE_INTENTS = new Set([
  "create_task",
  "create_contact",
  "schedule_meeting",
  "send_message",
  "log_call",
]);

// Secret rotation: returns ALL valid secrets (newest first). Sign uses [0],
// verify accepts any entry. SESSION_SECRETS (comma-separated) is preferred;
// SESSION_SECRET / JWT_SECRET kept for backward compatibility.
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
    throw new Error("SESSION_SECRETS (or SESSION_SECRET / JWT_SECRET) is required in production for voice action signing");
  }
  return ["dev-voice-pending-secret-do-not-use-in-prod"];
}

// One-shot replay protection: tokens may only be redeemed once within their
// TTL window. Stores token signatures (small) with their expiry; opportunistic
// GC keeps the map bounded.
const usedTokens = new Map<string, number>();
function consumeTokenOnce(sig: string, exp: number): boolean {
  const now = Date.now();
  // GC expired entries; bound size to ~10k.
  if (usedTokens.size > 10_000) {
    for (const [k, e] of usedTokens) if (e < now) usedTokens.delete(k);
  }
  if (usedTokens.has(sig)) return false;
  usedTokens.set(sig, exp);
  return true;
}

function signPendingAction(payload: object): string {
  const json = Buffer.from(JSON.stringify(payload)).toString("base64url");
  // Sign with the freshest secret; verify accepts any active secret.
  const sig = crypto.createHmac("sha256", getPendingSecrets()[0]).update(json).digest("base64url");
  return `${json}.${sig}`;
}

function verifyPendingAction(token: string): any | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [json, sig] = token.split(".");
  let sigBuf: Buffer;
  try { sigBuf = Buffer.from(sig, "base64url"); } catch { return null; }
  // Constant-time compare against EVERY active secret. Loop runs to completion
  // (no short-circuit on first match) so total work depends only on secret
  // count, not on which secret signed the token — preserves timing-safety.
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
  } catch { return null; }
}

// ───────────────────────── Intent parsing ────────────────────────────────────
interface VoiceCommand {
  intent: string;
  entity?: string;
  params?: Record<string, string>;
}

function parseCommandRegex(text: string): VoiceCommand {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // FR/EN/TR. Le texte est deja sans accents (NFD + strip). Pour le turc, "ı"
  // devient "i", "ğ"→"g", "ş"→"s", etc., donc on cible la forme normalisee.
  if (t.match(/briefing|resume.*(jour|today)|quoi de neuf|resume|daily.*brief|gunluk.*ozet|ozet/))
    return { intent: "daily_briefing" };
  if (t.match(/combien.*(appel|call)|nombre.*(appel|call)|appels.*aujourd|how many.*call|kac.*arama|arama.*sayi/))
    return { intent: "count_calls" };
  if (t.match(/combien.*(tache|task)|nombre.*(tache|task)|taches.*(attente|pending)|pending.*task|kac.*gorev|bekleyen.*gorev/))
    return { intent: "count_tasks" };
  if (t.match(/combien.*(contact)|nombre.*(contact)|how many.*contact|kac.*kisi/))
    return { intent: "count_contacts" };
  if (t.match(/derniers? appels?|appels? recents?|recent.*call|son.*arama/))
    return { intent: "recent_calls" };
  if (t.match(/taches? urgente|taches? haute|taches? priorite|urgent.*task|acil.*gorev/))
    return { intent: "urgent_tasks" };

  // ── Write intents (require confirmation) ────────────────────────────────
  if (t.match(/(planifie|programme|prend|fixe|reserve).*(rdv|rendez|reunion|meeting|rv)|(rdv|reunion|rendez vous|meeting).*(avec|le|demain|aujourd)/)) {
    const withMatch = text.match(/avec\s+([^,.;]+?)(?:\s+(?:le|demain|aujourd|a\b|à\b|$))/i);
    const titleMatch = text.match(/(?:reunion|rdv|rendez.?vous|meeting)\s+(?:avec\s+)?([^,.;]+)/i);
    return {
      intent: "schedule_meeting",
      params: {
        title: (titleMatch?.[1] || "Nouveau rendez-vous").trim(),
        contactName: (withMatch?.[1] || "").trim(),
        rawText: text,
      },
    };
  }
  if (t.match(/(envoie|envoyer|send).*(sms|message|msg).*(a |au |à )|(sms|message)\s+(a |au |à )/)) {
    const toMatch = text.match(/(?:a |au |à )\s*([A-Za-zÀ-ÿ' -]+?)(?:\s+(?:disant|dis|que|pour|:|$))/i);
    const bodyMatch = text.match(/(?:disant|dis|que|:)\s*(.+)$/i);
    return {
      intent: "send_message",
      params: {
        contactName: (toMatch?.[1] || "").trim(),
        body: (bodyMatch?.[1] || "").trim(),
        rawText: text,
      },
    };
  }
  if (t.match(/(enregistre|note|log|consigne).*(appel|call)|(appel|call).*(enregistre|note|consigne)/)) {
    const withMatch = text.match(/(?:avec|de|à|a)\s+([A-Za-zÀ-ÿ' -]+?)(?:\s+(?:dur|de|sur|:|$))/i);
    const noteMatch = text.match(/(?:note|notes|sujet|à propos|a propos)\s*[:,-]?\s*(.+)$/i);
    return {
      intent: "log_call",
      params: {
        contactName: (withMatch?.[1] || "").trim(),
        note: (noteMatch?.[1] || "").trim(),
        rawText: text,
      },
    };
  }
  if (t.match(/(cre(e|er)|ajoute|nouveau).*(contact)|nouveau client/)) {
    const nameMatch = text.match(/(?:contact|client)\s+(?:nomm(?:e|é|ée)\s+)?([A-Za-zÀ-ÿ' -]+?)(?:\s+(?:tel|telephone|téléphone|email|@|$))/i);
    const phoneMatch = text.match(/(\+?\d[\d\s.-]{7,}\d)/);
    const emailMatch = text.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
    return {
      intent: "create_contact",
      params: {
        name: (nameMatch?.[1] || "Nouveau contact").trim(),
        phone: (phoneMatch?.[1] || "").replace(/[\s.-]/g, ""),
        email: emailMatch?.[1] || "",
        rawText: text,
      },
    };
  }
  if (t.match(/cre(e|er).*tache|nouvelle? tache|ajoute.*tache|new.*task/)) {
    const titleMatch = text.match(/(?:tache|task)\s+(.+)/i);
    return { intent: "create_task", params: { title: (titleMatch?.[1] || "Nouvelle tache").trim() } };
  }

  if (t.match(/appel(le|er)?\s|telephone|call\s/)) {
    const nameMatch = text.match(/(?:appelle|appeler|call)\s+(.+)/i);
    return { intent: "call_contact", params: { name: nameMatch?.[1] || "" } };
  }
  if (t.match(/cherche|recherche|trouve|search|find/)) {
    const queryMatch = text.match(/(?:cherche|recherche|trouve|search|find)\s+(.+)/i);
    return { intent: "search", params: { query: queryMatch?.[1] || "" } };
  }
  if (t.match(/combien.*(projet)|nombre.*(projet)|projets?.*(actif|retard|cours)|how many.*project|kac.*proje|aktif.*proje/))
    return { intent: "count_projets" };
  if (t.match(/projets?.*(retard|late|overdue)|retard.*projet|overdue.*project|gecikmis.*proje/))
    return { intent: "projets_overdue" };
  if (t.match(/agenda|rendez.?vous|rdv|calendrier|calendar|evenement|event|takvim|etkinlik/))
    return { intent: "calendar" };
  if (t.match(/performance|statistique|stats|kpi|performans|istatistik/))
    return { intent: "performance" };
  if (t.match(/aide|help|que peux.tu|commande|command|yardim/))
    return { intent: "help" };
  if (t.match(/bonjour|salut|coucou|bonsoir|hello|hi|good (morning|afternoon|evening)|merhaba|selam|gunaydin|iyi.*(aksam|gun)/))
    return { intent: "greeting" };
  if (t.match(/heure|quelle heure|time|what.*time|saat (kac|nedir)/))
    return { intent: "time" };
  if (t.match(/merci|thank|tesekkur|sagol/))
    return { intent: "thanks" };

  return { intent: "unknown", params: { text } };
}

async function parseCommandAI(text: string, lang: Lang = "fr"): Promise<VoiceCommand> {
  if (!ai) return parseCommandRegex(text);

  const safeText = sanitizePromptInput(text, 1000);
  const langLabel = lang === "tr" ? "turkish" : lang === "en" ? "english" : "french";
  try {
    const result = await aiCallWithRetry(() => ai!.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{
        role: "user",
        parts: [{ text: `You are a voice assistant for an office management software. The user is speaking in ${langLabel}.
Analyze this voice command and return a JSON with "intent" and "params". Intent keys are language-agnostic — always use these exact English keys.

Possible intents:
- daily_briefing
- count_calls / count_tasks / count_contacts / count_projets / projets_overdue
- recent_calls / urgent_tasks
- create_task (params: {title})  -- write, requires confirmation
- create_contact (params: {name, phone, email})  -- write, requires confirmation
- schedule_meeting (params: {title, contactName, dateText})  -- write, requires confirmation
- send_message (params: {contactName, body})  -- write, requires confirmation
- log_call (params: {contactName, note, durationSec})  -- write, requires confirmation
- call_contact (params: {name})
- search (params: {query})
- calendar / performance / greeting / time / thanks / help
- unknown

Command: "${safeText}"

Reply ONLY with valid JSON, no backticks, no explanation. Params values stay in the user's original language.` }]
      }],
    }), { label: "voice-command", maxRetries: 1 });

    const parsed = safeJsonParse<VoiceCommand>((result as any).text, { intent: "unknown", params: { text } });
    if (parsed.intent) return parsed;
  } catch (err) {
    logger.warn({ err: err }, "[VoiceCommand] AI parse fallback:");
  }

  return parseCommandRegex(text);
}

// ───────────────────────── Read-intent dispatcher ────────────────────────────
async function dispatchReadIntent(
  command: VoiceCommand,
  orgId: number,
  text: string,
  lang: Lang = "fr",
): Promise<{ spoken: string; data: any; action: string | null; navigate: string | null }> {
  let spokenResponse = "";
  let data: any = null;
  let action: string | null = null;
  let navigate: string | null = null;

  switch (command.intent) {
    case "daily_briefing": {
      const [calls, tasks, contacts, events] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
          .where(and(eq(callsTable.organisationId, orgId), sql`DATE(${callsTable.createdAt}) = CURRENT_DATE`)),
        db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
          .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente"))),
        db.select({ count: sql<number>`count(*)::int` }).from(contactsTable)
          .where(eq(contactsTable.organisationId, orgId)),
        db.select({ count: sql<number>`count(*)::int` }).from(calendarEventsTable)
          .where(and(eq(calendarEventsTable.organisationId, orgId), sql`DATE(${calendarEventsTable.startDate}) = CURRENT_DATE`)),
      ]);
      const c = calls[0]?.count || 0;
      const tk = tasks[0]?.count || 0;
      const ct = contacts[0]?.count || 0;
      const ev = events[0]?.count || 0;
      spokenResponse = t(lang, "briefing", {
        c, cS: plural(c, lang),
        t: tk, tS: plural(tk, lang),
        ct, ctS: plural(ct, lang),
        ev, evS: plural(ev, lang),
      });
      data = { calls: c, tasks: tk, contacts: ct, events: ev };
      navigate = "/";
      break;
    }
    case "count_calls": {
      const [r] = await db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
        .where(and(eq(callsTable.organisationId, orgId), sql`DATE(${callsTable.createdAt}) = CURRENT_DATE`));
      const n = r?.count || 0;
      spokenResponse = t(lang, "count_calls", { n, nS: plural(n, lang) });
      data = { count: n }; navigate = "/appels"; break;
    }
    case "count_tasks": {
      const [r] = await db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
        .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente")));
      const n = r?.count || 0;
      spokenResponse = t(lang, "count_tasks", { n, nS: plural(n, lang) });
      data = { count: n }; navigate = "/taches"; break;
    }
    case "count_contacts": {
      const [r] = await db.select({ count: sql<number>`count(*)::int` }).from(contactsTable)
        .where(eq(contactsTable.organisationId, orgId));
      const n = r?.count || 0;
      spokenResponse = t(lang, "count_contacts", { n, nS: plural(n, lang) });
      data = { count: n }; navigate = "/contacts"; break;
    }
    case "count_projets": {
      const [actifs, total] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(projetsTable)
          .where(and(eq(projetsTable.organisationId, orgId), sql`${projetsTable.status} NOT IN ('termine','annule')`)),
        db.select({ count: sql<number>`count(*)::int` }).from(projetsTable)
          .where(eq(projetsTable.organisationId, orgId)),
      ]);
      const na = actifs[0]?.count || 0;
      const nt = total[0]?.count || 0;
      spokenResponse = t(lang, "count_projets", { a: na, aS: plural(na, lang), t: nt });
      data = { actifs: na, total: nt }; navigate = "/projets"; break;
    }
    case "projets_overdue": {
      const [r] = await db.select({ count: sql<number>`count(*)::int` }).from(projetsTable)
        .where(and(eq(projetsTable.organisationId, orgId), sql`${projetsTable.endDate} < now()`, sql`${projetsTable.status} NOT IN ('termine','annule')`));
      const n = r?.count || 0;
      const verb = lang === "en" ? (n === 1 ? "is" : "are") : (n > 1 ? "sont" : "est");
      spokenResponse = n > 0
        ? t(lang, "projets_overdue_some", { n, nS: plural(n, lang), verb })
        : t(lang, "projets_overdue_none");
      data = { overdue: n }; navigate = "/projets"; break;
    }
    case "recent_calls": {
      const calls = await db.select().from(callsTable)
        .where(eq(callsTable.organisationId, orgId)).orderBy(desc(callsTable.createdAt)).limit(5);
      const names = calls.map(c => c.contactName || c.phoneNumber).join(", ");
      spokenResponse = calls.length > 0
        ? t(lang, "recent_calls_some", { n: calls.length, names })
        : t(lang, "recent_calls_none");
      data = { calls: calls.map(c => ({ name: c.contactName, phone: c.phoneNumber, status: c.status })) };
      navigate = "/appels"; break;
    }
    case "urgent_tasks": {
      const tasks = await db.select().from(tasksTable)
        .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente")))
        .orderBy(desc(tasksTable.createdAt)).limit(5);
      const titles = tasks.map(tk => tk.title).join(", ");
      spokenResponse = tasks.length > 0
        ? t(lang, "urgent_tasks_some", { n: tasks.length, nS: plural(tasks.length, lang), titles })
        : t(lang, "urgent_tasks_none");
      data = { tasks: tasks.map(t => ({ id: t.id, title: t.title })) };
      navigate = "/taches"; break;
    }
    case "call_contact": {
      const name = command.params?.name || "";
      if (!name) { spokenResponse = t(lang, "call_ask"); break; }
      const useUnaccent = await ensureUnaccentExtension();
      const namePattern = `%${name}%`;
      const [contact] = await db.select().from(contactsTable)
        .where(and(eq(contactsTable.organisationId, orgId), or(
          accentInsensitiveIlike(contactsTable.firstName, namePattern, useUnaccent),
          accentInsensitiveIlike(contactsTable.lastName, namePattern, useUnaccent)
        ))).limit(1);
      if (contact && contact.phone) {
        const fullName = `${contact.firstName} ${contact.lastName}`;
        spokenResponse = t(lang, "call_found", { name: fullName, phone: contact.phone });
        data = { contact: { name: fullName, phone: contact.phone } };
        action = "initiate_call";
      } else {
        spokenResponse = t(lang, "call_notfound", { name });
      }
      break;
    }
    case "search": {
      const query = command.params?.query || "";
      if (!query) { spokenResponse = t(lang, "search_ask"); break; }
      const useUnaccent = await ensureUnaccentExtension();
      const qPattern = `%${query}%`;
      const [contacts, tasks] = await Promise.all([
        db.select().from(contactsTable).where(and(eq(contactsTable.organisationId, orgId), or(
          accentInsensitiveIlike(contactsTable.firstName, qPattern, useUnaccent),
          accentInsensitiveIlike(contactsTable.lastName, qPattern, useUnaccent),
          accentInsensitiveIlike(contactsTable.company, qPattern, useUnaccent)
        ))).limit(3),
        db.select().from(tasksTable).where(and(eq(tasksTable.organisationId, orgId),
          accentInsensitiveIlike(tasksTable.title, qPattern, useUnaccent))).limit(3),
      ]);
      const total = contacts.length + tasks.length;
      spokenResponse = total > 0
        ? t(lang, "search_some", {
            total, tS: plural(total, lang),
            c: contacts.length, cS: plural(contacts.length, lang),
            tk: tasks.length, tkS: plural(tasks.length, lang),
          })
        : t(lang, "search_none", { q: query });
      data = { contacts: contacts.map(c => `${c.firstName} ${c.lastName}`), tasks: tasks.map(t => t.title) };
      break;
    }
    case "calendar": {
      const events = await db.select().from(calendarEventsTable)
        .where(and(eq(calendarEventsTable.organisationId, orgId), sql`DATE(${calendarEventsTable.startDate}) = CURRENT_DATE`))
        .orderBy(calendarEventsTable.startDate).limit(5);
      spokenResponse = events.length > 0
        ? t(lang, "calendar_some", { n: events.length, nS: plural(events.length, lang), titles: events.map(e => e.title).join(", ") })
        : t(lang, "calendar_none");
      data = { events: events.map(e => ({ title: e.title, time: e.startDate })) };
      navigate = "/calendrier"; break;
    }
    case "performance": {
      const [calls, tasks] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
          .where(and(eq(callsTable.organisationId, orgId), sql`${callsTable.createdAt} >= now() - interval '7 days'`)),
        db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
          .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "termine"), sql`${tasksTable.updatedAt} >= now() - interval '7 days'`)),
      ]);
      const wc = calls[0]?.count || 0;
      const wt = tasks[0]?.count || 0;
      spokenResponse = t(lang, "performance", { c: wc, t: wt });
      data = { weekCalls: calls[0]?.count || 0, weekTasksDone: tasks[0]?.count || 0 };
      navigate = "/analyse"; break;
    }
    case "greeting": {
      const hour = new Date().getHours();
      const gKey = hour < 12 ? "greeting_morning" : hour < 18 ? "greeting_afternoon" : "greeting_evening";
      spokenResponse = t(lang, "greeting_full", { g: t(lang, gKey) }); break;
    }
    case "time": {
      const now = new Date();
      const h = now.getHours(); const m = now.getMinutes();
      const minPart = m > 0
        ? t(lang, "time_min", { m, mS: plural(m, lang), mm: String(m).padStart(2, "0") })
        : "";
      spokenResponse = t(lang, "time", { h, hS: plural(h, lang), minPart });
      break;
    }
    case "thanks": {
      spokenResponse = t(lang, "thanks"); break;
    }
    case "help": {
      spokenResponse = t(lang, "help"); break;
    }
    default: {
      if (ai) {
        try {
          const langName = lang === "tr" ? "Turkish" : lang === "en" ? "English" : "French";
          const result = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{ role: "user", parts: [{ text: `You are the "Bureau" voice assistant. The user said: "${text}". Reply in ${langName} (2-3 sentences). If off-topic, suggest available features (daily briefing, counts, search, scheduling, etc.).` }] }],
          });
          spokenResponse = (result.text || "").trim() || t(lang, "unknown", { text });
        } catch {
          spokenResponse = t(lang, "unknown", { text });
        }
      } else {
        spokenResponse = t(lang, "unknown", { text });
      }
    }
  }
  return { spoken: spokenResponse, data, action, navigate };
}

// ───────────────────────── Pending action summarizer ─────────────────────────
function summarizePendingAction(intent: string, params: Record<string, string>, lang: Lang = "fr"): {
  spoken: string;
  summary: string;
  fields: { label: string; value: string }[];
} {
  const unspec = t(lang, "field_unspecified");
  switch (intent) {
    case "create_task": {
      const title = params.title || (lang === "tr" ? "Basliksiz" : lang === "en" ? "Untitled" : "Sans titre");
      return {
        spoken: t(lang, "pending_create_task_spoken", { title }),
        summary: t(lang, "pending_create_task_summary", { title }),
        fields: [
          { label: t(lang, "field_title"), value: title },
          { label: t(lang, "field_priority"), value: t(lang, "field_priority_medium") },
          { label: t(lang, "field_status"), value: t(lang, "field_status_pending") },
        ],
      };
    }
    case "create_contact": {
      const name = params.name || (lang === "tr" ? "Isimsiz" : lang === "en" ? "Unnamed" : "Sans nom");
      return {
        spoken: t(lang, "pending_create_contact_spoken", { name }),
        summary: t(lang, "pending_create_contact_summary", { name }),
        fields: [
          { label: t(lang, "field_name"), value: name },
          { label: t(lang, "field_phone"), value: params.phone || unspec },
          { label: t(lang, "field_email"), value: params.email || unspec },
        ],
      };
    }
    case "schedule_meeting": {
      const title = params.title || (lang === "tr" ? "Yeni randevu" : lang === "en" ? "New meeting" : "Nouveau rendez-vous");
      const who = params.contactName || unspec;
      return {
        spoken: t(lang, "pending_schedule_spoken", { title, who }),
        summary: t(lang, "pending_schedule_summary", { title }),
        fields: [
          { label: t(lang, "field_title"), value: title },
          { label: t(lang, "field_contact"), value: who },
          { label: t(lang, "field_date"), value: params.dateText || t(lang, "field_default_date") },
        ],
      };
    }
    case "send_message": {
      const who = params.contactName || unspec;
      const body = params.body || t(lang, "field_empty_body");
      return {
        spoken: t(lang, "pending_message_spoken", { who }),
        summary: t(lang, "pending_message_summary", { who }),
        fields: [
          { label: t(lang, "field_recipient"), value: who },
          { label: t(lang, "field_content"), value: body },
        ],
      };
    }
    case "log_call": {
      const who = params.contactName || unspec;
      return {
        spoken: t(lang, "pending_log_call_spoken", { who }),
        summary: t(lang, "pending_log_call_summary", { who }),
        fields: [
          { label: t(lang, "field_contact"), value: who },
          { label: t(lang, "field_note"), value: params.note || t(lang, "field_no_note") },
        ],
      };
    }
  }
  return { spoken: "Action a confirmer.", summary: intent, fields: [] };
}

// ───────────────────────── Routes ────────────────────────────────────────────
router.post("/voice/command", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { text } = req.body;
  const lang = getLang(req);

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Texte requis" });
    return;
  }

  try { await assertAiQuota(orgId); } catch (qe) {
    if (qe instanceof AiQuotaExceededError) { res.status(429).json({ error: qe.message, quotaExceeded: true }); return; }
    throw qe;
  }

  const command = await parseCommandAI(text, lang);

  // Write intents are NEVER executed inline. Return a signed pending action.
  if (WRITE_INTENTS.has(command.intent)) {
    const params = (command.params || {}) as Record<string, string>;
    const summary = summarizePendingAction(command.intent, params, lang);
    const token = signPendingAction({
      intent: command.intent,
      params,
      orgId,
      userId: req.session?.userId ?? null,
      exp: Date.now() + PENDING_TTL_MS,
      raw: text.slice(0, 500),
    });
    res.json({
      success: true,
      intent: command.intent,
      requiresConfirmation: true,
      pendingAction: {
        token,
        intent: command.intent,
        summary: summary.summary,
        fields: summary.fields,
        expiresInMs: PENDING_TTL_MS,
      },
      spoken: summary.spoken,
    });
    return;
  }

  try {
    const result = await dispatchReadIntent(command, orgId, text, lang);
    res.json({ success: true, intent: command.intent, ...result });
  } catch (err) {
    logger.error({ err }, "[VoiceCommand] Error:");
    res.status(500).json({ success: false, spoken: t(lang, "server_error") });
  }
});

// ───────────────────────── Free-form chat endpoint ───────────────────────────
// Mode "sohbet": l'utilisateur converse librement avec l'assistant. Le backend
// ne tente PAS de parser un intent — on envoie directement la conversation
// (system prompt + N derniers tours + nouveau message) au modele Gemini Flash.
// Permet a l'utilisateur de poser des questions ouvertes, brainstormer, etc.
type ChatTurn = { role: "user" | "assistant"; text: string };
const MAX_CHAT_HISTORY = 10;
const MAX_CHAT_TEXT_LEN = 2000;

function buildChatSystemPrompt(lang: Lang): string {
  const langName = lang === "tr" ? "Turkish" : lang === "en" ? "English" : "French";
  const today = new Date().toLocaleDateString(
    lang === "tr" ? "tr-TR" : lang === "en" ? "en-US" : "fr-FR",
    { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  );
  return `You are "Bureau", a friendly office-management AI assistant inside a French B2B SaaS called "Agent de Bureau". The user is a small-business owner or office worker.

Today is ${today}.

Capabilities you can mention when asked:
- Daily briefing, counts of calls/tasks/contacts/projects
- Recent calls, urgent or pending tasks, overdue projects
- Calendar/agenda, performance dashboard
- Creating tasks/contacts, scheduling meetings, sending messages, logging calls
- Search across contacts and data

Rules:
- ALWAYS reply in ${langName}.
- Be concise: 1 to 4 short sentences (the reply will be spoken aloud).
- Be warm and professional. Use plain language, no markdown, no bullet lists, no emoji.
- If the user asks for an action you can do (create task, schedule, etc.), suggest they say it as a command, e.g. "Cree une tache pour rappeler Jean demain".
- If you don't know something, say so briefly and offer an alternative.`;
}

router.post("/voice/chat", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const lang = getLang(req);
  const { text, history, deep } = req.body ?? {};
  // Mode "derin dusunce": bascule sur Gemini Pro pour les questions strategiques
  // / brainstorming / analyse. Plus lent et plus couteux mais raisonnement bien
  // meilleur. Off par defaut pour preserver le quota.
  const useDeep = deep === true || deep === "true";

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Texte requis" });
    return;
  }

  try { await assertAiQuota(orgId); } catch (qe) {
    if (qe instanceof AiQuotaExceededError) { res.status(429).json({ error: qe.message, quotaExceeded: true }); return; }
    throw qe;
  }

  if (!ai) {
    res.json({ success: true, intent: "chat", spoken: t(lang, "unknown", { text }) });
    return;
  }

  const safeText = sanitizePromptInput(text, MAX_CHAT_TEXT_LEN);
  const safeHistory: ChatTurn[] = Array.isArray(history)
    ? history
        .filter((h: any) => h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string")
        .slice(-MAX_CHAT_HISTORY)
        .map((h: any) => ({ role: h.role, text: sanitizePromptInput(String(h.text), MAX_CHAT_TEXT_LEN) }))
    : [];

  try {
    // Gemini accepte system instruction + multi-turn. Les roles Gemini sont
    // "user" et "model" (pas "assistant"), on traduit.
    const contents = [
      ...safeHistory.map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.text }],
      })),
      { role: "user", parts: [{ text: safeText }] },
    ];

    // Modeles "courants" (versions Gemini 3 preview). flash-preview pour le mode
    // standard (rapide, conversationnel) et 3.1-pro-preview pour le mode "Derin
    // Dusunce" (raisonnement profond, brainstorming, analyse strategique).
    const modelId = useDeep ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";
    const result = await aiCallWithRetry(
      () =>
        ai!.models.generateContent({
          model: modelId,
          contents,
          config: { systemInstruction: buildChatSystemPrompt(lang) },
        }),
      { label: useDeep ? "voice-chat-deep" : "voice-chat", maxRetries: 1 },
    );

    const spoken = ((result as any).text || "").trim() || t(lang, "unknown", { text });
    res.json({ success: true, intent: "chat", spoken, model: modelId, deep: useDeep });
  } catch (err) {
    logger.error({ err }, "[VoiceChat] Error:");
    res.status(500).json({ success: false, spoken: t(lang, "server_error") });
  }
});

router.post("/voice/confirm", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const userId = req.session?.userId;
  const userEmail = req.session?.userEmail;
  const { token } = req.body ?? {};
  const lang = getLang(req);

  const tokenStr = String(token || "");
  const payload = verifyPendingAction(tokenStr);
  if (!payload) {
    res.status(400).json({ success: false, error: t(lang, "err_expired") });
    return;
  }
  if (payload.orgId !== orgId) {
    res.status(403).json({ success: false, error: t(lang, "err_wrong_org") });
    return;
  }
  // Strict user binding: if the original action was created in an authenticated
  // session, the confirmer MUST be the same user (no anonymous bypass).
  if (payload.userId != null) {
    if (!userId || payload.userId !== userId) {
      res.status(403).json({ success: false, error: t(lang, "err_wrong_user") });
      return;
    }
  }
  // Replay protection: each signed token may be confirmed only once.
  const sig = tokenStr.split(".")[1] || tokenStr;
  if (!consumeTokenOnce(sig, payload.exp)) {
    res.status(409).json({ success: false, error: t(lang, "err_replay") });
    return;
  }

  const params: Record<string, string> = payload.params || {};
  const ip = req.ip;
  const ua = req.get("user-agent") || undefined;

  try {
    switch (payload.intent) {
      case "create_task": {
        const title = (params.title || "Nouvelle tache vocale").slice(0, 200);
        const [row] = await db.insert(tasksTable).values({
          organisationId: orgId,
          title,
          description: `Cree par commande vocale: "${payload.raw || ""}"`,
          status: "en_attente",
          priority: "moyenne",
          createdBy: userId || null,
        }).returning({ id: tasksTable.id });
        await logAudit(userId, userEmail, "voice_create_task", "task", String(row?.id), { title, raw: payload.raw }, ip, ua, orgId);
        res.json({ success: true, action: "task_created", spoken: t(lang, "done_task", { title }), navigate: "/taches", id: row?.id });
        return;
      }
      case "create_contact": {
        const fullName = (params.name || "Nouveau contact").trim();
        const [first, ...rest] = fullName.split(/\s+/);
        const lastName = rest.join(" ") || "";
        const [row] = await db.insert(contactsTable).values({
          organisationId: orgId,
          firstName: first || fullName,
          lastName: lastName || "",
          phone: params.phone || null,
          email: params.email || null,
          createdBy: userId || null,
        } as any).returning({ id: contactsTable.id });
        await logAudit(userId, userEmail, "voice_create_contact", "contact", String(row?.id), { name: fullName, phone: params.phone, email: params.email }, ip, ua, orgId);
        res.json({ success: true, action: "contact_created", spoken: t(lang, "done_contact", { name: fullName }), navigate: "/contacts", id: row?.id });
        return;
      }
      case "schedule_meeting": {
        const title = (params.title || "Nouveau rendez-vous").slice(0, 200);
        // Default: tomorrow 10:00 → 11:00 local time
        const start = new Date();
        start.setDate(start.getDate() + 1);
        start.setHours(10, 0, 0, 0);
        const end = new Date(start.getTime() + 60 * 60_000);
        const [row] = await db.insert(calendarEventsTable).values({
          organisationId: orgId,
          title,
          description: `Planifie par commande vocale: "${payload.raw || ""}"${params.contactName ? ` - avec ${params.contactName}` : ""}`,
          type: "rendez_vous",
          startDate: start,
          endDate: end,
          contactName: params.contactName || null,
          createdBy: userId || null,
        } as any).returning({ id: calendarEventsTable.id });
        await logAudit(userId, userEmail, "voice_schedule_meeting", "calendar_event", String(row?.id), { title, contactName: params.contactName, startDate: start.toISOString() }, ip, ua, orgId);
        res.json({ success: true, action: "meeting_scheduled", spoken: t(lang, "done_meeting", { title }), navigate: "/calendrier", id: row?.id });
        return;
      }
      case "send_message": {
        const who = (params.contactName || "").trim();
        const body = (params.body || "").trim();
        if (!body) {
          res.status(400).json({ success: false, error: t(lang, "err_empty_msg") });
          return;
        }
        // Resolve contact (best-effort) for phone number
        let phone = "";
        let contactId: number | null = null;
        if (who) {
          const useUnaccent = await ensureUnaccentExtension();
          const namePattern = `%${who}%`;
          const [c] = await db.select().from(contactsTable)
            .where(and(eq(contactsTable.organisationId, orgId), or(
              accentInsensitiveIlike(contactsTable.firstName, namePattern, useUnaccent),
              accentInsensitiveIlike(contactsTable.lastName, namePattern, useUnaccent)
            ))).limit(1);
          if (c) { phone = c.phone || ""; contactId = c.id; }
        }
        if (!phone) {
          res.status(400).json({ success: false, error: t(lang, "err_no_phone", { who: who || t(lang, "no_contact_generic") }) });
          return;
        }
        const [row] = await db.insert(messagesTable).values({
          organisationId: orgId,
          contactId,
          contactName: who || null,
          phoneNumber: phone,
          content: body.slice(0, 1000),
          type: "sms_sortant",
          priority: "moyenne",
          createdBy: userId || null,
        } as any).returning({ id: messagesTable.id });
        await logAudit(userId, userEmail, "voice_send_message", "message", String(row?.id), { contactName: who, phone, body: body.slice(0, 200) }, ip, ua, orgId);
        res.json({ success: true, action: "message_sent", spoken: t(lang, "done_message", { who: who || t(lang, "no_recipient_generic") }), navigate: "/messages", id: row?.id });
        return;
      }
      case "log_call": {
        const who = (params.contactName || "").trim();
        let phone = ""; let contactId: number | null = null; let firstName: string | null = null; let lastName: string | null = null;
        if (who) {
          const useUnaccent = await ensureUnaccentExtension();
          const namePattern = `%${who}%`;
          const [c] = await db.select().from(contactsTable)
            .where(and(eq(contactsTable.organisationId, orgId), or(
              accentInsensitiveIlike(contactsTable.firstName, namePattern, useUnaccent),
              accentInsensitiveIlike(contactsTable.lastName, namePattern, useUnaccent)
            ))).limit(1);
          if (c) { phone = c.phone || ""; contactId = c.id; firstName = c.firstName; lastName = c.lastName; }
        }
        const [row] = await db.insert(callsTable).values({
          organisationId: orgId,
          contactId,
          contactName: firstName ? `${firstName} ${lastName ?? ""}`.trim() : (who || null),
          phoneNumber: phone || (params.phone || ""),
          status: "termine",
          notes: (params.note || "").slice(0, 1000),
          createdBy: userId || null,
        } as any).returning({ id: callsTable.id });
        await logAudit(userId, userEmail, "voice_log_call", "call", String(row?.id), { contactName: who, note: params.note }, ip, ua, orgId);
        res.json({ success: true, action: "call_logged", spoken: t(lang, "done_call", { who: who || t(lang, "no_contact_generic") }), navigate: "/appels", id: row?.id });
        return;
      }
    }
    res.status(400).json({ success: false, error: t(lang, "err_unsupported") });
  } catch (err: any) {
    logger.error({ err: err?.message, intent: payload.intent }, "[VoiceCommand/confirm] Error:");
    res.status(500).json({ success: false, error: t(lang, "err_exec") });
  }
});

router.post("/voice/cancel", async (_req: Request, res: Response): Promise<void> => {
  // Stateless tokens expire on their own; no server-side state to clear.
  res.json({ success: true });
});

// Liste des phrases d'exemple par langue. Les phrases changent selon la langue
// que l'utilisateur a choisie dans l'assistant vocal (query ?lang=fr|tr|en).
const COMMANDS_BY_LANG: Record<Lang, { phrase: string; description: string }[]> = {
  fr: [
    { phrase: "Briefing du jour", description: "Resume complet de la journee" },
    { phrase: "Combien d'appels aujourd'hui", description: "Nombre d'appels du jour" },
    { phrase: "Taches en attente", description: "Nombre de taches en attente" },
    { phrase: "Combien de projets actifs", description: "Nombre de projets en cours" },
    { phrase: "Projets en retard", description: "Projets depasses sur le planning" },
    { phrase: "Derniers appels", description: "Les 5 derniers appels" },
    { phrase: "Taches urgentes", description: "Taches haute priorite" },
    { phrase: "Cree une tache [titre]", description: "Creer une tache (confirmation requise)" },
    { phrase: "Cree un contact [nom] tel [numero]", description: "Creer un contact (confirmation requise)" },
    { phrase: "Planifie un rendez-vous avec [nom]", description: "Planifier un RDV (confirmation requise)" },
    { phrase: "Envoie un message a [nom] : [contenu]", description: "Envoyer un SMS (confirmation requise)" },
    { phrase: "Enregistre un appel avec [nom] note [texte]", description: "Logger un appel (confirmation requise)" },
    { phrase: "Appelle [nom]", description: "Trouver et appeler un contact" },
    { phrase: "Cherche [texte]", description: "Recherche dans contacts et taches" },
    { phrase: "Agenda du jour", description: "Evenements du calendrier" },
    { phrase: "Performance", description: "Stats de la semaine" },
    { phrase: "Quelle heure est-il", description: "Heure actuelle" },
    { phrase: "Aide", description: "Liste des commandes" },
  ],
  tr: [
    { phrase: "Gunluk ozet", description: "Gunun tam ozeti" },
    { phrase: "Bugun kac arama var", description: "Bugunku arama sayisi" },
    { phrase: "Bekleyen gorevler", description: "Bekleyen gorev sayisi" },
    { phrase: "Kac aktif proje var", description: "Devam eden proje sayisi" },
    { phrase: "Gecikmis projeler", description: "Planlamadan gecmis projeler" },
    { phrase: "Son aramalar", description: "Son 5 arama" },
    { phrase: "Acil gorevler", description: "Yuksek oncelikli gorevler" },
    { phrase: "Gorev olustur [baslik]", description: "Yeni gorev (onay gerekli)" },
    { phrase: "Kisi ekle [isim] tel [numara]", description: "Yeni kisi (onay gerekli)" },
    { phrase: "[isim] ile randevu planla", description: "Randevu planla (onay gerekli)" },
    { phrase: "[isim] kisisine mesaj gonder: [icerik]", description: "SMS gonder (onay gerekli)" },
    { phrase: "[isim] ile arama kaydet not [metin]", description: "Arama kaydet (onay gerekli)" },
    { phrase: "[isim] kisisini ara", description: "Kisi bul ve ara" },
    { phrase: "[metin] ara", description: "Kisi ve gorevlerde arama" },
    { phrase: "Bugunku takvim", description: "Takvim etkinlikleri" },
    { phrase: "Performans", description: "Haftalik istatistikler" },
    { phrase: "Saat kac", description: "Su anki saat" },
    { phrase: "Yardim", description: "Komut listesi" },
  ],
  en: [
    { phrase: "Daily briefing", description: "Complete summary of the day" },
    { phrase: "How many calls today", description: "Today's call count" },
    { phrase: "Pending tasks", description: "Number of tasks waiting" },
    { phrase: "How many active projects", description: "Projects in progress" },
    { phrase: "Overdue projects", description: "Projects past their deadline" },
    { phrase: "Recent calls", description: "The last 5 calls" },
    { phrase: "Urgent tasks", description: "High-priority tasks" },
    { phrase: "Create a task [title]", description: "Create a task (confirmation required)" },
    { phrase: "Add a contact [name] tel [number]", description: "Create a contact (confirmation required)" },
    { phrase: "Schedule a meeting with [name]", description: "Schedule a meeting (confirmation required)" },
    { phrase: "Send a message to [name]: [content]", description: "Send an SMS (confirmation required)" },
    { phrase: "Log a call with [name] note [text]", description: "Log a call (confirmation required)" },
    { phrase: "Call [name]", description: "Find and call a contact" },
    { phrase: "Search [text]", description: "Search contacts and tasks" },
    { phrase: "Today's calendar", description: "Calendar events" },
    { phrase: "Performance", description: "Weekly stats" },
    { phrase: "What time is it", description: "Current time" },
    { phrase: "Help", description: "List of commands" },
  ],
};

router.get("/voice/commands", (req: Request, res: Response): void => {
  const lang = normalizeLang(req.query.lang);
  res.json({ commands: COMMANDS_BY_LANG[lang] });
});

export default router;
