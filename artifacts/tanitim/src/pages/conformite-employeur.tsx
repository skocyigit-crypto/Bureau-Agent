import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useState } from "react";
import { Link, useParams } from "wouter";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";
import { rendreMarkdown } from "@/lib/markdown-simple";
import readme from "@/content/conformite-employeur/README.md?raw";
import cse from "@/content/conformite-employeur/dossier-consultation-cse.md?raw";
import note from "@/content/conformite-employeur/note-information-salaries.md?raw";
import aipd from "@/content/conformite-employeur/trame-aipd.md?raw";
import noticeIa from "@/content/conformite-employeur/notice-utilisation-ia.md?raw";

/**
 * Kit de conformite employeur : consultation du CSE, note d'information des
 * salaries, trame d'AIPD.
 *
 * Le kit existait depuis septembre 2026, complet — mais dans le depot
 * seulement. Aucun ecran, aucune page ne menait a lui : l'employeur qui active
 * le pointage, la presence sur zone ou les rapports d'evaluation n'avait aucun
 * moyen de le trouver. Or ce sont LUI, pas l'editeur, que le Code du travail
 * (L2312-38, L1222-4) et le RGPD (art. 13, 35) obligent. Un document que le
 * responsable ne peut pas lire ne l'aide pas a s'y conformer.
 *
 * Les fichiers restent la source unique : cette page les lit tels quels.
 */
export const DOCUMENTS = [
  { slug: "", fichier: "README.md", titre: "Présentation du kit", source: readme },
  { slug: "consultation-cse", fichier: "dossier-consultation-cse.md", titre: "Dossier de consultation du CSE", source: cse },
  { slug: "note-information-salaries", fichier: "note-information-salaries.md", titre: "Note d'information des salariés", source: note },
  { slug: "aipd", fichier: "trame-aipd.md", titre: "Trame d'analyse d'impact (AIPD)", source: aipd },
  { slug: "notice-ia", fichier: "notice-utilisation-ia.md", titre: "Notice d'utilisation de l'IA (AI Act)", source: noticeIa },
] as const;

const adresse = (slug: string) => (slug ? `/conformite-employeur/${slug}` : "/conformite-employeur");

/** Un lien entre fichiers du kit devient un lien entre pages. */
function lienInterne(cible: string): string {
  const doc = DOCUMENTS.find((d) => d.fichier === cible);
  return doc ? adresse(doc.slug) : cible;
}

export default function ConformiteEmployeur() {
  const [, setDemoOpen] = useState(false);
  useDocumentMeta(PAGE_META.conformiteEmployeur);
  const { doc } = useParams<{ doc?: string }>();
  const courant = DOCUMENTS.find((d) => d.slug === (doc ?? "")) ?? DOCUMENTS[0];

  return (
    <div className="min-h-screen bg-background">
      <Navbar onDemoClick={() => setDemoOpen(true)} />
      <main id="contenu" className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <nav aria-label="Documents du kit" className="mb-8">
          <ul className="flex flex-wrap gap-2">
            {DOCUMENTS.map((d) => (
              <li key={d.slug}>
                <Link
                  href={adresse(d.slug)}
                  aria-current={d === courant ? "page" : undefined}
                  className={
                    "inline-block rounded-lg px-3 py-1.5 text-sm border " +
                    (d === courant ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted")
                  }
                >
                  {d.titre}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <article className="text-foreground/90">{rendreMarkdown(courant.source, lienInterne)}</article>
        <p className="mt-12 text-sm text-muted-foreground">
          Modèles fournis à titre d'aide ; ils ne constituent pas un avis juridique. Les passages
          entre crochets sont à compléter par l'employeur.
        </p>
      </main>
      <Footer />
    </div>
  );
}
