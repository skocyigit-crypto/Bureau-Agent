import receptionImg from "@/assets/images/reception-desk.webp";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { Icon3D } from "@/components/icon-3d";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from "@/components/ui/table";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceUser } from "@/components/workspace-user";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { useQueryClient } from "@tanstack/react-query";
import {
getGetCheckinStatsQueryKey,getGetCurrentCheckinsQueryKey,
getListCheckinsQueryKey,
useCreateCheckin,
useDeleteCheckin,
useGetCheckinStats,useGetCurrentCheckins,
useListCheckins,
useUpdateCheckin
} from "@workspace/api-client-react";
import {
AlertCircle,
ArrowDown,
ArrowUp,
ArrowUpDown,
Building2,
CalendarDays,
CheckCircle2,
ChevronLeft,
ChevronRight,ChevronsLeft,ChevronsRight,
Clock,
CloudDownload,
Coffee,
Copy,
Download,
Eye,
FolderKanban,
Loader2,
LogIn,LogOut,
Map,
MapPin,
MoreHorizontal,
Pause,
Play,
Printer,
RefreshCw,
Timer,
Trash2,
TrendingUp,
Users,
Wifi
} from "lucide-react";
import { useEffect,useMemo,useState } from "react";
import { useLocation } from "wouter";

const PAGE_SIZE = 15;

const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  bureau: { label: "checkins.type.bureau", icon: Building2, color: "text-blue-600", bg: "bg-blue-100" },
  distance: { label: "checkins.type.distance", icon: Wifi, color: "text-purple-600", bg: "bg-purple-100" },
  terrain: { label: "checkins.type.terrain", icon: Map, color: "text-emerald-600", bg: "bg-emerald-100" },
};

const STATUS_META: Record<string, { label: string; color: string; dotColor: string }> = {
  present: { label: "checkins.status.present", color: "bg-emerald-100 text-emerald-700 border-emerald-200", dotColor: "bg-emerald-500" },
  en_pause: { label: "checkins.status.en_pause", color: "bg-amber-100 text-amber-700 border-amber-200", dotColor: "bg-amber-500" },
  termine: { label: "checkins.status.termine", color: "bg-slate-100 text-slate-600 border-slate-200", dotColor: "bg-slate-400" },
  absent: { label: "checkins.status.absent", color: "bg-red-100 text-red-700 border-red-200", dotColor: "bg-red-500" },
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
  const { t } = useTranslation();
  const typeLabel = (k?: string | null) => { const m = k ? TYPE_META[k] : undefined; return m ? t(m.label) : (k ?? ""); };
  const statusLabel = (k?: string | null) => { const m = k ? STATUS_META[k] : undefined; return m ? t(m.label) : (k ?? ""); };
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useWorkspaceUser();
  const userName = `${user.prenom} ${user.nom}`;

  const [page, setPage] = useState(0);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState("checkInAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showGoogleSyncDialog, setShowGoogleSyncDialog] = useState(false);
  const [selectedCheckin, setSelectedCheckin] = useState<any>(null);
  const [isEditingCheckin, setIsEditingCheckin] = useState(false);
  const [editCheckinNotes, setEditCheckinNotes] = useState("");
  const [editCheckinLocation, setEditCheckinLocation] = useState("");
  const [newCheckin, setNewCheckin] = useState({
    type: "bureau" as "bureau" | "distance" | "terrain",
    location: "",
    notes: "",
  });
  const [googleSync, setGoogleSync] = useState({
    dateFrom: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    dateTo: new Date().toISOString().slice(0, 10),
    loading: false,
    result: null as null | { message: string; imported: number; skipped: number; errors: number; details: string[] },
    error: null as string | null,
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
        toast({ title: t("checkins.toast.checkedIn"), description: t("checkins.toast.checkedInDesc", { type: typeLabel(newCheckin.type) }) });
        setShowNewDialog(false);
        setNewCheckin({ type: "bureau", location: "", notes: "" });
        invalidateAll();
      },
      onError: () => toast({ title: t("checkins.toast.error"), description: t("checkins.toast.checkInError"), variant: "destructive" }),
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
        toast({ title: t("checkins.toast.checkedOut"), description: t("checkins.toast.checkedOutDesc") });
        invalidateAll();
      },
      onError: () => toast({ title: t("checkins.toast.error"), description: t("checkins.toast.checkOutError"), variant: "destructive" }),
    });
  };

  const handlePause = () => {
    if (!activeSession) return;
    updateCheckin.mutate({
      id: activeSession.id,
      data: { status: "en_pause" },
    }, {
      onSuccess: () => {
        toast({ title: t("checkins.toast.paused"), description: t("checkins.toast.pausedDesc") });
        invalidateAll();
      },
      onError: () => toast({ title: t("checkins.toast.error"), description: t("checkins.toast.pauseError"), variant: "destructive" }),
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
        toast({ title: t("checkins.toast.resumed"), description: t("checkins.toast.resumedDesc") });
        invalidateAll();
      },
      onError: () => toast({ title: t("checkins.toast.error"), description: t("checkins.toast.resumeError"), variant: "destructive" }),
    });
  };

  const handleDuplicate = async (id: number) => {
    const baseUrl = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    const res = await fetch(`${baseUrl}api/checkins/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: t("checkins.toast.duplicated") }); invalidateAll(); }
    else toast({ title: t("checkins.toast.error"), description: t("checkins.toast.duplicateError"), variant: "destructive" });
  };

  const handleDelete = (id: number) => {
    deleteCheckin.mutate({ id }, {
      onSuccess: () => {
        toast({ title: t("checkins.toast.deleted") });
        invalidateAll();
      },
      onError: () => toast({ title: t("checkins.toast.error"), description: t("checkins.toast.deleteError"), variant: "destructive" }),
    });
  };

  const checkinsList = listData?.checkins ?? [];
  const toggleSelect = (id: number) => setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleAll = () => setSelectedIds(selectedIds.length === checkinsList.length ? [] : checkinsList.map((c: any) => c.id));
  const handleBulkStatus = async (status: string) => {
    if (!selectedIds.length) return;
    const baseUrl = import.meta.env.BASE_URL || "/";
    const res = await fetch(`${baseUrl}api/bulk/checkins/status`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds, status }) });
    if (res.ok) { toast({ title: t("checkins.toast.bulkUpdated", { count: selectedIds.length }) }); setSelectedIds([]); invalidateAll(); }
    else toast({ title: t("checkins.toast.error"), variant: "destructive" });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!(await confirmAction({ title: t("checkins.confirmBulkDelete", { count: selectedIds.length }), confirmLabel: t("common.delete"), destructive: true }))) return;
    const baseUrl = import.meta.env.BASE_URL || "/";
    const res = await fetch(`${baseUrl}api/bulk/checkins/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids: selectedIds }) });
    if (res.ok) { toast({ title: t("checkins.toast.bulkDeleted", { count: selectedIds.length }) }); setSelectedIds([]); invalidateAll(); }
    else toast({ title: t("checkins.toast.error"), variant: "destructive" });
  };

  const handleGoogleSync = async () => {
    setGoogleSync(p => ({ ...p, loading: true, result: null, error: null }));
    try {
      const baseUrl = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${baseUrl}api/checkins/sync-google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dateFrom: googleSync.dateFrom, dateTo: googleSync.dateTo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGoogleSync(p => ({ ...p, loading: false, error: data.error || t("checkins.sync.unknownError") }));
        return;
      }
      setGoogleSync(p => ({ ...p, loading: false, result: data }));
      if (data.imported > 0) {
        invalidateAll();
        toast({ title: t("checkins.sync.success"), description: data.message });
      }
    } catch (err: any) {
      setGoogleSync(p => ({ ...p, loading: false, error: err.message || t("checkins.sync.networkError") }));
    }
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
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Clock} variant="slate" size="md" /> {t("checkins.title")}</h1>
          <p className="text-muted-foreground">{t("checkins.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api/checkins/export/csv`} download>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />{t("checkins.csv")}</Button>
          </a>
          <Button variant="outline" size="sm" title={t("checkins.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => { setGoogleSync(p => ({ ...p, result: null, error: null })); setShowGoogleSyncDialog(true); }}>
            <CloudDownload className="w-4 h-4 mr-2" /> {t("checkins.syncGoogle")}
          </Button>
          {!currentSession ? (
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setShowNewDialog(true)}>
              <LogIn className="w-4 h-4 mr-2" /> {t("checkins.checkIn")}
            </Button>
          ) : (
            <>
              {activeSession && (
                <Button variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50" onClick={handlePause}>
                  <Pause className="w-4 h-4 mr-2" /> {t("checkins.pause")}
                </Button>
              )}
              {pausedSession && (
                <Button variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={handleResume}>
                  <Play className="w-4 h-4 mr-2" /> {t("checkins.resume")}
                </Button>
              )}
              <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={handleCheckOut}>
                <LogOut className="w-4 h-4 mr-2" /> {t("checkins.checkOut")}
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={receptionImg} alt={t("checkins.heroAlt")} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-900/80 via-slate-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">{t("checkins.heroTitle")}</h3>
              <p className="text-white/80 text-sm mt-1">{t("checkins.heroSubtitle")}</p>
            </div>
          </div>
        </div>
      </Card>

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
                    <span className="font-semibold text-lg">{t("checkins.currentSession")}</span>
                    <Badge className={STATUS_META[currentSession.status]?.color}>
                      <span className={`w-2 h-2 rounded-full mr-1.5 ${STATUS_META[currentSession.status]?.dotColor}`} />
                      {statusLabel(currentSession.status)}
                    </Badge>
                    {currentSession.type && (
                      <Badge variant="outline" className="gap-1">
                        {(() => { const T = TYPE_META[currentSession.type]; return T ? <T.icon className={`w-3 h-3 ${T.color}`} /> : null; })()}
                        {typeLabel(currentSession.type)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {t("checkins.arrivedAt", { time: formatTime(currentSession.checkInAt) })}
                    {currentSession.location && t("checkins.locationSuffix", { location: currentSession.location })}
                    {currentSession.breakMinutes > 0 && t("checkins.breakSuffix", { min: currentSession.breakMinutes })}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <LiveTimer startTime={currentSession.checkInAt} />
                <p className="text-xs text-muted-foreground mt-1">{t("checkins.elapsed")}</p>
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
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("checkins.stats.sessions")}</p>
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
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("checkins.stats.totalHours")}</p>
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
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("checkins.stats.avgSession")}</p>
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
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("checkins.stats.totalBreak")}</p>
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
                    <p className="text-sm font-medium">{t(meta.label)}</p>
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
          <TabsTrigger value="historique">{t("checkins.tabs.history")}</TabsTrigger>
          <TabsTrigger value="equipe">{t("checkins.tabs.team")}</TabsTrigger>
        </TabsList>

        <TabsContent value="historique" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("checkins.filters.allStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("checkins.filters.allStatuses")}</SelectItem>
                <SelectItem value="present">{t("checkins.status.present")}</SelectItem>
                <SelectItem value="en_pause">{t("checkins.status.en_pause")}</SelectItem>
                <SelectItem value="termine">{t("checkins.status.termine")}</SelectItem>
                <SelectItem value="absent">{t("checkins.status.absent")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t("checkins.filters.allTypes")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("checkins.filters.allTypes")}</SelectItem>
                <SelectItem value="bureau">{t("checkins.type.bureau")}</SelectItem>
                <SelectItem value="distance">{t("checkins.type.distance")}</SelectItem>
                <SelectItem value="terrain">{t("checkins.type.terrain")}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={invalidateAll}>
              <RefreshCw className="w-4 h-4 mr-1" /> {t("checkins.refresh")}
            </Button>
          </div>

          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg flex-wrap">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{t("checkins.selectedCount", { count: selectedIds.length })}</span>
              <Select onValueChange={handleBulkStatus}>
                <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder={t("checkins.changeStatus")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="present">{t("checkins.status.present")}</SelectItem>
                  <SelectItem value="en_pause">{t("checkins.status.en_pause")}</SelectItem>
                  <SelectItem value="termine">{t("checkins.status.termine")}</SelectItem>
                  <SelectItem value="absent">{t("checkins.status.absent")}</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="destructive" className="gap-1 h-7 text-xs" onClick={handleBulkDelete}><Trash2 className="w-3 h-3" />{t("checkins.deleteSelection")}</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds([])}>{t("common.cancel")}</Button>
            </div>
          )}

          <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-10"><Checkbox checked={checkinsList.length > 0 && selectedIds.length === checkinsList.length} onCheckedChange={toggleAll} /></TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("employeeName")}>
                    <span className="flex items-center">{t("checkins.columns.employee")}{getSortIcon("employeeName")}</span>
                  </TableHead>
                  <TableHead>{t("checkins.columns.type")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("checkInAt")}>
                    <span className="flex items-center">{t("checkins.columns.date")}{getSortIcon("checkInAt")}</span>
                  </TableHead>
                  <TableHead>{t("checkins.columns.checkIn")}</TableHead>
                  <TableHead>{t("checkins.columns.checkOut")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("totalMinutes")}>
                    <span className="flex items-center">{t("checkins.columns.duration")}{getSortIcon("totalMinutes")}</span>
                  </TableHead>
                  <TableHead>{t("checkins.columns.break")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                    <span className="flex items-center">{t("checkins.columns.status")}{getSortIcon("status")}</span>
                  </TableHead>
                  <TableHead className="text-right">{t("checkins.columns.actions")}</TableHead>
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
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                      <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">{t("checkins.emptyTitle")}</p>
                      <p className="text-sm">{t("checkins.emptyDesc")}</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  listData.checkins.map((checkin: any) => {
                    const typeMeta = TYPE_META[checkin.type] || TYPE_META.bureau;
                    const statusMeta = STATUS_META[checkin.status] || STATUS_META.termine;
                    return (
                      <TableRow key={checkin.id} className="group">
                        <TableCell><Checkbox checked={selectedIds.includes(checkin.id)} onCheckedChange={() => toggleSelect(checkin.id)} /></TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{checkin.employeeName}</div>
                          {checkin.employeeRole && <div className="text-xs text-muted-foreground">{checkin.employeeRole}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1">
                            <typeMeta.icon className={`w-3 h-3 ${typeMeta.color}`} />
                            {t(typeMeta.label)}
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
                            {t(statusMeta.label)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-label={t("common.moreActions")}>
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setSelectedCheckin(checkin); setShowDetailDialog(true); }}>
                                <Eye className="w-4 h-4 mr-2" /> {t("checkins.viewDetails")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicate(checkin.id)}>
                                <Copy className="w-4 h-4 mr-2" /> {t("checkins.duplicate")}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-indigo-600" onClick={async () => {
                                const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
                                const res = await fetch(`${BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: t("checkins.projectTitle", { name: checkin.employeeName }), status: "planifie", priority: "moyenne", progress: 0, notes: t("checkins.projectNotes", { name: checkin.employeeName }) }) });
                                if (res.ok) { toast({ title: t("checkins.toast.projectCreated") }); setLocation("/projets"); }
                                else toast({ title: t("checkins.toast.error"), variant: "destructive" });
                              }}><FolderKanban className="w-4 h-4 mr-2" />{t("checkins.createProject")}</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(checkin.id)}>
                                <Trash2 className="w-4 h-4 mr-2" /> {t("common.delete")}
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
                {t("checkins.pagination", { total: listData?.total ?? 0, page: page + 1, pages: totalPages })}
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(0)} aria-label={t("common.firstPage")}>
                  <ChevronsLeft className="w-4 h-4" aria-hidden="true" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label={t("common.previousPage")}>
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} aria-label={t("common.nextPage")}>
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} aria-label={t("common.lastPage")}>
                  <ChevronsRight className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="equipe" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("checkins.teamTitle")}</CardTitle>
              <CardDescription>{t("checkins.teamDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!currentData?.active?.length && !currentData?.paused?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">{t("checkins.noEmployeeTitle")}</p>
                  <p className="text-sm">{t("checkins.noEmployeeDesc")}</p>
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
                            {t("checkins.sinceTime", { type: typeLabel(c.type), time: formatTime(c.checkInAt) })}
                            {c.location && t("checkins.locationSuffix", { location: c.location })}
                          </p>
                        </div>
                      </div>
                      <Badge className={STATUS_META.present.color}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 animate-pulse ${STATUS_META.present.dotColor}`} />
                        {t("checkins.status.present")}
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
                            {t("checkins.pausedSinceTime", { type: typeLabel(c.type), time: formatTime(c.updatedAt) })}
                          </p>
                        </div>
                      </div>
                      <Badge className={STATUS_META.en_pause.color}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${STATUS_META.en_pause.dotColor}`} />
                        {t("checkins.status.en_pause")}
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
                <p className="text-sm text-emerald-600 mt-1">{t("checkins.presents")}</p>
              </CardContent>
            </Card>
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-amber-700">{currentData?.paused?.length ?? 0}</p>
                <p className="text-sm text-amber-600 mt-1">{t("checkins.status.en_pause")}</p>
              </CardContent>
            </Card>
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-blue-700">{(currentData?.active?.length ?? 0) + (currentData?.paused?.length ?? 0)}</p>
                <p className="text-sm text-blue-600 mt-1">{t("checkins.totalConnected")}</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <AiSuggestionsCard page="pointage" title={t("checkins.aiTitle")} compact />

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("checkins.newDialog.title")}</DialogTitle>
            <DialogDescription>{t("checkins.newDialog.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("checkins.newDialog.workType")}</Label>
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
                    <span className="text-xs font-medium">{t(meta.label)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="location">{t("checkins.newDialog.locationLabel")}</Label>
              <Input aria-label={t("checkins.newDialog.locationLabel")}
                id="location"
                placeholder={t("checkins.newDialog.locationPlaceholder")}
                value={newCheckin.location}
                onChange={e => setNewCheckin(p => ({ ...p, location: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="notes">{t("checkins.newDialog.notesLabel")}</Label>
              <Textarea aria-label={t("checkins.newDialog.notesLabel")}
                id="notes"
                placeholder={t("checkins.newDialog.notesPlaceholder")}
                value={newCheckin.notes}
                onChange={e => setNewCheckin(p => ({ ...p, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>{t("common.cancel")}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleCheckIn} disabled={createCheckin.isPending}>
              {createCheckin.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <LogIn className="w-4 h-4 mr-2" /> {t("checkins.newDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={(o) => { setShowDetailDialog(o); if (!o) setIsEditingCheckin(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("checkins.detail.title")}</DialogTitle>
          </DialogHeader>
          {selectedCheckin && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.employee")}</Label>
                  <p className="font-medium">{selectedCheckin.employeeName}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.role")}</Label>
                  <p>{selectedCheckin.employeeRole || "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.type")}</Label>
                  <p>{typeLabel(selectedCheckin.type)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.status")}</Label>
                  <Badge className={STATUS_META[selectedCheckin.status]?.color || ""}>
                    {statusLabel(selectedCheckin.status)}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.checkIn")}</Label>
                  <p>{t("checkins.detail.dateAtTime", { date: formatDate(selectedCheckin.checkInAt), time: formatTime(selectedCheckin.checkInAt) })}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.checkOut")}</Label>
                  <p>{selectedCheckin.checkOutAt ? t("checkins.detail.dateAtTime", { date: formatDate(selectedCheckin.checkOutAt), time: formatTime(selectedCheckin.checkOutAt) }) : "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.totalDuration")}</Label>
                  <p className="font-medium">{formatDuration(selectedCheckin.totalMinutes)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.break")}</Label>
                  <p>{selectedCheckin.breakMinutes > 0 ? `${selectedCheckin.breakMinutes} min` : "-"}</p>
                </div>
              </div>
              {selectedCheckin.location && (
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.location")}</Label>
                  <p className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {selectedCheckin.location}</p>
                </div>
              )}
              {selectedCheckin.notes && (
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.notes")}</Label>
                  <p className="text-sm">{selectedCheckin.notes}</p>
                </div>
              )}
              {selectedCheckin.ipAddress && (
                <div>
                  <Label className="text-xs text-muted-foreground">{t("checkins.detail.ipAddress")}</Label>
                  <p className="text-xs font-mono text-muted-foreground">{selectedCheckin.ipAddress}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {!isEditingCheckin ? (
              <>
                <Button variant="outline" onClick={() => setShowDetailDialog(false)}>{t("common.close")}</Button>
                <Button variant="outline" onClick={() => { setEditCheckinNotes(selectedCheckin?.notes || ""); setEditCheckinLocation(selectedCheckin?.location || ""); setIsEditingCheckin(true); }}>
                  {t("common.edit")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setIsEditingCheckin(false)}>{t("common.cancel")}</Button>
                <Button onClick={async () => {
                  try {
                    await updateCheckin.mutateAsync({ id: selectedCheckin.id, data: { notes: editCheckinNotes, location: editCheckinLocation } });
                    setSelectedCheckin((c: any) => ({ ...c, notes: editCheckinNotes, location: editCheckinLocation }));
                    setIsEditingCheckin(false);
                    toast({ title: t("checkins.toast.updated") });
                  } catch {
                    toast({ title: t("checkins.toast.error"), description: t("checkins.toast.updateError"), variant: "destructive" });
                  }
                }} disabled={updateCheckin.isPending}>
                  {updateCheckin.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
                </Button>
              </>
            )}
          </DialogFooter>
          {isEditingCheckin && selectedCheckin && (
            <div className="space-y-3 border-t pt-3">
              <div>
                <Label className="text-xs text-muted-foreground">{t("checkins.detail.location")}</Label>
                <Input aria-label={t("checkins.detail.location")} value={editCheckinLocation} onChange={e => setEditCheckinLocation(e.target.value)} placeholder={t("checkins.detail.locationPlaceholder")} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t("checkins.detail.notes")}</Label>
                <Textarea aria-label={t("checkins.detail.notes")} value={editCheckinNotes} onChange={e => setEditCheckinNotes(e.target.value)} placeholder={t("checkins.detail.notesPlaceholder")} className="mt-1 min-h-[80px]" />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showGoogleSyncDialog} onOpenChange={setShowGoogleSyncDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CloudDownload className="w-5 h-5 text-blue-600" />
              {t("checkins.sync.title")}
            </DialogTitle>
            <DialogDescription>
              {t("checkins.sync.desc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sync-from">{t("checkins.sync.dateFrom")}</Label>
                <Input aria-label={t("checkins.sync.dateFrom")}
                  id="sync-from"
                  type="date"
                  value={googleSync.dateFrom}
                  onChange={e => setGoogleSync(p => ({ ...p, dateFrom: e.target.value }))}
                  max={googleSync.dateTo}
                />
              </div>
              <div>
                <Label htmlFor="sync-to">{t("checkins.sync.dateTo")}</Label>
                <Input aria-label={t("checkins.sync.dateTo")}
                  id="sync-to"
                  type="date"
                  value={googleSync.dateTo}
                  onChange={e => setGoogleSync(p => ({ ...p, dateTo: e.target.value }))}
                  min={googleSync.dateFrom}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                <strong>{t("checkins.sync.howLabel")}</strong> {t("checkins.sync.howText")}
              </p>
            </div>

            {googleSync.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{googleSync.error}</p>
              </div>
            )}

            {googleSync.result && (
              <div className="space-y-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-emerald-800">
                    <p className="font-medium">{googleSync.result.message}</p>
                    <div className="flex gap-4 mt-1 text-xs">
                      <span>{t("checkins.sync.imported", { count: googleSync.result.imported })}</span>
                      <span>{t("checkins.sync.skipped", { count: googleSync.result.skipped })}</span>
                      {googleSync.result.errors > 0 && <span className="text-red-600">{t("checkins.sync.errors", { count: googleSync.result.errors })}</span>}
                    </div>
                  </div>
                </div>

                {googleSync.result.details.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1 bg-muted/50 rounded-lg p-3">
                    {googleSync.result.details.map((d, i) => (
                      <p key={i} className="text-xs text-muted-foreground font-mono">{d}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGoogleSyncDialog(false)}>
              {googleSync.result ? t("common.close") : t("common.cancel")}
            </Button>
            {!googleSync.result && (
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleGoogleSync}
                disabled={googleSync.loading || !googleSync.dateFrom || !googleSync.dateTo}
              >
                {googleSync.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("checkins.sync.syncing")}</>
                ) : (
                  <><CloudDownload className="w-4 h-4 mr-2" /> {t("checkins.sync.sync")}</>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
