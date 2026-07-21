import { useMemo, useState } from "react";
import { BookOpen, Search, X } from "lucide-react";
import guideSource from "@/content/guide.md?raw";
import { MarkdownView, slugify } from "@/components/markdown-view";
import { Input } from "@/components/ui/input";

/**
 * Guide d'utilisation complet, embarque dans l'application (contenu:
 * src/content/guide.md). Accessible depuis l'icone livre presente dans
 * l'en-tete de chaque page, donc toujours a portee de main.
 *
 * Colonne de gauche: sommaire clicable genere a partir des titres de niveau 2
 * (## dans le markdown). Recherche: filtre le sommaire ET fait defiler vers la
 * premiere section correspondante.
 */

interface TocEntry { title: string; id: string }

export default function GuidePage() {
  const [query, setQuery] = useState("");

  // Sommaire: un lien par titre de niveau 2 (## Titre). Les ids correspondent
  // a ceux poses par MarkdownView (meme slugify), donc les ancres fonctionnent.
  const toc = useMemo<TocEntry[]>(() => {
    const entries: TocEntry[] = [];
    for (const line of guideSource.split(/\r?\n/)) {
      const m = line.match(/^##\s+(.*)$/);
      if (m) {
        const title = m[1].trim();
        entries.push({ title, id: slugify(title) });
      }
    }
    return entries;
  }, []);

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
      <div className="flex items-start gap-3 mb-6">
        <div className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 p-2.5 text-white shadow-lg shadow-emerald-500/20">
          <BookOpen className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Guide d'utilisation</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Tout ce que fait l'application, section par section. Utilisez le sommaire ou la recherche.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        {/* Sommaire (colle en haut au defilement) */}
        <aside className="lg:sticky lg:top-20 self-start">
          <div className="relative mb-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une section…"
              className="pl-9 pr-8 h-9"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <nav className="max-h-[70vh] overflow-y-auto pr-2 space-y-0.5">
            {filteredToc.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-1">Aucune section.</p>
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
        <article className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-8">
          <MarkdownView source={guideSource} />
        </article>
      </div>
    </div>
  );
}
