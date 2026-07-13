import type { DocumentMeta } from "@/hooks/use-document-meta";

// Single source of truth for per-route metadata on the marketing site. Each page
// passes its entry to useDocumentMeta so crawlers and link previews reflect the
// current page rather than the static index.html defaults. Centralizing it here
// lets an automated test assert every route ships a distinct, non-empty title
// (a silent duplicate would hurt SEO and accessibility).
export const SITE_NAME = "Agent de Bureau";

export const PAGE_META = {
  home: {
    title: "Agent de Bureau — Le secrétariat IA de votre entreprise",
    description:
      "CRM, appels, devis, facturation, stock et IA multi-agents : la plateforme française complète qui centralise et automatise la gestion de votre bureau.",
    path: "/",
  },
  confidentialite: {
    title: "Politique de confidentialité",
    description:
      "Comment Agent de Bureau collecte, protège et traite vos données personnelles, en conformité avec le RGPD.",
    path: "/confidentialite",
  },
  gizlilik: {
    title: "Gizlilik Politikası",
    description:
      "Agent de Bureau / Büro Ajanı kişisel verilerinizi nasıl topladığını ve koruduğunu açıklar — KVKK ve GDPR uyumlu.",
    path: "/gizlilik",
  },
  cgu: {
    title: "Conditions Générales d'Utilisation",
    description:
      "Conditions générales d'utilisation de la plateforme SaaS Agent de Bureau : accès, abonnement et responsabilités.",
    path: "/cgu",
  },
  mentionsLegales: {
    title: "Mentions légales",
    description:
      "Mentions légales d'Agent de Bureau : éditeur, hébergement, propriété intellectuelle et contact.",
    path: "/mentions-legales",
  },
  notFound: {
    title: "Page introuvable (404)",
    description: "La page que vous recherchez n'existe pas ou a été déplacée.",
  },
} satisfies Record<string, DocumentMeta>;

export type PageMetaKey = keyof typeof PAGE_META;

// Composes the full <title>: appends the site name unless the page already
// includes it (the home title already carries the brand). Exported so the hook
// and tests share one implementation.
export function composePageTitle(title: string, siteName: string = SITE_NAME): string {
  return title.includes(siteName) ? title : `${title} — ${siteName}`;
}
