import { useState, useMemo, useEffect, useRef } from "react";
import { confirmAction } from "@/hooks/use-confirm";
import { useListTasks, useCreateTask, useUpdateTask, useDeleteTask, getListTasksQueryKey, useListContacts, useGetTask } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, isPast, isToday } from "date-fns";
import { fr } from "date-fns/locale";
import { CheckSquare, Search, Filter, MoreHorizontal, Plus, Calendar, Clock, AlertCircle, Edit, Users, LayoutList, Columns3, ArrowUpDown, ArrowUp, ArrowDown, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, AlertTriangle, GripVertical, Repeat, Download, Copy, Printer, CheckCheck, UserCheck, FolderKanban } from "lucide-react";
import { EmptyOnboardingHint } from "@/components/empty-onboarding-hint";
import { Icon3D } from "@/components/icon-3d";
import taskManagementImg from "@/assets/images/task-management.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { GhostTextarea } from "@/components/ghost-textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { AiValidationFeedback } from "@/components/ai-validation-feedback";
import { useAiValidation } from "@/hooks/use-ai-validation";
import { QueryErrorAlert } from "@/components/safe-component";
import { Link, useLocation } from "wouter";

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
          toast({ title: "Tache mise a jour" });
          setIsDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de modifier la tache", variant: "destructive" })
      });
    } else {
      createTask.mutate({ data: values }, {
        onSuccess: () => {
          toast({ title: "Tache creee" });
          setIsDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de creer la tache", variant: "destructive" })
      });
    }
  };

  const handleStatusChange = (id: number, status: any) => {
    updateTask.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast({ title: "Statut mis à jour" });
      },
      onError: () => toast({ title: "Erreur", description: "Impossible de changer le statut", variant: "destructive" }),
    });
  };

  const handleDuplicate = async (id: number) => {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    try {
      const res = await fetch(`${BASE}/api/tasks/${id}/duplicate`, { method: "POST", credentials: "include" });
      if (res.ok) {
        toast({ title: "Tâche dupliquée" });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      } else {
        const d = await res.json().catch(() => ({}));
        toast({ title: "Erreur", description: d.error, variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] duplicate failed:", err);
      toast({ title: "Erreur réseau", description: "Impossible de dupliquer la tâche.", variant: "destructive" });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirmAction({ title: `Supprimer ${selectedIds.size} tâche(s) ?`, confirmLabel: "Supprimer", destructive: true }))) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    try {
      const res = await fetch(`${BASE}/api/bulk/tasks/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      if (res.ok) {
        toast({ title: `${ids.length} tâche(s) supprimée(s)` });
      } else {
        toast({ title: "Erreur lors de la suppression", variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] bulk delete failed:", err);
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      toast({ title: "Erreur réseau", description: "La suppression a échoué.", variant: "destructive" });
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
        toast({ title: `${ids.length} tâche(s) marquée(s) terminée(s)` });
      } else {
        toast({ title: "Erreur", variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] bulk complete failed:", err);
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      toast({ title: "Erreur réseau", description: "La mise à jour a échoué.", variant: "destructive" });
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
        toast({ title: `${ids.length} tâche(s) → priorité ${priority}` });
      } else {
        toast({ title: "Erreur", variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] bulk priority failed:", err);
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      toast({ title: "Erreur réseau", description: "La mise à jour a échoué.", variant: "destructive" });
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
      if (res.ok) { toast({ title: `${ids.length} tâche(s) mise(s) à jour` }); setSelectedIds(new Set()); queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }); }
      else toast({ title: "Erreur", variant: "destructive" });
    } catch (err) {
      console.error("[tasks] bulk status failed:", err);
      toast({ title: "Erreur réseau", description: "La mise à jour a échoué.", variant: "destructive" });
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
        toast({ title: `${ids.length} tâche(s) assignée(s) à ${bulkAssignName.trim()}` });
      } else {
        toast({ title: "Erreur", variant: "destructive" });
      }
    } catch (err) {
      console.error("[tasks] bulk assign failed:", err);
      setBulkAssignName("");
      setShowAssignInput(false);
      queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
      toast({ title: "Erreur réseau", description: "L'assignation a échoué.", variant: "destructive" });
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
      case 'en_attente': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Clock className="w-3 h-3 mr-1" /> En attente</Badge>;
      case 'en_cours': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><AlertCircle className="w-3 h-3 mr-1" /> En cours</Badge>;
      case 'termine': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><CheckSquare className="w-3 h-3 mr-1" /> Termine</Badge>;
      case 'annule': return <Badge variant="secondary" className="bg-muted text-muted-foreground border-muted-foreground/20">Annule</Badge>;
      default: return <Badge variant="outline" className="capitalize">{status.replace('_', ' ')}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'haute': return <Badge variant="destructive" className="bg-destructive text-destructive-foreground">Haute</Badge>;
      case 'moyenne': return <Badge variant="secondary" className="bg-amber-500/20 text-amber-700">Moyenne</Badge>;
      case 'basse': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-700">Basse</Badge>;
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
          <DialogTitle>{editingTask ? "Modifier la tache" : "Nouvelle tache"}</DialogTitle>
          <DialogDescription>Details de l'action a effectuer.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem><FormLabel>Titre</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><GhostTextarea className="resize-none" {...field} value={field.value || ""} fieldType="task_description" context={{ title: form.getValues("title") || null }} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Statut</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="en_attente">En attente</SelectItem>
                      <SelectItem value="en_cours">En cours</SelectItem>
                      <SelectItem value="termine">Termine</SelectItem>
                      <SelectItem value="annule">Annule</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="priority" render={({ field }) => (
                <FormItem>
                  <FormLabel>Priorite</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="haute">Haute</SelectItem>
                      <SelectItem value="moyenne">Moyenne</SelectItem>
                      <SelectItem value="basse">Basse</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="dueDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date d'echeance</FormLabel>
                  <FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="assignedTo" render={({ field }) => (
                <FormItem>
                  <FormLabel>Assigne a</FormLabel>
                  <FormControl><Input placeholder="Nom du collaborateur" {...field} value={field.value || ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="relatedContactId" render={({ field }) => (
              <FormItem>
                <FormLabel>Contact associe (Optionnel)</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Choisir un contact..."/></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">Aucun</SelectItem>
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
                    <Repeat className="w-3.5 h-3.5 text-muted-foreground" />Tâche récurrente
                  </FormLabel>
                  <p className="text-xs text-muted-foreground">Cette tâche se répète automatiquement</p>
                </div>
              </FormItem>
            )} />
            {form.watch("isRecurring") && (
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="recurrenceRule" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fréquence</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="quotidien">Quotidien</SelectItem>
                        <SelectItem value="hebdomadaire">Hebdomadaire</SelectItem>
                        <SelectItem value="bihebdomadaire">Bi-hebdomadaire</SelectItem>
                        <SelectItem value="mensuel">Mensuel</SelectItem>
                        <SelectItem value="trimestriel">Trimestriel</SelectItem>
                        <SelectItem value="annuel">Annuel</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="recurrenceEndDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fin de récurrence</FormLabel>
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
                  <div>Créé par <span className="font-medium text-foreground">{editingTask.createdByName}</span> {editingTask.createdAt && <>— {format(new Date(editingTask.createdAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</>}</div>
                )}
                {editingTask.updatedByName && editingTask.updatedAt && (
                  <div>Modifié par <span className="font-medium text-foreground">{editingTask.updatedByName}</span> — {format(new Date(editingTask.updatedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => aiValidation.validate(form.getValues())} disabled={aiValidation.isValidating} className="mr-auto">Verifier IA</Button>
              <Button type="submit" disabled={updateTask.isPending || createTask.isPending}>{editingTask ? "Mettre a jour" : "Creer"}</Button>
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
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={CheckSquare} variant="emerald" size="md" /> Gestion des Taches</h1>
          <p className="text-muted-foreground mt-1">Organisez et suivez les actions a realiser au bureau.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleBulkComplete}>
                <CheckCheck className="w-4 h-4 mr-2" />
                Terminer ({selectedIds.size})
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="w-4 h-4 mr-2" />
                    Priorité ({selectedIds.size})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Changer la priorité</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {[{val:"urgente",label:"🔴 Urgente"},{val:"haute",label:"🟠 Haute"},{val:"moyenne",label:"🟡 Moyenne"},{val:"basse",label:"🟢 Basse"}].map(p => (
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
                    placeholder="Nom de l'agent..."
                    className="h-8 w-36 text-sm"
                    autoFocus
                  />
                  <Button size="sm" className="h-8" onClick={handleBulkAssign} disabled={!bulkAssignName.trim()}>
                    <UserCheck className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => { setShowAssignInput(true); setTimeout(() => assignInputRef.current?.focus(), 50); }}>
                  <UserCheck className="w-4 h-4 mr-2" />
                  Assigner ({selectedIds.size})
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ArrowUpDown className="w-4 h-4 mr-2" />
                    Statut ({selectedIds.size})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Changer le statut</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleBulkStatus("en_attente")}>À faire</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatus("en_cours")}>En cours</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatus("termine")}>Terminée</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatus("annule")}>Annulée</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                Supprimer ({selectedIds.size})
              </Button>
            </>
          )}
          <a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api/tasks/export/csv`} download>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />CSV</Button>
          </a>
          <Button variant="outline" size="sm" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button onClick={handleOpenCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            Nouvelle Tache
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={taskManagementImg} alt="Gestion des taches" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/80 via-emerald-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">Planification intelligente</h3>
              <p className="text-white/80 text-sm mt-1">Organisation et suivi des actions avec priorisation automatique par l'IA.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Rechercher une tache..." className="pl-9 w-full" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Statut" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="en_attente">En attente</SelectItem>
              <SelectItem value="en_cours">En cours</SelectItem>
              <SelectItem value="termine">Termine</SelectItem>
              <SelectItem value="annule">Annule</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Priorite" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les priorites</SelectItem>
              <SelectItem value="haute">Haute</SelectItem>
              <SelectItem value="moyenne">Moyenne</SelectItem>
              <SelectItem value="basse">Basse</SelectItem>
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

      {tasksError && <QueryErrorAlert error={tasksError as Error} title="Impossible de charger les taches" />}

      {viewMode === "kanban" ? (
        <div className="space-y-4">
        <AiSuggestionsCard page="tasks" title="Recommandations IA - Taches" compact />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {KANBAN_COLUMNS.map(col => (
            <div key={col.key} className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <div className={`w-3 h-3 rounded-full ${col.color}`} />
                <h3 className="font-semibold text-sm">{col.label}</h3>
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
                                <Button variant="ghost" className="h-6 w-6 p-0"><MoreHorizontal className="h-3 w-3" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {KANBAN_COLUMNS.filter(c => c.key !== task.status).map(c => (
                                  <DropdownMenuItem key={c.key} onClick={(e) => { e.stopPropagation(); handleStatusChange(task.id, c.key); }}>
                                    {c.label}
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
                              {(task as any).isRecurring && <span title={(task as any).recurrenceRule || "Récurrent"}><Repeat className="w-3 h-3 text-blue-500" /></span>}
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
                    <span className="flex items-center">Tache{getSortIcon("title")}</span>
                  </TableHead>
                  <TableHead>Assigne a</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("dueDate")}>
                    <span className="flex items-center">Echeance{getSortIcon("dueDate")}</span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                    <span className="flex items-center">Statut{getSortIcon("status")}</span>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("priority")}>
                    <span className="flex items-center">Priorite{getSortIcon("priority")}</span>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                        <p className="text-center text-muted-foreground" data-testid="no-results-tasks">Aucune tâche ne correspond à vos filtres.</p>
                      ) : (
                        <EmptyOnboardingHint
                          icon={CheckSquare}
                          title="Aucune tâche pour l'instant"
                          description="Créez votre première tâche pour organiser votre travail. Vous pourrez l'attribuer à un collaborateur, fixer une échéance et un niveau de priorité."
                          actionLabel="Créer ma première tâche"
                          onAction={handleOpenCreate}
                          tip="Astuce : utilisez le Commandant IA pour créer plusieurs tâches d'un coup en langage naturel."
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
                            {(task as any).isRecurring && <Repeat className="w-3 h-3 text-blue-500 shrink-0" aria-label={(task as any).recurrenceRule || "Récurrent"} />}
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
                          <span className="text-sm text-muted-foreground">{task.assignedTo || "Non assigne"}</span>
                        </TableCell>
                        <TableCell>
                          {getDueDateDisplay(task.dueDate, task.status) || (
                            <span className="text-sm text-muted-foreground">Aucune</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger className="outline-none">
                              {getStatusBadge(task.status)}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'en_attente')}>En attente</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'en_cours')}>En cours</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'termine')}>Termine</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'annule')}>Annule</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell>
                          {getPriorityBadge(task.priority)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => handleOpenEdit(task)}>
                                <Edit className="w-4 h-4 mr-2" /> Editer
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicate(task.id)}>
                                <Copy className="w-4 h-4 mr-2" /> Dupliquer
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-indigo-600" onClick={async () => {
                                const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
                                const res = await fetch(`${BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: task.title, status: "planifie", priority: task.priority || "moyenne", progress: 0, notes: `Créé depuis la tâche #${task.id}` }) });
                                if (res.ok) { toast({ title: "Projet créé" }); setLocation("/projets"); }
                                else toast({ title: "Erreur", variant: "destructive" });
                              }}><FolderKanban className="w-4 h-4 mr-2" />Créer un projet</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {task.status !== 'termine' && (
                                <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'termine')}>
                                  <CheckSquare className="w-4 h-4 mr-2" /> Marquer terminee
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={async () => {
                                if (!(await confirmAction({ title: "Supprimer cette tâche ?", confirmLabel: "Supprimer", destructive: true }))) return;
                                deleteTask.mutate({ id: task.id }, {
                                  onSuccess: () => { toast({ title: "Tâche supprimée" }); queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }); },
                                  onError: () => toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" }),
                                });
                              }}><Trash2 className="w-4 h-4 mr-2" />Supprimer</DropdownMenuItem>
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

          <AiSuggestionsCard page="tasks" title="Recommandations IA - Taches" compact />

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {data ? `${data.total} tache(s) - Page ${page + 1} sur ${totalPages}` : ""}
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
