import taskManagementImg from "@/assets/images/task-management.webp";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { AiValidationFeedback } from "@/components/ai-validation-feedback";
import { EmptyOnboardingHint } from "@/components/empty-onboarding-hint";
import { GhostTextarea } from "@/components/ghost-textarea";
import { Icon3D } from "@/components/icon-3d";
import { QueryErrorAlert } from "@/components/safe-component";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuSeparator,DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form,FormControl,FormField,FormItem,FormLabel,FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from "@/components/ui/table";
import { useAiValidation } from "@/hooks/use-ai-validation";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { getListTasksQueryKey,useCreateTask,useDeleteTask,useGetTask,useListContacts,useListTasks,useUpdateTask } from "@workspace/api-client-react";
import { format,isPast,isToday } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertCircle,AlertTriangle,ArrowDown,ArrowUp,ArrowUpDown,Calendar,CheckCheck,CheckSquare,ChevronLeft,ChevronRight,ChevronsLeft,ChevronsRight,Clock,Columns3,Copy,Download,Edit,Filter,FolderKanban,LayoutList,MoreHorizontal,Plus,Printer,Repeat,Search,Trash2,UserCheck,Users } from "lucide-react";
import { useEffect,useMemo,useRef,useState } from "react";
import { useForm } from "react-hook-form";
import { Link,useLocation } from "wouter";
import * as z from "zod";

const PAGE_SIZE = 20;

const formSchema = z.object({
  title: z.string().min(1, "Le titre est requis"),
  description: z.string().optional().nullable(),
  status: z.enum(["en_attente", "en_cours", "termine", "annule"]),
  priority: z.enum(["haute", "moyenne", "basse"]),
  dueDate: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  relatedContactId: z.string().transform(v => v === "none" ? null : parseInt(v)).optional().nullable(),
  isRecurring: z.boolean().optional().default(false),
  recurrenceRule: z.string().optional().nullable(),
  recurrenceEndDate: z.string().optional().nullable(),
});

const KANBAN_COLUMNS = [
  { key: "en_attente", label: "En attente", color: "bg-amber-500" },
  { key: "en_cours", label: "En cours", color: "bg-blue-500" },
  { key: "termine", label: "Termine", color: "bg-emerald-500" },
  { key: "annule", label: "Annule", color: "bg-gray-400" },
] as const;

export default function Tasks() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<string>("desc");
  const [page, setPage] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deepLinkTaskId, setDeepLinkTaskId] = useState<number | null>(null);

  // Tâche #68: efface le badge "Tâches" dans la sidebar dès que l'utilisateur ouvre la page.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("task-badge-clear"));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cId = params.get("contactId");
    const tId = params.get("id");
    if (cId) {
      form.setValue("relatedContactId", cId as any);
      setIsDialogOpen(true);
    }
    if (tId && !isNaN(parseInt(tId))) {
      setDeepLinkTaskId(parseInt(tId));
    }
    if (cId || tId) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: deepLinkTask } = useGetTask(deepLinkTaskId as number, {
    query: { enabled: deepLinkTaskId !== null, queryKey: ["task-deeplink", deepLinkTaskId] },
  });

  useEffect(() => {
    if (deepLinkTask && deepLinkTaskId !== null) {
      handleOpenEdit(deepLinkTask);
      setDeepLinkTaskId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkTask]);

  const queryParams = {
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    priority: priorityFilter !== "all" ? priorityFilter as any : undefined,
    search: search || undefined,
    sortBy: sortBy as any,
    sortOrder: sortOrder as any,
    limit: viewMode === "kanban" ? 200 : PAGE_SIZE,
    offset: viewMode === "kanban" ? 0 : page * PAGE_SIZE,
  };

  const { data, isLoading, error: tasksError } = useListTasks(queryParams, {
    query: { queryKey: getListTasksQueryKey(queryParams) }
  });

  const { data: contactsData } = useListContacts({ limit: 100 }, { query: { queryKey: ["contacts", "all"] } });

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const aiValidation = useAiValidation("task");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "", description: "", status: "en_attente", priority: "moyenne",
      dueDate: "", assignedTo: "", relatedContactId: null as any,
      isRecurring: false, recurrenceRule: "", recurrenceEndDate: "",
    }
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const kanbanData = useMemo(() => {
    if (!data?.tasks) return {};
    const grouped: Record<string, any[]> = { en_attente: [], en_cours: [], termine: [], annule: [] };
    data.tasks.forEach(t => {
      if (grouped[t.status]) grouped[t.status].push(t);
    });
    return grouped;
  }, [data?.tasks]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
    setPage(0);
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortOrder === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const handleOpenEdit = (task: any) => {
    setEditingTask(task);
    form.reset({
      title: task.title, description: task.description || "",
      status: task.status, priority: task.priority,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : "",
      assignedTo: task.assignedTo || "",
      relatedContactId: task.relatedContactId?.toString() || "none" as any,
      isRecurring: task.isRecurring || false,
      recurrenceRule: task.recurrenceRule || "",
      recurrenceEndDate: task.recurrenceEndDate ? new Date(task.recurrenceEndDate).toISOString().split('T')[0] : "",
    });
    setIsDialogOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingTask(null);
    form.reset({
      title: "", description: "", status: "en_attente", priority: "moyenne",
      dueDate: "", assignedTo: "", relatedContactId: null as any,
      isRecurring: false, recurrenceRule: "", recurrenceEndDate: "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (values: any) => {
    if (values.dueDate === "") values.dueDate = null;
    else if (values.dueDate) values.dueDate = new Date(values.dueDate).toISOString();

    if (editingTask) {
      updateTask.mutate({ id: editingTask.id, data: values }, {
        onSuccess: () => {
          toast({ title: t("tasks.toast.updated") });
          setIsDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: t("tasks.toast.error"), description: t("tasks.toast.updateError"), variant: "destructive" })
      });
    } else {
      createTask.mutate({ data: values }, {
        onSuccess: () => {
          toast({ title: t("tasks.toast.created") });
          setIsDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: t("tasks.toast.error"), description: t("tasks.toast.createError"), variant: "destructive" })
      });
    }
  };

  const handleStatusChange = (id: number, status: any) => {
    updateTask.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast({ title: t("tasks.toast.statusUpdated") });
      },
      onError: () => toast({ title: t("tasks.toast.error"), description: t("tasks.toast.statusError"), variant: "destructive" }),
    });
  };

  const handleDuplicate = async (id: number) => {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    try {
      const res = await fetch(`${BASE}/api/tasks/${id}/duplicate`, { method: "POST", credentials: "include" });
      if (res.ok) {
        toast({ title: t("tasks.toast.duplicated") });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: t("tasks.toast.error"), description: d.error, variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] duplicate failed:", err);
      toast({ title: t("tasks.toast.networkError"), description: t("tasks.toast.duplicateFailed"), variant: "destructive" });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirmAction({ title: t("tasks.confirm.bulkDelete", { count: selectedIds.size }), confirmLabel: t("common.delete"), destructive: true }))) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    try {
      const res = await fetch(`${BASE}/api/bulk/tasks/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      if (res.ok) {
        toast({ title: t("tasks.toast.bulkDeleted", { count: ids.length }) });
      } else {
        toast({ title: t("tasks.toast.bulkDeleteError"), variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] bulk delete failed:", err);
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      toast({ title: t("tasks.toast.networkError"), description: t("tasks.toast.deleteFailed"), variant: "destructive" });
    }
  };

  const handleBulkComplete = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    try {
      const res = await fetch(`${BASE}/api/bulk/tasks/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      if (res.ok) {
        toast({ title: t("tasks.toast.bulkCompleted", { count: ids.length }) });
      } else {
        toast({ title: t("tasks.toast.error"), variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] bulk complete failed:", err);
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      toast({ title: t("tasks.toast.networkError"), description: t("tasks.toast.updateFailed"), variant: "destructive" });
    }
  };

  const handleBulkPriority = async (priority: string) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    try {
      const res = await fetch(`${BASE}/api/bulk/tasks/priority`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids, priority }) });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      if (res.ok) {
        toast({ title: t("tasks.toast.bulkPriority", { count: ids.length, priority }) });
      } else {
        toast({ title: t("tasks.toast.error"), variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] bulk priority failed:", err);
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      toast({ title: t("tasks.toast.networkError"), description: t("tasks.toast.updateFailed"), variant: "destructive" });
    }
  };

  const [bulkAssignName, setBulkAssignName] = useState("");
  const [showAssignInput, setShowAssignInput] = useState(false);
  const assignInputRef = useRef<HTMLInputElement>(null);

  const handleBulkStatus = async (status: string) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    try {
      const res = await fetch(`${BASE}/api/bulk/tasks/status`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids, status }) });
      if (res.ok) { toast({ title: t("tasks.toast.bulkStatus", { count: ids.length }) }); setSelectedIds(new Set()); queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }); }
      else toast({ title: t("tasks.toast.error"), variant: "destructive" });
    } catch (err) {
      console.error("[tasks] bulk status failed:", err);
      toast({ title: t("tasks.toast.networkError"), description: t("tasks.toast.updateFailed"), variant: "destructive" });
    }
  };

  const handleBulkAssign = async () => {
    if (selectedIds.size === 0 || !bulkAssignName.trim()) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    try {
      const res = await fetch(`${BASE}/api/bulk/tasks/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids, assignedTo: bulkAssignName.trim() }) });
      setBulkAssignName("");
      setShowAssignInput(false);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      if (res.ok) {
        toast({ title: t("tasks.toast.bulkAssigned", { count: ids.length, name: bulkAssignName.trim() }) });
      } else {
        toast({ title: t("tasks.toast.error"), variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] bulk assign failed:", err);
      setBulkAssignName("");
      setShowAssignInput(false);
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      toast({ title: t("tasks.toast.networkError"), description: t("tasks.toast.assignFailed"), variant: "destructive" });
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'en_attente': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Clock className="w-3 h-3 mr-1" /> {t("tasks.status.en_attente")}</Badge>;
      case 'en_cours': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><AlertCircle className="w-3 h-3 mr-1" /> {t("tasks.status.en_cours")}</Badge>;
      case 'termine': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><CheckSquare className="w-3 h-3 mr-1" /> {t("tasks.status.termine")}</Badge>;
      case 'annule': return <Badge variant="secondary" className="bg-muted text-muted-foreground border-muted-foreground/20">{t("tasks.status.annule")}</Badge>;
      default: return <Badge variant="outline" className="capitalize">{status.replace('_', ' ')}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'haute': return <Badge variant="destructive" className="bg-destructive text-destructive-foreground">{t("tasks.priority.haute")}</Badge>;
      case 'moyenne': return <Badge variant="secondary" className="bg-amber-500/20 text-amber-700">{t("tasks.priority.moyenne")}</Badge>;
      case 'basse': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-700">{t("tasks.priority.basse")}</Badge>;
      default: return <Badge variant="outline" className="capitalize">{priority}</Badge>;
    }
  };

  const getPriorityDot = (priority: string) => {
    switch (priority) {
      case 'haute': return <div className="w-2 h-2 rounded-full bg-destructive" />;
      case 'moyenne': return <div className="w-2 h-2 rounded-full bg-amber-500" />;
      case 'basse': return <div className="w-2 h-2 rounded-full bg-blue-500" />;
      default: return <div className="w-2 h-2 rounded-full bg-muted-foreground" />;
    }
  };

  const getDueDateDisplay = (dueDate?: string | null, status?: string) => {
    if (!dueDate) return null;
    const date = new Date(dueDate);
    const overdue = isPast(date) && !isToday(date) && status !== 'termine' && status !== 'annule';
    const today = isToday(date);
    return (
      <div className={`flex items-center text-xs gap-1 ${overdue ? 'text-destructive font-medium' : today ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
        {overdue && <AlertTriangle className="w-3 h-3" />}
        <Calendar className="w-3 h-3" />
        {format(date, "d MMM", { locale: fr })}
      </div>
    );
  };

  const getContactName = (contactId?: number | null) => {
    if (!contactId || !contactsData) return null;
    const contact = contactsData.contacts.find(c => c.id === contactId);
    return contact ? `${contact.firstName} ${contact.lastName}` : null;
  };

  const taskDialog = (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{editingTask ? t("tasks.dialog.editTitle") : t("tasks.dialog.createTitle")}</DialogTitle>
          <DialogDescription>{t("tasks.dialog.desc")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem><FormLabel>{t("tasks.form.title")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>{t("tasks.form.description")}</FormLabel><FormControl><GhostTextarea className="resize-none" {...field} value={field.value || ""} fieldType="task_description" context={{ title: form.getValues("title") || null }} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("tasks.form.status")}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="en_attente">{t("tasks.status.en_attente")}</SelectItem>
                      <SelectItem value="en_cours">{t("tasks.status.en_cours")}</SelectItem>
                      <SelectItem value="termine">{t("tasks.status.termine")}</SelectItem>
                      <SelectItem value="annule">{t("tasks.status.annule")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="priority" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("tasks.form.priority")}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="haute">{t("tasks.priority.haute")}</SelectItem>
                      <SelectItem value="moyenne">{t("tasks.priority.moyenne")}</SelectItem>
                      <SelectItem value="basse">{t("tasks.priority.basse")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="dueDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("tasks.form.dueDate")}</FormLabel>
                  <FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="assignedTo" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("tasks.form.assignedTo")}</FormLabel>
                  <FormControl><Input placeholder={t("tasks.form.assignedToPlaceholder")} {...field} value={field.value || ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="relatedContactId" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("tasks.form.relatedContact")}</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                  <FormControl><SelectTrigger><SelectValue placeholder={t("tasks.form.chooseContact")}/></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">{t("tasks.form.none")}</SelectItem>
                    {contactsData?.contacts.map(c => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.firstName} {c.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="isRecurring" render={({ field }) => (
              <FormItem className="flex items-center gap-3 rounded-lg border border-border p-3">
                <Checkbox checked={!!field.value} onCheckedChange={field.onChange} id="recurring-check" />
                <div>
                  <FormLabel htmlFor="recurring-check" className="flex items-center gap-2 cursor-pointer mb-0">
                    <Repeat className="w-3.5 h-3.5 text-muted-foreground" />{t("tasks.form.recurring")}
                  </FormLabel>
                  <p className="text-xs text-muted-foreground">{t("tasks.form.recurringHint")}</p>
                </div>
              </FormItem>
            )} />
            {form.watch("isRecurring") && (
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="recurrenceRule" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("tasks.form.frequency")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t("tasks.form.choose")} /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="quotidien">{t("tasks.frequency.quotidien")}</SelectItem>
                        <SelectItem value="hebdomadaire">{t("tasks.frequency.hebdomadaire")}</SelectItem>
                        <SelectItem value="bihebdomadaire">{t("tasks.frequency.bihebdomadaire")}</SelectItem>
                        <SelectItem value="mensuel">{t("tasks.frequency.mensuel")}</SelectItem>
                        <SelectItem value="trimestriel">{t("tasks.frequency.trimestriel")}</SelectItem>
                        <SelectItem value="annuel">{t("tasks.frequency.annuel")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="recurrenceEndDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("tasks.form.recurrenceEnd")}</FormLabel>
                    <FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            )}
            <AiValidationFeedback result={aiValidation.result} isValidating={aiValidation.isValidating} />
            {editingTask && (editingTask.createdByName || editingTask.updatedByName) && (
              <div className="space-y-1 text-xs text-muted-foreground border-t border-border pt-3">
                {editingTask.createdByName && (
                  <div>{t("tasks.meta.createdBy")} <span className="font-medium text-foreground">{editingTask.createdByName}</span> {editingTask.createdAt && <>— {format(new Date(editingTask.createdAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</>}</div>
                )}
                {editingTask.updatedByName && editingTask.updatedAt && (
                  <div>{t("tasks.meta.updatedBy")} <span className="font-medium text-foreground">{editingTask.updatedByName}</span> — {format(new Date(editingTask.updatedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => aiValidation.validate(form.getValues())} disabled={aiValidation.isValidating} className="mr-auto">{t("tasks.verifyAi")}</Button>
              <Button type="submit" disabled={updateTask.isPending || createTask.isPending}>{editingTask ? t("tasks.dialog.update") : t("tasks.dialog.create")}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      {taskDialog}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={CheckSquare} variant="emerald" size="md" /> {t("tasks.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("tasks.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleBulkComplete}>
                <CheckCheck className="w-4 h-4 mr-2" />
                {t("tasks.completeBtn", { count: selectedIds.size })}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="w-4 h-4 mr-2" />
                    {t("tasks.priorityBtn", { count: selectedIds.size })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("tasks.changePriority")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {[{val:"haute",label:t("tasks.priorityEmoji.haute")},{val:"moyenne",label:t("tasks.priorityEmoji.moyenne")},{val:"basse",label:t("tasks.priorityEmoji.basse")}].map(p => (
                    <DropdownMenuItem key={p.val} onClick={() => handleBulkPriority(p.val)} className="cursor-pointer">{p.label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {showAssignInput ? (
                <div className="flex items-center gap-1">
                  <Input
                    ref={assignInputRef}
                    value={bulkAssignName}
                    onChange={e => setBulkAssignName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleBulkAssign(); if (e.key === "Escape") { setShowAssignInput(false); setBulkAssignName(""); } }}
                    placeholder={t("tasks.assignPlaceholder")}
                    className="h-8 w-36 text-sm"
                    autoFocus
                  />
                  <Button size="sm" className="h-8" onClick={handleBulkAssign} disabled={!bulkAssignName.trim()} aria-label={t("common.assign")}>
                    <UserCheck className="w-3 h-3" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => { setShowAssignInput(true); setTimeout(() => assignInputRef.current?.focus(), 50); }}>
                  <UserCheck className="w-4 h-4 mr-2" />
                  {t("tasks.assignBtn", { count: selectedIds.size })}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ArrowUpDown className="w-4 h-4 mr-2" />
                    {t("tasks.statusBtn", { count: selectedIds.size })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("tasks.changeStatus")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleBulkStatus("en_attente")}>{t("tasks.statusBulk.todo")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatus("en_cours")}>{t("tasks.statusBulk.en_cours")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatus("termine")}>{t("tasks.statusBulk.termine")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatus("annule")}>{t("tasks.statusBulk.annule")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                {t("tasks.deleteBtn", { count: selectedIds.size })}
              </Button>
            </>
          )}
          <a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api/tasks/export/csv`} download>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />CSV</Button>
          </a>
          <Button variant="outline" size="sm" title={t("tasks.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button onClick={handleOpenCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            {t("tasks.newTask")}
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={taskManagementImg} alt={t("tasks.bannerAlt")} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/80 via-emerald-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">{t("tasks.bannerTitle")}</h3>
              <p className="text-white/80 text-sm mt-1">{t("tasks.bannerSubtitle")}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t("tasks.searchPlaceholder")} className="pl-9 w-full" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder={t("tasks.filters.status")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tasks.filters.allStatuses")}</SelectItem>
              <SelectItem value="en_attente">{t("tasks.status.en_attente")}</SelectItem>
              <SelectItem value="en_cours">{t("tasks.status.en_cours")}</SelectItem>
              <SelectItem value="termine">{t("tasks.status.termine")}</SelectItem>
              <SelectItem value="annule">{t("tasks.status.annule")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder={t("tasks.filters.priority")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tasks.filters.allPriorities")}</SelectItem>
              <SelectItem value="haute">{t("tasks.priority.haute")}</SelectItem>
              <SelectItem value="moyenne">{t("tasks.priority.moyenne")}</SelectItem>
              <SelectItem value="basse">{t("tasks.priority.basse")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex border border-border rounded-md overflow-hidden">
            <Button variant={viewMode === "table" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-none" onClick={() => setViewMode("table")}>
              <LayoutList className="w-4 h-4" />
            </Button>
            <Button variant={viewMode === "kanban" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-none" onClick={() => setViewMode("kanban")}>
              <Columns3 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {tasksError && <QueryErrorAlert error={tasksError as Error} title={t("tasks.loadError")} />}

      {viewMode === "kanban" ? (
        <div className="space-y-4">
        <AiSuggestionsCard page="tasks" title={t("tasks.aiTitle")} compact />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {KANBAN_COLUMNS.map(col => (
            <div key={col.key} className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <div className={`w-3 h-3 rounded-full ${col.color}`} />
                <h3 className="font-semibold text-sm">{t(`tasks.status.${col.key}`)}</h3>
                <Badge variant="outline" className="ml-auto text-xs">{kanbanData[col.key]?.length || 0}</Badge>
              </div>
              <div className="space-y-2 min-h-[200px] bg-muted/30 rounded-lg p-2">
                {isLoading ? (
                  Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
                ) : (
                  kanbanData[col.key]?.map((task: any) => {
                    const contactName = getContactName(task.relatedContactId);
                    return (
                      <Card key={task.id} className="cursor-pointer hover:shadow-md transition-all" onClick={() => handleOpenEdit(task)}>
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              {getPriorityDot(task.priority)}
                              <span className={`text-sm font-medium ${task.status === 'termine' ? 'line-through text-muted-foreground' : ''}`}>
                                {task.title}
                              </span>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" className="h-6 w-6 p-0" aria-label={t("common.moreActions")}><MoreHorizontal className="h-3 w-3" aria-hidden="true" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {KANBAN_COLUMNS.filter(c => c.key !== task.status).map(c => (
                                  <DropdownMenuItem key={c.key} onClick={(e) => { e.stopPropagation(); handleStatusChange(task.id, c.key); }}>
                                    {t(`tasks.status.${c.key}`)}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          {task.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            {getDueDateDisplay(task.dueDate, task.status)}
                            <div className="flex items-center gap-1">
                              {(task as any).isRecurring && <span title={(task as any).recurrenceRule || t("tasks.kanban.recurring")}><Repeat className="w-3 h-3 text-blue-500" /></span>}
                              {task.assignedTo && (
                                <span className="text-xs text-muted-foreground truncate max-w-[80px]">{task.assignedTo}</span>
                              )}
                            </div>
                          </div>
                          {contactName && (
                            <div className="text-xs text-primary flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <Users className="w-3 h-3" />
                              <Link href={`/contacts/${task.relatedContactId}`} className="hover:underline">{contactName}</Link>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
        </div>
      ) : (
        <>
          <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={data?.tasks?.length ? selectedIds.size === data.tasks.length : false}
                      onCheckedChange={() => {
                        if (!data?.tasks) return;
                        setSelectedIds(selectedIds.size === data.tasks.length ? new Set() : new Set(data.tasks.map(t => t.id)));
                      }}
                    />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("title")}>
                    <span className="flex items-center">{t("tasks.columns.task")}{getSortIcon("title")}</span>
                  </TableHead>
                  <TableHead>{t("tasks.columns.assignedTo")}</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("dueDate")}>
                    <span className="flex items-center">{t("tasks.columns.dueDate")}{getSortIcon("dueDate")}</span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                    <span className="flex items-center">{t("tasks.columns.status")}{getSortIcon("status")}</span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("priority")}>
                    <span className="flex items-center">{t("tasks.columns.priority")}{getSortIcon("priority")}</span>
                  </TableHead>
                  <TableHead className="text-right">{t("tasks.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="w-4 h-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48 mb-1" /><Skeleton className="h-3 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : data?.tasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8">
                      {(search !== "" || statusFilter !== "all" || priorityFilter !== "all") ? (
                        <p className="text-center text-muted-foreground" data-testid="no-results-tasks">{t("tasks.empty.filtered")}</p>
                      ) : (
                        <EmptyOnboardingHint
                          icon={CheckSquare}
                          title={t("tasks.empty.title")}
                          description={t("tasks.empty.description")}
                          actionLabel={t("tasks.empty.action")}
                          onAction={handleOpenCreate}
                          tip={t("tasks.empty.tip")}
                          testIdPrefix="empty-tasks"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.tasks.map((task) => {
                    const contactName = getContactName(task.relatedContactId);
                    return (
                      <TableRow key={task.id} className={`hover:bg-muted/30 transition-colors ${selectedIds.has(task.id) ? 'bg-primary/5' : ''}`}>
                        <TableCell>
                          <Checkbox checked={selectedIds.has(task.id)} onCheckedChange={() => toggleSelect(task.id)} />
                        </TableCell>
                        <TableCell>
                          <div className={`font-medium flex items-center gap-2 ${task.status === 'termine' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                            {task.title}
                            {(task as any).isRecurring && <Repeat className="w-3 h-3 text-blue-500 shrink-0" aria-label={(task as any).recurrenceRule || t("tasks.kanban.recurring")} />}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                            {task.description && <span className="max-w-xs truncate">{task.description}</span>}
                            {contactName && (
                              <Link href={`/contacts/${task.relatedContactId}`} className="flex items-center gap-1 text-primary hover:underline">
                                <Users className="w-3 h-3" /> {contactName}
                              </Link>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{task.assignedTo || t("tasks.notAssigned")}</span>
                        </TableCell>
                        <TableCell>
                          {getDueDateDisplay(task.dueDate, task.status) || (
                            <span className="text-sm text-muted-foreground">{t("tasks.noDueDate")}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger className="outline-none">
                              {getStatusBadge(task.status)}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'en_attente')}>{t("tasks.status.en_attente")}</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'en_cours')}>{t("tasks.status.en_cours")}</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'termine')}>{t("tasks.status.termine")}</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'annule')}>{t("tasks.status.annule")}</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell>
                          {getPriorityBadge(task.priority)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0" aria-label={t("common.moreActions")}>
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>{t("tasks.columns.actions")}</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => handleOpenEdit(task)}>
                                <Edit className="w-4 h-4 mr-2" /> {t("tasks.rowActions.edit")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicate(task.id)}>
                                <Copy className="w-4 h-4 mr-2" /> {t("tasks.rowActions.duplicate")}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-indigo-600" onClick={async () => {
                                const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
                                const res = await fetch(`${BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: task.title, status: "planifie", priority: task.priority || "moyenne", progress: 0, notes: t("tasks.projectNotes", { id: task.id }) }) });
                                if (res.ok) { toast({ title: t("tasks.toast.projectCreated") }); setLocation("/projets"); }
                                else toast({ title: t("tasks.toast.error"), variant: "destructive" });
                              }}><FolderKanban className="w-4 h-4 mr-2" />{t("tasks.rowActions.createProject")}</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {task.status !== 'termine' && (
                                <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'termine')}>
                                  <CheckSquare className="w-4 h-4 mr-2" /> {t("tasks.rowActions.markDone")}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={async () => {
                                if (!(await confirmAction({ title: t("tasks.confirm.deleteOne"), confirmLabel: t("common.delete"), destructive: true }))) return;
                                deleteTask.mutate({ id: task.id }, {
                                  onSuccess: () => { toast({ title: t("tasks.toast.deleted") }); queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }); },
                                  onError: () => toast({ title: t("tasks.toast.error"), description: t("tasks.toast.deleteError"), variant: "destructive" }),
                                });
                              }}><Trash2 className="w-4 h-4 mr-2" />{t("tasks.rowActions.delete")}</DropdownMenuItem>
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

          <AiSuggestionsCard page="tasks" title={t("tasks.aiTitle")} compact />

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {data ? t("tasks.pagination", { total: data.total, page: page + 1, pages: totalPages }) : ""}
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(0)}><ChevronsLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}><ChevronsRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
