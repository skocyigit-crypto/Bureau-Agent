import { GhostTextarea } from "@/components/ghost-textarea";
import { QueryErrorAlert } from "@/components/safe-component";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardFooter,CardHeader,CardTitle } from "@/components/ui/card";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCallQueryKey,getGetContactQueryKey,useAskAiAssistant,useGetCall,useGetContact,useUpdateCall } from "@workspace/api-client-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowLeft,Brain,Building,Calendar,Check,Clock,Lightbulb,Loader2,Phone,PhoneIncoming,PhoneMissed,PhoneOutgoing,Printer,Send,Sparkles,User,Voicemail } from "lucide-react";
import { useEffect,useState } from "react";
import { Link,useLocation,useRoute } from "wouter";

function AiCallInsights({ call, contactName }: { call: any; contactName?: string | null }) {
  const { t } = useTranslation();
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
              <p className="text-sm font-medium">{t("callDetail.ai.title")}</p>
              <p className="text-xs text-muted-foreground">{t("callDetail.ai.subtitle")}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={handleAnalyze} className="w-full border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300">
            <Sparkles className="w-4 h-4 mr-1.5" />
            {t("callDetail.ai.analyze")}
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
          <CardTitle className="text-base">{t("callDetail.ai.titleShort")}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {askAi.isPending ? (
          <div className="flex items-center justify-center gap-2 py-6">
            <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
            <span className="text-sm text-muted-foreground">{t("callDetail.ai.analyzing")}</span>
          </div>
        ) : analysis ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground leading-relaxed">{analysis.reponse}</p>
            {analysis.actions && analysis.actions.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border/50">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                  {t("callDetail.ai.recommendedActions")}
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
              <Sparkles className="w-3.5 h-3.5 mr-1" /> {t("callDetail.ai.rerun")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function CallDetail() {
  const { t } = useTranslation();
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
        toast({ title: t("callDetail.toast.notesSaved") });
        queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(callId) });
      },
      onError: () => {
        toast({ title: t("callDetail.toast.error"), description: t("callDetail.toast.notesSaveError"), variant: "destructive" });
      }
    });
  };

  const [, navigate] = useLocation();

  const handleStatusChange = (status: any) => {
    updateCall.mutate({ id: callId, data: { status } }, {
      onSuccess: () => {
        toast({ title: t("callDetail.toast.statusUpdated") });
        queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(callId) });
      },
      onError: () => {
        toast({ title: t("callDetail.toast.error"), description: t("callDetail.toast.statusError"), variant: "destructive" });
      }
    });
  };

  const handleSentimentChange = (sentiment: any) => {
    updateCall.mutate({ id: callId, data: { sentiment: sentiment === 'none' ? null : sentiment } }, {
      onSuccess: () => {
        toast({ title: t("callDetail.toast.sentimentUpdated") });
        queryClient.invalidateQueries({ queryKey: getGetCallQueryKey(callId) });
      },
      onError: () => {
        toast({ title: t("callDetail.toast.error"), description: t("callDetail.toast.sentimentError"), variant: "destructive" });
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

  if (callError) return <QueryErrorAlert error={callError as Error} title={t("callDetail.loadError")} />;
  if (!call) return <div>{t("callDetail.notFound")}</div>;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'repondu': return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"><Check className="w-3 h-3 mr-1" /> {t("callDetail.statuses.repondu")}</Badge>;
      case 'manque': return <Badge variant="secondary" className="bg-destructive/10 text-destructive border-destructive/20"><PhoneMissed className="w-3 h-3 mr-1" /> {t("callDetail.statuses.manque")}</Badge>;
      case 'messagerie': return <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20"><Voicemail className="w-3 h-3 mr-1" /> {t("callDetail.statuses.messagerie")}</Badge>;
      case 'en_cours': return <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/20"><Clock className="w-3 h-3 mr-1" /> {t("callDetail.statuses.en_cours")}</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
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
          {t("callDetail.title")}
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" title={t("callDetail.print")} onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
          {call.status !== 'repondu' && (
            <Button variant="outline" onClick={() => handleStatusChange('repondu')}>
              {t("callDetail.markAnswered")}
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
                {t("callDetail.infoTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">{t("callDetail.dateTime")}</span>
                  <div className="font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    {format(new Date(call.createdAt), "d MMM yyyy HH:mm", { locale: fr })}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">{t("callDetail.number")}</span>
                  <div className="font-medium flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    {call.phoneNumber}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">{t("callDetail.duration")}</span>
                  <div className="font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    {call.duration > 0 ? formatDuration(call.duration) : "-"}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">{t("callDetail.statusLabel")}</span>
                  <div>{getStatusBadge(call.status)}</div>
                </div>
              </div>

              <div className="pt-4 border-t border-border">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">{t("callDetail.notesLabel")}</span>
                </div>
                <GhostTextarea
                  className="min-h-[150px] resize-y"
                  placeholder={t("callDetail.notesPlaceholder")}
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
                  <span className="text-sm font-medium block mb-2">{t("callDetail.sentimentLabel")}</span>
                  <Select value={call.sentiment || "none"} onValueChange={handleSentimentChange}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("callDetail.sentimentPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("callDetail.sentiments.none")}</SelectItem>
                      <SelectItem value="tres_positif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-600 mr-2"/> {t("callDetail.sentiments.tres_positif")}</div>
                      </SelectItem>
                      <SelectItem value="positif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-2"/> {t("callDetail.sentiments.positif")}</div>
                      </SelectItem>
                      <SelectItem value="neutre">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-muted-foreground mr-2"/> {t("callDetail.sentiments.neutre")}</div>
                      </SelectItem>
                      <SelectItem value="negatif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-destructive mr-2"/> {t("callDetail.sentiments.negatif")}</div>
                      </SelectItem>
                      <SelectItem value="tres_negatif">
                        <div className="flex items-center"><div className="w-2 h-2 rounded-full bg-red-700 mr-2"/> {t("callDetail.sentiments.tres_negatif")}</div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <span className="text-sm font-medium block mb-2">{t("callDetail.tags")}</span>
                  <div className="flex flex-wrap gap-2">
                    {call.tags && call.tags.length > 0 ? (
                      call.tags.map(tag => <Badge key={tag} variant="outline" className={getTagStyle(tag)}>{formatTagLabel(tag)}</Badge>)
                    ) : (
                      <span className="text-sm text-muted-foreground italic">{t("callDetail.noTag")}</span>
                    )}
                  </div>
                </div>
              </div>
              {((call as any).createdByName || (call as any).updatedByName) && (
                <div className="pt-4 border-t border-border space-y-1.5 text-xs text-muted-foreground">
                  {(call as any).createdByName && (
                    <div>{t("callDetail.createdBy")} <span className="font-medium text-foreground">{(call as any).createdByName}</span> {call.createdAt && <>— {format(new Date(call.createdAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</>}</div>
                  )}
                  {(call as any).updatedByName && call.updatedAt && (
                    <div>{t("callDetail.updatedBy")} <span className="font-medium text-foreground">{(call as any).updatedByName}</span> — {format(new Date(call.updatedAt), "d MMM yyyy 'à' HH:mm", { locale: fr })}</div>
                  )}
                </div>
              )}
            </CardContent>
            <CardFooter className="bg-muted/50 flex justify-end border-t border-border p-4">
              <Button onClick={handleNotesSave} disabled={updateCall.isPending}>
                {t("callDetail.saveNotes")}
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="space-y-6 md:col-span-1">
          <AiCallInsights call={call} contactName={contact ? `${contact.firstName} ${contact.lastName}` : call.contactName} />
          <Card>
            <CardHeader>
              <CardTitle>{t("callDetail.contactAssocie")}</CardTitle>
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
                    <Link href={`/contacts/${contact.id}`}>{t("callDetail.viewFullProfile")}</Link>
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
                    {t("callDetail.manualNameNote")}
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => navigate(`/contacts?newName=${encodeURIComponent(call.contactName || "")}`)}>
                    {t("callDetail.createContactProfile")}
                  </Button>
                </div>
              ) : (
                <div className="text-center py-6 space-y-3">
                  <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-2">
                    <User className="w-6 h-6" />
                  </div>
                  <p className="text-sm text-muted-foreground">{t("callDetail.unknownCaller")}</p>
                  <Button variant="outline" className="w-full" onClick={() => navigate(`/contacts?newPhone=${encodeURIComponent(call.phoneNumber || "")}`)}>
                    {t("callDetail.linkToContact")}
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