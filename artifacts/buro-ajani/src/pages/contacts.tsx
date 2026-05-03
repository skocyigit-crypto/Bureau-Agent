import { useState, useEffect } from "react";
import { useListContacts, useCreateContact, useUpdateContact, useDeleteContact, getListContactsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Search, Filter, MoreHorizontal, Phone, Mail, Building, Plus, Calendar, ArrowUpDown, ArrowUp, ArrowDown, Download, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LayoutGrid, LayoutList, Upload, Printer, Edit, Tag, Copy } from "lucide-react";
import { Icon3D } from "@/components/icon-3d";
import receptionImg from "@/assets/images/reception-desk.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { EmailComposer } from "@/components/email-composer";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const PAGE_SIZE = 15;

const formSchema = z.object({
  firstName: z.string().min(1, "Le prenom est requis"),
  lastName: z.string().min(1, "Le nom est requis"),
  company: z.string().optional().nullable(),
  email: z.string().email("Email invalide").optional().nullable().or(z.literal('')),
  phone: z.string().min(1, "Le telephone est requis"),
  mobile: z.string().optional().nullable(),
  category: z.enum(["client", "prospect", "fournisseur", "partenaire", "autre"]),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export default function Contacts() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<string>("desc");
  const [page, setPage] = useState(0);
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<any | null>(null);
  const [isEmailComposerOpen, setIsEmailComposerOpen] = useState(false);
  const [emailComposerContactId, setEmailComposerContactId] = useState<number | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const newName = params.get("newName");
    const newPhone = params.get("newPhone");
    if (newName || newPhone) {
      if (newName) {
        const parts = newName.trim().split(" ");
        form.setValue("firstName", parts[0] || "");
        form.setValue("lastName", parts.slice(1).join(" ") || "");
      }
      if (newPhone) {
        form.setValue("phone", newPhone);
      }
      setIsDialogOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const queryParams = {
    search: search || undefined,
    category: categoryFilter !== "all" ? categoryFilter as any : undefined,
    sortBy: sortBy as any,
    sortOrder: sortOrder as any,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data, isLoading, error: contactsError } = useListContacts(queryParams, {
    query: { queryKey: getListContactsQueryKey(queryParams) }
  });

  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const aiValidation = useAiValidation("contact");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "", lastName: "", company: "", email: "", phone: "",
      mobile: "", category: "client", address: "", notes: "",
    }
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
    setPage(0);
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortOrder === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data?.contacts) return;
    if (selectedIds.size === data.contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.contacts.map(c => c.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Supprimer ${selectedIds.size} contact(s) ?`)) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${BASE}/api/bulk/contacts/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids }) });
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
    if (res.ok) {
      toast({ title: `${ids.length} contact(s) supprimé(s)` });
    } else {
      toast({ title: "Erreur lors de la suppression", variant: "destructive" });
    }
  };

  const handleBulkCategory = async (category: string) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${BASE}/api/bulk/contacts/category`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ids, category }) });
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
    if (res.ok) {
      toast({ title: `${ids.length} contact(s) mis à jour → ${category}` });
    } else {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const exportCSV = () => {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const a = document.createElement("a");
    a.href = `${BASE}/api/contacts/export/csv`;
    a.download = `contacts_${format(new Date(), "yyyyMMdd")}.csv`;
    a.click();
  };

  const handleDuplicate = async (id: number) => {
    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const res = await fetch(`${BASE}/api/contacts/${id}/duplicate`, { method: "POST", credentials: "include" });
    if (res.ok) { toast({ title: "Contact dupliqué" }); queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() }); }
    else toast({ title: "Erreur", description: "Impossible de dupliquer", variant: "destructive" });
  };

  const openEdit = (contact: any) => {
    setEditingContact(contact);
    form.reset({
      firstName: contact.firstName || "",
      lastName: contact.lastName || "",
      company: contact.company || "",
      email: contact.email || "",
      phone: contact.phone || "",
      mobile: contact.mobile || "",
      category: contact.category || "client",
      address: contact.address || "",
      notes: contact.notes || "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (editingContact) {
      updateContact.mutate({ id: editingContact.id, data: values }, {
        onSuccess: () => {
          toast({ title: "Contact mis a jour" });
          setIsDialogOpen(false);
          setEditingContact(null);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        },
        onError: () => toast({ title: "Erreur", description: "Impossible de modifier le contact", variant: "destructive" }),
      });
    } else {
      createContact.mutate({ data: values }, {
        onSuccess: (newContact) => {
          toast({ title: "Contact cree avec succes" });
          setIsDialogOpen(false);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
          setLocation(`/contacts/${newContact.id}`);
        },
        onError: () => {
          toast({ title: "Erreur", description: "Impossible de creer le contact", variant: "destructive" });
        }
      });
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'client': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20">Client</Badge>;
      case 'prospect': return <Badge variant="secondary" className="bg-purple-500/10 text-purple-600 border-purple-500/20">Prospect</Badge>;
      case 'fournisseur': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">Fournisseur</Badge>;
      case 'partenaire': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Partenaire</Badge>;
      default: return <Badge variant="outline" className="capitalize">{category}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><Icon3D icon={Users} variant="indigo" size="md" /> Annuaire des Contacts</h1>
          <p className="text-muted-foreground mt-1">Gerez votre base de donnees professionnelle.</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Tag className="w-4 h-4 mr-2" />
                    Catégorie ({selectedIds.size})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Changer la catégorie</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {["client", "prospect", "fournisseur", "partenaire", "autre"].map(cat => (
                    <DropdownMenuItem key={cat} onClick={() => handleBulkCategory(cat)} className="capitalize cursor-pointer">{cat}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                <Trash2 className="w-4 h-4 mr-2" />
                Supprimer ({selectedIds.size})
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="w-4 h-4 mr-2" />
            Exporter CSV
          </Button>
          <Button variant="outline" size="sm" title="Imprimer" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />
          </Button>
          <Link href="/contacts/import">
            <Button variant="outline" size="sm">
              <Upload className="w-4 h-4 mr-2" />
              Importer CSV
            </Button>
          </Link>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) { setEditingContact(null); form.reset(); } }}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                Nouveau Contact
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>{editingContact ? "Modifier le contact" : "Nouveau contact"}</DialogTitle>
                <DialogDescription>{editingContact ? "Modifiez les informations du contact." : "Ajouter une personne a l'annuaire."}</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="firstName" render={({ field }) => (
                      <FormItem><FormLabel>Prenom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
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
                        <FormLabel>Categorie</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
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
                      <FormItem><FormLabel>Telephone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <AiValidationFeedback result={aiValidation.result} isValidating={aiValidation.isValidating} />
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => aiValidation.validate(form.getValues())} disabled={aiValidation.isValidating} className="mr-auto">Verifier IA</Button>
                    <Button type="submit" disabled={createContact.isPending || updateContact.isPending}>{editingContact ? "Mettre a jour" : "Creer le contact"}</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="relative h-28">
          <img src={receptionImg} alt="Accueil et reception" className="w-full h-full object-cover" loading="lazy" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-900/80 via-indigo-800/50 to-transparent" />
          <div className="absolute inset-0 flex items-center px-6">
            <div className="text-white">
              <h3 className="text-lg font-bold">Annuaire professionnel</h3>
              <p className="text-white/80 text-sm mt-1">Gestion centralisee de vos contacts, clients et partenaires.</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom, entreprise, email..."
            className="pl-9 w-full"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Toutes les categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les categories</SelectItem>
              <SelectItem value="client">Client</SelectItem>
              <SelectItem value="prospect">Prospect</SelectItem>
              <SelectItem value="fournisseur">Fournisseur</SelectItem>
              <SelectItem value="partenaire">Partenaire</SelectItem>
              <SelectItem value="autre">Autre</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex border border-border rounded-md overflow-hidden">
            <Button variant={viewMode === "table" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-none" onClick={() => setViewMode("table")}>
              <LayoutList className="w-4 h-4" />
            </Button>
            <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-none" onClick={() => setViewMode("grid")}>
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {contactsError && <QueryErrorAlert error={contactsError as Error} title="Impossible de charger les contacts" />}

      {viewMode === "table" ? (
        <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={data?.contacts?.length ? selectedIds.size === data.contacts.length : false}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("lastName")}>
                  <span className="flex items-center">Contact{getSortIcon("lastName")}</span>
                </TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("company")}>
                  <span className="flex items-center">Entreprise{getSortIcon("company")}</span>
                </TableHead>
                <TableHead>Coordonnees</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("totalCalls")}>
                  <span className="flex items-center">Appels{getSortIcon("totalCalls")}</span>
                </TableHead>
                <TableHead>Categorie</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="w-4 h-4" /></TableCell>
                    <TableCell><div className="flex items-center gap-3"><Skeleton className="w-9 h-9 rounded-full" /><Skeleton className="h-4 w-32" /></div></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : data?.contacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Aucun contact trouve.
                  </TableCell>
                </TableRow>
              ) : (
                data?.contacts.map((contact) => (
                  <TableRow key={contact.id} className={`hover:bg-muted/30 transition-colors cursor-pointer ${selectedIds.has(contact.id) ? 'bg-primary/5' : ''}`} onClick={() => setLocation(`/contacts/${contact.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selectedIds.has(contact.id)} onCheckedChange={() => toggleSelect(contact.id)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                          {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
                        </div>
                        <div className="font-medium text-foreground">{contact.firstName} {contact.lastName}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center text-sm text-muted-foreground">
                        {contact.company ? <><Building className="w-3.5 h-3.5 mr-1.5" /> {contact.company}</> : "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center text-sm text-foreground">
                          <Phone className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" /> {contact.phone}
                        </div>
                        {contact.email && (
                          <div className="flex items-center text-xs text-muted-foreground">
                            <Mail className="w-3.5 h-3.5 mr-1.5" /> {contact.email}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">{contact.totalCalls}</span>
                    </TableCell>
                    <TableCell>
                      {getCategoryBadge(contact.category)}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem asChild><Link href={`/contacts/${contact.id}`}>Voir le profil</Link></DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(contact); }}><Edit className="w-3 h-3 mr-2" />Modifier</DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicate(contact.id); }}><Copy className="w-3 h-3 mr-2" />Dupliquer</DropdownMenuItem>
                          {contact.phone && <DropdownMenuItem onClick={() => setLocation(`/appels?phone=${encodeURIComponent(contact.phone)}`)}><Phone className="w-3 h-3 mr-2" />Appeler</DropdownMenuItem>}
                          {contact.email && <DropdownMenuItem onClick={() => { setEmailComposerContactId(contact.id); setIsEmailComposerOpen(true); }}><Mail className="w-3 h-3 mr-2" />Envoyer email</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={(e) => {
                            e.stopPropagation();
                            if (!confirm(`Supprimer le contact ${contact.firstName} ${contact.lastName} ?`)) return;
                            deleteContact.mutate({ id: contact.id }, {
                              onSuccess: () => { toast({ title: "Contact supprimé" }); queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() }); },
                              onError: () => toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" }),
                            });
                          }}><Trash2 className="w-3 h-3 mr-2" />Supprimer</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>
            ))
          ) : data?.contacts.length === 0 ? (
            <div className="col-span-full text-center text-muted-foreground py-12">Aucun contact trouve.</div>
          ) : (
            data?.contacts.map((contact) => (
              <Card key={contact.id} className={`cursor-pointer hover:shadow-md transition-shadow ${selectedIds.has(contact.id) ? 'ring-2 ring-primary' : ''}`} onClick={() => setLocation(`/contacts/${contact.id}`)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                        {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{contact.firstName} {contact.lastName}</div>
                        {contact.company && <div className="text-sm text-muted-foreground flex items-center gap-1"><Building className="w-3 h-3" />{contact.company}</div>}
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selectedIds.has(contact.id)} onCheckedChange={() => toggleSelect(contact.id)} />
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center text-muted-foreground"><Phone className="w-3.5 h-3.5 mr-2" />{contact.phone}</div>
                    {contact.email && <div className="flex items-center text-muted-foreground"><Mail className="w-3.5 h-3.5 mr-2" />{contact.email}</div>}
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                    {getCategoryBadge(contact.category)}
                    <span className="text-xs text-muted-foreground">{contact.totalCalls} appel(s)</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      <AiSuggestionsCard page="contacts" title="Recommandations IA - Contacts" compact />

      <EmailComposer
        isOpen={isEmailComposerOpen}
        onClose={() => { setIsEmailComposerOpen(false); setEmailComposerContactId(undefined); }}
        preselectedContactId={emailComposerContactId}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total} contact(s) - Page ${page + 1} sur ${totalPages}` : ""}
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
