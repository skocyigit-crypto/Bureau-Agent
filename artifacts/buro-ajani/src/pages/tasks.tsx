import { useState, useMemo } from "react";
import { useListTasks, useCreateTask, useUpdateTask, useDeleteTask, getListTasksQueryKey, useListContacts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, isPast, isToday } from "date-fns";
import { fr } from "date-fns/locale";
import { CheckSquare, Search, Filter, MoreHorizontal, Plus, Calendar, Clock, AlertCircle, Edit, Users, LayoutList, Columns3, ArrowUpDown, ArrowUp, ArrowDown, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, AlertTriangle, GripVertical } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const PAGE_SIZE = 20;

const formSchema = z.object({
  title: z.string().min(1, "Le titre est requis"),
  description: z.string().optional().nullable(),
  status: z.enum(["en_attente", "en_cours", "termine", "annule"]),
  priority: z.enum(["haute", "moyenne", "basse"]),
  dueDate: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  relatedContactId: z.string().transform(v => v === "none" ? null : parseInt(v)).optional().nullable(),
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

  const queryParams = {
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    priority: priorityFilter !== "all" ? priorityFilter as any : undefined,
    search: search || undefined,
    sortBy: sortBy as any,
    sortOrder: sortOrder as any,
    limit: viewMode === "kanban" ? 200 : PAGE_SIZE,
    offset: viewMode === "kanban" ? 0 : page * PAGE_SIZE,
  };

  const { data, isLoading } = useListTasks(queryParams, {
    query: { queryKey: getListTasksQueryKey(queryParams) }
  });

  const { data: contactsData } = useListContacts({ limit: 100 }, { query: { queryKey: ["contacts", "all"] } });

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "", description: "", status: "en_attente", priority: "moyenne",
      dueDate: "", assignedTo: "", relatedContactId: null as any,
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
    });
    setIsDialogOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingTask(null);
    form.reset({
      title: "", description: "", status: "en_attente", priority: "moyenne",
      dueDate: "", assignedTo: "", relatedContactId: null as any,
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
        toast({ title: "Statut mis a jour" });
      }
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await new Promise<void>((resolve) => {
        deleteTask.mutate({ id }, { onSuccess: () => resolve(), onError: () => resolve() });
      });
    }
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
    toast({ title: `${ids.length} tache(s) supprimee(s)` });
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
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea className="resize-none" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
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
            <DialogFooter><Button type="submit" disabled={updateTask.isPending || createTask.isPending}>{editingTask ? "Mettre a jour" : "Creer"}</Button></DialogFooter>
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
          <h1 className="text-3xl font-bold tracking-tight">Gestion des Taches</h1>
          <p className="text-muted-foreground mt-1">Organisez et suivez les actions a realiser au bureau.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
              <Trash2 className="w-4 h-4 mr-2" />
              Supprimer ({selectedIds.size})
            </Button>
          )}
          <Button onClick={handleOpenCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            Nouvelle Tache
          </Button>
        </div>
      </div>

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

      {viewMode === "kanban" ? (
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
                            {task.assignedTo && (
                              <span className="text-xs text-muted-foreground truncate max-w-[80px]">{task.assignedTo}</span>
                            )}
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
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Aucune tache trouvee.
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
                          <div className={`font-medium ${task.status === 'termine' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                            {task.title}
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
                              <DropdownMenuSeparator />
                              {task.status !== 'termine' && (
                                <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'termine')}>
                                  <CheckSquare className="w-4 h-4 mr-2" /> Marquer terminee
                                </DropdownMenuItem>
                              )}
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
