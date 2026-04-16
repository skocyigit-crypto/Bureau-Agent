import { useState } from "react";
import { useListMessages, useUpdateMessage, useCreateMessage, useDeleteMessage, getListMessagesQueryKey, useListContacts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { MessageSquare, Voicemail, FileText, Bell, Search, Filter, MoreHorizontal, MailOpen, Mail, Plus, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CheckCheck, Send } from "lucide-react";
import { Icon3D } from "@/components/icon-3d";
import messagingImg from "@/assets/images/messaging-center.png";
import { EmailComposer } from "@/components/email-composer";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { AiValidationFeedback } from "@/components/ai-validation-feedback";
import { useAiValidation } from "@/hooks/use-ai-validation";
import { QueryErrorAlert } from "@/components/safe-component";
import { Link } from "wouter";

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
  const { toast } = useToast();
  const [readFilter, setReadFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isEmailComposerOpen, setIsEmailComposerOpen] = useState(false);

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
      onError: () => toast({ title: "Erreur", description: "Impossible de modifier le statut du message", variant: "destructive" }),
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
    let successCount = 0;
    let failCount = 0;
    await Promise.all(ids.map(id => new Promise<void>((resolve) => {
      updateMessage.mutate({ id, data: { isRead: true } }, { onSuccess: () => { successCount++; resolve(); }, onError: () => { failCount++; resolve(); } });
    })));
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
    if (failCount > 0) {
      toast({ title: `${successCount} marque(s) lu(s), ${failCount} echoue(s)`, variant: "destructive" });
    } else {
      toast({ title: `${ids.length} message(s) marque(s) comme lu(s)` });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    let successCount = 0;
    let failCount = 0;
    await Promise.all(ids.map(id => new Promise<void>((resolve) => {
      deleteMessage.mutate({ id }, { onSuccess: () => { successCount++; resolve(); }, onError: () => { failCount++; resolve(); } });
    })));
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
    if (failCount > 0) {
      toast({ title: `${successCount} supprime(s), ${failCount} echoue(s)`, variant: "destructive" });
    } else {
      toast({ title: `${ids.length} message(s) supprime(s)` });
    }
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createMessage.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Message enregistre" });
        setIsDialogOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey() });
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible d'enregistrer le message", variant: "destructive" });
      }
    });
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
      case 'messagerie_vocale': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">Vocal</Badge>;
      case 'note': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20">Note</Badge>;
      case 'rappel': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Rappel</Badge>;
      default: return <Badge variant="outline">{type}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'haute': return <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Haute</Badge>;
      case 'moyenne': return <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-amber-500/20 text-amber-700">Moyenne</Badge>;
      case 'basse': return <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-muted text-muted-foreground">Basse</Badge>;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={MessageSquare} variant="amber" size="md" /> Messages & Notes</h1>
          <p className="text-muted-foreground mt-1">Consultez les messages vocaux et notes laisses par les appelants.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleBulkMarkRead}>
                <CheckCheck className="w-4 h-4 mr-2" />
                Tout lire ({selectedIds.size})
              </Button>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                Supprimer ({selectedIds.size})
              </Button>
            </>
          )}
          <Button onClick={() => setIsEmailComposerOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
            <Send className="w-4 h-4" />
            Rediger un e-mail IA
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                Nouveau Message
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Enregistrer un message</DialogTitle>
                <DialogDescription>Ajoutez une note, un rappel ou consignez un message vocal.</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="type" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="note">Note</SelectItem>
                            <SelectItem value="messagerie_vocale">Message vocal</SelectItem>
                            <SelectItem value="rappel">Rappel</SelectItem>
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
                          <SelectItem value="none">Aucun</SelectItem>
                          {contactsData?.contacts.map(c => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.firstName} {c.lastName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="content" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contenu du message</FormLabel>
                      <FormControl><Textarea className="resize-none h-24" placeholder="Saisissez le contenu..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <AiValidationFeedback result={aiValidation.result} isValidating={aiValidation.isValidating} />
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => aiValidation.validate(form.getValues())} disabled={aiValidation.isValidating} className="mr-auto">Verifier IA</Button>
                    <Button type="submit" disabled={createMessage.isPending}>Enregistrer</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={messagingImg} alt="Centre de messagerie" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-amber-900/80 via-amber-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">Centre de messagerie</h3>
              <p className="text-white/80 text-sm mt-1">Messages vocaux, notes et rappels — tout centralise en un seul endroit.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Rechercher un message..." className="pl-9 w-full" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <Select value={readFilter} onValueChange={(v) => { setReadFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Lecture" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="unread">Non lus</SelectItem>
              <SelectItem value="read">Lus</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous types</SelectItem>
              <SelectItem value="messagerie_vocale">Vocal</SelectItem>
              <SelectItem value="note">Note</SelectItem>
              <SelectItem value="rappel">Rappel</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Priorite" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              <SelectItem value="haute">Haute</SelectItem>
              <SelectItem value="moyenne">Moyenne</SelectItem>
              <SelectItem value="basse">Basse</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {messagesError && <QueryErrorAlert error={messagesError as Error} title="Impossible de charger les messages" />}

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
              <TableHead>De</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Priorite</TableHead>
              <TableHead className="w-1/3">Contenu</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
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
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  Aucun message trouve.
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
                          {message.contactName || "Inconnu"}
                        </Link>
                      ) : (
                        message.contactName || "Inconnu"
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
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleReadToggle(message.id, !message.isRead)}>
                          {message.isRead ? (
                            <><Mail className="w-4 h-4 mr-2" /> Marquer non lu</>
                          ) : (
                            <><MailOpen className="w-4 h-4 mr-2" /> Marquer lu</>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AiSuggestionsCard page="messages" title="Recommandations IA - Messages" compact />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total} message(s) - Page ${page + 1} sur ${totalPages}` : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(0)}><ChevronsLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}><ChevronsRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <EmailComposer
        isOpen={isEmailComposerOpen}
        onClose={() => setIsEmailComposerOpen(false)}
      />
    </div>
  );
}
