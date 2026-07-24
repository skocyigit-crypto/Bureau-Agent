import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Mail, Calendar, HardDrive, FileText, Table, Presentation, Users, CheckSquare,
  StickyNote, Video, Image, PlayCircle, MessageCircle, ClipboardList,
  Search, ExternalLink, RefreshCw, Shield, Zap, Grid3X3, ChevronRight,
  Clock, Star, Eye, Folder, Link2, AlertCircle, Check, Loader2, Globe, Printer,
  FolderKanban
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { trackScanResult } from "@/lib/scan-result";
import { Icon3D } from "@/components/icon-3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string) {
  const res = await fetch(`${baseUrl}/api${path}`, { credentials: "include" });
  if (!res.ok) throw new Error("Erreur");
  return res.json();
}

const ICON_MAP: Record<string, any> = {
  mail: Mail, calendar: Calendar, "hard-drive": HardDrive, "file-text": FileText,
  table: Table, presentation: Presentation, users: Users, "check-square": CheckSquare,
  "sticky-note": StickyNote, video: Video, image: Image, "play-circle": PlayCircle,
  "message-circle": MessageCircle, "clipboard-list": ClipboardList,
};

const MIME_ICONS: Record<string, any> = {
  "Google Doc": FileText, "Google Sheet": Table, "Google Slides": Presentation,
  "Google Form": ClipboardList, "Dossier": Folder, "PDF": FileText,
  "Image": Image, "Word": FileText, "Excel": Table, "PowerPoint": Presentation, "Fichier": FileText,
};

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SmartDate({ dateStr }: { dateStr: string }) {
  if (!dateStr) return <span>-</span>;
  const d = new Date(dateStr);
  if (isToday(d)) return <span className="text-blue-600 font-medium">Aujourd'hui {format(d, "HH:mm")}</span>;
  if (isTomorrow(d)) return <span className="text-amber-600 font-medium">Demain {format(d, "HH:mm")}</span>;
  return <span>{format(d, "dd MMM HH:mm", { locale: fr })}</span>;
}

export default function GoogleWorkspace() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeTab, setActiveTab] = useState("apps");
  const [importingFile, setImportingFile] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [driveQuery, setDriveQuery] = useState("");
  const [driveResults, setDriveResults] = useState<any[] | null>(null);
  const [driveSearching, setDriveSearching] = useState(false);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ title: "", start: "", end: "", location: "" });

  const runDriveSearch = useCallback(async () => {
    const q = driveQuery.trim();
    if (!q) return;
    setDriveSearching(true);
    try {
      const data = await apiFetch(`/google-workspace/drive-search?q=${encodeURIComponent(q)}`);
      setDriveResults(data.files || []);
      if (!data.files?.length) toast({ title: "Aucun fichier trouvé", description: q });
    } catch {
      toast({ title: "Recherche impossible", description: "Réessayez dans un instant.", variant: "destructive" });
    } finally {
      setDriveSearching(false);
    }
  }, [driveQuery, toast]);

  // Lance le vrai flux OAuth 2.0 Google : demande l'URL de consentement au
  // backend (tous les scopes par defaut) puis redirige l'utilisateur vers
  // l'ecran de connexion Google officiel.
  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const res = await fetch(`${baseUrl}/api/google-oauth/auth-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data?.authUrl) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      window.location.href = data.authUrl;
    } catch (e: any) {
      toast({ title: "Connexion impossible", description: "Veuillez réessayer dans un instant.", variant: "destructive" });
      setConnecting(false);
    }
  }, [toast]);

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await fetch(`${baseUrl}/api/google-oauth/disconnect`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Compte Google déconnecté", description: "Toutes les applications ont été dissociées." });
      window.location.reload();
    } catch (e: any) {
      toast({ title: "Échec de la déconnexion", description: e?.message || "Réessayez.", variant: "destructive" });
      setDisconnecting(false);
    }
  }, [toast]);

  const handleImportFile = useCallback(async (file: any) => {
    if (!file?.id) return;
    setImportingFile(file.id);
    try {
      const res = await fetch(`${baseUrl}/api/google-workspace/drive-import`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast({ title: "Importé dans Documents", description: `${file.name} — analyse antivirus en cours.` });
      // Suivi du verdict antivirus en arriere-plan (Tache #175) : on affichera
      // un toast de suivi des que l'analyse est terminee (sain / dangereux).
      const docId = data?.document?.id ?? data?.id;
      if (docId) void trackScanResult(toast, docId, file.name || "Le fichier");
    } catch (e: any) {
      toast({ title: "Échec de l'import", description: e?.message || "Réessayez.", variant: "destructive" });
    } finally {
      setImportingFile(null);
    }
  }, [toast]);

  const { data: hub, isLoading: hubLoading } = useQuery({ queryKey: ["gw-hub"], queryFn: () => apiFetch("/google-workspace/hub") });
  const qc = useQueryClient();

  const createEvent = useCallback(async () => {
    setCreatingEvent(true);
    try {
      const res = await fetch(`${baseUrl}/api/google-workspace/create-event`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newEvent.title.trim(),
          // Le serveur attend une date ISO ; `datetime-local` fournit une
          // valeur sans fuseau, qu'on convertit en heure locale du navigateur.
          start: new Date(newEvent.start).toISOString(),
          end: new Date(newEvent.end).toISOString(),
          location: newEvent.location.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast({ title: "Évènement créé", description: newEvent.title });
      setNewEvent({ title: "", start: "", end: "", location: "" });
      setShowNewEvent(false);
      qc.invalidateQueries({ queryKey: ["gw-events"] });
    } catch (e: any) {
      toast({ title: "Création impossible", description: e?.message, variant: "destructive" });
    } finally {
      setCreatingEvent(false);
    }
  }, [newEvent, toast, qc]);
  const { data: emailsData, isLoading: emailsLoading } = useQuery({ queryKey: ["gw-emails"], queryFn: () => apiFetch("/google-workspace/recent-emails") });
  const { data: eventsData, isLoading: eventsLoading } = useQuery({ queryKey: ["gw-events"], queryFn: () => apiFetch("/google-workspace/upcoming-events") });
  const { data: filesData, isLoading: filesLoading } = useQuery({ queryKey: ["gw-files"], queryFn: () => apiFetch("/google-workspace/recent-files") });
  const { data: tasksData, isLoading: tasksLoading } = useQuery({ queryKey: ["gw-tasks"], queryFn: () => apiFetch("/google-workspace/tasks") });

  const filteredApps = (hub?.apps || []).filter((app: any) => {
    const matchSearch = !search || app.name.toLowerCase().includes(search.toLowerCase()) || app.description.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === "all" || app.category === activeCategory;
    return matchSearch && matchCat;
  });

  const connectedApps = (hub?.apps || []).filter((a: any) => a.connected);
  const disconnectedApps = (hub?.apps || []).filter((a: any) => !a.connected);

  return (
    <div className="flex-1 space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Icon3D icon={Globe} variant="blue" size="lg" />
          <div>
            <h1 className="text-2xl font-bold">Google Workspace</h1>
            <p className="text-muted-foreground text-sm">Gerez vos applications Google depuis un seul endroit</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hub?.authenticated ? (
            <>
              <Badge variant="default" className="bg-emerald-500 text-white gap-1"><Check className="h-3 w-3" /> Connecte</Badge>
              <Button variant="outline" size="sm" className="gap-1" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                Deconnecter
              </Button>
            </>
          ) : (
            <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              Se connecter avec Google
            </Button>
          )}
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
        </div>
      </div>

      {hub && !hub.authenticated && (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-800/50 dark:bg-amber-950/20">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">En attente de configuration — aucun compte Google connecte</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Connectez votre propre compte Google pour synchroniser Gmail, Agenda, Drive, Docs, Sheets, Slides et Meet.
                Chaque utilisateur lie son propre compte ; vos donnees restent privees.
              </p>
            </div>
            <Button size="sm" className="gap-1 bg-blue-600 hover:bg-blue-700 text-white shrink-0" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              Se connecter avec Google
            </Button>
          </CardContent>
        </Card>
      )}

      {hub?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Grid3X3 className="h-5 w-5 text-blue-500" />
              <div><p className="text-xs text-muted-foreground">Applications</p><p className="text-xl font-bold">{hub.stats.totalApps}</p></div>
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-emerald-500" />
              <div><p className="text-xs text-muted-foreground">Connectees</p><p className="text-xl font-bold">{hub.stats.connectedApps}</p></div>
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Integration</p>
              <Progress value={hub.stats.percentage} className="h-2" />
              <p className="text-xs font-semibold">{hub.stats.percentage}%</p>
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-500" />
              <div><p className="text-xs text-muted-foreground">Statut</p><p className="text-sm font-semibold">{hub?.tokenValid ? "Token actif" : "Token expire"}</p></div>
            </div>
          </CardContent></Card>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="apps">Applications ({hub?.stats?.totalApps || 0})</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="agenda">Agenda</TabsTrigger>
          <TabsTrigger value="drive">Drive</TabsTrigger>
          <TabsTrigger value="tasks">Taches</TabsTrigger>
        </TabsList>

        <TabsContent value="apps" className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Rechercher une application..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1 flex-wrap">
              {(hub?.categories || []).map((cat: any) => (
                <Button key={cat.id} variant={activeCategory === cat.id ? "default" : "outline"} size="sm" onClick={() => setActiveCategory(cat.id)}>{cat.label}</Button>
              ))}
            </div>
          </div>

          {hubLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>
          ) : (
            <>
              {connectedApps.length > 0 && activeCategory === "all" && !search && (
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500" /> Applications connectees ({connectedApps.length})
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {connectedApps.map((app: any) => <AppCard key={app.id} app={app} hasAccount={hub?.authenticated} />)}
                  </div>
                </div>
              )}

              {(search || activeCategory !== "all" ? filteredApps : disconnectedApps).length > 0 && (
                <div>
                  {!search && activeCategory === "all" && connectedApps.length > 0 && (
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">Autres applications ({disconnectedApps.length})</h3>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(search || activeCategory !== "all" ? filteredApps : disconnectedApps).map((app: any) => <AppCard key={app.id} app={app} hasAccount={hub?.authenticated} />)}
                  </div>
                </div>
              )}

              {filteredApps.length === 0 && <div className="text-center py-12 text-muted-foreground">Aucune application trouvee</div>}
            </>
          )}
        </TabsContent>

        <TabsContent value="emails" className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2"><Mail className="h-5 w-5 text-red-500" /> Derniers emails</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {emailsLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : emailsData?.error === "non_connecte" ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Mail className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>Connectez votre compte Google pour voir vos emails</p>
                </div>
              ) : (
                <div className="divide-y">
                  {(emailsData?.emails || []).map((email: any) => (
                    <div key={email.id} className={`p-3 hover:bg-muted/30 transition-colors ${email.unread ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {email.unread && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                            <p className={`text-sm truncate ${email.unread ? "font-semibold" : ""}`}>{email.subject}</p>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{email.from}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{email.snippet}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{email.date ? formatDistanceToNow(new Date(email.date), { addSuffix: true, locale: fr }) : ""}</span>
                      </div>
                    </div>
                  ))}
                  {(!emailsData?.emails || emailsData.emails.length === 0) && <div className="p-8 text-center text-muted-foreground">Aucun email recent</div>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agenda" className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg flex items-center gap-2"><Calendar className="h-5 w-5 text-blue-500" /> Evenements a venir</CardTitle>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setShowNewEvent(v => !v)}>
                  {showNewEvent ? "Annuler" : "Nouvel évènement"}
                </Button>
              </div>
              {/* Creation d'evenement: la route existait mais n'etait appelee
                  nulle part, le hub etait donc en lecture seule. */}
              {showNewEvent && (
                <div className="pt-3 space-y-2">
                  <Input
                    value={newEvent.title}
                    onChange={(e) => setNewEvent(v => ({ ...v, title: e.target.value }))}
                    placeholder="Titre de l'évènement"
                    className="h-8 text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-muted-foreground">Début</label>
                      <Input
                        type="datetime-local"
                        value={newEvent.start}
                        onChange={(e) => setNewEvent(v => ({ ...v, start: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground">Fin</label>
                      <Input
                        type="datetime-local"
                        value={newEvent.end}
                        onChange={(e) => setNewEvent(v => ({ ...v, end: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <Input
                    value={newEvent.location}
                    onChange={(e) => setNewEvent(v => ({ ...v, location: e.target.value }))}
                    placeholder="Lieu (facultatif)"
                    className="h-8 text-sm"
                  />
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={createEvent}
                    disabled={creatingEvent || !newEvent.title.trim() || !newEvent.start || !newEvent.end}
                  >
                    {creatingEvent && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Créer dans Google Agenda
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {eventsLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : eventsData?.error === "non_connecte" ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>Connectez votre compte Google pour voir votre agenda</p>
                </div>
              ) : (
                <div className="divide-y">
                  {(eventsData?.events || []).map((event: any) => (
                    <div key={event.id} className="p-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{event.title}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              <SmartDate dateStr={event.start} />
                              {!event.allDay && event.end && <> - {format(new Date(event.end), "HH:mm")}</>}
                            </span>
                            {event.allDay && <Badge variant="outline" className="text-[10px]">Toute la journee</Badge>}
                          </div>
                          {event.location && <p className="text-xs text-muted-foreground mt-1">{event.location}</p>}
                          {event.attendees?.length > 0 && (
                            <div className="flex items-center gap-1 mt-1">
                              <Users className="h-3 w-3 text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground">{event.attendees.length} participant{event.attendees.length > 1 ? "s" : ""}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {event.meetLink && (
                            <a href={event.meetLink} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"><Video className="h-3 w-3" /> Meet</Button>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!eventsData?.events || eventsData.events.length === 0) && <div className="p-8 text-center text-muted-foreground">Aucun evenement a venir</div>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="drive" className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2"><HardDrive className="h-5 w-5 text-green-500" /> {driveResults ? "Résultats de recherche" : "Fichiers recents"}</CardTitle>
              {/* La recherche Drive existait cote serveur mais n'etait exposee
                  nulle part: on ne pouvait que consulter les 15 derniers
                  fichiers modifies. */}
              <div className="flex items-center gap-2 pt-2">
                <Input
                  value={driveQuery}
                  onChange={(e) => setDriveQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runDriveSearch(); }}
                  placeholder="Rechercher dans Drive..."
                  className="h-8 text-sm"
                />
                <Button size="sm" className="h-8" onClick={runDriveSearch} disabled={driveSearching || !driveQuery.trim()}>
                  {driveSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                </Button>
                {driveResults && (
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => { setDriveResults(null); setDriveQuery(""); }}>
                    Effacer
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filesLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : filesData?.error === "non_connecte" ? (
                <div className="p-8 text-center text-muted-foreground">
                  <HardDrive className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>Connectez votre compte Google pour voir vos fichiers</p>
                </div>
              ) : (
                <div className="divide-y">
                  {((driveResults ?? filesData?.files) || []).map((file: any) => {
                    const TypeIcon = MIME_ICONS[file.type] || FileText;
                    return (
                      <div key={file.id} className="p-3 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <TypeIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              <Badge variant="outline" className="text-[10px]">{file.type}</Badge>
                              {file.size && <span>{formatFileSize(file.size)}</span>}
                              {file.modifiedTime && <span>{formatDistanceToNow(new Date(file.modifiedTime), { addSuffix: true, locale: fr })}</span>}
                              {file.shared && <Badge variant="secondary" className="text-[10px]">Partage</Badge>}
                            </div>
                          </div>
                          {file.type !== "Dossier" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 gap-1"
                              onClick={() => handleImportFile(file)}
                              disabled={importingFile === file.id}
                              title="Importer dans Documents (analyse antivirus)"
                            >
                              {importingFile === file.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <FolderKanban className="h-3 w-3" />}
                              <span className="hidden sm:inline text-xs">Documents</span>
                            </Button>
                          )}
                          {file.webViewLink && (
                            <a href={file.webViewLink} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><ExternalLink className="h-3 w-3" /></Button>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {((driveResults ?? filesData?.files) || []).length === 0 && (
                    <div className="p-8 text-center text-muted-foreground">
                      {driveResults ? "Aucun fichier ne correspond à cette recherche" : "Aucun fichier recent"}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2"><CheckSquare className="h-5 w-5 text-blue-500" /> Taches Google</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {tasksLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : tasksData?.error === "non_connecte" ? (
                <div className="p-8 text-center text-muted-foreground">
                  <CheckSquare className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p>Connectez votre compte Google pour voir vos taches</p>
                </div>
              ) : (
                <div className="divide-y">
                  {(tasksData?.tasks || []).map((task: any) => (
                    <div key={task.id} className="p-3 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start gap-2">
                        <div className={`mt-1 w-4 h-4 rounded border-2 shrink-0 ${task.status === "completed" ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/30"}`}>
                          {task.status === "completed" && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm ${task.status === "completed" ? "line-through text-muted-foreground" : "font-medium"}`}>{task.title}</p>
                          {task.notes && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.notes}</p>}
                          <div className="flex items-center gap-2 mt-1">
                            {task.listName && <Badge variant="outline" className="text-[10px]">{task.listName}</Badge>}
                            {task.due && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> {format(new Date(task.due), "dd/MM/yyyy")}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(!tasksData?.tasks || tasksData.tasks.length === 0) && <div className="p-8 text-center text-muted-foreground">Aucune tache en cours</div>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AppCard({ app, hasAccount }: { app: any; hasAccount?: boolean }) {
  const Icon = ICON_MAP[app.icon] || Grid3X3;
  const { toast } = useToast();
  const [activating, setActivating] = useState(false);

  // Autorisation INCREMENTALE : on ne demande que le scope de cette application.
  // Le backend passe `include_granted_scopes`, donc Google conserve les acces
  // deja accordes au lieu de les remplacer. Sans ce bouton, les applications
  // hors du trio par defaut (Gmail/Agenda/Drive) restaient "Inactif" a vie,
  // sans aucun moyen de les activer depuis l'interface.
  const activate = useCallback(async () => {
    setActivating(true);
    try {
      const res = await fetch(`${baseUrl}/api/google-oauth/auth-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: [app.id] }),
      });
      const data = await res.json();
      if (!res.ok || !data?.authUrl) throw new Error(data?.error || `HTTP ${res.status}`);
      window.location.href = data.authUrl;
    } catch {
      toast({ title: `Activation de ${app.name} impossible`, description: "Veuillez réessayer dans un instant.", variant: "destructive" });
      setActivating(false);
    }
  }, [app.id, app.name, toast]);

  return (
    <Card className={`transition-all hover:shadow-md ${app.connected ? "border-emerald-200 dark:border-emerald-800/50" : ""}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: app.color + "15" }}>
            <Icon className="h-5 w-5" style={{ color: app.color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">{app.name}</h3>
              {app.connected ? (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px]">Actif</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">Inactif</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{app.description}</p>
            {app.lastSync && (
              <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                <RefreshCw className="h-2.5 w-2.5" />
                Sync: {formatDistanceToNow(new Date(app.lastSync), { addSuffix: true, locale: fr })}
              </p>
            )}
            {!app.connected && hasAccount && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-7 text-xs w-full"
                onClick={activate}
                disabled={activating}
              >
                {activating ? "Redirection…" : "Activer"}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
