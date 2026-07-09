import { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, X, Volume2, MessageCircle, HelpCircle, Radio, Check, XCircle, Globe, Send, Sparkles, Zap, MessagesSquare, Brain, LayoutGrid } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ───────────────────────── i18n (FR / TR / EN) ──────────────────────────────
type Lang = "fr" | "tr" | "en";
const SUPPORTED_LANGS: Lang[] = ["fr", "tr", "en"];
const LANG_STORAGE_KEY = "buro.voiceLang";
const MODE_STORAGE_KEY = "buro.voiceMode";
const WAKE_STORAGE_KEY = "buro.voiceWake";
const DEEP_STORAGE_KEY = "buro.voiceDeep";
type AssistMode = "command" | "chat";
const CHAT_HISTORY_SEND_LIMIT = 10;

// Wake words par langue. On accepte plusieurs variantes pour la robustesse STT.
const WAKE_WORDS: Record<Lang, string[]> = {
  fr: ["hey bureau", "he bureau", "hey buro", "he buro", "hey burreau", "eh bureau", "hey burrow"],
  tr: ["hey buro", "ey buro", "hey buero", "merhaba buro", "hey biro"],
  en: ["hey office", "hey bureau", "hey buro"],
};

// Codes BCP-47 pour SpeechRecognition / SpeechSynthesis.
const STT_LANG: Record<Lang, string> = { fr: "fr-FR", tr: "tr-TR", en: "en-US" };
const TTS_LANG: Record<Lang, string> = { fr: "fr-FR", tr: "tr-TR", en: "en-US" };

// ───────────────────────── Detection auto de langue ──────────────────────────
// L'API Web SpeechRecognition n'a pas de mode "auto-detect"; on doit fixer
// recognition.lang. Mais Chrome retourne quand-meme une transcription pour
// d'autres langues (avec une qualite degradee). On detecte ici la langue
// REELLE du texte transcrit pour:
//   1. basculer setLang() vers la bonne langue avant d'envoyer la requete
//   2. faire repondre la TTS dans la meme langue
//   3. relancer le STT suivant dans la bonne langue
//
// Heuristique simple (sans dependance externe) basee sur:
//   - caracteres propres au turc (ş ç ğ ı İ ö ü) — forts indicateurs TR
//   - mots fonction frequents en chaque langue (stop-words)
// Si rien ne match, on garde la langue courante.
function detectLang(text: string): Lang | null {
  const raw = text.trim();
  if (!raw || raw.length < 2) return null;

  // Caracteres tres discriminants pour le turc: ş/ğ/ı/İ n'existent pas
  // en FR ni EN. (ç/ö/ü existent aussi en FR/DE donc moins forts mais
  // on les compte comme indicateur secondaire plus bas.)
  if (/[şğıİ]/i.test(raw)) return "tr";

  // Normalise les diacritiques pour matcher quelle que soit la sortie
  // STT (Chrome retourne parfois "için" parfois "icin").
  const t = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Stop-words par langue (en forme normalisee sans diacritiques).
  const TR_WORDS = ["ve", "bir", "icin", "ile", "bu", "ne", "var", "yok", "mi", "musun", "lutfen", "nasil", "kim", "nerede", "ben", "sen", "biz", "siz", "hangi", "kac", "merhaba", "gun", "iyi", "tamam", "evet", "hayir", "tesekkurler", "selam", "bugun", "yarin"];
  const FR_WORDS = ["le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "que", "qui", "quoi", "est", "sont", "pour", "avec", "dans", "sur", "je", "tu", "il", "elle", "nous", "vous", "ils", "bonjour", "merci", "oui", "non", "comment", "quel", "quelle", "combien", "salut", "aujourdhui", "demain"];
  const EN_WORDS = ["the", "and", "is", "are", "was", "were", "for", "with", "this", "that", "what", "which", "who", "where", "when", "how", "why", "i", "you", "we", "they", "have", "has", "do", "does", "please", "thanks", "hello", "yes", "no", "today", "tomorrow"];

  const words = t.split(/[\s,.!?;:'"]+/).filter(Boolean);
  let trHits = 0, frHits = 0, enHits = 0;
  for (const w of words) {
    if (TR_WORDS.includes(w)) trHits++;
    if (FR_WORDS.includes(w)) frHits++;
    if (EN_WORDS.includes(w)) enHits++;
  }

  // Indicateurs secondaires sur le texte brut (avec diacritiques):
  //   - ç/ö/ü presents en TR et FR -> on regarde le contexte
  //   - à â ê î ô û (sans ç) sont quasi exclusivement FR
  if (/[àâêîôû]/i.test(raw)) frHits += 2;
  // Si on a deja des indices TR (hits) ET on voit ç/ö/ü, c'est probable TR.
  if (trHits > 0 && /[çöü]/i.test(raw)) trHits += 1;
  // Si on a deja des indices FR ET on voit ç, renforcer FR.
  if (frHits > 0 && /ç/i.test(raw)) frHits += 1;

  const max = Math.max(trHits, frHits, enHits);
  if (max === 0) return null;
  // En cas d'egalite, on prefere la langue qui apparait en premier dans
  // l'ordre TR > FR > EN (le turc est sous-detecte sinon a cause des
  // mots courts comme "ne" qui peuvent matcher rien d'autre).
  if (trHits === max) return "tr";
  if (frHits === max) return "fr";
  return "en";
}

const UI_T = {
  title: { fr: "Assistant Vocal IA", tr: "Sesli Asistan IA", en: "AI Voice Assistant" },
  state_idle: { fr: "Inactif", tr: "Pasif", en: "Idle" },
  state_wake: { fr: '"Hey Bureau" actif', tr: '"Hey Buro" aktif', en: '"Hey Office" active' },
  state_listening: { fr: "Je vous ecoute...", tr: "Sizi dinliyorum...", en: "I'm listening..." },
  state_processing: { fr: "Traitement IA...", tr: "IA isleniyor...", en: "AI processing..." },
  state_speaking: { fr: "Reponse...", tr: "Yanit...", en: "Replying..." },
  greet_listening: { fr: "Je vous ecoute", tr: "Sizi dinliyorum", en: "I'm listening" },
  commands_available: { fr: "Commandes disponibles:", tr: "Kullanilabilir komutlar:", en: "Available commands:" },
  natural_hint: {
    fr: "L'IA comprend aussi les phrases naturelles en francais.",
    tr: "Yapay zeka dogal Turkce cumleleri de anlar.",
    en: "The AI also understands natural English sentences.",
  },
  confirm_required: { fr: "Confirmation requise", tr: "Onay gerekli", en: "Confirmation required" },
  confirm_btn: { fr: "Confirmer", tr: "Onayla", en: "Confirm" },
  cancel_btn: { fr: "Annuler", tr: "Iptal", en: "Cancel" },
  action_cancelled: { fr: "Action annulee.", tr: "Eylem iptal edildi.", en: "Action cancelled." },
  action_done: { fr: "Action effectuee.", tr: "Eylem tamamlandi.", en: "Action completed." },
  action_failed: { fr: "Impossible d'executer l'action.", tr: "Eylem gerceklestirilemedi.", en: "Couldn't execute the action." },
  err_server: { fr: "Erreur de communication avec le serveur.", tr: "Sunucu ile iletisim hatasi.", en: "Server communication error." },
  err_network: { fr: "Erreur de connexion. Verifiez votre reseau.", tr: "Baglanti hatasi. Aginizi kontrol edin.", en: "Connection error. Check your network." },
  err_confirm_network: { fr: "Erreur reseau lors de la confirmation.", tr: "Onay sirasinda ag hatasi.", en: "Network error during confirmation." },
  err_mic: { fr: "Erreur micro: ", tr: "Mikrofon hatasi: ", en: "Mic error: " },
  err_mic_start: { fr: "Impossible d'activer le micro.", tr: "Mikrofon etkinlestirilemedi.", en: "Couldn't enable the microphone." },
  wake_toggle_off: { fr: 'Desactiver "Hey Bureau"', tr: '"Hey Buro" kapat', en: 'Disable "Hey Office"' },
  wake_toggle_on: { fr: 'Activer "Hey Bureau"', tr: '"Hey Buro" ac', en: 'Enable "Hey Office"' },
  wake_label: { fr: "Hey Bureau", tr: "Hey Buro", en: "Hey Office" },
  lang_label: { fr: "Langue", tr: "Dil", en: "Language" },
  input_placeholder: {
    fr: "Tapez votre commande ou parlez...",
    tr: "Komutu yazin veya konusun...",
    en: "Type your command or speak...",
  },
  send_btn: { fr: "Envoyer", tr: "Gonder", en: "Send" },
  suggestions_label: { fr: "Suggestions", tr: "Oneriler", en: "Suggestions" },
  empty_hint: {
    fr: "Demandez-moi quelque chose, ou choisissez une suggestion ci-dessous.",
    tr: "Bana bir sey sorun veya asagidaki onerilerden birini secin.",
    en: "Ask me something, or pick a suggestion below.",
  },
  empty_chat: {
    fr: "Discutons. Posez-moi n'importe quelle question liee a votre activite.",
    tr: "Sohbet edelim. Isinizle ilgili her seyi sorabilirsiniz.",
    en: "Let's chat. Ask me anything about your business.",
  },
  mode_command: { fr: "Commande", tr: "Komut", en: "Command" },
  mode_chat: { fr: "Sohbet", tr: "Sohbet", en: "Chat" },
  chat_placeholder: {
    fr: "Posez votre question...",
    tr: "Sorunuzu yazin...",
    en: "Ask your question...",
  },
  deep_on: { fr: "Reflexion profonde activee", tr: "Derin dusunce aktif", en: "Deep thinking on" },
  deep_off: { fr: "Activer reflexion profonde (Pro)", tr: "Derin dusunceyi ac (Pro)", en: "Enable deep thinking (Pro)" },
  deep_badge: { fr: "Pro", tr: "Pro", en: "Pro" },
  library_open: { fr: "Bibliotheque d'actions", tr: "Aksiyon kutuphanesi", en: "Action library" },
  library_close: { fr: "Fermer", tr: "Kapat", en: "Close" },
  clear_chat: { fr: "Effacer la conversation", tr: "Konusmayi temizle", en: "Clear conversation" },
  retry_last: { fr: "Reessayer", tr: "Yeniden dene", en: "Retry" },
} as const;

// ───────────────────────── Bibliotheque d'actions rapides ────────────────────
// 4 categories x ~7 prompts par langue. Cliquer envoie le prompt comme si
// l'utilisateur l'avait dicte/tape.
type LibCategory = { title: string; items: { label: string; text: string }[] };
const LIBRARY: Record<Lang, LibCategory[]> = {
  fr: [
    {
      title: "Travail quotidien",
      items: [
        { label: "Briefing du jour", text: "Briefing du jour" },
        { label: "Taches urgentes", text: "Taches urgentes" },
        { label: "Agenda du jour", text: "Agenda du jour" },
        { label: "Derniers appels", text: "Derniers appels" },
        { label: "Appels aujourd'hui", text: "Combien d'appels aujourd'hui" },
        { label: "Performance", text: "Performance" },
        { label: "Taches en attente", text: "Combien de taches en attente" },
      ],
    },
    {
      title: "Gestion",
      items: [
        { label: "Projets actifs", text: "Combien de projets actifs" },
        { label: "Projets en retard", text: "Projets en retard" },
        { label: "Nb contacts", text: "Combien de contacts" },
        { label: "Creer une tache", text: "Cree une tache pour" },
        { label: "Ajouter contact", text: "Ajoute un nouveau contact" },
        { label: "Planifier RDV", text: "Planifie un rendez-vous" },
      ],
    },
    {
      title: "Idees & strategie",
      items: [
        { label: "Augmenter ventes", text: "Donne moi 3 idees concretes pour augmenter mes ventes ce mois-ci" },
        { label: "Fideliser clients", text: "Comment mieux fideliser mes clients existants ?" },
        { label: "Analyser performance", text: "Analyse ma performance recente et propose 2 axes d'amelioration" },
        { label: "Tarifs", text: "Comment annoncer une hausse de prix sans perdre de clients ?" },
        { label: "Reseaux sociaux", text: "Propose 3 idees de posts pour cette semaine" },
        { label: "Concurrence", text: "Comment me differencier de la concurrence ?" },
      ],
    },
    {
      title: "Equipe & RH",
      items: [
        { label: "Recrutement", text: "Quelles questions poser en entretien pour ce poste ?" },
        { label: "Motivation equipe", text: "Comment motiver mon equipe sans augmenter les salaires ?" },
        { label: "Email pro", text: "Redige un email professionnel pour" },
        { label: "Reunion efficace", text: "Comment rendre mes reunions plus efficaces ?" },
        { label: "Delegation", text: "Sur quoi devrais-je deleguer en priorite ?" },
      ],
    },
  ],
  tr: [
    {
      title: "Gunluk is",
      items: [
        { label: "Gunluk ozet", text: "Gunluk ozet" },
        { label: "Acil gorevler", text: "Acil gorevler" },
        { label: "Bugunku takvim", text: "Bugunku takvim" },
        { label: "Son aramalar", text: "Son aramalar" },
        { label: "Bugun aramalar", text: "Bugun kac arama var" },
        { label: "Performans", text: "Performans" },
        { label: "Bekleyen gorevler", text: "Bekleyen gorevler" },
      ],
    },
    {
      title: "Yonetim",
      items: [
        { label: "Aktif projeler", text: "Kac aktif proje var" },
        { label: "Gecikmis projeler", text: "Gecikmis projeler" },
        { label: "Toplam kisi", text: "Kac kisi var" },
        { label: "Gorev olustur", text: "Yeni bir gorev olustur" },
        { label: "Kisi ekle", text: "Yeni bir kisi ekle" },
        { label: "Randevu planla", text: "Bir randevu planla" },
      ],
    },
    {
      title: "Fikir & strateji",
      items: [
        { label: "Satislari artir", text: "Bu ay satislarimi artirmak icin 3 somut fikir ver" },
        { label: "Musteri sadakati", text: "Mevcut musterilerimi nasil daha iyi tutarim?" },
        { label: "Performans analizi", text: "Son performansimi analiz et ve 2 gelistirme onerisi ver" },
        { label: "Fiyat artisi", text: "Musteri kaybetmeden fiyat artisini nasil duyururum?" },
        { label: "Sosyal medya", text: "Bu hafta icin 3 sosyal medya gonderisi fikri ver" },
        { label: "Rekabet", text: "Rakiplerimden nasil farklilasirim?" },
      ],
    },
    {
      title: "Ekip & IK",
      items: [
        { label: "Ise alim", text: "Bu pozisyon icin mulakatta hangi sorulari sormaliyim?" },
        { label: "Ekip motivasyonu", text: "Maas artirmadan ekibimi nasil motive ederim?" },
        { label: "Profesyonel email", text: "Su konuda profesyonel bir email yaz:" },
        { label: "Verimli toplanti", text: "Toplantilarimi nasil daha verimli yaparim?" },
        { label: "Delegasyon", text: "Onceliklendirerek neyi delege etmeliyim?" },
      ],
    },
  ],
  en: [
    {
      title: "Daily work",
      items: [
        { label: "Daily briefing", text: "Daily briefing" },
        { label: "Urgent tasks", text: "Urgent tasks" },
        { label: "Today's calendar", text: "Today's calendar" },
        { label: "Recent calls", text: "Recent calls" },
        { label: "Calls today", text: "How many calls today" },
        { label: "Performance", text: "Performance" },
        { label: "Pending tasks", text: "Pending tasks" },
      ],
    },
    {
      title: "Management",
      items: [
        { label: "Active projects", text: "How many active projects" },
        { label: "Overdue projects", text: "Overdue projects" },
        { label: "Contacts count", text: "How many contacts" },
        { label: "Create task", text: "Create a new task" },
        { label: "Add contact", text: "Add a new contact" },
        { label: "Schedule meeting", text: "Schedule a meeting" },
      ],
    },
    {
      title: "Ideas & strategy",
      items: [
        { label: "Boost sales", text: "Give me 3 concrete ideas to boost my sales this month" },
        { label: "Customer loyalty", text: "How can I better retain my existing customers?" },
        { label: "Analyze perf", text: "Analyze my recent performance and suggest 2 improvements" },
        { label: "Price increase", text: "How do I announce a price increase without losing clients?" },
        { label: "Social media", text: "Give me 3 social media post ideas for this week" },
        { label: "Competition", text: "How can I differentiate from competitors?" },
      ],
    },
    {
      title: "Team & HR",
      items: [
        { label: "Hiring", text: "What questions should I ask in an interview for this role?" },
        { label: "Team motivation", text: "How can I motivate my team without raising salaries?" },
        { label: "Pro email", text: "Write a professional email about:" },
        { label: "Better meetings", text: "How do I run more effective meetings?" },
        { label: "Delegation", text: "What should I prioritize delegating?" },
      ],
    },
  ],
};

// Suggestions de suivi par intent + langue. Chaque chip envoie le texte
// `text` au backend comme si l'utilisateur l'avait dicte. Quand un intent n'a
// pas de suite naturelle, on retombe sur "default".
type Suggestion = { label: string; text: string };
const SUGG_DEFAULT: Record<Lang, Suggestion[]> = {
  fr: [
    { label: "Briefing du jour", text: "Briefing du jour" },
    { label: "Taches urgentes", text: "Taches urgentes" },
    { label: "Agenda du jour", text: "Agenda du jour" },
    { label: "Aide", text: "Aide" },
  ],
  tr: [
    { label: "Gunluk ozet", text: "Gunluk ozet" },
    { label: "Acil gorevler", text: "Acil gorevler" },
    { label: "Bugunku takvim", text: "Bugunku takvim" },
    { label: "Yardim", text: "Yardim" },
  ],
  en: [
    { label: "Daily briefing", text: "Daily briefing" },
    { label: "Urgent tasks", text: "Urgent tasks" },
    { label: "Today's calendar", text: "Today's calendar" },
    { label: "Help", text: "Help" },
  ],
};
const SUGGESTIONS: Record<string, Record<Lang, Suggestion[]>> = {
  daily_briefing: {
    fr: [
      { label: "Taches urgentes", text: "Taches urgentes" },
      { label: "Derniers appels", text: "Derniers appels" },
      { label: "Agenda du jour", text: "Agenda du jour" },
    ],
    tr: [
      { label: "Acil gorevler", text: "Acil gorevler" },
      { label: "Son aramalar", text: "Son aramalar" },
      { label: "Bugunku takvim", text: "Bugunku takvim" },
    ],
    en: [
      { label: "Urgent tasks", text: "Urgent tasks" },
      { label: "Recent calls", text: "Recent calls" },
      { label: "Today's calendar", text: "Today's calendar" },
    ],
  },
  count_calls: {
    fr: [{ label: "Derniers appels", text: "Derniers appels" }, { label: "Performance", text: "Performance" }],
    tr: [{ label: "Son aramalar", text: "Son aramalar" }, { label: "Performans", text: "Performans" }],
    en: [{ label: "Recent calls", text: "Recent calls" }, { label: "Performance", text: "Performance" }],
  },
  count_tasks: {
    fr: [{ label: "Taches urgentes", text: "Taches urgentes" }, { label: "Briefing", text: "Briefing du jour" }],
    tr: [{ label: "Acil gorevler", text: "Acil gorevler" }, { label: "Ozet", text: "Gunluk ozet" }],
    en: [{ label: "Urgent tasks", text: "Urgent tasks" }, { label: "Briefing", text: "Daily briefing" }],
  },
  count_contacts: {
    fr: [{ label: "Briefing", text: "Briefing du jour" }, { label: "Agenda", text: "Agenda du jour" }],
    tr: [{ label: "Ozet", text: "Gunluk ozet" }, { label: "Takvim", text: "Bugunku takvim" }],
    en: [{ label: "Briefing", text: "Daily briefing" }, { label: "Calendar", text: "Today's calendar" }],
  },
  count_projets: {
    fr: [{ label: "Projets en retard", text: "Projets en retard" }, { label: "Performance", text: "Performance" }],
    tr: [{ label: "Gecikmis projeler", text: "Gecikmis projeler" }, { label: "Performans", text: "Performans" }],
    en: [{ label: "Overdue projects", text: "Overdue projects" }, { label: "Performance", text: "Performance" }],
  },
  projets_overdue: {
    fr: [{ label: "Projets actifs", text: "Combien de projets actifs" }, { label: "Briefing", text: "Briefing du jour" }],
    tr: [{ label: "Aktif projeler", text: "Kac aktif proje var" }, { label: "Ozet", text: "Gunluk ozet" }],
    en: [{ label: "Active projects", text: "How many active projects" }, { label: "Briefing", text: "Daily briefing" }],
  },
  recent_calls: {
    fr: [{ label: "Performance", text: "Performance" }, { label: "Appels du jour", text: "Combien d'appels aujourd'hui" }],
    tr: [{ label: "Performans", text: "Performans" }, { label: "Bugun arama", text: "Bugun kac arama var" }],
    en: [{ label: "Performance", text: "Performance" }, { label: "Today's calls", text: "How many calls today" }],
  },
  urgent_tasks: {
    fr: [{ label: "Taches en attente", text: "Combien de taches en attente" }, { label: "Briefing", text: "Briefing du jour" }],
    tr: [{ label: "Bekleyen gorevler", text: "Bekleyen gorevler" }, { label: "Ozet", text: "Gunluk ozet" }],
    en: [{ label: "Pending tasks", text: "Pending tasks" }, { label: "Briefing", text: "Daily briefing" }],
  },
  calendar: {
    fr: [{ label: "Briefing", text: "Briefing du jour" }, { label: "Performance", text: "Performance" }],
    tr: [{ label: "Ozet", text: "Gunluk ozet" }, { label: "Performans", text: "Performans" }],
    en: [{ label: "Briefing", text: "Daily briefing" }, { label: "Performance", text: "Performance" }],
  },
  performance: {
    fr: [{ label: "Briefing", text: "Briefing du jour" }, { label: "Taches urgentes", text: "Taches urgentes" }],
    tr: [{ label: "Ozet", text: "Gunluk ozet" }, { label: "Acil gorevler", text: "Acil gorevler" }],
    en: [{ label: "Briefing", text: "Daily briefing" }, { label: "Urgent tasks", text: "Urgent tasks" }],
  },
  greeting: SUGG_DEFAULT,
  thanks: SUGG_DEFAULT,
  help: SUGG_DEFAULT,
  unknown: SUGG_DEFAULT,
};

function suggestionsFor(intent: string | undefined, lang: Lang): Suggestion[] {
  if (!intent) return SUGG_DEFAULT[lang];
  return SUGGESTIONS[intent]?.[lang] ?? SUGG_DEFAULT[lang];
}

function tr(key: keyof typeof UI_T, lang: Lang): string {
  return UI_T[key][lang] ?? UI_T[key].fr;
}

function loadStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && (SUPPORTED_LANGS as string[]).includes(stored)) return stored as Lang;
  } catch {}
  // Auto-detect from browser preference si pas de choix enregistre
  try {
    const nav = navigator.language.slice(0, 2).toLowerCase();
    if ((SUPPORTED_LANGS as string[]).includes(nav)) return nav as Lang;
  } catch {}
  return "fr";
}

function loadStoredMode(): AssistMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === "chat" || stored === "command") return stored;
  } catch {}
  return "command";
}

// Wake-word: par defaut ACTIF (utilisateur a demande "surekli uyanik" =
// toujours en eveil). L'utilisateur peut le desactiver explicitement; sa
// preference est persistee.
function loadStoredWake(): boolean {
  try {
    const stored = localStorage.getItem(WAKE_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {}
  return true;
}
function loadStoredDeep(): boolean {
  try { return localStorage.getItem(DEEP_STORAGE_KEY) === "1"; } catch { return false; }
}

interface PendingAction {
  token: string;
  intent: string;
  summary: string;
  fields: { label: string; value: string }[];
  expiresInMs: number;
}

interface VoiceResult {
  success: boolean;
  intent: string;
  spoken: string;
  data?: any;
  action?: string;
  navigate?: string;
  requiresConfirmation?: boolean;
  pendingAction?: PendingAction;
}

type VoiceState = "idle" | "listening_wake" | "listening_command" | "processing" | "speaking";

interface VoiceAssistantProps {
  onOpenLive?: () => void;
}

export function VoiceAssistant({ onOpenLive }: VoiceAssistantProps = {}) {
  const [lang, setLang] = useState<Lang>(loadStoredLang);
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [commands, setCommands] = useState<{ phrase: string; description: string }[]>([]);
  const [history, setHistory] = useState<{ type: "user" | "assistant"; text: string }[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [lastIntent, setLastIntent] = useState<string>("");
  const [mode, setMode] = useState<AssistMode>(loadStoredMode);
  const [deep, setDeep] = useState<boolean>(loadStoredDeep);
  const [showLibrary, setShowLibrary] = useState(false);
  // Mirror state pour afficher l'etat "wake actif" dans la UI sans re-render
  // depuis le ref (qui est non-reactif).
  const [wakeOn, setWakeOn] = useState<boolean>(loadStoredWake);
  const recognitionRef = useRef<any>(null);
  const wakeListenerRef = useRef<any>(null);
  const stateRef = useRef<VoiceState>("idle");
  const wakeActiveRef = useRef(false);
  // Refs miroirs pour les callbacks STT (closures): on doit toujours utiliser
  // la langue/mode courants meme si ils changent pendant l'ecoute.
  const langRef = useRef<Lang>(lang);
  const modeRef = useRef<AssistMode>(mode);
  const deepRef = useRef<boolean>(deep);
  // Snapshot de l'historique pour eviter de redeclarer processCommand quand
  // l'historique change (sinon les listeners STT se reabonnent en boucle).
  const historyRef = useRef<{ type: "user" | "assistant"; text: string }[]>([]);

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  // Sync refs
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    langRef.current = lang;
    try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch {}
  }, [lang]);
  useEffect(() => {
    modeRef.current = mode;
    try { localStorage.setItem(MODE_STORAGE_KEY, mode); } catch {}
  }, [mode]);
  useEffect(() => {
    deepRef.current = deep;
    try { localStorage.setItem(DEEP_STORAGE_KEY, deep ? "1" : "0"); } catch {}
  }, [deep]);
  useEffect(() => { historyRef.current = history; }, [history]);

  // Recharge la liste de commandes a chaque changement de langue.
  useEffect(() => {
    fetch(`${BASE}/api/voice/commands?lang=${lang}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.commands) setCommands(d.commands); })
      .catch(() => {});
  }, [lang]);

  // Pre-chargement des voix TTS. Chrome retourne souvent un tableau vide a
  // la 1ere lecture car les voix sont chargees asynchrone — on doit
  // attendre l'event voiceschanged. Sans ce hook, le 1er speak() utilise
  // une voix par defaut (souvent muette ou mauvaise langue) ce qui donne
  // l'impression que la TTS "ne marche pas".
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const warm = () => window.speechSynthesis.getVoices();
    warm();
    window.speechSynthesis.onvoiceschanged = warm;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const speak = useCallback((text: string, overrideLang?: Lang) => {
    if (!("speechSynthesis" in window) || !text) return;
    const curLang = overrideLang || langRef.current;
    const synth = window.speechSynthesis;

    const doSpeak = (voices: SpeechSynthesisVoice[]) => {
      // IMPORTANT: pas de setTimeout autour de speak() — Chrome refuse
      // alors la lecture car la chaine de user-gesture est cassee.
      // On appelle speak() INLINE, et on ne fait cancel() QUE si on est
      // reellement en train de parler (sinon ca declenche un bug Chrome
      // ou speechSynthesis reste en pause silencieuse).
      if (synth.speaking || synth.pending) {
        synth.cancel();
      }

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = TTS_LANG[curLang];
      utter.rate = 1.05;
      utter.pitch = 1;
      utter.volume = 1;

      // Choix de voix: match exact > prefix de langue > fallback FR > 1ere.
      const langPrefix = TTS_LANG[curLang].toLowerCase().slice(0, 2);
      const match = voices.find(v => v.lang.toLowerCase().startsWith(langPrefix))
        || voices.find(v => v.lang.toLowerCase().startsWith("fr"))
        || voices[0];
      if (match) utter.voice = match;

      utter.onend = () => {
        setState("idle");
        if (wakeActiveRef.current) startWakeWordListener();
      };
      utter.onerror = (ev: any) => {
        // "interrupted" et "canceled" sont normaux (notre cancel() ci-dessus
        // ou stopAllListeners). Les autres erreurs on log dans la console.
        if (ev?.error && ev.error !== "interrupted" && ev.error !== "canceled") {
          // eslint-disable-next-line no-console
          console.warn("[VoiceAssistant] TTS error:", ev.error);
        }
        setState("idle");
        if (wakeActiveRef.current) startWakeWordListener();
      };

      setState("speaking");
      synth.speak(utter);
      // Workaround bug Chrome connu: speechSynthesis se met parfois en
      // "paused" tout seul (notamment apres une longue inactivite ou
      // un cancel recent). resume() force la lecture.
      synth.resume();
    };

    const voices = synth.getVoices();
    if (voices.length > 0) {
      doSpeak(voices);
    } else {
      // Voix pas encore chargees: on attend voiceschanged (max 500ms).
      let done = false;
      const onReady = () => {
        if (done) return;
        done = true;
        synth.removeEventListener("voiceschanged", onReady);
        doSpeak(synth.getVoices());
      };
      synth.addEventListener("voiceschanged", onReady);
      setTimeout(() => {
        if (done) return;
        done = true;
        synth.removeEventListener("voiceschanged", onReady);
        // On tente avec ce qu'on a, meme tableau vide — la voix par
        // defaut du systeme sera utilisee.
        doSpeak(synth.getVoices());
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processCommand = useCallback(async (text: string, overrideLang?: Lang) => {
    setState("processing");
    setTranscript(text);
    setHistory(prev => [...prev, { type: "user", text }]);
    // Si l'appelant force une langue (auto-detect STT), on l'utilise pour
    // l'API et la TTS. Sinon on garde la langue UI courante.
    const curLang = overrideLang || langRef.current;
    const curMode = modeRef.current;
    // En mode chat: on envoie l'historique recent (sans le tour courant qui
    // vient juste d'etre ajoute a l'etat React, mais qu'on n'a pas a renvoyer
    // puisqu'on envoie aussi `text` separement) pour donner du contexte multi-
    // tour au modele. Le backend tronque a MAX_CHAT_HISTORY (10).
    const endpoint = curMode === "chat" ? "/api/voice/chat" : "/api/voice/command";
    const payload: Record<string, unknown> = { text, language: curLang };
    if (curMode === "chat") {
      payload.history = historyRef.current
        .slice(-CHAT_HISTORY_SEND_LIMIT)
        .map((h) => ({ role: h.type, text: h.text }));
      payload.deep = deepRef.current;
    }
    try {
      const res = await fetch(`${BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Voice-Lang": curLang },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data: VoiceResult = await res.json();
        setResponse(data.spoken);
        setLastIntent(data.intent || "");
        setHistory(prev => [...prev, { type: "assistant", text: data.spoken }]);
        speak(data.spoken, curLang);
        if (data.requiresConfirmation && data.pendingAction) {
          setPending(data.pendingAction);
          return;
        }
        if (data.navigate) {
          setTimeout(() => {
            window.location.pathname = BASE + data.navigate;
          }, 2500);
        }
        if (data.action === "initiate_call" && data.data?.contact?.phone) {
          setTimeout(() => window.open(`tel:${data.data.contact.phone}`), 3000);
        }
      } else {
        const errText = tr("err_server", curLang);
        setResponse(errText);
        setHistory(prev => [...prev, { type: "assistant", text: errText }]);
        speak(errText, curLang);
      }
    } catch {
      const errText = tr("err_network", curLang);
      setResponse(errText);
      setHistory(prev => [...prev, { type: "assistant", text: errText }]);
      speak(errText, curLang);
    }
  }, [speak]);

  const stopAllListeners = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    try { wakeListenerRef.current?.stop(); } catch {}
    window.speechSynthesis?.cancel();
  }, []);

  const startCommandListener = useCallback(() => {
    if (!SpeechRecognition) return;
    stopAllListeners();

    const curLang = langRef.current;
    const recognition = new SpeechRecognition();
    // continuous=true permet de capter des phrases plus longues sans que
    // Chrome ne coupe au 1er silence court (~500ms). On gere la fin de
    // phrase nous-meme via un timer de silence.
    recognition.lang = STT_LANG[curLang];
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;

    // Accumulateur des morceaux finaux + timer de silence. Quand on ne
    // recoit plus rien pendant SILENCE_MS, on considere la phrase finie
    // et on envoie le tout.
    let finalBuf = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let isFlushing = false;
    const SILENCE_MS = 1200;

    const clearSilence = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    };

    const flush = () => {
      clearSilence();
      const text = finalBuf.trim();
      if (!text || isFlushing) return;
      isFlushing = true;
      finalBuf = "";
      try { recognition.stop(); } catch {}
      // Detection auto de langue: si l'utilisateur a parle dans une
      // langue differente de celle selectionnee, on bascule la UI et
      // on utilise la nouvelle langue pour la requete + TTS.
      const detected = detectLang(text);
      let useLang = langRef.current;
      if (detected && detected !== langRef.current) {
        setLang(detected);
        langRef.current = detected;
        useLang = detected;
      }
      processCommand(text, useLang);
    };

    recognition.onresult = (event: any) => {
      if (isFlushing) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalBuf += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript((finalBuf + interim).trim());
      // Reset timer a chaque fragment recu.
      clearSilence();
      silenceTimer = setTimeout(flush, SILENCE_MS);
    };

    recognition.onerror = (e: any) => {
      clearSilence();
      isFlushing = true; // bloque tout flush tardif
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(tr("err_mic", langRef.current) + e.error);
      }
      setState("idle");
      if (wakeActiveRef.current) startWakeWordListener();
    };

    recognition.onend = () => {
      clearSilence();
      // Si on a encore du texte non-flush (Chrome a coupe avant le timer),
      // on l'envoie maintenant avant de passer en idle.
      if (!isFlushing && finalBuf.trim()) {
        flush();
        return;
      }
      if (stateRef.current === "listening_command") {
        setState("idle");
        if (wakeActiveRef.current) startWakeWordListener();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setState("listening_command");
      setTranscript("");
      setResponse("");
      setError("");
    } catch {
      setError(tr("err_mic_start", langRef.current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SpeechRecognition, processCommand, stopAllListeners]);

  const startWakeWordListener = useCallback(() => {
    if (!SpeechRecognition) return;
    const curLang = langRef.current;

    const recognition = new SpeechRecognition();
    recognition.lang = STT_LANG[curLang];
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: any) => {
      const wakeList = WAKE_WORDS[langRef.current];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        const detected = wakeList.some(w => text.includes(w));
        if (detected) {
          recognition.stop();
          setExpanded(true);
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.value = 0.15;
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
            setTimeout(() => { osc.frequency.value = 1320; }, 60);
          } catch {}
          speak(tr("greet_listening", langRef.current));
          setTimeout(() => startCommandListener(), 1200);
          return;
        }
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== "aborted" && e.error !== "no-speech") {
        setTimeout(() => {
          if (wakeActiveRef.current) startWakeWordListener();
        }, 3000);
      }
    };

    recognition.onend = () => {
      if (wakeActiveRef.current && stateRef.current !== "listening_command" && stateRef.current !== "processing" && stateRef.current !== "speaking") {
        setTimeout(() => {
          if (wakeActiveRef.current) startWakeWordListener();
        }, 500);
      }
    };

    wakeListenerRef.current = recognition;
    try {
      recognition.start();
      setState("listening_wake");
    } catch {}
  }, [SpeechRecognition, startCommandListener, speak]);

  function toggleVoice() {
    if (state === "idle" || state === "listening_wake") {
      setExpanded(true);
      stopAllListeners();
      startCommandListener();
    } else if (state === "listening_command") {
      stopAllListeners();
      setState("idle");
      if (wakeActiveRef.current) startWakeWordListener();
    } else if (state === "speaking") {
      window.speechSynthesis.cancel();
      setState("idle");
      if (wakeActiveRef.current) startWakeWordListener();
    }
  }

  function toggleWakeMode() {
    if (wakeActiveRef.current) {
      wakeActiveRef.current = false;
      setWakeOn(false);
      try { localStorage.setItem(WAKE_STORAGE_KEY, "0"); } catch {}
      stopAllListeners();
      setState("idle");
    } else {
      wakeActiveRef.current = true;
      setWakeOn(true);
      try { localStorage.setItem(WAKE_STORAGE_KEY, "1"); } catch {}
      stopAllListeners();
      startWakeWordListener();
    }
  }

  // Auto-demarrage du wake-word au montage si l'utilisateur l'avait laisse
  // actif (ou par defaut s'il n'a jamais touche au reglage). Permet de tenir
  // la promesse "agent toujours en eveil" sans clic manuel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!supported) return;
    if (wakeOn && !wakeActiveRef.current) {
      wakeActiveRef.current = true;
      startWakeWordListener();
    }
    return () => {
      // pas de cleanup ici: closeAssistant() s'en charge si besoin.
    };
    // On ne veut declencher qu'au mount; les toggles passent par toggleWakeMode.
  }, []);

  // Quand l'utilisateur change la langue alors qu'une ecoute est en cours,
  // on redemarre le listener avec la nouvelle langue STT.
  function changeLang(next: Lang) {
    if (next === lang) return;
    // Mise a jour synchrone du ref AVANT tout redemarrage de listener pour
    // eviter une course: les callbacks STT lisent langRef.current, pas l'etat
    // React (qui ne sera commit qu'apres rendu).
    langRef.current = next;
    try { localStorage.setItem(LANG_STORAGE_KEY, next); } catch {}
    setLang(next);
    if (wakeActiveRef.current) {
      stopAllListeners();
      startWakeWordListener();
    } else if (state === "listening_command") {
      stopAllListeners();
      setState("idle");
    }
  }

  function closeAssistant() {
    stopAllListeners();
    wakeActiveRef.current = false;
    setState("idle");
    setExpanded(false);
    setTranscript("");
    setResponse("");
    setError("");
    setPending(null);
  }

  const confirmPending = useCallback(async () => {
    if (!pending) return;
    setConfirming(true);
    const curLang = langRef.current;
    try {
      const res = await fetch(`${BASE}/api/voice/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Voice-Lang": curLang },
        credentials: "include",
        body: JSON.stringify({ token: pending.token, language: curLang }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        const msg = data.spoken || tr("action_done", curLang);
        setHistory(prev => [...prev, { type: "assistant", text: msg }]);
        setResponse(msg);
        speak(msg);
        if (data.navigate) {
          setTimeout(() => { window.location.pathname = BASE + data.navigate; }, 2500);
        }
      } else {
        const msg = data?.error || tr("action_failed", curLang);
        setHistory(prev => [...prev, { type: "assistant", text: msg }]);
        setResponse(msg);
        speak(msg);
      }
    } catch {
      const msg = tr("err_confirm_network", curLang);
      setResponse(msg);
      speak(msg);
    } finally {
      setPending(null);
      setConfirming(false);
    }
  }, [pending, speak]);

  const cancelPending = useCallback(() => {
    if (!pending) return;
    fetch(`${BASE}/api/voice/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token: pending.token }),
    }).catch(() => {});
    const msg = tr("action_cancelled", langRef.current);
    setHistory(prev => [...prev, { type: "assistant", text: msg }]);
    setResponse(msg);
    setPending(null);
  }, [pending]);

  useEffect(() => {
    return () => {
      stopAllListeners();
      wakeActiveRef.current = false;
    };
  }, [stopAllListeners]);

  if (!supported) return null;

  const stateLabels: Record<VoiceState, string> = {
    idle: tr("state_idle", lang),
    listening_wake: tr("state_wake", lang),
    listening_command: tr("state_listening", lang),
    processing: tr("state_processing", lang),
    speaking: tr("state_speaking", lang),
  };

  return (
    <>
      {!expanded ? (
        <div className="fixed bottom-6 left-6 z-50">
          {/* Animated outer rings during active states — premium "alive" feel */}
          {(state === "listening_command" || state === "listening_wake" || state === "speaking") && (
            <>
              <span className={`absolute inset-0 rounded-full ${state === "listening_command" ? "bg-red-500/40" : state === "speaking" ? "bg-emerald-500/40" : "bg-amber-500/40"} animate-ping`} />
              <span className={`absolute -inset-2 rounded-full ${state === "listening_command" ? "bg-red-500/20" : state === "speaking" ? "bg-emerald-500/20" : "bg-amber-500/20"} blur-md animate-pulse`} />
            </>
          )}
          {/* Animated gradient ring */}
          <span className="absolute -inset-[2px] rounded-full bg-gradient-to-tr from-amber-400 via-amber-500 to-orange-500 opacity-90 blur-[2px]" />
          <button
            onClick={toggleVoice}
            className={`relative w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 backdrop-blur-xl border border-white/20 ${
              state === "listening_command"
                ? "bg-gradient-to-br from-red-500 to-red-600"
                : state === "processing"
                  ? "bg-gradient-to-br from-blue-500 to-blue-600"
                  : state === "speaking"
                    ? "bg-gradient-to-br from-emerald-500 to-emerald-600"
                    : state === "listening_wake"
                      ? "bg-gradient-to-br from-amber-400 to-amber-600"
                      : "bg-gradient-to-br from-slate-700 to-slate-900"
            }`}
            title={stateLabels[state]}
          >
            {state === "processing" ? (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Mic className="w-6 h-6 text-white drop-shadow-md" />
            )}
            {state === "listening_wake" && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-300 rounded-full animate-ping shadow-lg shadow-amber-400/50" />
            )}
          </button>
          {onOpenLive && (
            <button
              onClick={onOpenLive}
              className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 via-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/40 flex items-center justify-center text-white text-[10px] font-bold border-2 border-slate-900 hover:scale-110 transition"
              title="Mode Live (conversation continue avec Gemini)"
            >
              ✦
            </button>
          )}
        </div>
      ) : (
        <div className="fixed bottom-6 left-6 z-50 w-80 rounded-2xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.6)] overflow-hidden border border-white/10 backdrop-blur-2xl bg-gradient-to-br from-slate-900/95 to-slate-950/95 ring-1 ring-amber-500/20">
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-800/80 via-slate-900/60 to-slate-800/80 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${state === "listening_command" ? "bg-red-500 animate-pulse" : state === "processing" ? "bg-blue-400 animate-pulse" : state === "speaking" ? "bg-green-400" : state === "listening_wake" ? "bg-amber-400 animate-pulse" : "bg-slate-500"}`} />
              <span className="text-sm font-semibold text-white">{tr("title", lang)}</span>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => { setShowLibrary(v => !v); if (!showLibrary) setShowHelp(false); }}
                className={`p-1.5 rounded-lg transition-colors ${showLibrary ? "bg-amber-500/20 text-amber-300" : "hover:bg-slate-700 text-slate-400 hover:text-white"}`}
                title={tr("library_open", lang)}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={toggleWakeMode}
                className={`p-1.5 rounded-lg transition-colors ${wakeOn ? "bg-amber-500/20 text-amber-300" : "hover:bg-slate-700 text-slate-400 hover:text-white"}`}
                title={wakeOn ? "Wake-word ON" : "Wake-word OFF"}
              >
                <Radio className="w-4 h-4" />
              </button>
              <button onClick={() => { setShowHelp(!showHelp); if (!showHelp) setShowLibrary(false); }} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                <HelpCircle className="w-4 h-4" />
              </button>
              <button onClick={closeAssistant} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Selecteur de mode (Commande / Sohbet) */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900/40 border-b border-white/5">
            <div className="flex gap-1 rounded-full bg-slate-800/60 p-0.5 border border-white/5 w-full">
              <button
                onClick={() => setMode("command")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-[11px] font-semibold rounded-full transition-all ${
                  mode === "command" ? "bg-amber-500 text-slate-900 shadow" : "text-slate-400 hover:text-white"
                }`}
              >
                <Zap className="w-3 h-3" /> {tr("mode_command", lang)}
              </button>
              <button
                onClick={() => setMode("chat")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 text-[11px] font-semibold rounded-full transition-all ${
                  mode === "chat" ? "bg-blue-500 text-white shadow" : "text-slate-400 hover:text-white"
                }`}
              >
                <MessagesSquare className="w-3 h-3" /> {tr("mode_chat", lang)}
              </button>
            </div>
          </div>

          {/* Toggle "Derin Dusunce" — visible uniquement en mode chat. Bascule
              le backend de Gemini Flash vers Gemini Pro pour les questions
              strategiques / analyse / brainstorming. */}
          {mode === "chat" && (
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900/40 border-b border-white/5">
              <button
                onClick={() => setDeep(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full transition-all ${
                  deep
                    ? "bg-purple-500/20 text-purple-200 border border-purple-400/40 shadow-[0_0_12px_-2px_rgba(168,85,247,0.5)]"
                    : "bg-slate-800/60 text-slate-400 border border-white/5 hover:text-white"
                }`}
                title={deep ? tr("deep_on", lang) : tr("deep_off", lang)}
              >
                <Brain className={`w-3.5 h-3.5 ${deep ? "animate-pulse" : ""}`} />
                <span>{deep ? tr("deep_on", lang) : tr("deep_off", lang)}</span>
                {deep && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-purple-500 text-white text-[9px] font-bold">
                    {tr("deep_badge", lang)}
                  </span>
                )}
              </button>
              {history.length > 0 && (
                <button
                  onClick={() => { setHistory([]); setResponse(""); setTranscript(""); }}
                  className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-white transition-colors"
                  title={tr("clear_chat", lang)}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Selecteur de langue — visible en permanence */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900/40 border-b border-white/5">
            <div className="flex items-center gap-1.5 text-slate-400 text-xs">
              <Globe className="w-3.5 h-3.5" />
              <span>{tr("lang_label", lang)}</span>
            </div>
            <div className="flex gap-1 rounded-full bg-slate-800/60 p-0.5 border border-white/5">
              {SUPPORTED_LANGS.map(l => (
                <button
                  key={l}
                  onClick={() => changeLang(l)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-full transition-all ${
                    lang === l
                      ? "bg-amber-500 text-slate-900 shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                  title={l.toUpperCase()}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {showLibrary ? (
            <div className="p-3 max-h-96 overflow-y-auto space-y-3">
              <p className="text-xs text-slate-400 mb-1">{tr("library_open", lang)}</p>
              {LIBRARY[lang].map((cat, ci) => (
                <div key={ci}>
                  <p className="text-[10px] uppercase tracking-wider text-amber-400/80 font-bold mb-1.5 px-1">{cat.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cat.items.map((it, ii) => (
                      <button
                        key={ii}
                        onClick={() => { setShowLibrary(false); processCommand(it.text); }}
                        disabled={state === "processing"}
                        className="px-2.5 py-1 text-[11px] rounded-full bg-slate-800/80 border border-white/10 text-slate-200 hover:bg-amber-500 hover:text-slate-900 hover:border-amber-400 transition-all disabled:opacity-40"
                        title={it.text}
                      >
                        {it.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : showHelp ? (
            <div className="p-3 max-h-64 overflow-y-auto">
              <p className="text-xs text-slate-400 mb-2">{tr("commands_available", lang)}</p>
              {commands.map((c, i) => (
                <div key={i} className="flex justify-between items-start py-1.5 border-b border-slate-800 last:border-0">
                  <span className="text-xs text-amber-400 font-medium">"{c.phrase}"</span>
                  <span className="text-xs text-slate-500 ml-2 text-right">{c.description}</span>
                </div>
              ))}
              <p className="text-xs text-blue-400 mt-3 italic">{tr("natural_hint", lang)}</p>
            </div>
          ) : (
            <div className="p-4">
              <div className="text-center mb-3">
                <p className="text-xs text-slate-400">{stateLabels[state]}</p>
              </div>

              {history.length > 0 && (
                <div className={`${mode === "chat" ? "max-h-80" : "max-h-40"} overflow-y-auto mb-3 space-y-2`}>
                  {history.slice(mode === "chat" ? -20 : -4).map((h, i) => (
                    <div key={i} className={`rounded-lg p-2.5 ${h.type === "user" ? "bg-slate-800 ml-6" : "bg-blue-900/30 border border-blue-800/50 mr-6"}`}>
                      <div className="flex items-start gap-2">
                        {h.type === "user" ? (
                          <MessageCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
                        )}
                        <p className={`text-xs ${h.type === "user" ? "text-white" : "text-blue-200"}`}>{h.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {transcript && state === "listening_command" && (
                <div className="bg-slate-800 rounded-lg p-3 mb-3">
                  <div className="flex items-start gap-2">
                    <MessageCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0 animate-pulse" />
                    <p className="text-sm text-white italic">{transcript}...</p>
                  </div>
                </div>
              )}

              {pending && (
                <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3 mb-3">
                  <p className="text-xs font-semibold text-amber-300 mb-1.5">{tr("confirm_required", lang)}</p>
                  <p className="text-sm text-white mb-2">{pending.summary}</p>
                  <div className="space-y-1 mb-3">
                    {pending.fields.map((f, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-slate-400">{f.label}</span>
                        <span className="text-slate-200 text-right ml-2 truncate max-w-[180px]">{f.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={confirmPending}
                      disabled={confirming}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {confirming ? "..." : tr("confirm_btn", lang)}
                    </button>
                    <button
                      onClick={cancelPending}
                      disabled={confirming}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-xs font-medium transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {tr("cancel_btn", lang)}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <p className="text-xs text-red-400 text-center mb-3">{error}</p>
              )}

              {/* Empty-state hint (premiere ouverture, pas d'historique). */}
              {history.length === 0 && !pending && state === "idle" && (
                <p className="text-xs text-slate-400 text-center italic mb-3 px-2">
                  {tr(mode === "chat" ? "empty_chat" : "empty_hint", lang)}
                </p>
              )}

              {/* Suggestions / chips de suivi — uniquement en mode "command".
                  En mode "chat" l'utilisateur tape librement, pas de raccourcis. */}
              {mode === "command" && !pending && state !== "listening_command" && state !== "processing" && (
                <div className="mb-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                    <Sparkles className="w-3 h-3" />
                    <span>{tr("suggestions_label", lang)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestionsFor(lastIntent, lang).map((s, i) => (
                      <button
                        key={i}
                        onClick={() => processCommand(s.text)}
                        disabled={state === "speaking"}
                        className="px-2.5 py-1 text-[11px] rounded-full bg-slate-800/80 hover:bg-amber-500 hover:text-slate-900 text-slate-300 border border-white/5 transition-colors disabled:opacity-50"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Champ de saisie texte — alternative au micro. */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = textInput.trim();
                  if (!v || state === "processing") return;
                  setTextInput("");
                  processCommand(v);
                }}
                className="flex gap-1.5 mb-3"
              >
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={tr(mode === "chat" ? "chat_placeholder" : "input_placeholder", lang)}
                  className="flex-1 px-3 py-2 text-xs rounded-lg bg-slate-800/80 border border-white/5 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                  disabled={state === "processing"}
                />
                <button
                  type="submit"
                  disabled={!textInput.trim() || state === "processing"}
                  className="px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 disabled:opacity-40 transition-colors"
                  title={tr("send_btn", lang)}
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>

              <div className="flex justify-center items-center gap-3">
                <button
                  onClick={toggleWakeMode}
                  className={`px-3 py-2 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                    wakeActiveRef.current
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/50"
                      : "bg-slate-700 hover:bg-slate-600 text-slate-400"
                  }`}
                  title={wakeActiveRef.current ? tr("wake_toggle_off", lang) : tr("wake_toggle_on", lang)}
                >
                  <Radio className="w-3.5 h-3.5" />
                  {tr("wake_label", lang)}
                </button>

                <button
                  onClick={toggleVoice}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                    state === "listening_command"
                      ? "bg-red-500 hover:bg-red-600 animate-pulse"
                      : state === "processing"
                        ? "bg-blue-500 cursor-wait"
                        : state === "speaking"
                          ? "bg-green-500"
                          : "bg-amber-500 hover:bg-amber-600"
                  }`}
                  aria-label={stateLabels[state]}
                  title={stateLabels[state]}
                >
                  {state === "listening_command" ? (
                    <MicOff className="w-6 h-6 text-white" />
                  ) : state === "processing" ? (
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Mic className="w-6 h-6 text-white" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
