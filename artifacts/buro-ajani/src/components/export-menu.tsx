import { useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

const ENTITIES = [
  { key: "contacts", label: "Contacts", icon: "👥" },
  { key: "appels", label: "Appels", icon: "📞" },
  { key: "taches", label: "Taches", icon: "✅" },
  { key: "messages", label: "Messages", icon: "💬" },
];

export function ExportMenu() {
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
      toast({ title: "Erreur d'export", description: "Impossible d'exporter les donnees.", variant: "destructive" });
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
        <TooltipContent>Exporter les donnees</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" /> Export CSV
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ENTITIES.map(e => (
          <DropdownMenuItem
            key={e.key}
            onClick={() => handleExport(e.key)}
            disabled={exporting === e.key}
            className="cursor-pointer"
          >
            <span className="mr-2">{e.icon}</span> {e.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
