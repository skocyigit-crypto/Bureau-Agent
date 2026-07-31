import { useState, useMemo, useEffect } from "react";
import { confirmAction } from "@/hooks/use-confirm";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useListCalls, useCreateCall, useUpdateCall, useDeleteCall, getListCallsQueryKey, useListContacts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Filter, MoreHorizontal, Check, Clock, Voicemail, Plus, ArrowUpDown, ArrowUp, ArrowDown, Download, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CalendarIcon, Printer, Edit, Copy, FolderKanban } from "lucide-react";
import { EmptyOnboardingHint } from "@/components/empty-onboarding-hint";
import { Icon3D } from "@/components/icon-3d";
import callCenterImg from "@/assets/images/call-center.webp";
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
import { useTranslation } from "@/i18n";

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
  const { t } = useTranslation();
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
  const [editingCall, setEditingCall] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Tâche #74: efface le badge "Appels" dans la sidebar dès que l'utilisateur ouvre la page.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("call-badge-clear"));
  }, []);

  const debouncedSearch = useDebouncedValue(search, 300);

  const queryParams = {
    search: debouncedSearch || undefined,
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

  // Revenir à la première page quand la recherche (debouncée) change, sans
  // remettre la page à zéro à chaque frappe.
  useEffect(() => { setPage(0); }, [debouncedSearch]);

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
        toast({ title: t("calls.toast.statusUpdated") });
      },
      onError: () => toast({ title: t("calls.toast.error"), description: t("calls.toast.statusError"), variant: "destructive" }),
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

  const handleBulkStatus = async (status: string) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${BASE}/api/bulk/calls/status`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids, status }) });
    if (res.ok) { toast({ title: t("calls.toast.bulkStatus", { count: ids.length }) }); queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() }); setSelectedIds(new Set()); }
    else toast({ title: t("calls.toast.error"), description: t("calls.toast.bulkStatusError"), variant: "destructive" });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirmAction({ title: t("calls.confirm.bulkDelete", { count: selectedIds.size }), confirmLabel: t("common.delete"), destructive: true }))) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${BASE}/api/bulk/calls/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
    if (res.ok) {
      toast({ title: t("calls.toast.bulkDeleted", { count: ids.length }) });
    } else {
      toast({ title: t("calls.toast.bulkDeleteError"), variant: "destructive" });
    }
  };

  const exportCSV = () => {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const a = document.createElement("a");
    a.href = `${BASE}/api/calls/export/csv`;
    a.download = `appels_${format(new Date(), "yyyyMMdd")}.csv`;
    a.click();
  };

  const openEditCall = (call: any) => {
    setEditingCall(call);
    form.reset({
      contactId: call.contactId ? String(call.contactId) : "none" as any,
      phoneNumber: call.phoneNumber || "",
      direction: call.direction || "entrant",
      status: call.status || "repondu",
      duration: call.duration || 0,
      notes: call.notes || "",
      sentiment: call.sentiment || "none" as any,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (values: any) => {
    if (editingCall) {
      updateCall.mutate({ id: editingCall.id, data: values }, {
        onSuccess: () => {
          toast({ title: t("calls.toast.updated") });
          setIsDialogOpen(false);
          setEditingCall(null);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
        },
        onError: () => toast({ title: t("calls.toast.error"), description: t("calls.toast.updateError"), variant: "destructive" }),
      });
    } else {
      createCall.mutate({ data: values }, {
        onSuccess: (newCall) => {
          toast({ title: t("calls.toast.created") });
          setIsDialogOpen(false);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
          setLocation(`/appels/${newCall.id}`);
        },
        onError: () => {
          toast({ title: t("calls.toast.error"), description: t("calls.toast.createError"), variant: "destructive" });
        }
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'repondu': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20"><Check className="w-3 h-3 mr-1" /> {t("calls.status.repondu")}</Badge>;
      case 'manque': return <Badge variant="secondary" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"><PhoneMissed className="w-3 h-3 mr-1" /> {t("calls.status.manque")}</Badge>;
      case 'messagerie': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-amber-500/20"><Voicemail className="w-3 h-3 mr-1" /> {t("calls.status.messagerie")}</Badge>;
      case 'en_cours': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-blue-500/20"><Clock className="w-3 h-3 mr-1" /> {t("calls.status.en_cours")}</Badge>;
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
      case 'tres_positif': return <Badge variant="outline" className="bg-emerald-600/10 text-emerald-700 border-emerald-600/30">{t("calls.sentiment.tres_positif")}</Badge>;
      case 'positif': return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">{t("calls.sentiment.positif")}</Badge>;
      case 'negatif': return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">{t("calls.sentiment.negatif")}</Badge>;
      case 'tres_negatif': return <Badge variant="outline" className="bg-red-700/10 text-red-700 border-red-700/30">{t("calls.sentiment.tres_negatif")}</Badge>;
      case 'neutre': return <Badge variant="outline" className="bg-muted text-muted-foreground border-muted-foreground/20">{t("calls.sentiment.neutre")}</Badge>;
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
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Phone} variant="blue" size="md" /> {t("calls.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("calls.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Check className="w-4 h-4 mr-2" />
                    {t("calls.statusBtn", { count: selectedIds.size })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("calls.changeStatus")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleBulkStatus("repondu")}><Check className="w-3 h-3 mr-2 text-emerald-600" />{t("calls.status.repondu")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatus("manque")}><PhoneMissed className="w-3 h-3 mr-2 text-destructive" />{t("calls.status.manque")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatus("messagerie")}><Voicemail className="w-3 h-3 mr-2 text-amber-600" />{t("calls.status.messagerie")}</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleBulkStatus("en_cours")}><Clock className="w-3 h-3 mr-2 text-blue-600" />{t("calls.status.en_cours")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                {t("calls.deleteBtn", { count: selectedIds.size })}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="w-4 h-4 mr-2" />
            {t("calls.exportCsv")}
          </Button>
          <Button variant="outline" size="sm" title={t("calls.print")} onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) { setEditingCall(null); form.reset(); } }}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                {t("calls.newCall")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{editingCall ? t("calls.dialog.editTitle") : t("calls.dialog.createTitle")}</DialogTitle>
                <DialogDescription>{editingCall ? t("calls.dialog.editDesc") : t("calls.dialog.createDesc")}</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="direction" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("calls.form.direction")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="entrant">{t("calls.direction.entrant")}</SelectItem>
                            <SelectItem value="sortant">{t("calls.direction.sortant")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="status" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("calls.form.status")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="repondu">{t("calls.status.repondu")}</SelectItem>
                            <SelectItem value="manque">{t("calls.status.manque")}</SelectItem>
                            <SelectItem value="messagerie">{t("calls.status.messagerie")}</SelectItem>
                            <SelectItem value="en_cours">{t("calls.status.en_cours")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  
                  <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("calls.form.phoneNumber")}</FormLabel>
                      <FormControl><Input placeholder={t("calls.form.phonePlaceholder")} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="contactId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("calls.form.contact")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                        <FormControl><SelectTrigger><SelectValue placeholder={t("calls.form.chooseContact")}/></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("calls.form.noneUnknown")}</SelectItem>
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
                        <FormLabel>{t("calls.form.duration")}</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="sentiment" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("calls.form.sentiment")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                          <FormControl><SelectTrigger><SelectValue placeholder={t("calls.sentiment.undefined")}/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="none">{t("calls.sentiment.undefined")}</SelectItem>
                            <SelectItem value="tres_positif">{t("calls.sentiment.tres_positif")}</SelectItem>
                            <SelectItem value="positif">{t("calls.sentiment.positif")}</SelectItem>
                            <SelectItem value="neutre">{t("calls.sentiment.neutre")}</SelectItem>
                            <SelectItem value="negatif">{t("calls.sentiment.negatif")}</SelectItem>
                            <SelectItem value="tres_negatif">{t("calls.sentiment.tres_negatif")}</SelectItem>
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
                      {t("calls.verifyAi")}
                    </Button>
                    <Button type="submit" disabled={createCall.isPending || updateCall.isPending}>{editingCall ? t("calls.dialog.update") : t("calls.dialog.create")}</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={callCenterImg} alt={t("calls.bannerAlt")} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-blue-900/80 via-blue-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">{t("calls.bannerTitle")}</h3>
              <p className="text-white/80 text-sm mt-1">{t("calls.bannerSubtitle")}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-3 bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("calls.searchPlaceholder")}
              className="pl-9 w-full"
              value={search}
              aria-label={t("calls.searchAria")}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t("calls.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("calls.filters.allStatuses")}</SelectItem>
                <SelectItem value="repondu">{t("calls.status.repondu")}</SelectItem>
                <SelectItem value="manque">{t("calls.status.manque")}</SelectItem>
                <SelectItem value="messagerie">{t("calls.status.messagerie")}</SelectItem>
                <SelectItem value="en_cours">{t("calls.status.en_cours")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={(v) => { setDirectionFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder={t("calls.filters.direction")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("calls.filters.allDirections")}</SelectItem>
                <SelectItem value="entrant">{t("calls.direction.entrant")}</SelectItem>
                <SelectItem value="sortant">{t("calls.direction.sortant")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
            <Input type="date" className="w-[160px]" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} placeholder={t("calls.dateFrom")} />
            <span className="text-muted-foreground text-sm">{t("calls.dateSeparator")}</span>
            <Input type="date" className="w-[160px]" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} placeholder={t("calls.dateTo")} />
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setPage(0); }}>
                {t("calls.clear")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {callsError && <QueryErrorAlert error={callsError as Error} title={t("calls.loadError")} />}

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
                <span className="flex items-center">{t("calls.columns.contactNumber")}{getSortIcon("contactName")}</span>
              </TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("createdAt")}>
                <span className="flex items-center">{t("calls.columns.dateTime")}{getSortIcon("createdAt")}</span>
              </TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("status")}>
                <span className="flex items-center">{t("calls.columns.status")}{getSortIcon("status")}</span>
              </TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort("duration")}>
                <span className="flex items-center">{t("calls.columns.duration")}{getSortIcon("duration")}</span>
              </TableHead>
              <TableHead>{t("calls.columns.sentiment")}</TableHead>
              <TableHead className="text-right">{t("calls.columns.actions")}</TableHead>
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
                <TableCell colSpan={8} className="py-8">
                  {(search !== "" || statusFilter !== "all" || directionFilter !== "all") ? (
                    <p className="text-center text-muted-foreground" data-testid="no-results-calls">{t("calls.empty.filtered")}</p>
                  ) : (
                    <EmptyOnboardingHint
                      icon={Phone}
                      title={t("calls.empty.title")}
                      description={t("calls.empty.description")}
                      actionLabel={t("calls.empty.action")}
                      onAction={() => { window.location.href = "/telephonie"; }}
                      tip={t("calls.empty.tip")}
                      testIdPrefix="empty-calls"
                    />
                  )}
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
                    <div className="font-medium text-foreground">{call.contactName || t("calls.unknown")}</div>
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
                          <span className="sr-only">{t("calls.openMenu")}</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{t("calls.columns.actions")}</DropdownMenuLabel>
                        <DropdownMenuItem asChild><Link href={`/appels/${call.id}`}>{t("calls.rowActions.viewDetails")}</Link></DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditCall(call); }}>{t("calls.rowActions.edit")}</DropdownMenuItem>
                        {call.contactId && <DropdownMenuItem asChild><Link href={`/contacts/${call.contactId}`}>{t("calls.rowActions.goToContact")}</Link></DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        {call.status !== 'repondu' && <DropdownMenuItem onClick={() => handleStatusChange(call.id, 'repondu')}>{t("calls.rowActions.markAnswered")}</DropdownMenuItem>}
                        {call.status !== 'messagerie' && <DropdownMenuItem onClick={() => handleStatusChange(call.id, 'messagerie')}>{t("calls.rowActions.markVoicemail")}</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={async (e) => {
                          e.stopPropagation();
                          const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
                          const res = await fetch(`${base}/api/calls/${call.id}/duplicate`, { method: "POST", credentials: "include" });
                          if (res.ok) { toast({ title: t("calls.toast.duplicated") }); queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() }); }
                          else toast({ title: t("calls.toast.error"), variant: "destructive" });
                        }}><Copy className="w-4 h-4 mr-2" />{t("calls.rowActions.duplicate")}</DropdownMenuItem>
                        <DropdownMenuItem className="text-indigo-600" onClick={async (e) => {
                          e.stopPropagation();
                          const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
                          const res = await fetch(`${base}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: call.contactName ? t("calls.projectTitleWith", { name: call.contactName }) : t("calls.projectTitleDefault"), clientName: call.contactName || "", status: "planifie", priority: "moyenne", progress: 0, notes: t("calls.projectNotes", { date: new Date(call.createdAt || Date.now()).toLocaleDateString("fr-FR") }) }) });
                          if (res.ok) { toast({ title: t("calls.toast.projectCreated") }); setLocation("/projets"); }
                          else toast({ title: t("calls.toast.error"), variant: "destructive" });
                        }}><FolderKanban className="w-4 h-4 mr-2" />{t("calls.rowActions.createProject")}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={async (e) => {
                          e.stopPropagation();
                          if (!(await confirmAction({ title: t("calls.confirm.deleteOne"), confirmLabel: t("common.delete"), destructive: true }))) return;
                          const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
                          const res = await fetch(`${base}/api/calls/${call.id}`, { method: "DELETE", credentials: "include" });
                          if (res.ok) { toast({ title: t("calls.toast.deleted") }); queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() }); }
                        }}><Trash2 className="w-4 h-4 mr-2" />{t("calls.rowActions.delete")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AiSuggestionsCard page="calls" title={t("calls.aiTitle")} compact />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? t("calls.pagination", { total: data.total, page: page + 1, pages: totalPages }) : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(0)} aria-label={t("calls.pager.first")}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label={t("calls.pager.prev")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} aria-label={t("calls.pager.next")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} aria-label={t("calls.pager.last")}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
