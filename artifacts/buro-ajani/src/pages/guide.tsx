import { MarkdownView,slugify } from "@/components/markdown-view";
import { Input } from "@/components/ui/input";
import { BookOpen,Search,X } from "lucide-react";
import { useMemo,useState } from "react";

/**
 * Guide d'utilisation multilingue, embarque dans l'application. Accessible
 * depuis l'icone livre presente dans l'en-tete de chaque page.
 *
 * INTERNATIONALISATION — ajouter une langue = deposer UN fichier.
 * Le contenu vit dans src/content/guide.<code>.md (ex: guide.fr.md, guide.tr.md,
 * guide.en.md). `import.meta.glob` les decouvre automatiquement au build: aucune
 * modification de ce composant n'est necessaire pour ajouter l'espagnol,
 * l'arabe, etc. Il suffit d'ajouter le libelle natif dans LANG_LABELS.
 *
 * Selecteur de langue en haut a droite; langue memorisee (localStorage). Sommaire
 * clicable genere depuis les titres de niveau 2 (##). Recherche: filtre le
 * sommaire ET fait defiler vers la premiere section correspondante.
 */

// Decouverte automatique de toutes les traductions du guide. La cle du glob est
// le chemin (ex: "../content/guide.fr.md"); on en extrait le code langue.
const rawSources = import.meta.glob<string>("../content/guide.*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Nom natif de chaque langue (affiche dans le selecteur). Une langue presente
// dans rawSources mais absente ici s'affiche avec son code en majuscules.
const LANG_LABELS: Record<string, string> = {
  fr: "Francais",
  tr: "Turkce",
  en: "English",
  es: "Espanol",
  de: "Deutsch",
  ar: "العربية",
  nl: "Nederlands",
  it: "Italiano",
  pt: "Portugues",
};

// Chaine de l'interface du guide (hors contenu) par langue, avec repli FR.
const UI_STRINGS: Record<string, { title: string; subtitle: string; search: string; empty: string; clearSearch: string }> = {
  fr: {
    title: "Guide d'utilisation",
    subtitle: "Tout ce que fait l'application, section par section. Utilisez le sommaire ou la recherche.",
    search: "Rechercher une section…",
    empty: "Aucune section.",
    clearSearch: "Effacer la recherche",
  },
  tr: {
    title: "Kullanma Kilavuzu",
    subtitle: "Uygulamanin yaptigi her sey, bolum bolum. Icindekiler'i veya aramayi kullanin.",
    search: "Bir bolum arayin…",
    empty: "Bolum yok.",
    clearSearch: "Aramayi temizle",
  },
  en: {
    title: "User Guide",
    subtitle: "Everything the app does, section by section. Use the table of contents or search.",
    search: "Search a section…",
    empty: "No section.",
    clearSearch: "Clear search",
  },
};

interface TocEntry { title: string; id: string }

// { fr: "...markdown...", tr: "...", ... } trie pour un ordre de selecteur stable.
const SOURCES: Record<string, string> = {};
for (const [path, content] of Object.entries(rawSources)) {
  const m = path.match(/guide\.([a-z]{2})\.md$/i);
  if (m) SOURCES[m[1].toLowerCase()] = content as string;
}

// Ordre de preference d'affichage; les langues hors liste suivent, triees.
const LANG_ORDER = ["fr", "tr", "en", "es", "de", "ar", "nl", "it", "pt"];
const AVAILABLE_LANGS = Object.keys(SOURCES).sort((a, b) => {
  const ia = LANG_ORDER.indexOf(a), ib = LANG_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
});

const STORAGE_KEY = "guide.lang";

function initialLang(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SOURCES[saved]) return saved;
  } catch { /* localStorage indisponible: on retombe sur la detection */ }
  // On suit la langue du navigateur si une traduction existe, sinon FR, sinon
  // la premiere langue disponible (garantit toujours un contenu affichable).
  const nav = typeof navigator !== "undefined" ? navigator.language?.slice(0, 2).toLowerCase() : "";
  if (nav && SOURCES[nav]) return nav;
  if (SOURCES.fr) return "fr";
  return AVAILABLE_LANGS[0] ?? "fr";
}

export default function GuidePage() {
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<string>(initialLang);

  const source = SOURCES[lang] ?? SOURCES[AVAILABLE_LANGS[0]] ?? "";
  const t = UI_STRINGS[lang] ?? UI_STRINGS.fr;

  const changeLang = (next: string) => {
    setLang(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  };

  // Sommaire: un lien par titre de niveau 2 (## Titre). Les ids correspondent
  // a ceux poses par MarkdownView (meme slugify), donc les ancres fonctionnent.
  const toc = useMemo<TocEntry[]>(() => {
    const entries: TocEntry[] = [];
    for (const line of source.split(/\r?\n/)) {
      const m = line.match(/^##\s+(.*)$/);
      if (m) {
        const title = m[1].trim();
        entries.push({ title, id: slugify(title) });
      }
    }
    return entries;
  }, [source]);

  const filteredToc = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return toc;
    return toc.filter((e) => e.title.toLowerCase().includes(q));
  }, [toc, query]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-2.5 text-white shadow-lg shadow-emerald-500/20">
          <BookOpen className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{t.subtitle}</p>
        </div>
        {/* Selecteur de langue — auto-alimente par les fichiers guide.<code>.md */}
        {AVAILABLE_LANGS.length > 1 && (
          <div className="flex flex-wrap items-center rounded-lg border border-border bg-card p-0.5 shrink-0" role="group" aria-label="Langue">
            {AVAILABLE_LANGS.map((code) => (
              <button
                key={code}
                onClick={() => changeLang(code)}
                aria-pressed={lang === code}
                lang={code}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  lang === code
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {LANG_LABELS[code] ?? code.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        {/* Sommaire (colle en haut au defilement) */}
        <aside className="lg:sticky lg:top-20 self-start">
          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
              className="pl-9 pr-8 h-9"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={t.clearSearch}>
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <nav className="max-h-[70vh] overflow-y-auto pr-2 space-y-0.5">
            {filteredToc.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-1">{t.empty}</p>
            ) : (
              filteredToc.map((e) => (
                <button
                  key={e.id}
                  onClick={() => scrollTo(e.id)}
                  className="w-full text-left text-sm px-2 py-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  {e.title}
                </button>
              ))
            )}
          </nav>
        </aside>

        {/* Contenu */}
        <article className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-8" lang={lang}>
          <MarkdownView source={source} />
        </article>
      </div>
    </div>
  );
}
