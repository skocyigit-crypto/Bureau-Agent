import { useRoute } from "wouter";
import { useGetCall, getGetCallQueryKey, useUpdateCall, useGetContact, getGetContactQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Phone, Clock, Calendar, ArrowLeft, Building, User, Edit, PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function CallDetail() {
  const [, params] = useRoute("/appels/:id");
  const callId = params?.id ? parseInt(params.id) : 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const { data: call, isLoading: isCallLoading } = useGetCall(callId, {
    query: { enabled: !!callId, queryKey: getGetCallQueryKey(callId) }
  });

  const { data: contact } = useGetContact(call?.contactId || 0, {
    query: { enabled: !!call?.contactId, queryKey: getGetContactQueryKey(call?.contactId || 0) }
  });

  const updateCall = useUpdateCall();

  useEffect(() => {
    if (call?.notes) {
      setNotes(call.notes);
    }
  }, [call?.notes]);

  const handleNotesSave = () => {
    updateCall.mutate({ id: callId, data: { notes } }, {
      onSuccess: () => {
        toast({ title: "Notes enregistrées" });
        queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(callId) });
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible d'enregistrer les notes", variant: "destructive" });
      }
    });
  };

  const handleStatusChange = (status: any) => {
    updateCall.mutate({ id: callId, data: { status } }, {
      onSuccess: () => {
        toast({ title: "Statut mis à jour" });
        queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(callId) });
      }
    });
  };

  const handleSentimentChange = (sentiment: any) => {
    updateCall.mutate({ id: callId, data: { sentiment: sentiment === 'none' ? null : sentiment } }, {
      onSuccess: () => {
        toast({ title: "Sentiment mis à jour" });
        queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(callId) });
      }
    });
  };

  if (isCallLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-64 md:col-span-2" />
          <Skeleton className="h-64 md:col-span-1" />
        </div>
      </div>
    );
  }

  if (!call) return <div>Appel introuvable</div>;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'repondu': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><Check className="w-3 h-3 mr-1" /> Répondu</Badge>;
      case 'manque': return <Badge variant="secondary" className="bg-destructive/10 text-destructive border-destructive/20"><PhoneMissed className="w-3 h-3 mr-1" /> Manqué</Badge>;
      case 'messagerie': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Voicemail className="w-3 h-3 mr-1" /> Messagerie</Badge>;
      case 'en_cours': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><Clock className="w-3 h-3 mr-1" /> En cours</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const getSentimentColor = (sentiment?: string | null) => {
    switch (sentiment) {
      case 'positif': return 'bg-emerald-500';
      case 'negatif': return 'bg-destructive';
      case 'neutre': return 'bg-muted-foreground';
      default: return 'bg-transparent border border-border';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/appels"><ArrowLeft className="w-4 h-4" /></Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight flex-1">
          Détails de l'appel
        </h1>
        <div className="flex gap-2">
          {call.status !== 'repondu' && (
            <Button variant="outline" onClick={() => handleStatusChange('repondu')}>
              Marquer répondu
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {call.direction === 'entrant' ? <PhoneIncoming className="w-5 h-5 text-blue-500" /> : <PhoneOutgoing className="w-5 h-5 text-emerald-500" />}
                Informations sur l'appel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Date & Heure</span>
                  <div className="font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    {format(new Date(call.createdAt), "d MMM yyyy HH:mm", { locale: fr })}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Numéro</span>
                  <div className="font-medium flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    {call.phoneNumber}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Durée</span>
                  <div className="font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    {call.duration > 0 ? formatDuration(call.duration) : "-"}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Statut</span>
                  <div>{getStatusBadge(call.status)}</div>
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">Notes de l'appel</span>
                </div>
                <Textarea 
                  className="min-h-[150px] resize-y" 
                  placeholder="Saisissez les notes de l'appel ici..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              
              <div className="flex gap-4">
                <div className="flex-1">
                  <span className="text-sm font-medium block mb-2">Sentiment</span>
                  <Select value={call.sentiment || "none"} onValueChange={handleSentimentChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner le sentiment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Non défini</SelectItem>
                      <SelectItem value="positif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-2"/> Positif</div>
                      </SelectItem>
                      <SelectItem value="neutre">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-muted-foreground mr-2"/> Neutre</div>
                      </SelectItem>
                      <SelectItem value="negatif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-destructive mr-2"/> Négatif</div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <span className="text-sm font-medium block mb-2">Tags</span>
                  <div className="flex flex-wrap gap-2">
                    {call.tags && call.tags.length > 0 ? (
                      call.tags.map(tag => <Badge key={tag} variant="outline">{tag}</Badge>)
                    ) : (
                      <span className="text-sm text-muted-foreground italic">Aucun tag</span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="bg-muted/50 flex justify-end border-t border-border p-4">
              <Button onClick={handleNotesSave} disabled={updateCall.isPending}>
                Enregistrer les notes
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="space-y-6 md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Contact Associé</CardTitle>
            </CardHeader>
            <CardContent>
              {contact ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-secondary/10 flex items-center justify-center text-lg font-medium text-secondary">
                      {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
                    </div>
                    <div>
                      <div className="font-medium text-lg leading-tight">{contact.firstName} {contact.lastName}</div>
                      {contact.company && <div className="text-sm text-muted-foreground flex items-center mt-1"><Building className="w-3 h-3 mr-1" /> {contact.company}</div>}
                    </div>
                  </div>
                  <Button variant="outline" className="w-full" asChild>
                    <Link href={`/contacts/${contact.id}`}>Voir le profil complet</Link>
                  </Button>
                </div>
              ) : call.contactName ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                      <User className="w-6 h-6" />
                    </div>
                    <div className="font-medium text-lg leading-tight">{call.contactName}</div>
                  </div>
                  <div className="text-sm text-muted-foreground p-3 bg-muted rounded-md text-center">
                    Ce nom a été saisi manuellement mais n'est pas lié à un profil.
                  </div>
                  <Button variant="outline" className="w-full">
                    Créer un profil contact
                  </Button>
                </div>
              ) : (
                <div className="text-center py-6 space-y-3">
                  <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-2">
                    <User className="w-6 h-6" />
                  </div>
                  <p className="text-sm text-muted-foreground">Appel d'un numéro inconnu.</p>
                  <Button variant="outline" className="w-full">
                    Associer à un contact
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}