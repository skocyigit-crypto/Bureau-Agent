import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Couche d'internationalisation legere, SANS dependance externe.
 *
 * Pourquoi maison plutot que react-i18next: le monorepo impose une quarantaine
 * supply-chain de 24 h (minimumReleaseAge) et le build n'est pas observable
 * depuis cet environnement — ajouter une dependance + muter le lockfile a
 * l'aveugle est risque. Cette couche expose volontairement la MEME surface que
 * react-i18next (`useTranslation()` -> `{ t, i18n }`, `t("cle", { var })`), donc
 * migrer plus tard revient a remplacer ce fichier sans toucher aux appelants.
 *
 * Fonctions couvertes: detection langue (localStorage > navigateur > defaut),
 * persistance, interpolation {{var}}, repli sur la langue par defaut (fr) si une
 * cle manque, sens d'ecriture RTL (arabe), mise a jour de <html lang/dir>.
 */

import fr from "./locales/fr.json";
import tr from "./locales/tr.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import de from "./locales/de.json";
import ar from "./locales/ar.json";

export type LangCode = "fr" | "tr" | "en" | "es" | "de" | "ar";

export const DEFAULT_LANG: LangCode = "fr";

// Dictionnaires charges statiquement (petits, inclus dans le bundle). Passer a un
// chargement paresseux (import dynamique) est trivial si les catalogues grossissent.
const RESOURCES: Record<LangCode, Record<string, unknown>> = { fr, tr, en, es, de, ar };

// Metadonnees d'affichage. `dir` pilote la mise en page (RTL pour l'arabe).
export const LANGUAGES: { code: LangCode; label: string; dir: "ltr" | "rtl" }[] = [
  { code: "fr", label: "Francais", dir: "ltr" },
  { code: "tr", label: "Turkce", dir: "ltr" },
  { code: "en", label: "English", dir: "ltr" },
  { code: "es", label: "Espanol", dir: "ltr" },
  { code: "de", label: "Deutsch", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
];

const LANG_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));
const STORAGE_KEY = "app.lang";

function isLangCode(v: unknown): v is LangCode {
  return typeof v === "string" && LANG_BY_CODE.has(v as LangCode);
}

export function detectInitialLang(): LangCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLangCode(saved)) return saved;
  } catch { /* localStorage indisponible */ }
  const nav = typeof navigator !== "undefined" ? navigator.language?.slice(0, 2).toLowerCase() : "";
  if (isLangCode(nav)) return nav;
  return DEFAULT_LANG;
}

// Resout "a.b.c" dans un objet imbrique; retourne undefined si absent.
function lookup(dict: Record<string, unknown>, key: string): string | undefined {
  const val = key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
  return typeof val === "string" ? val : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

interface I18nContextValue {
  lang: LangCode;
  dir: "ltr" | "rtl";
  setLang: (code: LangCode) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(detectInitialLang);

  const dir = LANG_BY_CODE.get(lang)?.dir ?? "ltr";

  // Refletons la langue/sens sur <html> pour le CSS (RTL), l'accessibilite et le
  // rendu natif des dates par le navigateur.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("lang", lang);
    root.setAttribute("dir", dir);
  }, [lang, dir]);

  const setLang = useCallback((code: LangCode) => {
    setLangState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  }, []);

  const t = useCallback<TFunction>((key, vars) => {
    const active = RESOURCES[lang];
    const found = lookup(active, key) ?? lookup(RESOURCES[DEFAULT_LANG], key);
    // Repli ultime: la cle elle-meme, pour reperer visuellement un trou de trad.
    return interpolate(found ?? key, vars);
  }, [lang]);

  const value = useMemo<I18nContextValue>(() => ({ lang, dir, setLang, t }), [lang, dir, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Surface compatible react-i18next: `const { t, i18n } = useTranslation();`
 * `i18n.language` et `i18n.changeLanguage(code)` sont fournis pour faciliter une
 * eventuelle migration.
 */
export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used within <I18nProvider>");
  return {
    t: ctx.t,
    lang: ctx.lang,
    dir: ctx.dir,
    i18n: {
      language: ctx.lang,
      dir: ctx.dir,
      changeLanguage: (code: LangCode) => ctx.setLang(code),
    },
  };
}
