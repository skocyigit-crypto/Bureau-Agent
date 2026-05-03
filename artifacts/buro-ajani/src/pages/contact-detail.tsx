import { useRoute, useLocation } from "wouter";
import { useGetContact, useGetContactCalls, useGetContactTasks, getGetContactQueryKey, useUpdateContact, getGetContactCallsQueryKey, getGetContactTasksQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useState, useEffect, useRef, useCallback } from "react";
import { Phone, Mail, Building, MapPin, Calendar, Clock, Edit, FileText, Plus, PhoneCall, ArrowLeft, MoreHorizontal, Voicemail, PhoneMissed, CheckSquare, AlertCircle, Send, Tag, X, Receipt, Euro, Save, Printer, FolderKanban } from "lucide-react";
import { EmailComposer } from "@/components/email-composer";
import { DocumentsPanel } from "@/components/file-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { AiValidationFeedback } from "@/components/ai-validation-feedback";
import { useAiValidation } from "@/hooks/use-ai-validation";

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
  const [devisData, setDevisData] = useState<{ devis: any[], factures: any[] } | null>(null);
  const [isDevisLoading, setIsDevisLoading] = useState(false);
  const [projetsData, setProjetsData] = useState<any[]>([]);
  const [isProjetsLoading, setIsProjetsLoading] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const aiValidation = useAiValidation("contact");
  const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

  const { data: contact, isLoading: isContactLoading } = useGetContact(contactId, {
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

  const loadDevisData = useCallback(async () => {
    if (!contactId) return;
    setIsDevisLoading(true);
    try {
      const res = await fetch(`${BASE}/api/contacts/${contactId}/devis`, { credentials: "include" });
      if (res.ok) setDevisData(await res.json());
    } catch {}
    finally { setIsDevisLoading(false); }
  }, [contactId, BASE]);

  const loadProjetsData = useCallback(async () => {
    if (!contactId) return;
    setIsProjetsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/projets?contactId=${contactId}&limit=20`, { credentials: "include" });
      if (res.ok) { const d = await res.json(); setProjetsData(d.projets || []); }
    } catch {}
    finally { setIsProjetsLoading(false); }
  }, [contactId, BASE]);

  const formInitialized = useRef(false);
  useEffect(() => {
    if (contactId) { loadDevisData(); loadProjetsData(); }
  }, [contactId, loadDevisData, loadProjetsData]);

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
        toast({ title: "Contact mis à jour" });
        setIsEditDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible de mettre à jour le contact", variant: "destructive" });
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

  if (!contact) return <div>Contact introuvable</div>;

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'client': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20">Client</Badge>;
      case 'prospect': return <Badge variant="secondary" className="bg-purple-500/10 text-purple-600 border-purple-500/20">Prospect</Badge>;
      case 'fournisseur': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">Fournisseur</Badge>;
      case 'partenaire': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Partenaire</Badge>;
      default: return <Badge variant="outline" className="capitalize">{category}</Badge>;
    }
  };

  const getCallStatusBadge = (status: string) => {
    switch (status) {
      case 'repondu': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Répondu</Badge>;
      case 'manque': return <Badge variant="secondary" className="bg-destructive/10 text-destructive border-destructive/20"><PhoneMissed className="w-3 h-3 mr-1" /> Manqué</Badge>;
      case 'messagerie': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Voicemail className="w-3 h-3 mr-1" /> Messagerie</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTaskStatusBadge = (status: string) => {
    switch (status) {
      case 'en_attente': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Clock className="w-3 h-3 mr-1" /> En attente</Badge>;
      case 'en_cours': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><AlertCircle className="w-3 h-3 mr-1" /> En cours</Badge>;
      case 'termine': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><CheckSquare className="w-3 h-3 mr-1" /> Terminé</Badge>;
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
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => setIsEmailComposerOpen(true)} className="gap-2">
            <Send className="w-4 h-4" /> E-mail IA
          </Button>
          <Button className="bg-primary text-primary-foreground" onClick={() => {
            if (contact?.phone) {
              window.open(`tel:${contact.phone}`, "_self");
            } else {
              toast({ title: "Aucun numéro de téléphone", variant: "destructive" });
            }
          }}>
            <PhoneCall className="w-4 h-4 mr-2" /> Appeler
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-1">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Profil</CardTitle>
                <CardDescription>Détails du contact</CardDescription>
              </div>
              <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon"><Edit className="w-4 h-4" /></Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px]">
                  <DialogHeader>
                    <DialogTitle>Modifier le contact</DialogTitle>
                    <DialogDescription>Mettez à jour les informations du contact.</DialogDescription>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="firstName" render={({ field }) => (
                          <FormItem><FormLabel>Prénom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="lastName" render={({ field }) => (
                          <FormItem><FormLabel>Nom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="company" render={({ field }) => (
                          <FormItem><FormLabel>Entreprise</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="category" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Catégorie</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="client">Client</SelectItem>
                                <SelectItem value="prospect">Prospect</SelectItem>
                                <SelectItem value="fournisseur">Fournisseur</SelectItem>
                                <SelectItem value="partenaire">Partenaire</SelectItem>
                                <SelectItem value="autre">Autre</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="phone" render={({ field }) => (
                          <FormItem><FormLabel>Téléphone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="mobile" render={({ field }) => (
                          <FormItem><FormLabel>Mobile</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                      <FormField control={form.control} name="email" render={({ field }) => (
                        <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="address" render={({ field }) => (
                        <FormItem><FormLabel>Adresse</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="notes" render={({ field }) => (
                        <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea className="resize-none" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <AiValidationFeedback result={aiValidation.result} isValidating={aiValidation.isValidating} />
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => aiValidation.validate(form.getValues())} disabled={aiValidation.isValidating} className="mr-auto">Verifier IA</Button>
                        <Button type="submit" disabled={updateContact.isPending}>Enregistrer</Button>
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
                    <div>Créé par <span className="font-medium text-foreground">{(contact as any).createdByName}</span> {contact.createdAt && <>— {format(new Date(contact.createdAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</>}</div>
                  )}
                  {(contact as any).updatedByName && contact.updatedAt && (
                    <div>Modifié par <span className="font-medium text-foreground">{(contact as any).updatedByName}</span> — {format(new Date(contact.updatedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Statistiques</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center pb-4 border-b border-border">
                <span className="text-muted-foreground text-sm">Total des appels</span>
                <span className="font-bold text-lg">{contact.totalCalls}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">Dernier contact</span>
                <span className="font-medium text-sm">{contact.lastCallAt ? format(new Date(contact.lastCallAt), "d MMM yyyy", { locale: fr }) : "Jamais"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Tag className="w-4 h-4 text-muted-foreground" />Étiquettes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 mb-3 min-h-[28px]">
                {tags.length === 0 && <span className="text-xs text-muted-foreground italic">Aucune étiquette</span>}
                {tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full border border-primary/20">
                    {tag}
                    <button onClick={() => removeTag(tag)} disabled={isSavingTags} className="hover:text-destructive transition-colors"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  className="flex-1 text-xs border border-input rounded-md px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Ajouter une étiquette..."
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
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="calls">Appels</TabsTrigger>
              <TabsTrigger value="tasks">Tâches</TabsTrigger>
              <TabsTrigger value="projets">Projets</TabsTrigger>
              <TabsTrigger value="documents">Devis & Fact.</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>
            
            <TabsContent value="calls" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Historique des appels</CardTitle>
                    <CardDescription>Les 10 derniers appels avec ce contact</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/appels?contactId=${contactId}`)}><Plus className="w-4 h-4 mr-2" /> Nouvel appel</Button>
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
                                {call.direction === 'entrant' ? 'Appel entrant' : 'Appel sortant'}
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
                    <div className="text-center py-8 text-muted-foreground">Aucun appel enregistré pour ce contact.</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="tasks" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Tâches liées</CardTitle>
                    <CardDescription>Tâches associées à ce contact</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/taches?contactId=${contactId}`)}><Plus className="w-4 h-4 mr-2" /> Nouvelle tâche</Button>
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
                          <Button variant="ghost" size="icon"><Edit className="w-4 h-4" /></Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">Aucune tâche liée à ce contact.</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="projets" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><FolderKanban className="w-4 h-4 text-indigo-500" />Projets liés</CardTitle>
                    <CardDescription>Projets associés à ce contact</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/projets`)}>
                    <Plus className="w-4 h-4 mr-1" />Nouveau
                  </Button>
                </CardHeader>
                <CardContent>
                  {isProjetsLoading ? (
                    <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
                  ) : projetsData.length > 0 ? (
                    <div className="space-y-2">
                      {projetsData.map((p: any) => {
                        const statusColors: Record<string, string> = { en_cours: "bg-blue-100 text-blue-700", planifie: "bg-amber-100 text-amber-700", termine: "bg-emerald-100 text-emerald-700", suspendu: "bg-gray-100 text-gray-700", annule: "bg-red-100 text-red-700" };
                        const statusLabels: Record<string, string> = { en_cours: "En cours", planifie: "Planifié", termine: "Terminé", suspendu: "Suspendu", annule: "Annulé" };
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
                    <div className="text-center py-8 text-muted-foreground text-sm">Aucun projet lié à ce contact.</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents" className="mt-4">
              <div className="space-y-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <div><CardTitle className="flex items-center gap-2"><FileText className="w-4 h-4 text-blue-500" />Devis</CardTitle></div>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/devis?clientName=${encodeURIComponent(contact.firstName + " " + contact.lastName)}`)}>
                      <Plus className="w-4 h-4 mr-1" />Nouveau
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {isDevisLoading ? <Skeleton className="h-20 w-full" /> : devisData?.devis && devisData.devis.length > 0 ? (
                      <div className="space-y-2">
                        {devisData.devis.map((d: any) => (
                          <div key={d.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">{d.reference}</span>
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${d.status === 'accepte' ? 'bg-green-100 text-green-700' : d.status === 'refuse' ? 'bg-red-100 text-red-700' : d.status === 'envoye' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{d.status}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-emerald-600">{Number(d.totalAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                              <span className="text-muted-foreground text-xs">{d.createdAt ? format(new Date(d.createdAt), "dd/MM/yy") : ""}</span>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigate(`/devis`)}><ArrowLeft className="w-3 h-3 rotate-180" /></Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="text-center py-6 text-muted-foreground text-sm italic">Aucun devis.</div>}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <div><CardTitle className="flex items-center gap-2"><Receipt className="w-4 h-4 text-purple-500" />Factures</CardTitle></div>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/factures-client`)}>
                      <Plus className="w-4 h-4 mr-1" />Nouvelle
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {isDevisLoading ? <Skeleton className="h-20 w-full" /> : devisData?.factures && devisData.factures.length > 0 ? (
                      <div className="space-y-2">
                        {devisData.factures.map((f: any) => (
                          <div key={f.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">{f.reference}</span>
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${f.status === 'payee' ? 'bg-green-100 text-green-700' : f.status === 'annulee' ? 'bg-red-100 text-red-700' : f.status === 'envoyee' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{f.status}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-purple-600">{Number(f.totalAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                              {Number(f.paidAmount) > 0 && <span className="text-xs text-emerald-600">(payé: {Number(f.paidAmount).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €)</span>}
                              <span className="text-muted-foreground text-xs">{f.createdAt ? format(new Date(f.createdAt), "dd/MM/yy") : ""}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="text-center py-6 text-muted-foreground text-sm italic">Aucune facture.</div>}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle>Notes générales</CardTitle>
                    <CardDescription>Informations supplémentaires sur le contact</CardDescription>
                  </div>
                  {!isEditingNotes ? (
                    <Button variant="outline" size="sm" onClick={() => { setNotesValue(contact.notes || ""); setIsEditingNotes(true); }}>
                      <Edit className="w-3.5 h-3.5 mr-1" />Modifier
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setIsEditingNotes(false)}>Annuler</Button>
                      <Button size="sm" disabled={isSavingNotes} onClick={async () => {
                        setIsSavingNotes(true);
                        try {
                          await updateContact.mutateAsync({ id: contactId, data: { notes: notesValue } });
                          queryClient.invalidateQueries({ queryKey: getGetContactQueryKey(contactId) });
                          setIsEditingNotes(false);
                        } finally { setIsSavingNotes(false); }
                      }}>
                        <Save className="w-3.5 h-3.5 mr-1" />{isSavingNotes ? "Enregistrement..." : "Enregistrer"}
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
                      placeholder="Entrez des notes sur ce contact..."
                    />
                  ) : contact.notes ? (
                    <div className="p-4 bg-muted/50 rounded-lg whitespace-pre-wrap text-sm border border-border">
                      {contact.notes}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground italic">Aucune note. Cliquez sur Modifier pour en ajouter.</div>
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