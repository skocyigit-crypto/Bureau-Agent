import { AiValidationFeedback } from "@/components/ai-validation-feedback";
import { EmailComposer } from "@/components/email-composer";
import { DocumentsPanel } from "@/components/file-upload";
import { QueryErrorAlert } from "@/components/safe-component";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,DialogTrigger } from "@/components/ui/dialog";
import { Form,FormControl,FormField,FormItem,FormLabel,FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAiValidation } from "@/hooks/use-ai-validation";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { getGetContactCallsQueryKey,getGetContactQueryKey,getGetContactTasksQueryKey,useGetContact,useGetContactCalls,useGetContactTasks,useUpdateContact } from "@workspace/api-client-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertCircle,ArrowLeft,Building,Calendar,CheckSquare,Clock,Edit,FolderKanban,Mail,MapPin,Phone,PhoneCall,PhoneMissed,Plus,Printer,Save,Send,Tag,Voicemail,X } from "lucide-react";
import { useCallback,useEffect,useRef,useState } from "react";
import { useForm } from "react-hook-form";
import { Link,useLocation,useRoute } from "wouter";
import * as z from "zod";

const formSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis"),
  lastName: z.string().min(1, "Le nom est requis"),
  company: z.string().optional().nullable(),
  email: z.string().email("Email invalide").optional().nullable().or(z.literal('')),
  phone: z.string().min(1, "Le téléphone est requis"),
  mobile: z.string().optional().nullable(),
  category: z.enum(["client", "prospect", "fournisseur", "partenaire", "autre"]),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export default function ContactDetail() {
  const { t } = useTranslation();
  const [, params] = useRoute("/contacts/:id");
  const contactId = params?.id ? parseInt(params.id) : 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isEmailComposerOpen, setIsEmailComposerOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [projetsData, setProjetsData] = useState<any[]>([]);
  const [isProjetsLoading, setIsProjetsLoading] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const aiValidation = useAiValidation("contact");
  const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  const { data: contact, isLoading: isContactLoading, error: contactError } = useGetContact(contactId, {
    query: { enabled: !!contactId, queryKey: getGetContactQueryKey(contactId) }
  });

  const { data: callsData, isLoading: isCallsLoading } = useGetContactCalls(contactId, { limit: 10 }, {
    query: { enabled: !!contactId, queryKey: getGetContactCallsQueryKey(contactId, { limit: 10 }) }
  });

  const { data: tasksData, isLoading: isTasksLoading } = useGetContactTasks(contactId, {
    query: { enabled: !!contactId, queryKey: getGetContactTasksQueryKey(contactId) }
  });

  const updateContact = useUpdateContact();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      company: "",
      email: "",
      phone: "",
      mobile: "",
      category: "client",
      address: "",
      notes: "",
    }
  });

  // Garde anti-course : une navigation rapide entre contacts peut faire résoudre
  // une ancienne requête après la nouvelle et écraser les projets du mauvais contact.
  const activeContactIdRef = useRef(contactId);
  activeContactIdRef.current = contactId;

  const loadProjetsData = useCallback(async () => {
    if (!contactId) return;
    const reqId = contactId;
    setIsProjetsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/projets?contactId=${contactId}&limit=20`, { credentials: "include" });
      if (activeContactIdRef.current !== reqId) return;
      if (res.ok) { const d = await res.json(); setProjetsData(d.projets || []); }
    } catch {}
    finally { if (activeContactIdRef.current === reqId) setIsProjetsLoading(false); }
  }, [contactId, BASE]);

  const formInitialized = useRef(false);
  useEffect(() => {
    // Navigating from one contact's page to another's reuses this component
    // instance (same route, only the :id param changes) — reset the
    // one-shot init guard so the form/tags effect below re-initializes for
    // the new contact instead of leaving the previous contact's data shown.
    formInitialized.current = false;
    if (contactId) { loadProjetsData(); }
  }, [contactId, loadProjetsData]);

  useEffect(() => {
    if (contact && !formInitialized.current) {
      form.reset({
        firstName: contact.firstName,
        lastName: contact.lastName,
        company: contact.company || "",
        email: contact.email || "",
        phone: contact.phone,
        mobile: contact.mobile || "",
        category: contact.category,
        address: contact.address || "",
        notes: contact.notes || "",
      });
      formInitialized.current = true;
      if ((contact as any).tags) setTags((contact as any).tags as string[]);
    }
  }, [contact, form]);

  const saveTags = async (newTags: string[]) => {
    setIsSavingTags(true);
    try {
      await fetch(`${BASE}/api/contacts/${contactId}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: newTags }),
      });
      queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
    } finally {
      setIsSavingTags(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) { setTagInput(""); return; }
    const next = [...tags, t];
    setTags(next);
    setTagInput("");
    saveTags(next);
  };

  const removeTag = (tag: string) => {
    const next = tags.filter(t => t !== tag);
    setTags(next);
    saveTags(next);
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    updateContact.mutate({ id: contactId, data: values }, {
      onSuccess: () => {
        toast({ title: t("contactDetail.updated") });
        setIsEditDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
      },
      onError: () => {
        toast({ title: t("contactDetail.error"), description: t("contactDetail.updateError"), variant: "destructive" });
      }
    });
  };

  if (isContactLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-64 md:col-span-1" />
          <Skeleton className="h-64 md:col-span-2" />
        </div>
      </div>
    );
  }

  if (contactError) return <QueryErrorAlert error={contactError as Error} title={t("contactDetail.loadError")} />;
  if (!contact) return <div>{t("contactDetail.notFound")}</div>;

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'client': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20">{t("contactDetail.cat.client")}</Badge>;
      case 'prospect': return <Badge variant="secondary" className="bg-purple-500/10 text-purple-600 border-purple-500/20">{t("contactDetail.cat.prospect")}</Badge>;
      case 'fournisseur': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">{t("contactDetail.cat.fournisseur")}</Badge>;
      case 'partenaire': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">{t("contactDetail.cat.partenaire")}</Badge>;
      default: return <Badge variant="outline" className="capitalize">{category}</Badge>;
    }
  };

  const getCallStatusBadge = (status: string) => {
    switch (status) {
      case 'repondu': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">{t("contactDetail.callStatus.repondu")}</Badge>;
      case 'manque': return <Badge variant="secondary" className="bg-destructive/10 text-destructive border-destructive/20"><PhoneMissed className="w-3 h-3 mr-1" /> {t("contactDetail.callStatus.manque")}</Badge>;
      case 'messagerie': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Voicemail className="w-3 h-3 mr-1" /> {t("contactDetail.callStatus.messagerie")}</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTaskStatusBadge = (status: string) => {
    switch (status) {
      case 'en_attente': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Clock className="w-3 h-3 mr-1" /> {t("contactDetail.taskStatus.en_attente")}</Badge>;
      case 'en_cours': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><AlertCircle className="w-3 h-3 mr-1" /> {t("contactDetail.taskStatus.en_cours")}</Badge>;
      case 'termine': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><CheckSquare className="w-3 h-3 mr-1" /> {t("contactDetail.taskStatus.termine")}</Badge>;
      default: return <Badge variant="outline" className="capitalize">{status.replace('_', ' ')}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/contacts"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight flex-1">{contact.firstName} {contact.lastName}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" title={t("contactDetail.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setIsEmailComposerOpen(true)} className="gap-2">
            <Send className="w-4 h-4" /> {t("contactDetail.emailIa")}
          </Button>
          <Button className="bg-primary text-primary-foreground" onClick={() => {
            if (contact?.phone) {
              window.open(`tel:${contact.phone}`, "_self");
            } else {
              toast({ title: t("contactDetail.noPhone"), variant: "destructive" });
            }
          }}>
            <PhoneCall className="w-4 h-4 mr-2" /> {t("contactDetail.call")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-1">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>{t("contactDetail.profile")}</CardTitle>
                <CardDescription>{t("contactDetail.profileDesc")}</CardDescription>
              </div>
              <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("common.edit")}><Edit className="w-4 h-4" aria-hidden="true" /></Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px]">
                  <DialogHeader>
                    <DialogTitle>{t("contactDetail.editContact")}</DialogTitle>
                    <DialogDescription>{t("contactDetail.editContactDesc")}</DialogDescription>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="firstName" render={({ field }) => (
                          <FormItem><FormLabel>{t("contactDetail.firstName")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="lastName" render={({ field }) => (
                          <FormItem><FormLabel>{t("contactDetail.lastName")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="company" render={({ field }) => (
                          <FormItem><FormLabel>{t("contactDetail.company")}</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="category" render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("contactDetail.category")}</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder={t("contactDetail.selectPlaceholder")} /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="client">{t("contactDetail.cat.client")}</SelectItem>
                                <SelectItem value="prospect">{t("contactDetail.cat.prospect")}</SelectItem>
                                <SelectItem value="fournisseur">{t("contactDetail.cat.fournisseur")}</SelectItem>
                                <SelectItem value="partenaire">{t("contactDetail.cat.partenaire")}</SelectItem>
                                <SelectItem value="autre">{t("contactDetail.cat.autre")}</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="phone" render={({ field }) => (
                          <FormItem><FormLabel>{t("contactDetail.phone")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="mobile" render={({ field }) => (
                          <FormItem><FormLabel>{t("contactDetail.mobile")}</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <FormField control={form.control} name="email" render={({ field }) => (
                        <FormItem><FormLabel>{t("contactDetail.email")}</FormLabel><FormControl><Input type="email" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="address" render={({ field }) => (
                        <FormItem><FormLabel>{t("contactDetail.address")}</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="notes" render={({ field }) => (
                        <FormItem><FormLabel>{t("contactDetail.notes")}</FormLabel><FormControl><Textarea className="resize-none" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <AiValidationFeedback result={aiValidation.result} isValidating={aiValidation.isValidating} />
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => aiValidation.validate(form.getValues())} disabled={aiValidation.isValidating} className="mr-auto">{t("contactDetail.verifyAi")}</Button>
                        <Button type="submit" disabled={updateContact.isPending}>{t("common.save")}</Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-center py-4">
                <div className="w-20 h-20 rounded-full bg-secondary/10 flex items-center justify-center text-3xl font-medium text-secondary">
                  {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
                </div>
              </div>
              <div className="flex justify-center mb-4">{getCategoryBadge(contact.category)}</div>
              <div className="space-y-3 text-sm">
                {contact.company && <div className="flex items-center gap-3"><Building className="w-4 h-4 text-muted-foreground" /><span>{contact.company}</span></div>}
                <div className="flex items-center gap-3"><Phone className="w-4 h-4 text-muted-foreground" /><span>{contact.phone}</span></div>
                {contact.mobile && <div className="flex items-center gap-3"><Phone className="w-4 h-4 text-muted-foreground" /><span>{contact.mobile}</span></div>}
                {contact.email && <div className="flex items-center gap-3"><Mail className="w-4 h-4 text-muted-foreground" /><span>{contact.email}</span></div>}
                {contact.address && <div className="flex items-start gap-3"><MapPin className="w-4 h-4 text-muted-foreground mt-0.5" /><span className="flex-1">{contact.address}</span></div>}
              </div>
              {((contact as any).createdByName || (contact as any).updatedByName) && (
                <div className="pt-4 mt-4 border-t border-border space-y-1.5 text-xs text-muted-foreground">
                  {(contact as any).createdByName && (
                    <div>{t("contactDetail.createdBy")} <span className="font-medium text-foreground">{(contact as any).createdByName}</span> {contact.createdAt && <>— {format(new Date(contact.createdAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</>}</div>
                  )}
                  {(contact as any).updatedByName && contact.updatedAt && (
                    <div>{t("contactDetail.updatedBy")} <span className="font-medium text-foreground">{(contact as any).updatedByName}</span> — {format(new Date(contact.updatedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("contactDetail.stats")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center pb-4 border-b border-border">
                <span className="text-muted-foreground text-sm">{t("contactDetail.totalCalls")}</span>
                <span className="font-bold text-lg">{contact.totalCalls}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">{t("contactDetail.lastContact")}</span>
                <span className="font-medium text-sm">{contact.lastCallAt ? format(new Date(contact.lastCallAt), "d MMM yyyy", { locale: fr }) : t("contactDetail.never")}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Tag className="w-4 h-4 text-muted-foreground" />{t("contactDetail.tags")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 mb-3 min-h-[28px]">
                {tags.length === 0 && <span className="text-xs text-muted-foreground italic">{t("contactDetail.noTags")}</span>}
                {tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full border border-primary/20">
                    {tag}
                    <button onClick={() => removeTag(tag)} disabled={isSavingTags} className="hover:text-destructive transition-colors" aria-label={t("common.close")}><X className="w-3 h-3" aria-hidden="true" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  className="flex-1 text-xs border border-input rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder={t("contactDetail.addTag")}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  disabled={isSavingTags}
                />
                <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={addTag} disabled={!tagInput.trim() || isSavingTags}>+</Button>
              </div>
            </CardContent>
          </Card>

          <DocumentsPanel entityType="contact" entityId={contact.id} />
        </div>

        <div className="md:col-span-2">
          <Tabs defaultValue="calls">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="calls">{t("contactDetail.tabCalls")}</TabsTrigger>
              <TabsTrigger value="tasks">{t("contactDetail.tabTasks")}</TabsTrigger>
              <TabsTrigger value="projets">{t("contactDetail.tabProjets")}</TabsTrigger>
              <TabsTrigger value="notes">{t("contactDetail.tabNotes")}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="calls" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>{t("contactDetail.callsHistory")}</CardTitle>
                    <CardDescription>{t("contactDetail.callsHistoryDesc")}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/appels?contactId=${contactId}`)}><Plus className="w-4 h-4 mr-2" /> {t("contactDetail.newCall")}</Button>
                </CardHeader>
                <CardContent>
                  {isCallsLoading ? (
                    <div className="space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
                  ) : callsData?.calls && callsData.calls.length > 0 ? (
                    <div className="space-y-4">
                      {callsData.calls.map(call => (
                        <div key={call.id} className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/30">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              {getCallStatusBadge(call.status)}
                              <span className="text-sm font-medium">
                                {call.direction === 'entrant' ? t("contactDetail.callIncoming") : t("contactDetail.callOutgoing")}
                              </span>
                            </div>
                            <span className="text-sm text-muted-foreground flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {format(new Date(call.createdAt), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
                            </span>
                          </div>
                          <Button variant="ghost" size="icon" asChild>
                            <Link href={`/appels/${call.id}`}><ArrowLeft className="w-4 h-4 rotate-180" /></Link>
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">{t("contactDetail.noCalls")}</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="tasks" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>{t("contactDetail.linkedTasks")}</CardTitle>
                    <CardDescription>{t("contactDetail.linkedTasksDesc")}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/taches?contactId=${contactId}`)}><Plus className="w-4 h-4 mr-2" /> {t("contactDetail.newTask")}</Button>
                </CardHeader>
                <CardContent>
                  {isTasksLoading ? (
                    <div className="space-y-4">{[1,2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
                  ) : tasksData?.tasks && tasksData.tasks.length > 0 ? (
                    <div className="space-y-4">
                      {tasksData.tasks.map(task => (
                        <div key={task.id} className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/30">
                          <div className="flex flex-col gap-1">
                            <div className="font-medium">{task.title}</div>
                            <div className="flex items-center gap-2 mt-1">
                              {getTaskStatusBadge(task.status)}
                              {task.dueDate && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Calendar className="w-3 h-3" /> {format(new Date(task.dueDate), "d MMM", { locale: fr })}
                                </span>
                              )}
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" aria-label={t("common.edit")}><Edit className="w-4 h-4" aria-hidden="true" /></Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">{t("contactDetail.noTasks")}</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="projets" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><FolderKanban className="w-4 h-4 text-indigo-500" />{t("contactDetail.linkedProjets")}</CardTitle>
                    <CardDescription>{t("contactDetail.linkedProjetsDesc")}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/projets`)}>
                    <Plus className="w-4 h-4 mr-1" />{t("contactDetail.new")}
                  </Button>
                </CardHeader>
                <CardContent>
                  {isProjetsLoading ? (
                    <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
                  ) : projetsData.length > 0 ? (
                    <div className="space-y-2">
                      {projetsData.map((p: any) => {
                        const statusColors: Record<string, string> = { en_cours: "bg-blue-100 text-blue-700", planifie: "bg-amber-100 text-amber-700", termine: "bg-emerald-100 text-emerald-700", suspendu: "bg-gray-100 text-gray-700", annule: "bg-red-100 text-red-700" };
                        const statusLabels: Record<string, string> = { en_cours: t("contactDetail.projStatus.en_cours"), planifie: t("contactDetail.projStatus.planifie"), termine: t("contactDetail.projStatus.termine"), suspendu: t("contactDetail.projStatus.suspendu"), annule: t("contactDetail.projStatus.annule") };
                        return (
                          <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 text-sm">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{p.title}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${statusColors[p.status] ?? "bg-gray-100 text-gray-700"}`}>{statusLabels[p.status] ?? p.status}</span>
                                {p.progress != null && <span className="text-xs text-muted-foreground">{p.progress}%</span>}
                                {p.endDate && <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Calendar className="w-3 h-3" />{format(new Date(p.endDate), "dd/MM/yy")}</span>}
                              </div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/projets`)}><ArrowLeft className="w-3.5 h-3.5 rotate-180" /></Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">{t("contactDetail.noProjets")}</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle>{t("contactDetail.generalNotes")}</CardTitle>
                    <CardDescription>{t("contactDetail.generalNotesDesc")}</CardDescription>
                  </div>
                  {!isEditingNotes ? (
                    <Button variant="outline" size="sm" onClick={() => { setNotesValue(contact.notes || ""); setIsEditingNotes(true); }}>
                      <Edit className="w-3.5 h-3.5 mr-1" />{t("common.edit")}
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setIsEditingNotes(false)}>{t("common.cancel")}</Button>
                      <Button size="sm" disabled={isSavingNotes} onClick={async () => {
                        setIsSavingNotes(true);
                        try {
                          await updateContact.mutateAsync({ id: contactId, data: { notes: notesValue } });
                          queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
                          setIsEditingNotes(false);
                        } finally { setIsSavingNotes(false); }
                      }}>
                        <Save className="w-3.5 h-3.5 mr-1" />{isSavingNotes ? t("contactDetail.saving") : t("common.save")}
                      </Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  {isEditingNotes ? (
                    <Textarea
                      className="resize-none min-h-[160px] text-sm"
                      value={notesValue}
                      onChange={e => setNotesValue(e.target.value)}
                      placeholder={t("contactDetail.notesPlaceholder")}
                    />
                  ) : contact.notes ? (
                    <div className="p-4 bg-muted/50 rounded-lg whitespace-pre-wrap text-sm border border-border">
                      {contact.notes}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground italic">{t("contactDetail.noNotes")}</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <EmailComposer
        isOpen={isEmailComposerOpen}
        onClose={() => setIsEmailComposerOpen(false)}
        preselectedContactId={contactId}
      />
    </div>
  );
}