import messagingImg from "@/assets/images/messaging-center.webp";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { AiValidationFeedback } from "@/components/ai-validation-feedback";
import { EmailComposer } from "@/components/email-composer";
import { EmptyOnboardingHint } from "@/components/empty-onboarding-hint";
import { GhostTextarea } from "@/components/ghost-textarea";
import { Icon3D } from "@/components/icon-3d";
import { QueryErrorAlert } from "@/components/safe-component";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,DialogTrigger } from "@/components/ui/dialog";
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
import { getListMessagesQueryKey,useCreateMessage,useDeleteMessage,useGetMessage,useListContacts,useListMessages,useUpdateMessage } from "@workspace/api-client-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Bell,CheckCheck,ChevronLeft,ChevronRight,ChevronsLeft,ChevronsRight,Copy,Download,Edit,FileText,FolderKanban,Mail,MailOpen,MessageSquare,MoreHorizontal,Plus,Printer,Search,Send,Trash2,Voicemail } from "lucide-react";
import { useEffect,useState } from "react";
import { useForm } from "react-hook-form";
import { Link,useLocation } from "wouter";
import * as z from "zod";

const PAGE_SIZE = 15;

const formSchema = z.object({
  contactId: z.string().transform(v => v === "none" ? null : parseInt(v)).optional().nullable(),
  phoneNumber: z.string().min(1, "Le numero est requis"),
  content: z.string().min(1, "Le message est requis"),
  type: z.enum(["messagerie_vocale", "note", "rappel"]),
  priority: z.enum(["haute", "moyenne", "basse"]),
});

export default function Messages() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [readFilter, setReadFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isEmailComposerOpen, setIsEmailComposerOpen] = useState(false);
  const [deepLinkMessageId, setDeepLinkMessageId] = useState<number | null>(null);

  // Tâche #68: efface le badge "Messages" dans la sidebar dès que l'utilisateur ouvre la page.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("message-badge-clear"));
  }, []);

  // Tâche #87: deep-link depuis un toast / une notification « Nouveau message ».
  // On lit le param `?id=` au montage, on le mémorise pour aller chercher le
  // message, puis on nettoie l'URL (miroir web du comportement mobile #83).
  useEffect(() => {
    const mId = new URLSearchParams(window.location.search).get("id");
    if (mId && !isNaN(parseInt(mId))) {
      setDeepLinkMessageId(parseInt(mId));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: deepLinkMessage } = useGetMessage(deepLinkMessageId as number, {
    query: { enabled: deepLinkMessageId !== null, queryKey: ["message-deeplink", deepLinkMessageId] },
  });

  useEffect(() => {
    if (deepLinkMessage && deepLinkMessageId !== null) {
      handleOpenEdit(deepLinkMessage);
      setDeepLinkMessageId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkMessage]);

  const queryParams = {
    read: readFilter === "all" ? undefined : readFilter === "read",
    type: typeFilter !== "all" ? typeFilter as any : undefined,
    priority: priorityFilter !== "all" ? priorityFilter as any : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading, error: messagesError } = useListMessages(queryParams, {
    query: { queryKey: getListMessagesQueryKey(queryParams) }
  });

  const { data: contactsData } = useListContacts({ limit: 100 }, { query: { queryKey: ["contacts", "all"] } });

  const updateMessage = useUpdateMessage();
  const createMessage = useCreateMessage();
  const deleteMessage = useDeleteMessage();
  const aiValidation = useAiValidation("message");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      contactId: null as any, phoneNumber: "", content: "", type: "note", priority: "moyenne",
    }
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const handleReadToggle = (id: number, isRead: boolean) => {
    updateMessage.mutate({ id, data: { isRead } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["dashboardSummary"] });
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      },
      onError: () => toast({ title: t("messages.toast.error"), description: t("messages.toast.statusError"), variant: "destructive" }),
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
    if (!data?.messages) return;
    if (selectedIds.size === data.messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.messages.map(m => m.id)));
    }
  };

  const handleBulkMarkRead = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${BASE}/api/bulk/messages/read`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
    if (res.ok) {
      toast({ title: t("messages.toast.bulkRead", { count: ids.length }) });
    } else {
      toast({ title: t("messages.toast.error"), variant: "destructive" });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!(await confirmAction({ title: t("messages.confirm.bulkDelete", { count: selectedIds.size }), confirmLabel: t("common.delete"), destructive: true }))) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${BASE}/api/bulk/messages/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
    if (res.ok) {
      toast({ title: t("messages.toast.bulkDeleted", { count: ids.length }) });
    } else {
      toast({ title: t("messages.toast.bulkDeleteError"), variant: "destructive" });
    }
  };

  const handleDuplicate = async (id: number) => {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${BASE}/api/messages/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: t("messages.toast.duplicated") }); queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() }); }
    else toast({ title: t("messages.toast.error"), description: t("messages.toast.duplicateError"), variant: "destructive" });
  };

  const handleOpenEdit = (message: any) => {
    setEditingMessage(message);
    form.reset({
      contactId: message.contactId ?? null,
      phoneNumber: message.phoneNumber,
      content: message.content,
      type: message.type,
      priority: message.priority,
    });
    setIsDialogOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingMessage(null);
    form.reset({ contactId: null as any, phoneNumber: "", content: "", type: "note", priority: "moyenne" });
    setIsDialogOpen(true);
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (editingMessage) {
      updateMessage.mutate({ id: editingMessage.id, data: values }, {
        onSuccess: () => {
          toast({ title: t("messages.toast.updated") });
          setIsDialogOpen(false);
          setEditingMessage(null);
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
        },
        onError: () => toast({ title: t("messages.toast.error"), description: t("messages.toast.updateError"), variant: "destructive" }),
      });
    } else {
      createMessage.mutate({ data: values }, {
        onSuccess: () => {
          toast({ title: t("messages.toast.created") });
          setIsDialogOpen(false);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
        },
        onError: () => {
          toast({ title: t("messages.toast.error"), description: t("messages.toast.createError"), variant: "destructive" });
        }
      });
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'messagerie_vocale': return <Voicemail className="w-4 h-4 text-amber-500" />;
      case 'note': return <FileText className="w-4 h-4 text-blue-500" />;
      case 'rappel': return <Bell className="w-4 h-4 text-emerald-500" />;
      default: return <MessageSquare className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'messagerie_vocale': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">{t("messages.type.vocalShort")}</Badge>;
      case 'note': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20">{t("messages.type.note")}</Badge>;
      case 'rappel': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">{t("messages.type.rappel")}</Badge>;
      default: return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'haute': return <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{t("messages.priority.haute")}</Badge>;
      case 'moyenne': return <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-amber-500/20 text-amber-700">{t("messages.priority.moyenne")}</Badge>;
      case 'basse': return <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-muted text-muted-foreground">{t("messages.priority.basse")}</Badge>;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={MessageSquare} variant="amber" size="md" /> {t("messages.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("messages.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleBulkMarkRead}>
                <CheckCheck className="w-4 h-4 mr-2" />
                {t("messages.bulkRead", { count: selectedIds.size })}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                {t("messages.bulkDelete", { count: selectedIds.size })}
              </Button>
            </>
          )}
          <a href={`${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/api/messages/export/csv`} download>
            <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />{t("messages.csv")}</Button>
          </a>
          <Button variant="outline" size="sm" title={t("messages.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button onClick={() => setIsEmailComposerOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
            <Send className="w-4 h-4" />
            {t("messages.composeEmail")}
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) setEditingMessage(null); }}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleOpenCreate}>
                <Plus className="w-4 h-4 mr-2" />
                {t("messages.newMessage")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>{editingMessage ? t("messages.dialog.editTitle") : t("messages.dialog.createTitle")}</DialogTitle>
                <DialogDescription>{editingMessage ? t("messages.dialog.editDesc") : t("messages.dialog.createDesc")}</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="type" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("messages.form.type")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="note">{t("messages.type.note")}</SelectItem>
                            <SelectItem value="messagerie_vocale">{t("messages.type.vocal")}</SelectItem>
                            <SelectItem value="rappel">{t("messages.type.rappel")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="priority" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("messages.form.priority")}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="haute">{t("messages.priority.haute")}</SelectItem>
                            <SelectItem value="moyenne">{t("messages.priority.moyenne")}</SelectItem>
                            <SelectItem value="basse">{t("messages.priority.basse")}</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  
                  <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("messages.form.phoneNumber")}</FormLabel>
                      <FormControl><Input aria-label={t("messages.form.phonePlaceholder")} placeholder={t("messages.form.phonePlaceholder")} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="contactId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("messages.form.contact")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                        <FormControl><SelectTrigger aria-label={t("messages.form.chooseContact")}><SelectValue placeholder={t("messages.form.chooseContact")}/></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("messages.form.none")}</SelectItem>
                          {contactsData?.contacts.map(c => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.firstName} {c.lastName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="content" render={({ field }) => {
                    const cidStr = form.getValues("contactId")?.toString();
                    const linkedContact = cidStr && cidStr !== "none"
                      ? contactsData?.contacts.find(c => c.id.toString() === cidStr)
                      : null;
                    return (
                      <FormItem>
                        <FormLabel>{t("messages.form.content")}</FormLabel>
                        <FormControl>
                          <GhostTextarea
                            className="resize-none h-24"
                            placeholder={t("messages.form.contentPlaceholder")}
                            {...field}
                            fieldType="message_content"
                            context={{
                              title: form.getValues("type") ? `Message ${form.getValues("type")}` : null,
                              contactName: linkedContact ? `${linkedContact.firstName} ${linkedContact.lastName}` : null,
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }} />

                  <AiValidationFeedback result={aiValidation.result} isValidating={aiValidation.isValidating} />
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => aiValidation.validate(form.getValues())} disabled={aiValidation.isValidating} className="mr-auto">{t("messages.verifyAi")}</Button>
                    <Button type="submit" disabled={createMessage.isPending || updateMessage.isPending}>{editingMessage ? t("messages.dialog.update") : t("messages.dialog.create")}</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={messagingImg} alt={t("messages.banner.alt")} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-amber-900/80 via-amber-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">{t("messages.banner.title")}</h3>
              <p className="text-white/80 text-sm mt-1">{t("messages.banner.subtitle")}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input aria-label={t("messages.searchPlaceholder")} placeholder={t("messages.searchPlaceholder")} className="pl-9 w-full" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <Select value={readFilter} onValueChange={(v) => { setReadFilter(v); setPage(0); }}>
            <SelectTrigger aria-label={t("messages.filters.readPlaceholder")} className="w-[140px]"><SelectValue placeholder={t("messages.filters.readPlaceholder")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("messages.filters.all")}</SelectItem>
              <SelectItem value="unread">{t("messages.filters.unread")}</SelectItem>
              <SelectItem value="read">{t("messages.filters.read")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger aria-label={t("messages.filters.typePlaceholder")} className="w-[140px]"><SelectValue placeholder={t("messages.filters.typePlaceholder")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("messages.filters.allTypes")}</SelectItem>
              <SelectItem value="messagerie_vocale">{t("messages.type.vocalShort")}</SelectItem>
              <SelectItem value="note">{t("messages.type.note")}</SelectItem>
              <SelectItem value="rappel">{t("messages.type.rappel")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(0); }}>
            <SelectTrigger aria-label={t("messages.filters.priorityPlaceholder")} className="w-[140px]"><SelectValue placeholder={t("messages.filters.priorityPlaceholder")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("messages.filters.allPriorities")}</SelectItem>
              <SelectItem value="haute">{t("messages.priority.haute")}</SelectItem>
              <SelectItem value="moyenne">{t("messages.priority.moyenne")}</SelectItem>
              <SelectItem value="basse">{t("messages.priority.basse")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {messagesError && <QueryErrorAlert error={messagesError as Error} title={t("messages.loadError")} />}

      <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={data?.messages?.length ? selectedIds.size === data.messages.length : false}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead>{t("messages.columns.from")}</TableHead>
              <TableHead>{t("messages.columns.type")}</TableHead>
              <TableHead>{t("messages.columns.priority")}</TableHead>
              <TableHead className="w-1/3">{t("messages.columns.content")}</TableHead>
              <TableHead>{t("messages.columns.date")}</TableHead>
              <TableHead className="text-right">{t("messages.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="w-4 h-4" /></TableCell>
                  <TableCell><Skeleton className="w-6 h-6 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32 mb-1" /><Skeleton className="h-3 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : data?.messages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8">
                  {(search !== "" || readFilter !== "all" || typeFilter !== "all" || priorityFilter !== "all") ? (
                    <p className="text-center text-muted-foreground" data-testid="no-results-messages">{t("messages.empty.filtered")}</p>
                  ) : (
                    <EmptyOnboardingHint
                      icon={MessageSquare}
                      title={t("messages.empty.title")}
                      description={t("messages.empty.description")}
                      actionLabel={t("messages.empty.action")}
                      onAction={handleOpenCreate}
                      tip={t("messages.empty.tip")}
                      testIdPrefix="empty-messages"
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              data?.messages.map((message) => (
                <TableRow key={message.id} className={`hover:bg-muted/30 transition-colors ${!message.isRead ? 'bg-primary/5' : ''} ${selectedIds.has(message.id) ? 'ring-1 ring-inset ring-primary/20' : ''}`}>
                  <TableCell>
                    <Checkbox checked={selectedIds.has(message.id)} onCheckedChange={() => toggleSelect(message.id)} />
                  </TableCell>
                  <TableCell>
                    <div className={`flex items-center justify-center p-2 rounded-full ${!message.isRead ? 'bg-primary/10' : 'bg-muted'}`}>
                      {getTypeIcon(message.type)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className={`font-medium ${!message.isRead ? 'text-foreground font-bold' : 'text-foreground'}`}>
                      {message.contactId ? (
                        <Link href={`/contacts/${message.contactId}`} className="hover:underline hover:text-primary transition-colors">
                          {message.contactName || t("messages.unknown")}
                        </Link>
                      ) : (
                        message.contactName || t("messages.unknown")
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{message.phoneNumber}</div>
                  </TableCell>
                  <TableCell>
                    {getTypeBadge(message.type)}
                  </TableCell>
                  <TableCell>
                    {getPriorityBadge(message.priority)}
                  </TableCell>
                  <TableCell>
                    <p className={`text-sm line-clamp-2 ${!message.isRead ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {message.content}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-foreground">
                      {format(new Date(message.createdAt), "d MMM yyyy", { locale: fr })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(message.createdAt), "HH:mm", { locale: fr })}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" aria-label={t("common.moreActions")}>
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{t("messages.actionsLabel")}</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleOpenEdit(message)}>
                          <Edit className="w-4 h-4 mr-2" />{t("messages.rowActions.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(message.id)}>
                          <Copy className="w-4 h-4 mr-2" />{t("messages.rowActions.duplicate")}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-indigo-600" onClick={async () => {
                          const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
                          const res = await fetch(`${BASE}/api/projets`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ title: message.contactName ? t("messages.projectTitleWith", { name: message.contactName }) : t("messages.projectTitleDefault"), status: "planifie", priority: (message.priority as string) || "moyenne", progress: 0, notes: t("messages.projectNotes") }) });
                          if (res.ok) { toast({ title: t("messages.toast.projectCreated") }); setLocation("/projets"); }
                          else toast({ title: t("messages.toast.error"), variant: "destructive" });
                        }}><FolderKanban className="w-4 h-4 mr-2" />{t("messages.rowActions.createProject")}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleReadToggle(message.id, !message.isRead)}>
                          {message.isRead ? (
                            <><Mail className="w-4 h-4 mr-2" /> {t("messages.rowActions.markUnread")}</>
                          ) : (
                            <><MailOpen className="w-4 h-4 mr-2" /> {t("messages.rowActions.markRead")}</>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={async () => {
                          if (!(await confirmAction({ title: t("messages.confirm.deleteOne"), confirmLabel: t("common.delete"), destructive: true }))) return;
                          deleteMessage.mutate({ id: message.id }, {
                            onSuccess: () => { toast({ title: t("messages.toast.deleted") }); queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() }); },
                            onError: () => toast({ title: t("messages.toast.error"), description: t("messages.toast.deleteError"), variant: "destructive" }),
                          });
                        }}><Trash2 className="w-4 h-4 mr-2" />{t("messages.rowActions.delete")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AiSuggestionsCard page="messages" title={t("messages.aiTitle")} compact />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? t("messages.pagination", { total: data.total, page: page + 1, pages: totalPages }) : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(0)} aria-label={t("common.firstPage")}><ChevronsLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label={t("common.previousPage")}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} aria-label={t("common.nextPage")}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} aria-label={t("common.lastPage")}><ChevronsRight className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </div>
      <EmailComposer
        isOpen={isEmailComposerOpen}
        onClose={() => setIsEmailComposerOpen(false)}
      />
    </div>
  );
}
