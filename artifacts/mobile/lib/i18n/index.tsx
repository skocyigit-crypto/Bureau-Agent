import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import fr from "./locales/fr.json";
import tr from "./locales/tr.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import de from "./locales/de.json";
import ar from "./locales/ar.json";

/**
 * i18n leger et SANS dependance externe pour l'app mobile (Expo/React Native),
 * calque sur celui du web (memes conventions: useTranslation() -> { t, i18n },
 * t("cle", { var }) avec interpolation {{var}} et repli sur le francais).
 *
 * Differences RN par rapport au web:
 * - persistance via AsyncStorage (asynchrone): la langue enregistree est
 *   chargee au montage; avant, on affiche fr (pas de flash notable car le repli
 *   est le francais, langue source).
 * - RTL (arabe): on met a jour I18nManager. Le miroir complet de la mise en page
 *   RN exige un redemarrage de l'app; on expose `dir` pour l'alignement du texte
 *   et on prepare I18nManager, sans forcer un reload perturbant.
 */

export type LangCode = "fr" | "tr" | "en" | "es" | "de" | "ar";

export const DEFAULT_LANG: LangCode = "fr";
const STORAGE_KEY = "app.lang";

const RESOURCES: Record<LangCode, Record<string, unknown>> = { fr, tr, en, es, de, ar };

export const LANGUAGES: { code: LangCode; label: string; dir: "ltr" | "rtl" }[] = [
  { code: "fr", label: "Francais", dir: "ltr" },
  { code: "tr", label: "Turkce", dir: "ltr" },
  { code: "en", label: "English", dir: "ltr" },
  { code: "es", label: "Espanol", dir: "ltr" },
  { code: "de", label: "Deutsch", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
];

const LANG_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

function isLangCode(v: unknown): v is LangCode {
  return typeof v === "string" && LANG_BY_CODE.has(v as LangCode);
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

const I18nContext = createContext<I18nContextValue>({
  lang: DEFAULT_LANG,
  dir: "ltr",
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(DEFAULT_LANG);

  // Charger la langue enregistree au montage (AsyncStorage est asynchrone).
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => { if (isLangCode(saved)) setLangState(saved); })
      .catch(() => { /* stockage indisponible: on reste sur fr */ });
  }, []);

  const dir = LANG_BY_CODE.get(lang)?.dir ?? "ltr";

  // Refleter le sens sur I18nManager (RTL arabe). Le miroir complet de la mise
  // en page exige un redemarrage; on autorise le RTL sans forcer de reload.
  useEffect(() => {
    try {
      I18nManager.allowRTL(dir === "rtl");
    } catch { /* no-op */ }
  }, [dir]);

  const setLang = useCallback((code: LangCode) => {
    setLangState(code);
    AsyncStorage.setItem(STORAGE_KEY, code).catch(() => { /* ignore */ });
  }, []);

  const t = useCallback<TFunction>((key, vars) => {
    const active = RESOURCES[lang];
    const found = lookup(active, key) ?? lookup(RESOURCES[DEFAULT_LANG], key);
    return interpolate(found ?? key, vars);
  }, [lang]);

  const value = useMemo<I18nContextValue>(() => ({ lang, dir, setLang, t }), [lang, dir, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Surface compatible web/react-i18next: `const { t, i18n } = useTranslation();` */
export function useTranslation() {
  const ctx = useContext(I18nContext);
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
