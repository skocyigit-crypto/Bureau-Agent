import { useState } from "react";
import { useListContacts, useCreateContact, getListContactsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Search, Filter, MoreHorizontal, Phone, Mail, Building, Plus, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
import { format } from "date-fns";
import { fr } from "date-fns/locale";

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

export default function Contacts() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data, isLoading } = useListContacts(
    { search: search || undefined, category: categoryFilter !== "all" ? categoryFilter as any : undefined },
    { query: { queryKey: getListContactsQueryKey({ search: search || undefined, category: categoryFilter !== "all" ? categoryFilter as any : undefined }) } }
  );

  const createContact = useCreateContact();

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

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createContact.mutate({ data: values }, {
      onSuccess: (newContact) => {
        toast({ title: "Contact créé avec succès" });
        setIsDialogOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setLocation(`/contacts/${newContact.id}`);
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible de créer le contact", variant: "destructive" });
      }
    });
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
          <h1 className="text-3xl font-bold tracking-tight">Annuaire des Contacts</h1>
          <p className="text-muted-foreground mt-1">Gérez votre base de données professionnelle.</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                Nouveau Contact
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Nouveau contact</DialogTitle>
                <DialogDescription>Ajouter une personne à l'annuaire.</DialogDescription>
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
                      <FormItem><FormLabel>Téléphone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <DialogFooter><Button type="submit" disabled={createContact.isPending}>Créer le contact</Button></DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom, entreprise, email..."
            className="pl-9 w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Toutes les catégories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les catégories</SelectItem>
              <SelectItem value="client">Client</SelectItem>
              <SelectItem value="prospect">Prospect</SelectItem>
              <SelectItem value="fournisseur">Fournisseur</SelectItem>
              <SelectItem value="partenaire">Partenaire</SelectItem>
              <SelectItem value="autre">Autre</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Contact</TableHead>
              <TableHead>Entreprise</TableHead>
              <TableHead>Coordonnées</TableHead>
              <TableHead>Dernier Appel</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-9 h-9 rounded-full" />
                      <div><Skeleton className="h-4 w-32 mb-1" /></div>
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32 mb-1" /><Skeleton className="h-3 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : data?.contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  Aucun contact trouvé.
                </TableCell>
              </TableRow>
            ) : (
              data?.contacts.map((contact) => (
                <TableRow key={contact.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setLocation(`/contacts/${contact.id}`)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center text-sm font-medium text-secondary">
                        {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
                      </div>
                      <div className="font-medium text-foreground">{contact.firstName} {contact.lastName}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center text-sm text-muted-foreground">
                      {contact.company ? (
                        <><Building className="w-3.5 h-3.5 mr-1.5" /> {contact.company}</>
                      ) : (
                        "-"
                      )}
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
                     <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                       {contact.lastCallAt ? (
                          <>
                           <Calendar className="w-3.5 h-3.5" />
                           {format(new Date(contact.lastCallAt), "d MMM yyyy", { locale: fr })}
                          </>
                       ) : "-"}
                     </div>
                  </TableCell>
                  <TableCell>
                    {getCategoryBadge(contact.category)}
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
                        <DropdownMenuItem asChild><Link href={`/contacts/${contact.id}`}>Voir le profil</Link></DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}