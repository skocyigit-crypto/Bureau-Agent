import { useState } from "react";
import {
  Phone, Users, CheckSquare, MessageSquare, BarChart3, Brain, X, Maximize2,
  Minimize2, Wifi, Battery, Signal, ChevronLeft, Home, LayoutDashboard,
  PhoneCall, Clock, Bell, TrendingUp, AlertCircle, CheckCircle2, Star, Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type MobileScreen = "accueil" | "appels" | "contacts" | "taches" | "messages" | "agents-ia" | "stats";

const NAV_ITEMS = [
  { id: "accueil" as MobileScreen, icon: Home, label: "Accueil" },
  { id: "appels" as MobileScreen, icon: Phone, label: "Appels" },
  { id: "contacts" as MobileScreen, icon: Users, label: "Contacts" },
  { id: "taches" as MobileScreen, icon: CheckSquare, label: "Taches" },
  { id: "messages" as MobileScreen, icon: MessageSquare, label: "Messages" },
];

function MobileStatusBar() {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, "0");
  const m = now.getMinutes().toString().padStart(2, "0");

  return (
    <div className="flex items-center justify-between px-5 py-1.5 text-white text-[9px] font-medium bg-[#1a2744]">
      <span>{h}:{m}</span>
      <div className="absolute left-1/2 -translate-x-1/2 w-20 h-5 bg-black rounded-b-xl" />
      <div className="flex items-center gap-1.5">
        <Signal className="w-2.5 h-2.5" />
        <Wifi className="w-2.5 h-2.5" />
        <Battery className="w-3 h-2.5" />
      </div>
    </div>
  );
}

function MobileHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="bg-[#1a2744] text-white px-4 py-2.5 flex items-center gap-2">
      {onBack && (
        <button onClick={onBack} className="p-0.5">
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}
      <span className="text-xs font-semibold flex-1">{title}</span>
      <Bell className="w-3.5 h-3.5 opacity-70" />
    </div>
  );
}

function ScreenAccueil({ onNavigate }: { onNavigate: (s: MobileScreen) => void }) {
  return (
    <div className="p-3 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center">
          <span className="text-[9px] font-bold text-amber-700">AB</span>
        </div>
        <div>
          <p className="text-[10px] font-semibold">Bonjour, Aurelie</p>
          <p className="text-[8px] text-muted-foreground">Paris HQ - Super Administrateur</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-2.5">
          <Phone className="w-3.5 h-3.5 text-blue-600 mb-1" />
          <p className="text-sm font-bold text-blue-900 dark:text-blue-200">44</p>
          <p className="text-[8px] text-blue-600">Appels aujourd'hui</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-2.5">
          <CheckSquare className="w-3.5 h-3.5 text-emerald-600 mb-1" />
          <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">12</p>
          <p className="text-[8px] text-emerald-600">Taches en cours</p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-2.5">
          <MessageSquare className="w-3.5 h-3.5 text-purple-600 mb-1" />
          <p className="text-sm font-bold text-purple-900 dark:text-purple-200">8</p>
          <p className="text-[8px] text-purple-600">Messages non lus</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5">
          <Users className="w-3.5 h-3.5 text-amber-600 mb-1" />
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">156</p>
          <p className="text-[8px] text-amber-600">Contacts</p>
        </div>
      </div>

      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/10 rounded-lg p-2.5 border border-purple-100 dark:border-purple-900/30">
        <div className="flex items-center gap-1.5 mb-1">
          <Brain className="w-3 h-3 text-purple-600" />
          <span className="text-[9px] font-semibold text-purple-700">Intelligence IA</span>
        </div>
        <p className="text-[8px] text-purple-600">Score global: 82/100</p>
        <p className="text-[8px] text-muted-foreground mt-0.5">3 alertes detectees, 5 suggestions</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] font-semibold">Activite recente</p>
        {[
          { icon: PhoneCall, text: "Appel entrant - Marie Dupont", time: "il y a 5 min", color: "text-blue-600" },
          { icon: CheckCircle2, text: "Tache terminee - Rapport Q2", time: "il y a 15 min", color: "text-emerald-600" },
          { icon: AlertCircle, text: "Message urgent de J. Martin", time: "il y a 30 min", color: "text-amber-600" },
          { icon: Star, text: "Nouveau contact VIP ajoute", time: "il y a 1h", color: "text-purple-600" },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2 p-1.5 rounded-md bg-muted/30">
            <item.icon className={`w-3 h-3 ${item.color} shrink-0`} />
            <div className="flex-1 min-w-0">
              <p className="text-[8px] font-medium truncate">{item.text}</p>
              <p className="text-[7px] text-muted-foreground">{item.time}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: "Taux reponse", value: "94%", color: "text-emerald-600" },
          { label: "Duree moy.", value: "4:32", color: "text-blue-600" },
          { label: "Satisfaction", value: "4.8", color: "text-amber-600" },
        ].map((stat, i) => (
          <div key={i} className="text-center p-1.5 bg-muted/30 rounded-md">
            <p className={`text-xs font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-[7px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenAppels({ onNavigate }: { onNavigate: (s: MobileScreen) => void }) {
  const appels = [
    { nom: "Marie Dupont", heure: "14:32", statut: "repondu", duree: "5:42", direction: "entrant" },
    { nom: "Jean-Luc Martin", heure: "13:15", statut: "manque", duree: "-", direction: "entrant" },
    { nom: "Sophie Bernard", heure: "11:48", statut: "repondu", duree: "12:08", direction: "sortant" },
    { nom: "Pierre Leroy", heure: "10:22", statut: "repondu", duree: "3:15", direction: "entrant" },
    { nom: "Camille Roux", heure: "09:05", statut: "messagerie", duree: "0:45", direction: "entrant" },
    { nom: "Luc Petit", heure: "Hier", statut: "repondu", duree: "8:30", direction: "sortant" },
  ];

  return (
    <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <div className="w-full h-7 rounded-md bg-muted/50 pl-6 flex items-center text-[9px] text-muted-foreground">
            Rechercher un appel...
          </div>
        </div>
      </div>
      {appels.map((a, i) => (
        <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
          <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
            <span className="text-[8px] font-bold text-blue-700">{a.nom.split(' ').map(n => n[0]).join('')}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-semibold truncate">{a.nom}</p>
              <span className="text-[7px] text-muted-foreground">{a.heure}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge variant={a.statut === "repondu" ? "secondary" : a.statut === "manque" ? "destructive" : "outline"} className="text-[6px] h-3 px-1">
                {a.statut}
              </Badge>
              <span className="text-[7px] text-muted-foreground">{a.direction}</span>
              {a.duree !== "-" && <span className="text-[7px] text-muted-foreground">{a.duree}</span>}
            </div>
          </div>
          <Phone className="w-3 h-3 text-emerald-600 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function ScreenContacts() {
  const contacts = [
    { nom: "Marie Dupont", societe: "Renault SA", cat: "client" },
    { nom: "Jean-Luc Martin", societe: "BNP Paribas", cat: "prospect" },
    { nom: "Sophie Bernard", societe: "LVMH", cat: "client" },
    { nom: "Pierre Leroy", societe: "Air France", cat: "fournisseur" },
    { nom: "Camille Roux", societe: "Orange", cat: "partenaire" },
    { nom: "Luc Petit", societe: "Carrefour", cat: "client" },
  ];

  return (
    <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <div className="w-full h-7 rounded-md bg-muted/50 pl-6 flex items-center text-[9px] text-muted-foreground">
            Rechercher un contact...
          </div>
        </div>
      </div>
      {contacts.map((c, i) => {
        const catColor = c.cat === "client" ? "bg-blue-100 text-blue-700" : c.cat === "prospect" ? "bg-amber-100 text-amber-700" : c.cat === "fournisseur" ? "bg-purple-100 text-purple-700" : "bg-emerald-100 text-emerald-700";
        return (
          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center shrink-0">
              <span className="text-[8px] font-bold text-white">{c.nom.split(' ').map(n => n[0]).join('')}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-semibold truncate">{c.nom}</p>
              <p className="text-[7px] text-muted-foreground">{c.societe}</p>
            </div>
            <Badge className={`text-[6px] h-3 px-1 border-0 ${catColor}`}>{c.cat}</Badge>
          </div>
        );
      })}
    </div>
  );
}

function ScreenTaches() {
  const taches = [
    { titre: "Rappeler M. Dupont", priorite: "haute", statut: "en_cours", echeance: "Aujourd'hui" },
    { titre: "Rapport mensuel Q2", priorite: "haute", statut: "en_attente", echeance: "Demain" },
    { titre: "Mise a jour CRM", priorite: "moyenne", statut: "en_cours", echeance: "Ven." },
    { titre: "Reunion equipe ventes", priorite: "basse", statut: "en_attente", echeance: "Lun." },
    { titre: "Formation nouveaux", priorite: "moyenne", statut: "termine", echeance: "Termine" },
  ];

  return (
    <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold">Mes taches</p>
        <Badge variant="outline" className="text-[7px] h-4">5 taches</Badge>
      </div>
      {taches.map((t, i) => {
        const prioColor = t.priorite === "haute" ? "bg-red-500" : t.priorite === "moyenne" ? "bg-amber-500" : "bg-blue-500";
        const statutColor = t.statut === "termine" ? "text-emerald-600" : t.statut === "en_cours" ? "text-blue-600" : "text-amber-600";
        return (
          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
            <div className={`w-1.5 h-1.5 rounded-full ${prioColor} mt-1 shrink-0`} />
            <div className="flex-1 min-w-0">
              <p className={`text-[9px] font-semibold ${t.statut === "termine" ? "line-through text-muted-foreground" : ""}`}>{t.titre}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-[7px] font-medium ${statutColor}`}>{t.statut.replace("_", " ")}</span>
                <span className="text-[7px] text-muted-foreground">{t.echeance}</span>
              </div>
            </div>
            {t.statut === "termine" && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

function ScreenMessages() {
  const messages = [
    { de: "J. Martin", objet: "Reunion demain 10h", type: "Note", lu: false, priorite: true },
    { de: "S. Bernard", objet: "Documents contrat signe", type: "Vocal", lu: false, priorite: false },
    { de: "P. Leroy", objet: "Devis materiel bureau", type: "Rappel", lu: true, priorite: false },
    { de: "C. Roux", objet: "Confirmation partenariat", type: "Note", lu: true, priorite: false },
    { de: "L. Petit", objet: "Facture en attente", type: "Rappel", lu: true, priorite: true },
  ];

  return (
    <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold">Messages</p>
        <Badge variant="secondary" className="text-[7px] h-4">2 non lus</Badge>
      </div>
      {messages.map((m, i) => (
        <div key={i} className={cn("flex items-center gap-2 p-2 rounded-lg border border-border/30", !m.lu ? "bg-blue-50/50 dark:bg-blue-950/10 font-semibold" : "bg-muted/20")}>
          <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", !m.lu ? "bg-blue-100" : "bg-muted")}>
            <MessageSquare className={cn("w-3 h-3", !m.lu ? "text-blue-600" : "text-muted-foreground")} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className={cn("text-[9px] truncate", !m.lu && "font-bold")}>{m.de}</p>
              <Badge variant="outline" className="text-[6px] h-3 px-1">{m.type}</Badge>
            </div>
            <p className="text-[8px] text-muted-foreground truncate">{m.objet}</p>
          </div>
          {m.priorite && <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

function ScreenAgentsIA() {
  const agents = [
    { nom: "Appels", score: 87, icon: Phone, couleur: "text-blue-600" },
    { nom: "Contacts", score: 92, icon: Users, couleur: "text-emerald-600" },
    { nom: "Taches", score: 74, icon: CheckSquare, couleur: "text-amber-600" },
    { nom: "Messages", score: 81, icon: MessageSquare, couleur: "text-purple-600" },
    { nom: "Securite", score: 95, icon: Brain, couleur: "text-red-600" },
  ];

  return (
    <div className="p-3 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/10 rounded-lg p-3 border border-purple-100 dark:border-purple-900/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] font-semibold text-purple-700">Super Agent IA</p>
            <p className="text-[7px] text-purple-600/70">Synthese globale</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-purple-700">82</p>
            <p className="text-[7px] text-purple-500">/ 100</p>
          </div>
        </div>
        <div className="mt-2 h-1 bg-purple-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full" style={{ width: "82%" }} />
        </div>
      </div>

      <p className="text-[9px] font-semibold">Agents specialises</p>
      {agents.map((a, i) => (
        <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <a.icon className={`w-3.5 h-3.5 ${a.couleur}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-semibold">Agent {a.nom}</p>
              <span className={`text-[10px] font-bold ${a.score >= 80 ? "text-emerald-600" : a.score >= 60 ? "text-amber-600" : "text-red-600"}`}>{a.score}</span>
            </div>
            <div className="mt-0.5 h-1 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${a.score >= 80 ? "bg-emerald-500" : a.score >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${a.score}%` }} />
            </div>
          </div>
        </div>
      ))}

      <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50">
        <p className="text-[8px] font-medium text-amber-700">3 alertes actives</p>
        <p className="text-[7px] text-amber-600">2 erreurs de pointage, 1 tache en retard critique</p>
      </div>
    </div>
  );
}

interface PhoneSimulatorProps {
  className?: string;
  defaultScreen?: MobileScreen;
  expanded?: boolean;
  onClose?: () => void;
}

export function PhoneSimulator({ className, defaultScreen = "accueil", expanded = false, onClose }: PhoneSimulatorProps) {
  const [currentScreen, setCurrentScreen] = useState<MobileScreen>(defaultScreen);
  const [isExpanded, setIsExpanded] = useState(expanded);

  const screenTitles: Record<MobileScreen, string> = {
    accueil: "Agent de Bureau",
    appels: "Appels",
    contacts: "Contacts",
    taches: "Taches",
    messages: "Messages",
    "agents-ia": "Agents IA",
    stats: "Statistiques",
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case "accueil": return <ScreenAccueil onNavigate={setCurrentScreen} />;
      case "appels": return <ScreenAppels onNavigate={setCurrentScreen} />;
      case "contacts": return <ScreenContacts />;
      case "taches": return <ScreenTaches />;
      case "messages": return <ScreenMessages />;
      case "agents-ia": return <ScreenAgentsIA />;
      default: return <ScreenAccueil onNavigate={setCurrentScreen} />;
    }
  };

  const phoneWidth = isExpanded ? 320 : 260;
  const phoneHeight = isExpanded ? 640 : 520;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div
        className="relative bg-[#1a1a1a] rounded-[2.5rem] shadow-2xl border-4 border-[#2a2a2a] overflow-hidden transition-all duration-300"
        style={{ width: phoneWidth, height: phoneHeight }}
      >
        <div className="absolute inset-0 rounded-[2rem] overflow-hidden bg-background flex flex-col m-1">
          <MobileStatusBar />
          <MobileHeader
            title={screenTitles[currentScreen]}
            onBack={currentScreen !== "accueil" ? () => setCurrentScreen("accueil") : undefined}
          />

          <div className="flex-1 overflow-hidden bg-background">
            {renderScreen()}
          </div>

          <div className="bg-background border-t border-border/50 px-1 py-1.5 flex items-center justify-around">
            {NAV_ITEMS.map((item) => {
              const isActive = item.id === currentScreen;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentScreen(item.id)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 p-1 rounded-lg transition-colors min-w-0",
                    isActive ? "text-amber-600" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon className="w-3.5 h-3.5" />
                  <span className="text-[7px] font-medium">{item.label}</span>
                </button>
              );
            })}
            <button
              onClick={() => setCurrentScreen("agents-ia")}
              className={cn(
                "flex flex-col items-center gap-0.5 p-1 rounded-lg transition-colors min-w-0",
                currentScreen === "agents-ia" ? "text-purple-600" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Brain className="w-3.5 h-3.5" />
              <span className="text-[7px] font-medium">IA</span>
            </button>
          </div>
        </div>

        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-24 h-1 bg-white/20 rounded-full" />
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] gap-1"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          {isExpanded ? "Reduire" : "Agrandir"}
        </Button>
        {onClose && (
          <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1" onClick={onClose}>
            <X className="w-3 h-3" /> Fermer
          </Button>
        )}
      </div>
    </div>
  );
}

export function PhoneSimulatorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={() => onOpenChange(false)}>
      <div onClick={(e) => e.stopPropagation()} className="animate-in zoom-in-95 fade-in duration-200">
        <PhoneSimulator expanded onClose={() => onOpenChange(false)} />
      </div>
    </div>
  );
}
