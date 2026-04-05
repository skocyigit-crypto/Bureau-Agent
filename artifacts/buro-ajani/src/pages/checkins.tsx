import { useState, useEffect, useMemo } from "react";
import {
  Clock, LogIn, LogOut, Coffee, MapPin, Building2, Wifi, Map, CalendarDays,
  Timer, Users, BarChart3, Loader2, Play, Pause, Square, Plus, ChevronLeft,
  ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal, Trash2, Eye,
  RefreshCw, TrendingUp, ArrowUpDown, ArrowUp, ArrowDown, Sparkles
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon3D } from "@/components/icon-3d";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  useListCheckins, useCreateCheckin, useUpdateCheckin, useDeleteCheckin,
  useGetCheckinStats, useGetCurrentCheckins,
  getListCheckinsQueryKey, getGetCheckinStatsQueryKey, getGetCurrentCheckinsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { useWorkspaceUser } from "@/components/workspace-user";

const PAGE_SIZE = 15;

const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  bureau: { label: "Bureau", icon: Building2, color: "text-blue-600", bg: "bg-blue-100" },
  distance: { label: "Distance", icon: Wifi, color: "text-purple-600", bg: "bg-purple-100" },
  terrain: { label: "Terrain", icon: Map, color: "text-emerald-600", bg: "bg-emerald-100" },
};

const STATUS_META: Record<string, { label: string; color: string; dotColor: string }> = {
  present: { label: "Present", color: "bg-emerald-100 text-emerald-700 border-emerald-200", dotColor: "bg-emerald-500" },
  en_pause: { label: "En pause", color: "bg-amber-100 text-amber-700 border-amber-200", dotColor: "bg-amber-500" },
  termine: { label: "Termine", color: "bg-slate-100 text-slate-600 border-slate-200", dotColor: "bg-slate-400" },
  absent: { label: "Absent", color: "bg-red-100 text-red-700 border-red-200", dotColor: "bg-red-500" },
};

function formatDuration(minutes: number | null | undefined): string {
  if (!minutes) return "-";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m.toString().padStart(2, "0")}min`;
}

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function LiveTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startTime).getTime();
    const update = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return (
    <span className="font-mono text-2xl font-bold tabular-nums">
      {h.toString().padStart(2, "0")}:{m.toString().padStart(2, "0")}:{s.toString().padStart(2, "0")}
    </span>
  );
}

export default function CheckinsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useWorkspaceUser();
  const userName = `${user.prenom} ${user.nom}`;

  const [page, setPage] = useState(0);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState("checkInAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedCheckin, setSelectedCheckin] = useState<any>(null);
  const [newCheckin, setNewCheckin] = useState({
    type: "bureau" as "bureau" | "distance" | "terrain",
    location: "",
    notes: "",
  });

  const { data: listData, isLoading } = useListCheckins({
    status: filterStatus !== "all" ? filterStatus as any : undefined,
    type: filterType !== "all" ? filterType as any : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    sortBy: sortBy as any,
    sortOrder: sortOrder as any,
  });

  const { data: statsData } = useGetCheckinStats({});
  const { data: currentData } = useGetCurrentCheckins({ employeeName: userName });

  const createCheckin = useCreateCheckin();
  const updateCheckin = useUpdateCheckin();
  const deleteCheckin = useDeleteCheckin();

  const totalPages = Math.max(1, Math.ceil((listData?.total ?? 0) / PAGE_SIZE));

  const activeSession = useMemo(() => {
    return currentData?.active?.find((c: any) => c.employeeName === userName) || null;
  }, [currentData, userName]);

  const pausedSession = useMemo(() => {
    return currentData?.paused?.find((c: any) => c.employeeName === userName) || null;
  }, [currentData, userName]);

  const currentSession = activeSession || pausedSession;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListCheckinsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCheckinStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCurrentCheckinsQueryKey() });
  };

  const handleCheckIn = () => {
    createCheckin.mutate({
      data: {
        employeeName: userName,
        employeeRole: user.role,
        type: newCheckin.type,
        status: "present",
        location: newCheckin.location || null,
        notes: newCheckin.notes || null,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Pointage enregistre", description: `Arrivee enregistree - ${TYPE_META[newCheckin.type]?.label}` });
        setShowNewDialog(false);
        setNewCheckin({ type: "bureau", location: "", notes: "" });
        invalidateAll();
      },
      onError: () => toast({ title: "Erreur", description: "Impossible d'enregistrer le pointage", variant: "destructive" }),
    });
  };

  const handleCheckOut = () => {
    if (!currentSession) return;
    const now = new Date().toISOString();
    updateCheckin.mutate({
      id: currentSession.id,
      data: { status: "termine", checkOutAt: now },
    }, {
      onSuccess: () => {
        toast({ title: "Depart enregistre", description: "Bonne fin de journee !" });
        invalidateAll();
      },
    });
  };

  const handlePause = () => {
    if (!activeSession) return;
    updateCheckin.mutate({
      id: activeSession.id,
      data: { status: "en_pause" },
    }, {
      onSuccess: () => {
        toast({ title: "Pause commencee", description: "Votre session est en pause" });
        invalidateAll();
      },
    });
  };

  const handleResume = () => {
    if (!pausedSession) return;
    const breakAdd = Math.round((Date.now() - new Date(pausedSession.updatedAt).getTime()) / 60000);
    updateCheckin.mutate({
      id: pausedSession.id,
      data: { status: "present", breakMinutes: (pausedSession.breakMinutes || 0) + breakAdd },
    }, {
      onSuccess: () => {
        toast({ title: "Reprise", description: "Votre session est active" });
        invalidateAll();
      },
    });
  };

  const handleDelete = (id: number) => {
    deleteCheckin.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Pointage supprime" });
        invalidateAll();
      },
    });
  };

  const handleSort = (col: string) => {
    if (sortBy === col) setSortOrder(o => o === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortOrder("desc"); }
    setPage(0);
  };

  const getSortIcon = (col: string) => {
    if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortOrder === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Clock} variant="slate" size="md" /> Pointage & Presence</h1>
          <p className="text-muted-foreground">Gerez vos heures d'arrivee, de depart et votre temps de travail.</p>
        </div>
        <div className="flex gap-2">
          {!currentSession ? (
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowNewDialog(true)}>
              <LogIn className="w-4 h-4 mr-2" /> Pointer mon arrivee
            </Button>
          ) : (
            <>
              {activeSession && (
                <Button variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50" onClick={handlePause}>
                  <Pause className="w-4 h-4 mr-2" /> Pause
                </Button>
              )}
              {pausedSession && (
                <Button variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={handleResume}>
                  <Play className="w-4 h-4 mr-2" /> Reprendre
                </Button>
              )}
              <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={handleCheckOut}>
                <LogOut className="w-4 h-4 mr-2" /> Pointer mon depart
              </Button>
            </>
          )}
        </div>
      </div>

      {currentSession && (
        <Card className="border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${activeSession ? "bg-emerald-500" : "bg-amber-500"} text-white`}>
                  {activeSession ? <Clock className="w-6 h-6" /> : <Coffee className="w-6 h-6" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg">Session en cours</span>
                    <Badge className={STATUS_META[currentSession.status]?.color}>
                      <span className={`w-2 h-2 rounded-full mr-1.5 ${STATUS_META[currentSession.status]?.dotColor}`} />
                      {STATUS_META[currentSession.status]?.label}
                    </Badge>
                    {currentSession.type && (
                      <Badge variant="outline" className="gap-1">
                        {(() => { const T = TYPE_META[currentSession.type]; return T ? <T.icon className={`w-3 h-3 ${T.color}`} /> : null; })()}
                        {TYPE_META[currentSession.type]?.label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Arrivee a {formatTime(currentSession.checkInAt)}
                    {currentSession.location && ` - ${currentSession.location}`}
                    {currentSession.breakMinutes > 0 && ` - ${currentSession.breakMinutes}min de pause`}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <LiveTimer startTime={currentSession.checkInAt} />
                <p className="text-xs text-muted-foreground mt-1">Temps ecoule</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Sessions</p>
                <p className="text-2xl font-bold mt-1">{statsData?.totalSessions ?? 0}</p>
              </div>
              <CalendarDays className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Heures totales</p>
                <p className="text-2xl font-bold mt-1">{formatDuration(statsData?.totalMinutes)}</p>
              </div>
              <Timer className="w-8 h-8 text-emerald-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Moy. / session</p>
                <p className="text-2xl font-bold mt-1">{formatDuration(statsData?.avgSessionMinutes)}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-amber-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Pause totale</p>
                <p className="text-2xl font-bold mt-1">{formatDuration(statsData?.totalBreakMinutes)}</p>
              </div>
              <Coffee className="w-8 h-8 text-orange-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {Object.entries(TYPE_META).map(([key, meta]) => {
          const count = key === "bureau" ? statsData?.bureauCount : key === "distance" ? statsData?.distanceCount : statsData?.terrainCount;
          return (
            <Card key={key} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${meta.bg}`}>
                    <meta.icon className={`w-5 h-5 ${meta.color}`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{meta.label}</p>
                    <p className="text-xl font-bold">{count ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="historique" className="space-y-4">
        <TabsList>
          <TabsTrigger value="historique">Historique</TabsTrigger>
          <TabsTrigger value="equipe">Equipe</TabsTrigger>
        </TabsList>

        <TabsContent value="historique" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tous les statuts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="en_pause">En pause</SelectItem>
                <SelectItem value="termine">Termine</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tous les types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                <SelectItem value="bureau">Bureau</SelectItem>
                <SelectItem value="distance">Distance</SelectItem>
                <SelectItem value="terrain">Terrain</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={invalidateAll}>
              <RefreshCw className="w-4 h-4 mr-1" /> Actualiser
            </Button>
          </div>

          <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("employeeName")}>
                    <span className="flex items-center">Employe{getSortIcon("employeeName")}</span>
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("checkInAt")}>
                    <span className="flex items-center">Date{getSortIcon("checkInAt")}</span>
                  </TableHead>
                  <TableHead>Arrivee</TableHead>
                  <TableHead>Depart</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("totalMinutes")}>
                    <span className="flex items-center">Duree{getSortIcon("totalMinutes")}</span>
                  </TableHead>
                  <TableHead>Pause</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                    <span className="flex items-center">Statut{getSortIcon("status")}</span>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : !listData?.checkins?.length ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">Aucun pointage enregistre</p>
                      <p className="text-sm">Commencez par pointer votre arrivee</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  listData.checkins.map((checkin: any) => {
                    const typeMeta = TYPE_META[checkin.type] || TYPE_META.bureau;
                    const statusMeta = STATUS_META[checkin.status] || STATUS_META.termine;
                    return (
                      <TableRow key={checkin.id} className="group">
                        <TableCell>
                          <div className="font-medium text-sm">{checkin.employeeName}</div>
                          {checkin.employeeRole && <div className="text-xs text-muted-foreground">{checkin.employeeRole}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1">
                            <typeMeta.icon className={`w-3 h-3 ${typeMeta.color}`} />
                            {typeMeta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(checkin.checkInAt)}</TableCell>
                        <TableCell className="text-sm font-mono">{formatTime(checkin.checkInAt)}</TableCell>
                        <TableCell className="text-sm font-mono">{formatTime(checkin.checkOutAt)}</TableCell>
                        <TableCell className="text-sm font-medium">{formatDuration(checkin.totalMinutes)}</TableCell>
                        <TableCell className="text-sm">{checkin.breakMinutes > 0 ? `${checkin.breakMinutes}min` : "-"}</TableCell>
                        <TableCell>
                          <Badge className={statusMeta.color}>
                            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${statusMeta.dotColor}`} />
                            {statusMeta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setSelectedCheckin(checkin); setShowDetailDialog(true); }}>
                                <Eye className="w-4 h-4 mr-2" /> Voir les details
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(checkin.id)}>
                                <Trash2 className="w-4 h-4 mr-2" /> Supprimer
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {(listData?.total ?? 0) > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {listData?.total ?? 0} pointage(s) - Page {page + 1} sur {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(0)}>
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="equipe" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Equipe - Statut en temps reel</CardTitle>
              <CardDescription>Visualisez qui est present, en pause ou absent</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!currentData?.active?.length && !currentData?.paused?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Aucun employe connecte</p>
                  <p className="text-sm">Personne n'est pointe actuellement</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {currentData?.active?.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-bold">
                          {c.employeeName?.split(" ").map((n: string) => n[0]).join("").substring(0, 2)}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{c.employeeName}</p>
                          <p className="text-xs text-muted-foreground">
                            {TYPE_META[c.type]?.label} - Depuis {formatTime(c.checkInAt)}
                            {c.location && ` - ${c.location}`}
                          </p>
                        </div>
                      </div>
                      <Badge className={STATUS_META.present.color}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 animate-pulse ${STATUS_META.present.dotColor}`} />
                        Present
                      </Badge>
                    </div>
                  ))}
                  {currentData?.paused?.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center text-sm font-bold">
                          {c.employeeName?.split(" ").map((n: string) => n[0]).join("").substring(0, 2)}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{c.employeeName}</p>
                          <p className="text-xs text-muted-foreground">
                            {TYPE_META[c.type]?.label} - En pause depuis {formatTime(c.updatedAt)}
                          </p>
                        </div>
                      </div>
                      <Badge className={STATUS_META.en_pause.color}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${STATUS_META.en_pause.dotColor}`} />
                        En pause
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 gap-4">
            <Card className="bg-emerald-50 border-emerald-200">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-emerald-700">{currentData?.active?.length ?? 0}</p>
                <p className="text-sm text-emerald-600 mt-1">Presents</p>
              </CardContent>
            </Card>
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-amber-700">{currentData?.paused?.length ?? 0}</p>
                <p className="text-sm text-amber-600 mt-1">En pause</p>
              </CardContent>
            </Card>
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-blue-700">{(currentData?.active?.length ?? 0) + (currentData?.paused?.length ?? 0)}</p>
                <p className="text-sm text-blue-600 mt-1">Total connectes</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <AiSuggestionsCard page="pointage" title="Recommandations IA - Pointage" compact />

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pointer mon arrivee</DialogTitle>
            <DialogDescription>Enregistrez votre arrivee au travail</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Type de travail</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {Object.entries(TYPE_META).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => setNewCheckin(p => ({ ...p, type: key as any }))}
                    className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-1.5 ${
                      newCheckin.type === key
                        ? `border-primary ${meta.bg}`
                        : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <meta.icon className={`w-5 h-5 ${meta.color}`} />
                    <span className="text-xs font-medium">{meta.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="location">Lieu (optionnel)</Label>
              <Input
                id="location"
                placeholder="Ex: Bureau Paris, Domicile, Client XYZ..."
                value={newCheckin.location}
                onChange={e => setNewCheckin(p => ({ ...p, location: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes (optionnel)</Label>
              <Textarea
                id="notes"
                placeholder="Commentaire sur votre journee..."
                value={newCheckin.notes}
                onChange={e => setNewCheckin(p => ({ ...p, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>Annuler</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleCheckIn} disabled={createCheckin.isPending}>
              {createCheckin.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <LogIn className="w-4 h-4 mr-2" /> Confirmer l'arrivee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Details du pointage</DialogTitle>
          </DialogHeader>
          {selectedCheckin && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Employe</Label>
                  <p className="font-medium">{selectedCheckin.employeeName}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Role</Label>
                  <p>{selectedCheckin.employeeRole || "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <p>{TYPE_META[selectedCheckin.type]?.label || selectedCheckin.type}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Statut</Label>
                  <Badge className={STATUS_META[selectedCheckin.status]?.color || ""}>
                    {STATUS_META[selectedCheckin.status]?.label || selectedCheckin.status}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Arrivee</Label>
                  <p>{formatDate(selectedCheckin.checkInAt)} a {formatTime(selectedCheckin.checkInAt)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Depart</Label>
                  <p>{selectedCheckin.checkOutAt ? `${formatDate(selectedCheckin.checkOutAt)} a ${formatTime(selectedCheckin.checkOutAt)}` : "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Duree totale</Label>
                  <p className="font-medium">{formatDuration(selectedCheckin.totalMinutes)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Pause</Label>
                  <p>{selectedCheckin.breakMinutes > 0 ? `${selectedCheckin.breakMinutes} min` : "-"}</p>
                </div>
              </div>
              {selectedCheckin.location && (
                <div>
                  <Label className="text-xs text-muted-foreground">Lieu</Label>
                  <p className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {selectedCheckin.location}</p>
                </div>
              )}
              {selectedCheckin.notes && (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="text-sm">{selectedCheckin.notes}</p>
                </div>
              )}
              {selectedCheckin.ipAddress && (
                <div>
                  <Label className="text-xs text-muted-foreground">Adresse IP</Label>
                  <p className="text-xs font-mono text-muted-foreground">{selectedCheckin.ipAddress}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailDialog(false)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
