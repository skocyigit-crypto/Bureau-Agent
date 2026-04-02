import { useState } from "react";
import { useListCalls, useCreateCall, useUpdateCall, useDeleteCall, getListCallsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, Filter, MoreHorizontal, Check, Clock, Voicemail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export default function Calls() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading } = useListCalls(
    { search: search || undefined, status: statusFilter !== "all" ? statusFilter as any : undefined },
    { query: { queryKey: getListCallsQueryKey({ search: search || undefined, status: statusFilter !== "all" ? statusFilter as any : undefined }) } }
  );

  const updateCall = useUpdateCall();

  const handleStatusChange = (id: number, status: any) => {
    updateCall.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCallsQueryKey() });
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

  const getSentimentColor = (sentiment?: string | null) => {
    switch (sentiment) {
      case 'positif': return 'bg-emerald-500';
      case 'negatif': return 'bg-destructive';
      case 'neutre': return 'bg-muted-foreground';
      default: return 'bg-transparent';
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
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Phone className="w-4 h-4 mr-2" />
            Nouvel Appel
          </Button>
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
                  <TableCell><Skeleton className="h-3 w-3 rounded-full" /></TableCell>
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
                <TableRow key={call.id} className="hover:bg-muted/30 transition-colors">
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
                    {call.sentiment && (
                      <div className="flex items-center gap-2" title={call.sentiment}>
                        <div className={`w-2.5 h-2.5 rounded-full ${getSentimentColor(call.sentiment)}`} />
                        <span className="text-xs capitalize text-muted-foreground">{call.sentiment}</span>
                      </div>
                    )}
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
                        <DropdownMenuItem>Voir les détails</DropdownMenuItem>
                        <DropdownMenuItem>Associer à un contact</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleStatusChange(call.id, 'repondu')}>Marquer comme répondu</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStatusChange(call.id, 'messagerie')}>Marquer comme messagerie</DropdownMenuItem>
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