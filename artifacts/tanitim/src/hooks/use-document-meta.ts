import { useEffect } from "react";
import { composePageTitle } from "@/lib/page-meta";

export interface DocumentMeta {
  title: string;
  description: string;
  /** Path-only canonical (e.g. "/confidentialite"). Resolved against origin. */
  path?: string;
  ogTitle?: string;
  ogDescription?: string;
  /** Demande aux moteurs de ne pas indexer cette page (cf. PAGE_META.notFound). */
  noindex?: boolean;
}

function setMetaTag(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// Applies per-page metadata (title / description / Open Graph / canonical) for
// this client-rendered marketing site. Each route calls it with its own copy so
// crawlers and link previews reflect the current page rather than the static
// index.html defaults.
export function useDocumentMeta({
  title,
  description,
  path,
  ogTitle,
  ogDescription,
  noindex,
}: DocumentMeta): void {
  useEffect(() => {
    const fullTitle = composePageTitle(title);
    document.title = fullTitle;

    // La balise est posee ET retiree. Sur une application monopage, le
    // `<head>` survit a la navigation: une balise `noindex` laissee derriere
    // soi apres un passage par la page d'erreur desindexerait ensuite les
    // vraies pages. Le defaut qu'on corrige ici est deja un defaut de
    // referencement; en introduire un pire serait sans excuse.
    if (noindex) {
      setMetaTag("name", "robots", "noindex, follow");
    } else {
      document.head.querySelector('meta[name="robots"]')?.remove();
    }

    setMetaTag("name", "description", description);
    setMetaTag("property", "og:title", ogTitle || fullTitle);
    setMetaTag("property", "og:description", ogDescription || description);
    setMetaTag("name", "twitter:title", ogTitle || fullTitle);
    setMetaTag("name", "twitter:description", ogDescription || description);

    if (path && typeof window !== "undefined") {
      const canonical = new URL(path, window.location.origin).toString();
      setMetaTag("property", "og:url", canonical);
      setCanonical(canonical);
    }
  }, [title, description, path, ogTitle, ogDescription, noindex]);
}
