import { useState } from "react";
import { useListTasks, useCreateTask, useUpdateTask, getListTasksQueryKey, useListContacts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { CheckSquare, Search, Filter, MoreHorizontal, Plus, Calendar, Clock, AlertCircle, Edit, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

const formSchema = z.object({
  title: z.string().min(1, "Le titre est requis"),
  description: z.string().optional().nullable(),
  status: z.enum(["en_attente", "en_cours", "termine", "annule"]),
  priority: z.enum(["haute", "moyenne", "basse"]),
  dueDate: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  relatedContactId: z.string().transform(v => v === "none" ? null : parseInt(v)).optional().nullable(),
});

export default function Tasks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);

  const { data, isLoading } = useListTasks(
    { 
      status: statusFilter !== "all" ? statusFilter as any : undefined,
      priority: priorityFilter !== "all" ? priorityFilter as any : undefined 
    },
    { query: { queryKey: getListTasksQueryKey({ 
      status: statusFilter !== "all" ? statusFilter as any : undefined,
      priority: priorityFilter !== "all" ? priorityFilter as any : undefined 
    }) } }
  );

  const { data: contactsData } = useListContacts({ limit: 100 }, { query: { queryKey: ["contacts", "all"] } });

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      status: "en_attente",
      priority: "moyenne",
      dueDate: "",
      assignedTo: "",
      relatedContactId: null as any,
    }
  });

  const handleOpenEdit = (task: any) => {
    setEditingTask(task);
    form.reset({
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : "",
      assignedTo: task.assignedTo || "",
      relatedContactId: task.relatedContactId?.toString() || "none" as any,
    });
    setIsDialogOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingTask(null);
    form.reset({
      title: "",
      description: "",
      status: "en_attente",
      priority: "moyenne",
      dueDate: "",
      assignedTo: "",
      relatedContactId: null as any,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (values: any) => {
    // If date is empty string, set it to null
    if (values.dueDate === "") values.dueDate = null;
    else if (values.dueDate) values.dueDate = new Date(values.dueDate).toISOString();

    if (editingTask) {
      updateTask.mutate({ id: editingTask.id, data: values }, {
        onSuccess: () => {
          toast({ title: "Tâche mise à jour" });
          setIsDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de modifier la tâche", variant: "destructive" })
      });
    } else {
      createTask.mutate({ data: values }, {
        onSuccess: () => {
          toast({ title: "Tâche créée" });
          setIsDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de créer la tâche", variant: "destructive" })
      });
    }
  };

  const handleStatusChange = (id: number, status: any) => {
    updateTask.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast({ title: "Statut mis à jour" });
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'en_attente': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Clock className="w-3 h-3 mr-1" /> En attente</Badge>;
      case 'en_cours': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><AlertCircle className="w-3 h-3 mr-1" /> En cours</Badge>;
      case 'termine': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><CheckSquare className="w-3 h-3 mr-1" /> Terminé</Badge>;
      case 'annule': return <Badge variant="secondary" className="bg-muted text-muted-foreground border-muted-foreground/20">Annulé</Badge>;
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

  const getContactName = (contactId?: number | null) => {
    if (!contactId || !contactsData) return null;
    const contact = contactsData.contacts.find(c => c.id === contactId);
    return contact ? `${contact.firstName} ${contact.lastName}` : null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestion des Tâches</h1>
          <p className="text-muted-foreground mt-1">Organisez et suivez les actions à réaliser au bureau.</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                Nouvelle Tâche
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{editingTask ? "Modifier la tâche" : "Nouvelle tâche"}</DialogTitle>
                <DialogDescription>Détails de l'action à effectuer.</DialogDescription>
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
                            <SelectItem value="termine">Terminé</SelectItem>
                            <SelectItem value="annule">Annulé</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="priority" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priorité</FormLabel>
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
                        <FormLabel>Date d'échéance</FormLabel>
                        <FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="assignedTo" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assigné à</FormLabel>
                        <FormControl><Input placeholder="Nom du collaborateur" {...field} value={field.value || ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="relatedContactId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact associé (Optionnel)</FormLabel>
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

                  <DialogFooter><Button type="submit" disabled={updateTask.isPending || createTask.isPending}>{editingTask ? "Mettre à jour" : "Créer"}</Button></DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="flex-1 w-full sm:max-w-sm" />
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="en_attente">En attente</SelectItem>
              <SelectItem value="en_cours">En cours</SelectItem>
              <SelectItem value="termine">Terminé</SelectItem>
              <SelectItem value="annule">Annulé</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="Priorité" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les priorités</SelectItem>
              <SelectItem value="haute">Haute</SelectItem>
              <SelectItem value="moyenne">Moyenne</SelectItem>
              <SelectItem value="basse">Basse</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Tâche</TableHead>
              <TableHead>Assigné à</TableHead>
              <TableHead>Échéance</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Priorité</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
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
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  Aucune tâche trouvée.
                </TableCell>
              </TableRow>
            ) : (
              data?.tasks.map((task) => {
                const contactName = getContactName(task.relatedContactId);
                return (
                <TableRow key={task.id} className="hover:bg-muted/30 transition-colors">
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
                    <span className="text-sm text-muted-foreground">{task.assignedTo || "Non assigné"}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5 mr-1.5" />
                      {task.dueDate ? format(new Date(task.dueDate), "d MMM yyyy", { locale: fr }) : "Aucune"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="outline-none">
                        {getStatusBadge(task.status)}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                         <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'en_attente')}>En attente</DropdownMenuItem>
                         <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'en_cours')}>En cours</DropdownMenuItem>
                         <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'termine')}>Terminé</DropdownMenuItem>
                         <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'annule')}>Annulé</DropdownMenuItem>
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
                          <span className="sr-only">Ouvrir le menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleOpenEdit(task)}>
                           <Edit className="w-4 h-4 mr-2" /> Éditer la tâche
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {task.status !== 'termine' && (
                          <DropdownMenuItem onClick={() => handleStatusChange(task.id, 'termine')}>
                            <CheckSquare className="w-4 h-4 mr-2" /> Marquer comme terminée
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )})
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}