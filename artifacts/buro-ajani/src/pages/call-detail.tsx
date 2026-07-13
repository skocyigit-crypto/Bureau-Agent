import { useRoute, useLocation } from "wouter";
import { useGetCall, getGetCallQueryKey, useUpdateCall, useGetContact, getGetContactQueryKey, useAskAiAssistant } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Phone, Clock, Calendar, ArrowLeft, Building, User, Edit, PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail, Check, Brain, Sparkles, Loader2, Send, Lightbulb, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { GhostTextarea } from "@/components/ghost-textarea";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryErrorAlert } from "@/components/safe-component";

function AiCallInsights({ call, contactName }: { call: any; contactName?: string | null }) {
  const askAi = useAskAiAssistant();
  const [analysis, setAnalysis] = useState<{ reponse: string; actions?: { label: string; description: string }[] } | null>(null);

  const handleAnalyze = () => {
    const question = `Analyse cet appel en detail: Direction: ${call.direction}, Statut: ${call.status}, Duree: ${call.duration}s, Numero: ${call.phoneNumber}${contactName ? `, Contact: ${contactName}` : ''}, Sentiment: ${call.sentiment || 'non defini'}, Notes: ${call.notes || 'aucune'}. Donne un resume, des observations et des actions recommandees.`;
    askAi.mutate(
      { data: { question, currentPage: "calls" } },
      { onSuccess: (res) => setAnalysis(res) }
    );
  };

  if (!analysis && !askAi.isPending) {
    return (
      <Card className="border-dashed border-purple-300/50 bg-gradient-to-br from-purple-50/50 to-indigo-50/30 dark:from-purple-950/20 dark:to-indigo-950/10">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 dark:from-purple-900/40 dark:to-indigo-900/30 flex items-center justify-center">
              <Brain className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium">Analyse IA de l'appel</p>
              <p className="text-xs text-muted-foreground">Resume, observations et actions suggerees</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={handleAnalyze} className="w-full border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300">
            <Sparkles className="w-4 h-4 mr-1.5" />
            Analyser cet appel
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-purple-200/50 bg-gradient-to-br from-purple-50/30 to-indigo-50/20 dark:from-purple-950/10 dark:to-indigo-950/5">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <CardTitle className="text-base">Analyse IA</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {askAi.isPending ? (
          <div className="flex items-center justify-center gap-2 py-6">
            <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
            <span className="text-sm text-muted-foreground">Analyse en cours...</span>
          </div>
        ) : analysis ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground leading-relaxed">{analysis.reponse}</p>
            {analysis.actions && analysis.actions.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                  Actions recommandees
                </p>
                {analysis.actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-muted/50">
                    <Send className="w-3 h-3 text-purple-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">{a.label}</span>
                      <span className="text-muted-foreground"> - {a.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={handleAnalyze} className="w-full text-xs text-purple-600">
              <Sparkles className="w-3.5 h-3.5 mr-1" /> Relancer l'analyse
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function CallDetail() {
  const [, params] = useRoute("/appels/:id");
  const callId = params?.id ? parseInt(params.id) : 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");

  const { data: call, isLoading: isCallLoading, error: callError } = useGetCall(callId, {
    query: { enabled: !!callId, queryKey: getGetCallQueryKey(callId) }
  });

  const { data: contact } = useGetContact(call?.contactId || 0, {
    query: { enabled: !!call?.contactId, queryKey: getGetContactQueryKey(call?.contactId || 0) }
  });

  const updateCall = useUpdateCall();

  useEffect(() => {
    // Keyed on call?.id (not call?.notes): navigating from one call's page to
    // another's reuses this component instance, and the previous condition
    // only updated when the new call had non-empty notes — leaving the prior
    // call's notes in the textarea (and risking them being saved onto the
    // wrong call) whenever the newly-loaded call's notes were empty.
    setNotes(call?.notes || "");
  }, [call?.id]);

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

  const [, navigate] = useLocation();

  const handleStatusChange = (status: any) => {
    updateCall.mutate({ id: callId, data: { status } }, {
      onSuccess: () => {
        toast({ title: "Statut mis à jour" });
        queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(callId) });
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible de mettre à jour le statut", variant: "destructive" });
      }
    });
  };

  const handleSentimentChange = (sentiment: any) => {
    updateCall.mutate({ id: callId, data: { sentiment: sentiment === 'none' ? null : sentiment } }, {
      onSuccess: () => {
        toast({ title: "Sentiment mis à jour" });
        queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(callId) });
      },
      onError: () => {
        toast({ title: "Erreur", description: "Impossible de mettre à jour le sentiment", variant: "destructive" });
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

  if (callError) return <QueryErrorAlert error={callError as Error} title="Impossible de charger cet appel" />;
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
      case 'tres_positif': return 'bg-emerald-600';
      case 'positif': return 'bg-emerald-500';
      case 'negatif': return 'bg-destructive';
      case 'tres_negatif': return 'bg-red-700';
      case 'neutre': return 'bg-muted-foreground';
      default: return 'bg-transparent border border-border';
    }
  };

  const getTagStyle = (tag: string) => {
    if (tag.startsWith('urgence:critique')) return 'bg-red-700/10 text-red-700 border-red-700/30';
    if (tag.startsWith('urgence:haute')) return 'bg-orange-500/10 text-orange-600 border-orange-500/30';
    if (tag.startsWith('urgence:moyenne')) return 'bg-amber-500/10 text-amber-600 border-amber-500/30';
    if (tag.startsWith('emotion:colere') || tag.startsWith('emotion:frustration')) return 'bg-red-500/10 text-red-600 border-red-500/30';
    if (tag.startsWith('emotion:satisfaction') || tag.startsWith('emotion:enthousiasme')) return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30';
    if (tag.startsWith('emotion:anxiete') || tag.startsWith('emotion:tristesse')) return 'bg-blue-500/10 text-blue-600 border-blue-500/30';
    if (tag.startsWith('emotion:') || tag.startsWith('urgence:')) return 'bg-muted text-muted-foreground border-border';
    return '';
  };

  const formatTagLabel = (tag: string) => {
    if (tag.startsWith('emotion:')) return `😶 ${tag.slice(8).replace(/_/g, ' ')}`;
    if (tag.startsWith('urgence:')) return `⚡ urgence ${tag.slice(8)}`;
    return tag;
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
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
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
                <GhostTextarea
                  className="min-h-[150px] resize-y"
                  placeholder="Saisissez les notes de l'appel ici..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  fieldType="call_note"
                  context={{
                    title: call.direction === 'entrant' ? `Appel entrant ${call.phoneNumber || ''}` : `Appel sortant ${call.phoneNumber || ''}`,
                    contactName: contact ? `${contact.firstName} ${contact.lastName}` : call.contactName ?? null,
                  }}
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
                      <SelectItem value="tres_positif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-600 mr-2"/> Très positif</div>
                      </SelectItem>
                      <SelectItem value="positif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-2"/> Positif</div>
                      </SelectItem>
                      <SelectItem value="neutre">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-muted-foreground mr-2"/> Neutre</div>
                      </SelectItem>
                      <SelectItem value="negatif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-destructive mr-2"/> Négatif</div>
                      </SelectItem>
                      <SelectItem value="tres_negatif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-red-700 mr-2"/> Très négatif</div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <span className="text-sm font-medium block mb-2">Tags</span>
                  <div className="flex flex-wrap gap-2">
                    {call.tags && call.tags.length > 0 ? (
                      call.tags.map(tag => <Badge key={tag} variant="outline" className={getTagStyle(tag)}>{formatTagLabel(tag)}</Badge>)
                    ) : (
                      <span className="text-sm text-muted-foreground italic">Aucun tag</span>
                    )}
                  </div>
                </div>
              </div>
              {((call as any).createdByName || (call as any).updatedByName) && (
                <div className="pt-4 border-t border-border space-y-1.5 text-xs text-muted-foreground">
                  {(call as any).createdByName && (
                    <div>Créé par <span className="font-medium text-foreground">{(call as any).createdByName}</span> {call.createdAt && <>— {format(new Date(call.createdAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</>}</div>
                  )}
                  {(call as any).updatedByName && call.updatedAt && (
                    <div>Modifié par <span className="font-medium text-foreground">{(call as any).updatedByName}</span> — {format(new Date(call.updatedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</div>
                  )}
                </div>
              )}
            </CardContent>
            <CardFooter className="bg-muted/50 flex justify-end border-t border-border p-4">
              <Button onClick={handleNotesSave} disabled={updateCall.isPending}>
                Enregistrer les notes
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="space-y-6 md:col-span-1">
          <AiCallInsights call={call} contactName={contact ? `${contact.firstName} ${contact.lastName}` : call.contactName} />
          <Card>
            <CardHeader>
              <CardTitle>Contact Associe</CardTitle>
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
                  <Button variant="outline" className="w-full" onClick={() => navigate(`/contacts?newName=${encodeURIComponent(call.contactName || "")}`)}>
                    Créer un profil contact
                  </Button>
                </div>
              ) : (
                <div className="text-center py-6 space-y-3">
                  <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-2">
                    <User className="w-6 h-6" />
                  </div>
                  <p className="text-sm text-muted-foreground">Appel d'un numéro inconnu.</p>
                  <Button variant="outline" className="w-full" onClick={() => navigate(`/contacts?newPhone=${encodeURIComponent(call.phoneNumber || "")}`)}>
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