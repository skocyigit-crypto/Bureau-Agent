import { useState, useMemo, useEffect } from "react";
import { useListCalls, useCreateCall, useUpdateCall, useDeleteCall, getListCallsQueryKey, useListContacts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Filter, MoreHorizontal, Check, Clock, Voicemail, Plus, ArrowUpDown, ArrowUp, ArrowDown, Download, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CalendarIcon } from "lucide-react";
import { Icon3D } from "@/components/icon-3d";
import callCenterImg from "@/assets/images/call-center.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Link, useLocation } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { AiValidationFeedback } from "@/components/ai-validation-feedback";
import { useAiValidation } from "@/hooks/use-ai-validation";
import { QueryErrorAlert } from "@/components/safe-component";

const PAGE_SIZE = 15;

const formSchema = z.object({
  contactId: z.string().transform(v => v === "none" ? null : parseInt(v)),
  phoneNumber: z.string().min(1, "Le numero est requis"),
  direction: z.enum(["entrant", "sortant"]),
  status: z.enum(["repondu", "manque", "messagerie", "en_cours"]),
  duration: z.coerce.number().min(0).default(0),
  notes: z.string().optional().nullable(),
  sentiment: z.enum(["tres_positif", "positif", "neutre", "negatif", "tres_negatif", "none"]).transform(v => v === "none" ? null : v).optional(),
});

export default function Calls() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<string>("desc");
  const [page, setPage] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cId = params.get("contactId");
    if (cId) {
      form.setValue("contactId", cId as any);
      const matchedContact = contactsData?.contacts?.find((c: any) => String(c.id) === cId);
      if (matchedContact?.phone) {
        form.setValue("phoneNumber", matchedContact.phone);
      }
      setIsDialogOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [contactsData]);

  const queryParams = {
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    direction: directionFilter !== "all" ? directionFilter as any : undefined,
    sortBy: sortBy as any,
    sortOrder: sortOrder as any,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo + "T23:59:59").toISOString() : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading, error: callsError } = useListCalls(queryParams, {
    query: { queryKey: getListCallsQueryKey(queryParams) }
  });

  const { data: contactsData } = useListContacts({ limit: 100 }, { query: { queryKey: ["contacts", "all"] } });

  const updateCall = useUpdateCall();
  const createCall = useCreateCall();
  const deleteCall = useDeleteCall();
  const aiValidation = useAiValidation("call");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactId: null as any,
      phoneNumber: "",
      direction: "entrant",
      status: "repondu",
      duration: 0,
      notes: "",
      sentiment: null as any,
    }
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

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

  const handleStatusChange = (id: number, status: any) => {
    updateCall.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
        toast({ title: "Statut mis a jour" });
      },
      onError: () => toast({ title: "Erreur", description: "Impossible de changer le statut de l'appel", variant: "destructive" }),
    });
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data?.calls) return;
    if (selectedIds.size === data.calls.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.calls.map(c => c.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    let successCount = 0;
    let failCount = 0;
    await Promise.all(ids.map(id => new Promise<void>((resolve) => {
      deleteCall.mutate({ id }, {
        onSuccess: () => { successCount++; resolve(); },
        onError: () => { failCount++; resolve(); },
      });
    })));
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
    if (failCount > 0) {
      toast({ title: `${successCount} supprime(s), ${failCount} echoue(s)`, variant: "destructive" });
    } else {
      toast({ title: `${successCount} appel(s) supprime(s)` });
    }
  };

  const exportCSV = () => {
    if (!data?.calls) return;
    const headers = ["ID", "Contact", "Numero", "Direction", "Statut", "Duree (s)", "Sentiment", "Date"];
    const rows = data.calls.map(c => [
      c.id, c.contactName || "Inconnu", c.phoneNumber, c.direction, c.status,
      c.duration, c.sentiment || "", format(new Date(c.createdAt), "dd/MM/yyyy HH:mm")
    ]);
    const csv = [headers, ...rows].map(r => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `appels_${format(new Date(), "yyyyMMdd")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const onSubmit = (values: any) => {
    createCall.mutate({ data: values }, {
      onSuccess: (newCall) => {
        toast({ title: "Appel enregistre" });
        setIsDialogOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
        setLocation(`/appels/${newCall.id}`);
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible d'enregistrer l'appel", variant: "destructive" });
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'repondu': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20"><Check className="w-3 h-3 mr-1" /> Repondu</Badge>;
      case 'manque': return <Badge variant="secondary" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"><PhoneMissed className="w-3 h-3 mr-1" /> Manque</Badge>;
      case 'messagerie': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-amber-500/20"><Voicemail className="w-3 h-3 mr-1" /> Messagerie</Badge>;
      case 'en_cours': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-blue-500/20"><Clock className="w-3 h-3 mr-1" /> En cours</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case 'entrant': return <PhoneIncoming className="w-4 h-4 text-blue-500" />;
      case 'sortant': return <PhoneOutgoing className="w-4 h-4 text-emerald-500" />;
      default: return <Phone className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getSentimentBadge = (sentiment?: string | null) => {
    switch (sentiment) {
      case 'tres_positif': return <Badge variant="outline" className="bg-emerald-600/10 text-emerald-700 border-emerald-600/30">Tres positif</Badge>;
      case 'positif': return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Positif</Badge>;
      case 'negatif': return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Negatif</Badge>;
      case 'tres_negatif': return <Badge variant="outline" className="bg-red-700/10 text-red-700 border-red-700/30">Tres negatif</Badge>;
      case 'neutre': return <Badge variant="outline" className="bg-muted text-muted-foreground border-muted-foreground/20">Neutre</Badge>;
      default: return null;
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Phone} variant="blue" size="md" /> Journal des Appels</h1>
          <p className="text-muted-foreground mt-1">Gerez et suivez toutes les communications telephoniques.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
              <Trash2 className="w-4 h-4 mr-2" />
              Supprimer ({selectedIds.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="w-4 h-4 mr-2" />
            Exporter CSV
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                Nouvel Appel
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Enregistrer un appel</DialogTitle>
                <DialogDescription>Saisissez les details de la communication.</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="direction" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Direction</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="entrant">Entrant</SelectItem>
                            <SelectItem value="sortant">Sortant</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="status" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Statut</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="repondu">Repondu</SelectItem>
                            <SelectItem value="manque">Manque</SelectItem>
                            <SelectItem value="messagerie">Messagerie</SelectItem>
                            <SelectItem value="en_cours">En cours</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  
                  <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Numero de telephone</FormLabel>
                      <FormControl><Input placeholder="+33 6..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="contactId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Associer a un contact (Optionnel)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Choisir un contact..."/></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">Aucun (Numero inconnu)</SelectItem>
                          {contactsData?.contacts.map(c => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.firstName} {c.lastName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="duration" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Duree (secondes)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="sentiment" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sentiment</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Non defini"/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="none">Non defini</SelectItem>
                            <SelectItem value="tres_positif">Tres positif</SelectItem>
                            <SelectItem value="positif">Positif</SelectItem>
                            <SelectItem value="neutre">Neutre</SelectItem>
                            <SelectItem value="negatif">Negatif</SelectItem>
                            <SelectItem value="tres_negatif">Tres negatif</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <AiValidationFeedback result={aiValidation.result} isValidating={aiValidation.isValidating} />

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => aiValidation.validate(form.getValues())}
                      disabled={aiValidation.isValidating}
                      className="mr-auto"
                    >
                      Verifier IA
                    </Button>
                    <Button type="submit" disabled={createCall.isPending}>Enregistrer l'appel</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={callCenterImg} alt="Centre d'appels" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/80 via-blue-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">Centre de communication</h3>
              <p className="text-white/80 text-sm mt-1">Suivi en temps reel de toutes les communications entrantes et sortantes.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-3 bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par nom ou numero..."
              className="pl-9 w-full"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="answered">Repondu</SelectItem>
                <SelectItem value="missed">Manque</SelectItem>
                <SelectItem value="voicemail">Messagerie</SelectItem>
                <SelectItem value="outgoing">Sortant</SelectItem>
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={(v) => { setDirectionFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes directions</SelectItem>
                <SelectItem value="entrant">Entrant</SelectItem>
                <SelectItem value="sortant">Sortant</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
            <Input type="date" className="w-[160px]" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} placeholder="Du" />
            <span className="text-muted-foreground text-sm">au</span>
            <Input type="date" className="w-[160px]" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} placeholder="Au" />
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setPage(0); }}>
                Effacer
              </Button>
            )}
          </div>
        </div>
      </div>

      {callsError && <QueryErrorAlert error={callsError as Error} title="Impossible de charger les appels" />}

      <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={data?.calls?.length ? selectedIds.size === data.calls.length : false}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("contactName")}>
                <span className="flex items-center">Contact & Numero{getSortIcon("contactName")}</span>
              </TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("createdAt")}>
                <span className="flex items-center">Date & Heure{getSortIcon("createdAt")}</span>
              </TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                <span className="flex items-center">Statut{getSortIcon("status")}</span>
              </TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("duration")}>
                <span className="flex items-center">Duree{getSortIcon("duration")}</span>
              </TableHead>
              <TableHead>Sentiment</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="w-4 h-4" /></TableCell>
                  <TableCell><Skeleton className="w-6 h-6 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32 mb-2" /><Skeleton className="h-3 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : data?.calls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  Aucun appel trouve.
                </TableCell>
              </TableRow>
            ) : (
              data?.calls.map((call) => (
                <TableRow key={call.id} className={`hover:bg-muted/30 transition-colors cursor-pointer ${selectedIds.has(call.id) ? 'bg-primary/5' : ''}`} onClick={() => setLocation(`/appels/${call.id}`)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(call.id)}
                      onCheckedChange={() => toggleSelect(call.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center p-2 bg-muted rounded-full">
                      {getDirectionIcon(call.direction)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{call.contactName || "Inconnu"}</div>
                    <div className="text-sm text-muted-foreground">{call.phoneNumber}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-foreground">
                      {format(new Date(call.createdAt), "d MMM yyyy", { locale: fr })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(call.createdAt), "HH:mm", { locale: fr })}
                    </div>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(call.status)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {call.duration > 0 ? formatDuration(call.duration) : "-"}
                  </TableCell>
                  <TableCell>
                    {getSentimentBadge(call.sentiment)}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Ouvrir le menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem asChild><Link href={`/appels/${call.id}`}>Voir les details</Link></DropdownMenuItem>
                        {call.contactId && <DropdownMenuItem asChild><Link href={`/contacts/${call.contactId}`}>Aller au contact</Link></DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        {call.status !== 'repondu' && <DropdownMenuItem onClick={() => handleStatusChange(call.id, 'repondu')}>Marquer comme repondu</DropdownMenuItem>}
                        {call.status !== 'messagerie' && <DropdownMenuItem onClick={() => handleStatusChange(call.id, 'messagerie')}>Marquer comme messagerie</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AiSuggestionsCard page="calls" title="Recommandations IA - Appels" compact />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total} resultat(s) - Page ${page + 1} sur ${totalPages}` : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(0)}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
