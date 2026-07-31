import { Button } from "@/components/ui/button";
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuSeparator,DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip,TooltipContent,TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { Download,FileSpreadsheet,Loader2 } from "lucide-react";
import { useState } from "react";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

// Les libelles lisibles vivent dans i18n (exportMenu.entities.<key>).
const ENTITIES = [
  { key: "contacts", icon: "👥" },
  { key: "appels", icon: "📞" },
  { key: "taches", icon: "✅" },
  { key: "messages", icon: "💬" },
];

export function ExportMenu() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [exporting, setExporting] = useState<string | null>(null);

  async function handleExport(entity: string) {
    setExporting(entity);
    try {
      const res = await fetch(`${baseUrl}/api/export/${entity}`, { credentials: "include" });
      if (!res.ok) throw new Error("Export echoue");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] || `${entity}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: t("exportMenu.errorTitle"), description: t("exportMenu.errorDesc"), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              {exporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("exportMenu.exportData")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" /> {t("exportMenu.csvLabel")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ENTITIES.map(e => (
          <DropdownMenuItem
            key={e.key}
            onClick={() => handleExport(e.key)}
            disabled={exporting === e.key}
            className="cursor-pointer"
          >
            <span className="mr-2">{e.icon}</span> {t(`exportMenu.entities.${e.key}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
