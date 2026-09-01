import { Button } from "@/components/ui/button";
import { Tooltip,TooltipContent,TooltipTrigger } from "@/components/ui/tooltip";
import { Moon,Sun } from "lucide-react";
import { useEffect,useState } from "react";
import { useTranslation } from "@/i18n";

export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("adb-theme") as "light" | "dark") || "light";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("adb-theme", theme);
  }, [theme]);

  // Le bouton porte un `aria-label`: le tooltip ne suffit pas. Radix le pose
  // en `aria-describedby`, soit une DESCRIPTION, alors que le critere WCAG
  // 4.1.2 exige un NOM — sans lui, un lecteur d'ecran annonce « bouton » et
  // rien d'autre. Le parametre du `setTheme` s'appelle `prev` et non `t`,
  // qui designe maintenant la fonction de traduction.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(prev => prev === "light" ? "dark" : "light")}
          className="text-muted-foreground hover:text-foreground"
          aria-label={t("common.toggleTheme")}
        >
          {theme === "light"
            ? <Moon className="w-5 h-5" aria-hidden="true" />
            : <Sun className="w-5 h-5" aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{theme === "light" ? "Mode sombre" : "Mode clair"}</TooltipContent>
    </Tooltip>
  );
}
