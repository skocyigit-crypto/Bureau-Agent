import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Phone, Users, CheckSquare, MessageSquare, BarChart, LayoutDashboard, Settings, FileText, Package, Calendar, Shield, Zap, BarChart3, Brain, Clock, Target, FileSignature, Receipt, FolderKanban, Search, UserCog, KeyRound } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type CommandItem = {
  id: string;
  label: string;
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

  const commands: CommandItem[] = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard, action: () => navigate("/"), category: "Navigation", keywords: ["accueil", "home"] },
    { id: "calls", label: "Appels", icon: Phone, action: () => navigate("/appels"), category: "Navigation", keywords: ["telephone", "phone"] },
    { id: "contacts", label: "Contacts", icon: Users, action: () => navigate("/contacts"), category: "Navigation", keywords: ["client", "carnet"] },
    { id: "tasks", label: "Taches", icon: CheckSquare, action: () => navigate("/taches"), category: "Navigation", keywords: ["todo", "travail"] },
    { id: "messages", label: "Messages", icon: MessageSquare, action: () => navigate("/messages"), category: "Navigation", keywords: ["sms", "chat"] },
    { id: "prospects", label: "Pipeline Commercial", icon: Target, action: () => navigate("/prospects"), category: "Navigation", keywords: ["crm", "vente", "lead"] },
    { id: "devis", label: "Devis", icon: FileSignature, action: () => navigate("/devis"), category: "Navigation", keywords: ["quote", "estimation"] },
    { id: "factures", label: "Factures", icon: Receipt, action: () => navigate("/factures"), category: "Navigation", keywords: ["invoice", "paiement"] },
    { id: "projets", label: "Projets", icon: FolderKanban, action: () => navigate("/projets"), category: "Navigation", keywords: ["project", "chantier"] },
    { id: "calendar", label: "Calendrier", icon: Calendar, action: () => navigate("/calendrier"), category: "Navigation", keywords: ["agenda", "rdv"] },
    { id: "stock", label: "Stock", icon: Package, action: () => navigate("/stock"), category: "Navigation", keywords: ["inventaire", "materiel"] },
    { id: "reports", label: "Rapports", icon: FileText, action: () => navigate("/rapports"), category: "Navigation" },
    { id: "analytics", label: "Analyse", icon: BarChart, action: () => navigate("/analyse"), category: "Navigation" },
    { id: "performance", label: "Performance", icon: BarChart3, action: () => navigate("/performance"), category: "Navigation" },
    { id: "checkins", label: "Pointage", icon: Clock, action: () => navigate("/pointage"), category: "Navigation" },
    { id: "ai", label: "Agents IA", icon: Brain, action: () => navigate("/agents-ia"), category: "Navigation" },
    { id: "automations", label: "Automatisations", icon: Zap, action: () => navigate("/automatisations"), category: "Administration" },
    { id: "users", label: "Utilisateurs", icon: UserCog, action: () => navigate("/utilisateurs"), category: "Administration" },
    { id: "audit", label: "Journal d'audit", icon: Shield, action: () => navigate("/audit"), category: "Administration" },
    { id: "organisations", label: "Licences", icon: KeyRound, action: () => navigate("/organisations"), category: "Administration" },
    { id: "abonnement", label: "Mon Abonnement", icon: KeyRound, action: () => navigate("/abonnement"), category: "Navigation", keywords: ["licence", "plan", "subscription"] },
    { id: "settings", label: "Parametres", icon: Settings, action: () => navigate("/parametres"), category: "Administration" },
    { id: "notifications", label: "Notifications", icon: MessageSquare, action: () => navigate("/notifications"), category: "Navigation" },
    { id: "google-workspace", label: "Google Workspace", icon: Search, action: () => navigate("/google-workspace"), category: "Navigation", keywords: ["gmail", "drive", "docs", "sheets", "calendar", "google"] },
  ];

  const filtered = commands.filter(cmd => {
    if (!search) return true;
    const s = search.toLowerCase();
    return cmd.label.toLowerCase().includes(s) || cmd.category.toLowerCase().includes(s) || cmd.keywords?.some(k => k.includes(s));
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
            <Input className="border-0 shadow-none focus-visible:ring-0 p-0 h-8" placeholder="Rechercher une commande..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
          </div>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-2">
          {categories.map(cat => (
            <div key={cat}>
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{cat}</div>
              {filtered.filter(c => c.category === cat).map((cmd, idx) => {
                const globalIdx = filtered.indexOf(cmd);
                const Icon = cmd.icon;
                return (
                  <button key={cmd.id} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${globalIdx === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
                    onClick={() => { cmd.action(); setOpen(false); }} onMouseEnter={() => setSelectedIndex(globalIdx)}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{cmd.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center py-6 text-sm text-muted-foreground">Aucun resultat</div>}
        </div>
        <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center gap-4">
          <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1">↑↓</kbd> naviguer</span>
          <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1">↵</kbd> ouvrir</span>
          <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1">esc</kbd> fermer</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
