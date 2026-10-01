/**
 * Plan de navigation du bureau — une seule source pour la barre laterale, les
 * onglets de section, le titre de la page et la palette de commandes.
 *
 * Le menu etait une liste de 12 groupes et 59 entrees construite dans
 * `layout.tsx`. Trois defauts en venaient :
 *
 *  - Des outils ranges par hasard. « Centre de securite », « Diagnostic du
 *    poste », « Reglements » (le journal des encaissements) et « Recherche
 *    web » etaient sous « Communication ». Traduits par le navigateur, ces
 *    libelles francais devenaient « Yonetmelikler », « Is Teshisi »… : on ne
 *    pouvait plus deviner ce qu'ils faisaient.
 *  - Sept entrees « IA » de meme rang (equipe, commandant, assistant
 *    universel, agents, catalogue…) sans dire en quoi elles different.
 *  - Les outils du proprietaire de la plateforme melanges au menu du bureau.
 *
 * Ici le bureau a huit sections de travail, des reglages repliables en bas, et
 * la console plateforme est un espace a part. Une entree peut regrouper
 * plusieurs pages : la barre laterale n'en montre qu'une, les autres sont des
 * onglets en tete de page (`pages[0]` est la page d'arrivee).
 *
 * Aucune page n'a ete retiree : chaque route du menu d'avant a une place ici,
 * et un test le verifie.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity, AudioLines, CalendarRange, Banknote, BarChart, Bell, BookOpen, Bot, Briefcase, Building2, Calendar, CheckSquare, ClipboardList, Clock,
  CreditCard, FileSignature, FileText, Globe, HardHat, Inbox, KeyRound, LayoutDashboard, LifeBuoy, Mail, MapPin, MessageCircle,
  MessageSquare, Phone, Plug, Radar, Receipt, ReceiptText, Rocket, Search, Settings, Shield, ShieldCheck, StickyNote, UserCog,
  Scale, Users, Wallet, Workflow,
} from "lucide-react";

/**
 * Qui peut ouvrir la page. Reprend les gardes des routes (`withRoleGate`) et
 * l'ancien filtre du menu : `ia` exclut le role en lecture seule, qui ne
 * declenche pas d'agent.
 */
export type Acces = "tous" | "ia" | "admin" | "super_admin";

/** Compteurs affiches a cote d'une entree. `approbation` est le seul orange. */
export type Rozet = "call" | "message" | "prospect" | "task" | "note" | "rappel" | "approbation";

export type Page = { cle: string; href: string; acces?: Acces };
export type Entree = { cle: string; icone: LucideIcon; pages: Page[]; rozet?: Rozet };
export type Section = { cle: string; entrees: Entree[] };

const seule = (cle: string, href: string, icone: LucideIcon, opts: { acces?: Acces; rozet?: Rozet } = {}): Entree => ({
  cle,
  icone,
  rozet: opts.rozet,
  pages: [{ cle, href, acces: opts.acces }],
});

/** Les huit sections de travail, dans l'ordre de la barre laterale. */
export const SECTIONS_BUREAU: readonly Section[] = [
  {
    cle: "today",
    entrees: [
      seule("dashboard", "/", LayoutDashboard),
      seule("approvalQueue", "/file-approbation", Inbox, { acces: "ia", rozet: "approbation" }),
      seule("proactiveAssistant", "/assistant-proactif", Radar, { acces: "ia" }),
      {
        cle: "recentActivity",
        icone: Activity,
        // La corbeille reste ouverte a tous : celui qui vient de se tromper
        // n'est pas forcement administrateur.
        pages: [{ cle: "recentActivity", href: "/activite-recente" }, { cle: "trash", href: "/corbeille" }],
      },
    ],
  },
  {
    cle: "communication",
    entrees: [
      {
        cle: "calls",
        icone: Phone,
        rozet: "call",
        // Appels recus et appels a passer : un seul espace. Les reglages de la
        // ligne restent dans Reglages du bureau > Connexions.
        pages: [{ cle: "calls", href: "/appels" }, { cle: "phoneOps", href: "/telefon" }],
      },
      seule("messages", "/messages", MessageSquare, { rozet: "message" }),
      seule("whatsapp", "/whatsapp", MessageCircle),
      seule("mailAgent", "/gmail-agent", Mail, { acces: "ia" }),
      seule("contacts", "/contacts", Users),
    ],
  },
  {
    cle: "sales",
    entrees: [
      seule("prospects", "/prospects", Briefcase, { rozet: "prospect" }),
      seule("quotes", "/devis", FileSignature),
    ],
  },
  {
    cle: "work",
    entrees: [
      seule("projects", "/projets", HardHat),
      seule("tasks", "/taches", CheckSquare, { rozet: "task" }),
      seule("siteVoice", "/saisie-chantier", AudioLines, { acces: "ia" }),
      seule("internalNotes", "/notes-internes", StickyNote, { rozet: "note" }),
      seule("checkin", "/pointage", Clock),
      seule("teamLocation", "/equipe/localisation", MapPin, { acces: "admin" }),
    ],
  },
  {
    cle: "planning",
    entrees: [
      // Les trois vues du plan (rendez-vous, equipe, travaux) d abord ; le
      // calendrier reste pour la saisie libre.
      seule("planningViews", "/planning", CalendarRange),
      seule("calendar", "/calendrier", Calendar),
      seule("reminders", "/notifications", Bell, { rozet: "rappel" }),
    ],
  },
  {
    cle: "finance",
    entrees: [
      // La comparaison par chantier vient en tete : c est la question que la
      // section Finance existe pour trancher — ce chantier rapporte-t-il ?
      seule("businessComparison", "/finance/affaires", Scale),
      seule("clientInvoices", "/factures", Receipt),
      seule("encaissements", "/reglements", Banknote),
      seule("expenses", "/depenses", ReceiptText),
      seule("treasury", "/tresorerie", Wallet),
    ],
  },
  {
    cle: "agentBureau",
    entrees: [
      {
        cle: "agents",
        icone: Bot,
        pages: [
          { cle: "agentHub", href: "/ajan-bureau", acces: "ia" },
          { cle: "agentCatalog", href: "/agents-catalogue", acces: "ia" },
          { cle: "aiAgents", href: "/agents-ia", acces: "ia" },
          { cle: "aiTeam", href: "/equipe-ia", acces: "ia" },
          { cle: "universalAssistant", href: "/asistan", acces: "ia" },
          { cle: "aiCommander", href: "/commandant-ia", acces: "ia" },
          { cle: "aiLearned", href: "/ia-apprentissage", acces: "ia" },
        ],
      },
      {
        cle: "flows",
        icone: Workflow,
        pages: [
          { cle: "flowStudio", href: "/studio-flux", acces: "admin" },
          { cle: "automations", href: "/automatisations", acces: "admin" },
        ],
      },
      {
        cle: "runs",
        icone: ClipboardList,
        pages: [
          { cle: "taskDesk", href: "/bureau-taches", acces: "ia" },
          { cle: "autoAudit", href: "/auto-audit", acces: "admin" },
        ],
      },
    ],
  },
  {
    cle: "knowledge",
    entrees: [
      {
        cle: "documents",
        icone: FileText,
        pages: [{ cle: "documents", href: "/documents" }, { cle: "documentAi", href: "/document-ia", acces: "ia" }],
      },
      seule("knowledgeBase", "/base-connaissances", BookOpen, { acces: "ia" }),
      {
        cle: "reports",
        icone: ClipboardList,
        pages: [{ cle: "reports", href: "/rapports" }, { cle: "executiveReport", href: "/rapport-executif", acces: "admin" }],
      },
      {
        cle: "statistics",
        icone: BarChart,
        pages: [{ cle: "statistics", href: "/analyse" }, { cle: "teamPerformance", href: "/performance", acces: "admin" }],
      },
      seule("webSearch", "/recherche-web", Search, { acces: "ia" }),
    ],
  },
];

/** Reglages du bureau : en bas de la barre laterale, repliables. */
export const REGLAGES_BUREAU: readonly Entree[] = [
  seule("users", "/utilisateurs", UserCog, { acces: "admin" }),
  {
    cle: "connections",
    icone: Plug,
    pages: [{ cle: "connectors", href: "/logiciels" }, { cle: "telephony", href: "/telephonie" }],
  },
  seule("googleWorkspace", "/google-workspace", Globe),
  seule("dataProtection", "/protection-donnees", Shield, { acces: "admin" }),
  {
    cle: "security",
    icone: ShieldCheck,
    pages: [{ cle: "securityCenter", href: "/securite" }, { cle: "postDiagnostic", href: "/diagnostic-poste" }],
  },
  seule("license", "/gestion-licence", CreditCard, { acces: "admin" }),
  seule("settings", "/parametres", Settings),
  {
    cle: "initialSetup",
    icone: Rocket,
    pages: [{ cle: "initialSetup", href: "/onboarding" }, { cle: "smartImport", href: "/import" }],
  },
  {
    cle: "guide",
    icone: LifeBuoy,
    pages: [{ cle: "guide", href: "/guide" }, { cle: "mobileApp", href: "/telecharger" }],
  },
];

/**
 * Console du proprietaire de la plateforme. Jamais dans le menu du bureau :
 * un super-administrateur y entre par un bouton de l'en-tete, et la barre
 * laterale ne montre alors QUE ces pages.
 */
export const CONSOLE_PLATEFORME: readonly Entree[] = [
  seule("saasBackoffice", "/admin", Building2, { acces: "super_admin" }),
  seule("organisations", "/organisations", KeyRound, { acces: "super_admin" }),
  seule("globalAuditLog", "/admin/audit", ClipboardList, { acces: "super_admin" }),
  seule("techHealth", "/sante-technique", Activity, { acces: "super_admin" }),
];

export function peutOuvrir(acces: Acces | undefined, role: string): boolean {
  const superAdmin = role === "super_admin";
  switch (acces ?? "tous") {
    case "super_admin": return superAdmin;
    case "admin": return superAdmin || role === "administrateur";
    case "ia": return role !== "lecture_seule";
    default: return true;
  }
}

/** L'entree, reduite aux pages que ce role peut ouvrir ; `null` s'il n'en reste aucune. */
export function entreeVisible(entree: Entree, role: string): Entree | null {
  const pages = entree.pages.filter((p) => peutOuvrir(p.acces, role));
  return pages.length ? { ...entree, pages } : null;
}

export function entreesVisibles(entrees: readonly Entree[], role: string): Entree[] {
  return entrees.map((e) => entreeVisible(e, role)).filter((e): e is Entree => e !== null);
}

export function sectionsVisibles(role: string): Section[] {
  return SECTIONS_BUREAU.map((s) => ({ cle: s.cle, entrees: entreesVisibles(s.entrees, role) })).filter((s) => s.entrees.length > 0);
}

/** « /appels/12 » est dans « /appels » ; « /appels-sortants » ne l'est pas. */
export function contient(href: string, adresse: string): boolean {
  return href === "/" ? adresse === "/" : adresse === href || adresse.startsWith(`${href}/`);
}

/**
 * La page la plus precise qui contient l'adresse. « /admin/audit » est a la
 * fois dans « /admin » et dans « /admin/audit » : la plus longue gagne.
 */
export function pageDe(adresse: string, entrees: readonly Entree[]): { entree: Entree; page: Page } | null {
  let meilleure: { entree: Entree; page: Page } | null = null;
  for (const entree of entrees) {
    for (const page of entree.pages) {
      if (contient(page.href, adresse) && (!meilleure || page.href.length > meilleure.page.href.length)) {
        meilleure = { entree, page };
      }
    }
  }
  return meilleure;
}

/** Vrai quand l'adresse est une page de la console plateforme. */
export function estDansLaConsole(adresse: string): boolean {
  return pageDe(adresse, CONSOLE_PLATEFORME) !== null;
}

/** Toutes les pages d'une liste d'entrees, a plat. */
export function pagesDe(entrees: readonly Entree[]): Page[] {
  return entrees.flatMap((e) => e.pages);
}

/**
 * Le droit d'ouvrir une adresse, lu dans le plan du menu. La palette de
 * commandes s'en sert : elle proposait « Automatisations » et « Performance »
 * a tout le monde alors que les routes sont reservees aux responsables.
 */
export function accesDeLAdresse(adresse: string): Acces | undefined {
  const chemin = adresse.split("?")[0];
  const trouvee = pageDe(chemin, [...SECTIONS_BUREAU.flatMap((s) => s.entrees), ...REGLAGES_BUREAU, ...CONSOLE_PLATEFORME]);
  return trouvee?.page.acces ?? (trouvee ? "tous" : undefined);
}
