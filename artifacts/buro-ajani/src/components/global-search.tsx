import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Search, Phone, Users, CheckSquare, MessageSquare, X, Loader2, TrendingUp, FileText, Receipt, Package, ShoppingCart } from "lucide-react";
import { Input } from "@/components/ui/input";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

const ICON_MAP: Record<string, any> = {
  contacts: Users,
  calls: Phone,
  tasks: CheckSquare,
  messages: MessageSquare,
  prospects: TrendingUp,
  devis: FileText,
  factures: Receipt,
  stock: Package,
  commandes: ShoppingCart,
};

const LABEL_MAP: Record<string, string> = {
  contacts: "Contacts",
  calls: "Appels",
  tasks: "Taches",
  messages: "Messages",
  prospects: "Prospects",
  devis: "Devis",
  factures: "Factures",
  stock: "Stock",
  commandes: "Bons de Commande",
};

const COLOR_MAP: Record<string, string> = {
  contacts: "text-blue-500",
  calls: "text-green-500",
  tasks: "text-amber-500",
  messages: "text-purple-500",
  prospects: "text-orange-500",
  devis: "text-sky-500",
  factures: "text-emerald-500",
  stock: "text-slate-500",
  commandes: "text-violet-500",
};

const ALL_TYPES = ["contacts", "calls", "tasks", "messages", "prospects", "devis", "factures", "stock", "commandes"] as const;

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<any>(null);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults(null); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=5`, { credentials: "include", signal: controller.signal });
        if (!res.ok) { setLoading(false); return; }
        const data = await res.json();
        setResults(data);
        setOpen(true);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      } finally { setLoading(false); }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); if (abortRef.current) abortRef.current.abort(); };
  }, [query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(type: string, item: any) {
    setOpen(false);
    setQuery("");
    switch (type) {
      case "contacts": setLocation(`/contacts/${item.id}`); break;
      case "calls": setLocation(`/appels/${item.id}`); break;
      case "tasks": setLocation("/taches"); break;
      case "messages": setLocation("/messages"); break;
      case "prospects": setLocation("/prospects"); break;
      case "devis": setLocation("/devis"); break;
      case "factures": setLocation("/factures-client"); break;
      case "stock": setLocation("/stock"); break;
      case "commandes": setLocation("/commandes-fournisseur"); break;
    }
  }

  function getItemTitle(type: string, item: any): string {
    switch (type) {
      case "contacts": return `${item.firstName || ""} ${item.lastName || ""}`.trim() || item.email;
      case "calls": return item.contactName || item.phoneNumber;
      case "tasks": return item.title;
      case "messages": return item.contactName || item.content?.substring(0, 40);
      case "prospects": return item.title || item.contactName || item.company || item.email || "";
      case "devis": return item.reference || `Devis #${item.id}`;
      case "factures": return item.reference || `Facture #${item.id}`;
      case "stock": return item.name || item.sku || "";
      case "commandes": return item.reference || `BC #${item.id}`;
      default: return "";
    }
  }

  function getItemSub(type: string, item: any): string {
    switch (type) {
      case "contacts": return item.company || item.email || "";
      case "calls": return `${item.direction === "entrant" ? "Entrant" : "Sortant"} - ${item.status}`;
      case "tasks": return `${item.status} - ${item.priority}`;
      case "messages": return item.type || "";
      case "prospects": return item.stage ? `${item.stage}${item.value ? ` · ${item.value} €` : ""}` : item.email || "";
      case "devis": return `${item.clientName || ""} · ${item.status}${item.totalAmount ? ` · ${Number(item.totalAmount).toFixed(2)} €` : ""}`;
      case "factures": return `${item.clientName || ""} · ${item.status}${item.totalAmount ? ` · ${Number(item.totalAmount).toFixed(2)} €` : ""}`;
      case "stock": return `${item.category || ""}${item.quantity !== undefined ? ` · Qté: ${item.quantity}` : ""}`;
      case "commandes": return `${item.fournisseurName || ""} · ${item.status}${item.totalAmount ? ` · ${Number(item.totalAmount).toFixed(2)} €` : ""}`;
      default: return "";
    }
  }

  const hasResults = results && results.totalResults > 0;

  return (
    <div ref={containerRef} className="relative w-64 hidden md:block">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Rechercher partout..."
        className="w-full bg-muted/50 border-none pl-9 h-9 pr-8"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results && setOpen(true)}
        data-global-search="true"
      />
      {loading && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground animate-spin" />}
      {query && !loading && (
        <button onClick={() => { setQuery(""); setResults(null); }} className="absolute right-2.5 top-2.5">
          <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </button>
      )}

      {open && results && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg z-50 max-h-[480px] overflow-auto">
          {!hasResults ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Aucun resultat pour "{query}"</div>
          ) : (
            <>
              {ALL_TYPES.map(type => {
                const items = results[type];
                if (!items || items.length === 0) return null;
                const Icon = ICON_MAP[type];
                return (
                  <div key={type}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50 flex items-center gap-1.5">
                      <Icon className={`w-3 h-3 ${COLOR_MAP[type]}`} />
                      {LABEL_MAP[type]} ({items.length})
                    </div>
                    {items.map((item: any) => (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(type, item)}
                        className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors flex items-center gap-2.5"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{getItemTitle(type, item)}</div>
                          <div className="text-xs text-muted-foreground truncate">{getItemSub(type, item)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
              <div className="px-3 py-2 text-center text-xs text-muted-foreground border-t">
                {results.totalResults} resultat(s) trouve(s)
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
