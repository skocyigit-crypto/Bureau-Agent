import { useState } from "react";
import { useListContacts, useCreateContact, useUpdateContact, useDeleteContact, getListContactsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Search, Filter, MoreHorizontal, Phone, Mail, Building, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export default function Contacts() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data, isLoading } = useListContacts(
    { search: search || undefined, category: categoryFilter !== "all" ? categoryFilter as any : undefined },
    { query: { queryKey: getListContactsQueryKey({ search: search || undefined, category: categoryFilter !== "all" ? categoryFilter as any : undefined }) } }
  );

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
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            Nouveau Contact
          </Button>
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
              <TableHead>Catégorie</TableHead>
              <TableHead className="text-center">Appels</TableHead>
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
                  <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
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
                <TableRow key={contact.id} className="hover:bg-muted/30 transition-colors">
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
                    {getCategoryBadge(contact.category)}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm font-medium text-muted-foreground">{contact.totalCalls}</span>
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
                        <DropdownMenuItem>Voir le profil</DropdownMenuItem>
                        <DropdownMenuItem>Éditer le contact</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>Nouvel appel</DropdownMenuItem>
                        <DropdownMenuItem>Nouvelle tâche</DropdownMenuItem>
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