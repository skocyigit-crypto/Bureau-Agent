import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogTitle } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import {
AlertCircle,
Battery,
Bell,
Brain,
CheckCircle2,
CheckSquare,
ChevronLeft,
Clock,
Home,
Maximize2,
MessageSquare,
Minimize2,
Phone,
PhoneCall,
Plug,
Search,
ShieldCheck,
Signal,
Users,
Wifi,
X
} from "lucide-react";
import { useState } from "react";

type MobileScreen = "accueil" | "appels" | "contacts" | "taches" | "messages" | "agents-ia" | "stats";

// `labelKey` est une cle i18n stable; le libelle est resolu via t() au rendu.
const NAV_ITEMS = [
  { id: "accueil" as MobileScreen, icon: Home, labelKey: "accueil" },
  { id: "appels" as MobileScreen, icon: Phone, labelKey: "appels" },
  { id: "contacts" as MobileScreen, icon: Users, labelKey: "contacts" },
  { id: "taches" as MobileScreen, icon: CheckSquare, labelKey: "taches" },
  { id: "messages" as MobileScreen, icon: MessageSquare, labelKey: "messages" },
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
  const { t } = useTranslation();
  return (
    <div className="p-3 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center">
          <span className="text-[9px] font-bold text-amber-700">AB</span>
        </div>
        <div>
          <p className="text-[10px] font-semibold">{t("phoneSimulator.greeting")}</p>
          <p className="text-[8px] text-muted-foreground">{t("phoneSimulator.userRole")}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <button onClick={() => onNavigate("appels")} className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-2 text-left">
          <Phone className="w-3 h-3 text-blue-600 mb-0.5" />
          <p className="text-xs font-bold text-blue-900 dark:text-blue-200">44</p>
          <p className="text-[7px] text-blue-600">{t("phoneSimulator.labels.appels")}</p>
        </button>
        <button onClick={() => onNavigate("taches")} className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-2 text-left">
          <CheckSquare className="w-3 h-3 text-emerald-600 mb-0.5" />
          <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">12</p>
          <p className="text-[7px] text-emerald-600">{t("phoneSimulator.labels.taches")}</p>
        </button>
        <button onClick={() => onNavigate("messages")} className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-2 text-left">
          <MessageSquare className="w-3 h-3 text-purple-600 mb-0.5" />
          <p className="text-xs font-bold text-purple-900 dark:text-purple-200">8</p>
          <p className="text-[7px] text-purple-600">{t("phoneSimulator.labels.messages")}</p>
        </button>
        <button onClick={() => onNavigate("contacts")} className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2 text-left">
          <Users className="w-3 h-3 text-amber-600 mb-0.5" />
          <p className="text-xs font-bold text-amber-900 dark:text-amber-200">156</p>
          <p className="text-[7px] text-amber-600">{t("phoneSimulator.labels.contacts")}</p>
        </button>
        <button onClick={() => onNavigate("agents-ia")} className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-2 text-left">
          <Brain className="w-3 h-3 text-indigo-600 mb-0.5" />
          <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200">7</p>
          <p className="text-[7px] text-indigo-600">{t("phoneSimulator.labels.agentsIa")}</p>
        </button>
      </div>

      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/10 rounded-lg p-2.5 border border-purple-100 dark:border-purple-900/30">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Brain className="w-3 h-3 text-purple-600" />
            <span className="text-[9px] font-semibold text-purple-700">{t("phoneSimulator.intelligenceIa")}</span>
          </div>
          <span className="text-[10px] font-bold text-purple-700">82/100</span>
        </div>
        <div className="h-1 bg-purple-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full" style={{ width: "82%" }} />
        </div>
        <p className="text-[7px] text-muted-foreground mt-1">{t("phoneSimulator.alertsSuggestions")}</p>
      </div>

      <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-2.5 border border-emerald-100 dark:border-emerald-900/30">
        <div className="flex items-center gap-1.5 mb-1">
          <Plug className="w-3 h-3 text-emerald-600" />
          <span className="text-[9px] font-semibold text-emerald-700">{t("phoneSimulator.platformsConnected")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[7px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Google 26</span>
          <span className="text-[7px] px-1.5 py-0.5 bg-blue-50 text-[#0078D4] rounded">Microsoft 19</span>
          <span className="text-[7px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded">Apple 13</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] font-semibold">{t("phoneSimulator.recentActivity")}</p>
        {[
          { icon: PhoneCall, text: t("phoneSimulator.activity.call"), time: t("phoneSimulator.timeAgo", { count: 5 }), color: "text-blue-600" },
          { icon: CheckCircle2, text: t("phoneSimulator.activity.taskDone"), time: t("phoneSimulator.timeAgo", { count: 15 }), color: "text-emerald-600" },
          { icon: AlertCircle, text: t("phoneSimulator.activity.urgentMsg"), time: t("phoneSimulator.timeAgo", { count: 30 }), color: "text-amber-600" },
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
          { label: t("phoneSimulator.stats.responseRate"), value: "94%", color: "text-emerald-600" },
          { label: t("phoneSimulator.stats.avgDuration"), value: "4:32", color: "text-blue-600" },
          { label: t("phoneSimulator.stats.satisfaction"), value: "4.8", color: "text-amber-600" },
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

function ScreenAppels({ }: { onNavigate: (s: MobileScreen) => void }) {
  const { t } = useTranslation();
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
            {t("phoneSimulator.searchCall")}
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
              <span className="text-[7px] text-muted-foreground">{a.heure === "Hier" ? t("phoneSimulator.yesterday") : a.heure}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge variant={a.statut === "repondu" ? "secondary" : a.statut === "manque" ? "destructive" : "outline"} className="text-[6px] h-3 px-1">
                {t(`phoneSimulator.callStatus.${a.statut}`)}
              </Badge>
              <span className="text-[7px] text-muted-foreground">{t(`phoneSimulator.direction.${a.direction}`)}</span>
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
  const { t } = useTranslation();
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
            {t("phoneSimulator.searchContact")}
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
            <Badge className={`text-[6px] h-3 px-1 border-0 ${catColor}`}>{t(`phoneSimulator.category.${c.cat}`)}</Badge>
          </div>
        );
      })}
    </div>
  );
}

function ScreenTaches() {
  const { t } = useTranslation();
  const taches = [
    { titreKey: "callBack", priorite: "haute", statut: "en_cours", dueKey: "today" },
    { titreKey: "monthlyReport", priorite: "haute", statut: "en_attente", dueKey: "tomorrow" },
    { titreKey: "crmUpdate", priorite: "moyenne", statut: "en_cours", dueKey: "fri" },
    { titreKey: "salesMeeting", priorite: "basse", statut: "en_attente", dueKey: "mon" },
    { titreKey: "training", priorite: "moyenne", statut: "termine", dueKey: "done" },
  ];

  return (
    <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold">{t("phoneSimulator.myTasks")}</p>
        <Badge variant="outline" className="text-[7px] h-4">{t("phoneSimulator.tasksCount", { count: 5 })}</Badge>
      </div>
      {taches.map((task, i) => {
        const prioColor = task.priorite === "haute" ? "bg-red-500" : task.priorite === "moyenne" ? "bg-amber-500" : "bg-blue-500";
        const statutColor = task.statut === "termine" ? "text-emerald-600" : task.statut === "en_cours" ? "text-blue-600" : "text-amber-600";
        return (
          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
            <div className={`w-1.5 h-1.5 rounded-full ${prioColor} mt-1 shrink-0`} />
            <div className="flex-1 min-w-0">
              <p className={`text-[9px] font-semibold ${task.statut === "termine" ? "line-through text-muted-foreground" : ""}`}>{t(`phoneSimulator.tasks.${task.titreKey}`)}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-[7px] font-medium ${statutColor}`}>{t(`phoneSimulator.taskStatus.${task.statut}`)}</span>
                <span className="text-[7px] text-muted-foreground">{t(`phoneSimulator.due.${task.dueKey}`)}</span>
              </div>
            </div>
            {task.statut === "termine" && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

function ScreenMessages() {
  const { t } = useTranslation();
  const messages = [
    { de: "J. Martin", objetKey: "meeting", type: "Note", lu: false, priorite: true },
    { de: "S. Bernard", objetKey: "contract", type: "Vocal", lu: false, priorite: false },
    { de: "P. Leroy", objetKey: "quote", type: "Rappel", lu: true, priorite: false },
    { de: "C. Roux", objetKey: "partnership", type: "Note", lu: true, priorite: false },
    { de: "L. Petit", objetKey: "invoice", type: "Rappel", lu: true, priorite: true },
  ];

  return (
    <div className="p-3 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold">{t("phoneSimulator.labels.messages")}</p>
        <Badge variant="secondary" className="text-[7px] h-4">{t("phoneSimulator.unreadCount", { count: 2 })}</Badge>
      </div>
      {messages.map((m, i) => (
        <div key={i} className={cn("flex items-center gap-2 p-2 rounded-lg border border-border/30", !m.lu ? "bg-blue-50/50 dark:bg-blue-950/10 font-semibold" : "bg-muted/20")}>
          <div className={cn("w-7 h-7 rounded-full flex items-center justify-center shrink-0", !m.lu ? "bg-blue-100" : "bg-muted")}>
            <MessageSquare className={cn("w-3 h-3", !m.lu ? "text-blue-600" : "text-muted-foreground")} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className={cn("text-[9px] truncate", !m.lu && "font-bold")}>{m.de}</p>
              <Badge variant="outline" className="text-[6px] h-3 px-1">{t(`phoneSimulator.msgType.${m.type}`)}</Badge>
            </div>
            <p className="text-[8px] text-muted-foreground truncate">{t(`phoneSimulator.msgSubject.${m.objetKey}`)}</p>
          </div>
          {m.priorite && <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

function ScreenAgentsIA() {
  const { t } = useTranslation();
  const agents = [
    { nomKey: "appels", score: 87, icon: Phone, couleur: "text-blue-600" },
    { nomKey: "contacts", score: 92, icon: Users, couleur: "text-emerald-600" },
    { nomKey: "taches", score: 74, icon: CheckSquare, couleur: "text-amber-600" },
    { nomKey: "messages", score: 81, icon: MessageSquare, couleur: "text-purple-600" },
    { nomKey: "pointage", score: 91, icon: Clock, couleur: "text-orange-600" },
    { nomKey: "securite", score: 95, icon: ShieldCheck, couleur: "text-red-600" },
  ];

  return (
    <div className="p-3 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(100% - 44px)" }}>
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/20 dark:to-indigo-950/10 rounded-lg p-3 border border-purple-100 dark:border-purple-900/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] font-semibold text-purple-700">{t("phoneSimulator.superAgent")}</p>
            <p className="text-[7px] text-purple-600/70">{t("phoneSimulator.globalSynthesis")}</p>
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

      <p className="text-[9px] font-semibold">{t("phoneSimulator.specializedAgents")}</p>
      {agents.map((a, i) => (
        <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <a.icon className={`w-3.5 h-3.5 ${a.couleur}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-semibold">{t("phoneSimulator.agentName", { name: t(`phoneSimulator.agentLabels.${a.nomKey}`) })}</p>
              <span className={`text-[10px] font-bold ${a.score >= 80 ? "text-emerald-600" : a.score >= 60 ? "text-amber-600" : "text-red-600"}`}>{a.score}</span>
            </div>
            <div className="mt-0.5 h-1 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${a.score >= 80 ? "bg-emerald-500" : a.score >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${a.score}%` }} />
            </div>
          </div>
        </div>
      ))}

      <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50">
        <p className="text-[8px] font-medium text-amber-700">{t("phoneSimulator.activeAlerts", { count: 3 })}</p>
        <p className="text-[7px] text-amber-600">{t("phoneSimulator.alertsDetail")}</p>
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
  const { t } = useTranslation();
  const [currentScreen, setCurrentScreen] = useState<MobileScreen>(defaultScreen);
  const [isExpanded, setIsExpanded] = useState(expanded);

  const screenTitles: Record<MobileScreen, string> = {
    accueil: "Ajant Bureau",
    appels: t("phoneSimulator.screenTitles.appels"),
    contacts: t("phoneSimulator.screenTitles.contacts"),
    taches: t("phoneSimulator.screenTitles.taches"),
    messages: t("phoneSimulator.screenTitles.messages"),
    "agents-ia": t("phoneSimulator.screenTitles.agentsIa"),
    stats: t("phoneSimulator.screenTitles.stats"),
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
                  <span className="text-[7px] font-medium">{t(`phoneSimulator.labels.${item.labelKey}`)}</span>
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
          {isExpanded ? t("phoneSimulator.reduce") : t("phoneSimulator.enlarge")}
        </Button>
        {onClose && (
          <Button variant="ghost" size="sm" className="h-7 text-[10px] gap-1" onClick={onClose}>
            <X className="w-3 h-3" /> {t("phoneSimulator.close")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PhoneSimulatorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-auto max-w-none border-0 bg-transparent p-0 shadow-none [&>button]:hidden">
        <DialogTitle className="sr-only">Simulateur téléphonique</DialogTitle>
        <PhoneSimulator expanded onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
