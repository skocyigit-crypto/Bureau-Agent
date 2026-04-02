import { useState } from "react";
import { useListCalls, useCreateCall, useUpdateCall, getListCallsQueryKey, useListContacts } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Filter, MoreHorizontal, Check, Clock, Voicemail, Plus } from "lucide-react";
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

const formSchema = z.object({
  contactId: z.string().transform(v => v === "none" ? null : parseInt(v)),
  phoneNumber: z.string().min(1, "Le numéro est requis"),
  direction: z.enum(["entrant", "sortant"]),
  status: z.enum(["repondu", "manque", "messagerie", "en_cours"]),
  duration: z.coerce.number().min(0).default(0),
  notes: z.string().optional().nullable(),
  sentiment: z.enum(["positif", "neutre", "negatif", "none"]).transform(v => v === "none" ? null : v).optional(),
});

export default function Calls() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data, isLoading } = useListCalls(
    { search: search || undefined, status: statusFilter !== "all" ? statusFilter as any : undefined },
    { query: { queryKey: getListCallsQueryKey({ search: search || undefined, status: statusFilter !== "all" ? statusFilter as any : undefined }) } }
  );

  const { data: contactsData } = useListContacts({ limit: 100 }, { query: { queryKey: ["contacts", "all"] } });

  const updateCall = useUpdateCall();
  const createCall = useCreateCall();

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

  const handleStatusChange = (id: number, status: any) => {
    updateCall.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
        toast({ title: "Statut mis à jour" });
      }
    });
  };

  const onSubmit = (values: any) => {
    createCall.mutate({ data: values }, {
      onSuccess: (newCall) => {
        toast({ title: "Appel enregistré" });
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
      case 'repondu': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20"><Check className="w-3 h-3 mr-1" /> Répondu</Badge>;
      case 'manque': return <Badge variant="secondary" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"><PhoneMissed className="w-3 h-3 mr-1" /> Manqué</Badge>;
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
      case 'positif': return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Positif</Badge>;
      case 'negatif': return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Négatif</Badge>;
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
          <h1 className="text-3xl font-bold tracking-tight">Journal des Appels</h1>
          <p className="text-muted-foreground mt-1">Gérez et suivez toutes les communications téléphoniques.</p>
        </div>
        <div className="flex items-center gap-2">
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
                <DialogDescription>Saisissez les détails de la communication.</DialogDescription>
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
                            <SelectItem value="repondu">Répondu</SelectItem>
                            <SelectItem value="manque">Manqué</SelectItem>
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
                      <FormLabel>Numéro de téléphone</FormLabel>
                      <FormControl><Input placeholder="+33 6..." {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="contactId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Associer à un contact (Optionnel)</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Choisir un contact..."/></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">Aucun (Numéro inconnu)</SelectItem>
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
                        <FormLabel>Durée (secondes)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="sentiment" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sentiment</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value?.toString() || "none"}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Non défini"/></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="none">Non défini</SelectItem>
                            <SelectItem value="positif">Positif</SelectItem>
                            <SelectItem value="neutre">Neutre</SelectItem>
                            <SelectItem value="negatif">Négatif</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <DialogFooter>
                    <Button type="submit" disabled={createCall.isPending}>Enregistrer l'appel</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-card p-4 border border-border rounded-lg shadow-sm">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom ou numéro..."
            className="pl-9 w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Tous les statuts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les statuts</SelectItem>
              <SelectItem value="answered">Répondu</SelectItem>
              <SelectItem value="missed">Manqué</SelectItem>
              <SelectItem value="voicemail">Messagerie</SelectItem>
              <SelectItem value="outgoing">Sortant</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[50px]"></TableHead>
              <TableHead>Contact & Numéro</TableHead>
              <TableHead>Date & Heure</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Durée</TableHead>
              <TableHead>Sentiment</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
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
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  Aucun appel trouvé.
                </TableCell>
              </TableRow>
            ) : (
              data?.calls.map((call) => (
                <TableRow key={call.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setLocation(`/appels/${call.id}`)}>
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
                        <DropdownMenuItem asChild><Link href={`/appels/${call.id}`}>Voir les détails</Link></DropdownMenuItem>
                        {call.contactId && <DropdownMenuItem asChild><Link href={`/contacts/${call.contactId}`}>Aller au contact</Link></DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        {call.status !== 'repondu' && <DropdownMenuItem onClick={() => handleStatusChange(call.id, 'repondu')}>Marquer comme répondu</DropdownMenuItem>}
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
    </div>
  );
}