import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

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

export type LangCode = "fr" | "tr" | "en" | "es" | "de" | "ar";

export const DEFAULT_LANG: LangCode = "fr";

type Dictionary = Record<string, unknown>;

// Le francais reste synchrone pour garantir un premier rendu immediat et un
// fallback toujours disponible. Les autres catalogues font plusieurs centaines
// de Ko chacun: les charger uniquement lorsque la langue est selectionnee evite
// de les inclure tous dans le bundle initial.
const RESOURCES: Partial<Record<LangCode, Dictionary>> = { fr };
const RESOURCE_LOADERS: Record<
  Exclude<LangCode, "fr">,
  () => Promise<Dictionary>
> = {
  tr: () => import("./locales/tr.json").then((module) => module.default),
  en: () => import("./locales/en.json").then((module) => module.default),
  es: () => import("./locales/es.json").then((module) => module.default),
  de: () => import("./locales/de.json").then((module) => module.default),
  ar: () => import("./locales/ar.json").then((module) => module.default),
};
const pendingResources = new Map<LangCode, Promise<Dictionary>>();

function loadResource(code: LangCode): Promise<Dictionary> {
  const cached = RESOURCES[code];
  if (cached) return Promise.resolve(cached);

  const pending = pendingResources.get(code);
  if (pending) return pending;

  const request = RESOURCE_LOADERS[code as Exclude<LangCode, "fr">]().then(
    (resource) => {
      RESOURCES[code] = resource;
      pendingResources.delete(code);
      return resource;
    },
    (error: unknown) => {
      pendingResources.delete(code);
      throw error;
    },
  );
  pendingResources.set(code, request);
  return request;
}

// Metadonnees d'affichage. `dir` pilote la mise en page (RTL pour l'arabe).
export const LANGUAGES: {
  code: LangCode;
  label: string;
  dir: "ltr" | "rtl";
}[] = [
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
  } catch {
    /* localStorage indisponible */
  }
  const nav =
    typeof navigator !== "undefined"
      ? navigator.language?.slice(0, 2).toLowerCase()
      : "";
  if (isLangCode(nav)) return nav;
  return DEFAULT_LANG;
}

// Resout "a.b.c" dans un objet imbrique; retourne undefined si absent.
function lookup(
  dict: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = key.split(".").reduce<unknown>((acc, part) => {
    if (
      acc &&
      typeof acc === "object" &&
      part in (acc as Record<string, unknown>)
    ) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
  return typeof val === "string" ? val : undefined;
}

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

export type TFunction = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

interface I18nContextValue {
  lang: LangCode;
  dir: "ltr" | "rtl";
  setLang: (code: LangCode) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(detectInitialLang);
  const [resourceVersion, setResourceVersion] = useState(0);

  const dir = LANG_BY_CODE.get(lang)?.dir ?? "ltr";

  useEffect(() => {
    if (RESOURCES[lang]) return;
    let active = true;
    void loadResource(lang)
      .then(() => {
        if (active) setResourceVersion((version) => version + 1);
      })
      .catch((error: unknown) => {
        // Le fallback francais reste utilisable meme si un chunk de traduction
        // ne peut pas etre telecharge (reseau hors ligne, cache obsolete, etc.).
        console.error(`[i18n] Failed to load locale ${lang}`, error);
      });
    return () => {
      active = false;
    };
  }, [lang]);

  // Refletons la langue/sens sur <html> pour le CSS (RTL), l'accessibilite et le
  // rendu natif des dates par le navigateur.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("lang", lang);
    root.setAttribute("dir", dir);
  }, [lang, dir]);

  const setLang = useCallback((code: LangCode) => {
    setLangState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback<TFunction>(
    (key, vars) => {
      const fallback = RESOURCES[DEFAULT_LANG]!;
      const active = RESOURCES[lang] ?? fallback;
      const found = lookup(active, key) ?? lookup(fallback, key);
      // Repli ultime: la cle elle-meme, pour reperer visuellement un trou de trad.
      return interpolate(found ?? key, vars);
    },
    [lang, resourceVersion],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ lang, dir, setLang, t }),
    [lang, dir, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Surface compatible react-i18next: `const { t, i18n } = useTranslation();`
 * `i18n.language` et `i18n.changeLanguage(code)` sont fournis pour faciliter une
 * eventuelle migration.
 */
export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx)
    throw new Error("useTranslation must be used within <I18nProvider>");
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
