import { Dialog,DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";
import { BarChart,BarChart3,Brain,Calendar,CheckSquare,Clock,FileText,FolderKanban,KeyRound,LayoutDashboard,MessageSquare,Phone,Search,Settings,Shield,UserCog,Users,Zap } from "lucide-react";
import { useCallback,useEffect,useState } from "react";
import { useLocation } from "wouter";

type CommandItem = {
  id: string;
  icon: any;
  action: () => void;
  category: string;
  keywords?: string[];
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
        setSearch("");
        setSelectedIndex(0);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // `category` = slug stable; libelle rendu via t(`commandPalette.category.${category}`).
  const commands: CommandItem[] = [
    { id: "dashboard", icon: LayoutDashboard, action: () => navigate("/"), category: "navigation", keywords: ["accueil", "home"] },
    { id: "calls", icon: Phone, action: () => navigate("/appels"), category: "navigation", keywords: ["telephone", "phone"] },
    { id: "contacts", icon: Users, action: () => navigate("/contacts"), category: "navigation", keywords: ["client", "carnet"] },
    { id: "tasks", icon: CheckSquare, action: () => navigate("/taches"), category: "navigation", keywords: ["todo", "travail"] },
    { id: "messages", icon: MessageSquare, action: () => navigate("/messages"), category: "navigation", keywords: ["sms", "chat"] },
    { id: "calendar", icon: Calendar, action: () => navigate("/calendrier"), category: "navigation", keywords: ["agenda", "rdv"] },
    { id: "reports", icon: FileText, action: () => navigate("/rapports"), category: "navigation" },
    { id: "analytics", icon: BarChart, action: () => navigate("/analyse"), category: "navigation" },
    { id: "performance", icon: BarChart3, action: () => navigate("/performance"), category: "navigation" },
    { id: "checkins", icon: Clock, action: () => navigate("/pointage"), category: "navigation" },
    { id: "ai", icon: Brain, action: () => navigate("/agents-ia"), category: "navigation" },
    { id: "automations", icon: Zap, action: () => navigate("/automatisations"), category: "administration" },
    { id: "users", icon: UserCog, action: () => navigate("/utilisateurs"), category: "administration" },
    { id: "audit", icon: Shield, action: () => navigate("/gestion-licence"), category: "administration", keywords: ["audit", "log", "journal"] },
    { id: "organisations", icon: KeyRound, action: () => navigate("/organisations"), category: "administration" },
    { id: "abonnement", icon: KeyRound, action: () => navigate("/gestion-licence"), category: "navigation", keywords: ["licence", "plan", "subscription", "abonnement", "facturation"] },
    { id: "settings", icon: Settings, action: () => navigate("/parametres"), category: "administration" },
    { id: "notifications", icon: MessageSquare, action: () => navigate("/notifications"), category: "navigation" },
    { id: "projets", icon: FolderKanban, action: () => navigate("/projets"), category: "navigation", keywords: ["chantier", "project", "kanban"] },
    { id: "google-workspace", icon: Search, action: () => navigate("/google-workspace"), category: "navigation", keywords: ["gmail", "drive", "docs", "sheets", "calendar", "google"] },
  ];

  const filtered = commands.filter(cmd => {
    if (!search) return true;
    const s = search.toLowerCase();
    return t(`commandPalette.cmd.${cmd.id}`).toLowerCase().includes(s) || t(`commandPalette.category.${cmd.category}`).toLowerCase().includes(s) || cmd.keywords?.some(k => k.includes(s));
  });

  useEffect(() => { setSelectedIndex(0); }, [search]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && filtered[selectedIndex]) { filtered[selectedIndex].action(); setOpen(false); }
    else if (e.key === "Escape") { setOpen(false); }
  }, [filtered, selectedIndex]);

  const categories = [...new Set(filtered.map(c => c.category))];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 max-w-lg overflow-hidden" onKeyDown={handleKeyDown}>
        <div className="border-b p-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input aria-label={t("commandPalette.searchPlaceholder")} className="border-0 shadow-none focus-visible:ring-0 p-0 h-8" placeholder={t("commandPalette.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} autoFocus />
            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
          </div>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-2">
          {categories.map(cat => (
            <div key={cat}>
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t(`commandPalette.category.${cat}`)}</div>
              {filtered.filter(c => c.category === cat).map((cmd) => {
                const globalIdx = filtered.indexOf(cmd);
                const Icon = cmd.icon;
                return (
                  <button key={cmd.id} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${globalIdx === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
                    onClick={() => { cmd.action(); setOpen(false); }} onMouseEnter={() => setSelectedIndex(globalIdx)}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{t(`commandPalette.cmd.${cmd.id}`)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-6 text-sm text-muted-foreground">{t("commandPalette.noResults")}</div>}
        </div>
        <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center gap-4">
          <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1">↑↓</kbd> {t("commandPalette.navigate")}</span>
          <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1">↵</kbd> {t("commandPalette.openHint")}</span>
          <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1">esc</kbd> {t("commandPalette.closeHint")}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
