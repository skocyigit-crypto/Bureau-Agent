import { Button } from "@/components/ui/button";
import {
DropdownMenu,
DropdownMenuContent,
DropdownMenuItem,
DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LANGUAGES,useTranslation,type LangCode } from "@/i18n";
import { Check,Globe } from "lucide-react";

/**
 * Selecteur de langue global de l'application (distinct de celui du Guide, qui
 * ne couvre que les langues du manuel). Change la langue de l'interface via le
 * contexte i18n; la mise a jour de <html lang/dir> (RTL arabe compris) est geree
 * par I18nProvider. Le choix est persiste (localStorage) par le provider.
 *
 * `variant` compact = icone seule (barres denses); sinon libelle visible.
 */
export function LanguageSwitcher({ variant = "full" }: { variant?: "full" | "compact" }) {
  const { lang, i18n, t } = useTranslation();
  const current = LANGUAGES.find((l) => l.code === lang);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={variant === "compact" ? "icon" : "sm"}
          className="gap-2"
          aria-label={t("common.language")}
        >
          <Globe className="h-4 w-4" />
          {variant === "full" && <span className="text-sm">{current?.label ?? lang.toUpperCase()}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {LANGUAGES.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => i18n.changeLanguage(l.code as LangCode)}
            className="flex items-center justify-between gap-3"
            dir={l.dir}
          >
            <span>{l.label}</span>
            {l.code === lang && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
