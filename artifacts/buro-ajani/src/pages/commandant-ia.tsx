import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Brain, Phone, Mail, Calendar, CheckSquare, DollarSign, HardDrive, Camera,
  Users, Zap, Send, RefreshCw, Loader2, AlertTriangle, Star, Clock, FileText,
  MapPin, BarChart3, Shield, Bell, TrendingUp, ArrowRight, Sparkles,
  MessageSquare, Target, Play, Eye, Coffee,
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiPost(path: string, body?: any) {
  const r = await fetch(`${API}/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
async function apiGet(path: string) {
  const r = await fetch(`${API}/api${path}`, { credentials: "include" });
  return r.json();
}

export default function CommandantIAPage() {
  const [tab, setTab] = useState("briefing");
  const { toast } = useToast();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-7 w-7 text-amber-500" />
            AI Commandant
          </h1>
          <p className="text-sm text-muted-foreground">Centre de commande intelligent — 18 super-capacites alimentees par Gemini, OpenAI et Anthropic</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-500 text-white text-xs">Gemini</Badge>
          <Badge className="bg-violet-500 text-white text-xs">OpenAI</Badge>
          <Badge className="bg-orange-500 text-white text-xs">Anthropic</Badge>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-8 w-full">
          <TabsTrigger value="briefing" className="text-xs gap-1"><Coffee className="h-3 w-3" />Briefing</TabsTrigger>
          <TabsTrigger value="phone" className="text-xs gap-1"><Phone className="h-3 w-3" />Telephone</TabsTrigger>
          <TabsTrigger value="email" className="text-xs gap-1"><Mail className="h-3 w-3" />Email</TabsTrigger>
          <TabsTrigger value="meetings" className="text-xs gap-1"><Calendar className="h-3 w-3" />Reunions</TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs gap-1"><CheckSquare className="h-3 w-3" />Taches</TabsTrigger>
          <TabsTrigger value="finance" className="text-xs gap-1"><DollarSign className="h-3 w-3" />Finance</TabsTrigger>
          <TabsTrigger value="drive" className="text-xs gap-1"><HardDrive className="h-3 w-3" />Drive</TabsTrigger>
          <TabsTrigger value="stats" className="text-xs gap-1"><BarChart3 className="h-3 w-3" />Stats</TabsTrigger>
        </TabsList>

        <TabsContent value="briefing"><BriefingTab /></TabsContent>
        <TabsContent value="phone"><PhoneTab /></TabsContent>
        <TabsContent value="email"><EmailTab /></TabsContent>
        <TabsContent value="meetings"><MeetingsTab /></TabsContent>
        <TabsContent value="tasks"><TasksTab /></TabsContent>
        <TabsContent value="finance"><FinanceTab /></TabsContent>
        <TabsContent value="drive"><DriveTab /></TabsContent>
        <TabsContent value="stats"><StatsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function BriefingTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const loadBriefing = async () => {
    setLoading(true);
    try {
      const d = await apiGet("/commandant/daily-briefing");
      if (d.success) setData(d);
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  useEffect(() => { loadBriefing(); }, []);

  const weatherIcons: Record<string, string> = { ensoleille: "☀️", nuageux: "⛅", orageux: "⛈️" };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Coffee className="h-5 w-5 text-amber-500" />Briefing du jour</h2>
        <Button onClick={loadBriefing} variant="outline" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button>
      </div>

      {loading && !data ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : data ? (
        <>
          <Card className="border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="text-4xl">{weatherIcons[data.briefing?.weatherOfBusiness] || "🌤️"}</div>
                <div className="flex-1">
                  <p className="text-base font-medium">{data.briefing?.greeting}</p>
                  {data.briefing?.motivationalNote && <p className="text-sm text-muted-foreground mt-2 italic">{data.briefing.motivationalNote}</p>}
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-amber-600">{data.briefing?.priorityScore || "?"}</div>
                  <div className="text-[10px] text-muted-foreground">Score Priorite</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-4 gap-3">
            <Card className="text-center p-3"><CheckSquare className="h-4 w-4 mx-auto mb-1 text-blue-500" /><div className="text-xl font-bold">{data.rawData?.openTasks || 0}</div><div className="text-[10px] text-muted-foreground">Taches ouvertes</div></Card>
            <Card className="text-center p-3"><AlertTriangle className="h-4 w-4 mx-auto mb-1 text-red-500" /><div className="text-xl font-bold text-red-600">{data.rawData?.overdueTasks || 0}</div><div className="text-[10px] text-muted-foreground">En retard</div></Card>
            <Card className="text-center p-3"><Calendar className="h-4 w-4 mx-auto mb-1 text-emerald-500" /><div className="text-xl font-bold">{data.rawData?.todayEvents || 0}</div><div className="text-[10px] text-muted-foreground">Evenements</div></Card>
            <Card className="text-center p-3"><DollarSign className="h-4 w-4 mx-auto mb-1 text-orange-500" /><div className="text-xl font-bold text-orange-600">{data.rawData?.overdueInvoices || 0}</div><div className="text-[10px] text-muted-foreground">Factures retard</div></Card>
          </div>

          {data.briefing?.criticalItems?.length > 0 && (
            <Card className="border-red-200 bg-red-50">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-red-700 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />Items critiques</CardTitle></CardHeader>
              <CardContent><ul className="space-y-1">{data.briefing.criticalItems.map((item: string, i: number) => <li key={i} className="text-sm text-red-700 flex items-center gap-1"><ArrowRight className="h-3 w-3 shrink-0" />{item}</li>)}</ul></CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4">
            {data.briefing?.todayAgenda?.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Calendar className="h-4 w-4 text-blue-500" />Agenda</CardTitle></CardHeader>
                <CardContent><ul className="space-y-1">{data.briefing.todayAgenda.map((item: string, i: number) => <li key={i} className="text-xs flex items-center gap-1"><Clock className="h-3 w-3 text-muted-foreground shrink-0" />{item}</li>)}</ul></CardContent>
              </Card>
            )}
            {data.briefing?.recommendations?.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Sparkles className="h-4 w-4 text-amber-500" />Recommandations IA</CardTitle></CardHeader>
                <CardContent><ul className="space-y-1">{data.briefing.recommendations.map((item: string, i: number) => <li key={i} className="text-xs flex items-center gap-1"><Star className="h-3 w-3 text-amber-500 shrink-0" />{item}</li>)}</ul></CardContent>
              </Card>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PhoneTab() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<any>(null);
  const [compileResult, setCompileResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const { toast } = useToast();

  const getSmartResponse = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/call-smart-response", { callerPhone: phone, callerName: name, callNotes: notes, callDirection: "entrant" });
      if (d.success) setResult(d);
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const compileCall = async () => {
    setCompiling(true);
    try {
      const d = await apiPost("/commandant/call-compile", { callerPhone: phone, callerName: name, notes, duration: 300 });
      if (d.success) { setCompileResult(d); toast({ title: "Succes", description: `${d.createdTasks?.length || 0} taches et ${d.createdEvents?.length || 0} RDV crees` }); }
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setCompiling(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Phone className="h-4 w-4 text-emerald-500" />Reponse intelligente aux appels</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Telephone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+33 6 12 34 56 78" /></div>
              <div><Label className="text-xs">Nom</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Jean Dupont" /></div>
            </div>
            <div><Label className="text-xs">Notes de l'appel</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Sujet de l'appel, ce qui a ete discute..." rows={3} /></div>
            <div className="flex gap-2">
              <Button onClick={getSmartResponse} disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-700">{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}Reponse IA</Button>
              <Button onClick={compileCall} disabled={compiling} variant="outline" className="flex-1">{compiling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}Compiler</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Resultat IA</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-72">
              {result ? (
                <div className="space-y-3">
                  {result.contact && <div className="p-2 bg-blue-50 rounded text-xs"><strong>Contact reconnu:</strong> {result.contact.name} ({result.contact.company || "N/A"}) - {result.contact.totalCalls || 0} appels</div>}
                  {result.aiResponse?.greeting && <div className="p-2 bg-emerald-50 rounded text-xs"><strong>Accueil:</strong> {result.aiResponse.greeting}</div>}
                  {result.aiResponse?.detectedIntent && <Badge className="text-xs">{result.aiResponse.detectedIntent}</Badge>}
                  {result.aiResponse?.contextBriefing && <p className="text-xs text-muted-foreground">{result.aiResponse.contextBriefing}</p>}
                  {result.aiResponse?.suggestedResponses?.map((r: string, i: number) => <div key={i} className="p-2 bg-muted rounded text-xs flex items-start gap-1"><MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />{r}</div>)}
                  {result.aiResponse?.recommendedActions?.length > 0 && (
                    <div><div className="text-xs font-medium mb-1">Actions recommandees:</div>{result.aiResponse.recommendedActions.map((a: string, i: number) => <div key={i} className="text-xs text-muted-foreground ml-2">• {a}</div>)}</div>
                  )}
                </div>
              ) : <p className="text-xs text-muted-foreground text-center py-8">Entrez un numero et cliquez sur "Reponse IA"</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {compileResult && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4 text-amber-500" />Compilation de l'appel</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{compileResult.compilation?.summary}</p>
            {compileResult.createdTasks?.length > 0 && <div className="text-xs"><strong>Taches creees:</strong> {compileResult.createdTasks.map((t: any) => t.title).join(", ")}</div>}
            {compileResult.createdEvents?.length > 0 && <div className="text-xs"><strong>RDV crees:</strong> {compileResult.createdEvents.map((e: any) => e.title).join(", ")}</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EmailTab() {
  const [emailFrom, setEmailFrom] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [tone, setTone] = useState("professionnel");
  const [reply, setReply] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [emails, setEmails] = useState("");
  const [compilation, setCompilation] = useState<any>(null);
  const [compilingEmails, setCompilingEmails] = useState(false);
  const { toast } = useToast();

  const generateReply = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/email-smart-reply", { emailFrom, emailSubject, emailBody, tone });
      if (d.success) setReply(d.reply);
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const compileEmails = async () => {
    setCompilingEmails(true);
    try {
      const emailList = emails.split("\n---\n").map(block => {
        const lines = block.trim().split("\n");
        return { from: lines[0] || "", subject: lines[1] || "", body: lines.slice(2).join("\n") };
      }).filter(e => e.from || e.subject);
      const d = await apiPost("/commandant/email-compile", { emails: emailList });
      if (d.success) setCompilation(d.compilation);
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setCompilingEmails(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4 text-blue-500" />Reponse email intelligente</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">De</Label><Input value={emailFrom} onChange={e => setEmailFrom(e.target.value)} placeholder="client@example.com" /></div>
            <div><Label className="text-xs">Objet</Label><Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Demande de devis" /></div>
            <div><Label className="text-xs">Corps du mail</Label><Textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} placeholder="Contenu de l'email recu..." rows={4} /></div>
            <div><Label className="text-xs">Ton</Label>
              <Select value={tone} onValueChange={setTone}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="professionnel">Professionnel</SelectItem>
                <SelectItem value="formel">Formel</SelectItem>
                <SelectItem value="empathique">Empathique</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
                <SelectItem value="direct">Direct</SelectItem>
              </SelectContent></Select>
            </div>
            <Button onClick={generateReply} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700">{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}Generer la reponse</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Reponse generee</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-80">
              {reply ? (
                <div className="space-y-3">
                  <div className="text-xs"><strong>Objet:</strong> {reply.replySubject}</div>
                  <div className="flex gap-1 flex-wrap">
                    {reply.detectedIntent && <Badge variant="outline" className="text-[10px]">{reply.detectedIntent}</Badge>}
                    {reply.urgency && <Badge variant={reply.urgency === "haute" ? "destructive" : "secondary"} className="text-[10px]">{reply.urgency}</Badge>}
                    {reply.tone && <Badge className="text-[10px] bg-blue-100 text-blue-700">{reply.tone}</Badge>}
                  </div>
                  <div className="p-3 bg-muted rounded text-sm whitespace-pre-wrap">{reply.replyBody?.replace(/<[^>]*>/g, "") || reply.replyBody}</div>
                  {reply.suggestedActions?.length > 0 && (
                    <div className="space-y-1"><div className="text-xs font-semibold">Actions suggerees:</div>{reply.suggestedActions.map((a: string, i: number) => <div key={i} className="text-xs text-muted-foreground">• {a}</div>)}</div>
                  )}
                </div>
              ) : <p className="text-xs text-muted-foreground text-center py-8">Entrez un email et cliquez pour generer</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4 text-purple-500" />Derleme - Compilation d'emails</CardTitle>
          <CardDescription className="text-xs">Collez vos emails separes par "---" (ligne 1: expediteur, ligne 2: objet, reste: contenu)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={emails} onChange={e => setEmails(e.target.value)} placeholder={"client@example.com\nDemande de devis\nBonjour, je souhaite un devis pour...\n---\nautreclient@example.com\nFacture en attente\nMerci de nous envoyer la facture..."} rows={5} />
          <Button onClick={compileEmails} disabled={compilingEmails} className="bg-purple-600 hover:bg-purple-700">{compilingEmails ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}Compiler les emails</Button>
          {compilation && (
            <div className="space-y-2">
              <div className="p-3 bg-purple-50 rounded text-sm">{compilation.globalSummary}</div>
              {compilation.priorityActions?.map((a: string, i: number) => <div key={i} className="text-xs flex items-center gap-1"><ArrowRight className="h-3 w-3 text-purple-500" />{a}</div>)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MeetingsTab() {
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("60");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const compileMeeting = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/meeting-compile", { meetingTitle: title, participants: participants.split(",").map(s => s.trim()), notes, duration: parseInt(duration), meetingType: "reunion" });
      if (d.success) { setResult(d); toast({ title: "Reunion compilee", description: `${d.createdTasks?.length || 0} taches, ${d.createdEvents?.length || 0} suivis, ${d.remindersCreated || 0} rappels crees` }); }
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-indigo-500" />Compilation de reunion</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">Titre de la reunion</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Reunion commerciale hebdomadaire" /></div>
            <div><Label className="text-xs">Participants (separes par virgule)</Label><Input value={participants} onChange={e => setParticipants(e.target.value)} placeholder="Jean, Marie, Pierre" /></div>
            <div><Label className="text-xs">Duree (minutes)</Label><Input value={duration} onChange={e => setDuration(e.target.value)} type="number" /></div>
            <div><Label className="text-xs">Notes de reunion</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ce qui a ete discute, decisions prises, points importants..." rows={6} /></div>
            <Button onClick={compileMeeting} disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700">{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Brain className="h-4 w-4 mr-2" />}Compiler la reunion</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Compte-rendu IA</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              {result ? (
                <div className="space-y-3">
                  <div className="p-3 bg-indigo-50 rounded text-sm font-medium">{result.compilation?.summary}</div>
                  {result.compilation?.keyDecisions?.length > 0 && (
                    <div><div className="text-xs font-semibold mb-1">Decisions prises:</div>{result.compilation.keyDecisions.map((d: string, i: number) => <div key={i} className="text-xs ml-2">✓ {d}</div>)}</div>
                  )}
                  {result.createdTasks?.length > 0 && (
                    <div className="p-2 bg-emerald-50 rounded"><div className="text-xs font-semibold text-emerald-700 mb-1">Taches creees automatiquement:</div>{result.createdTasks.map((t: any, i: number) => <div key={i} className="text-xs">• {t.title} [{t.priority}]</div>)}</div>
                  )}
                  {result.createdEvents?.length > 0 && (
                    <div className="p-2 bg-blue-50 rounded"><div className="text-xs font-semibold text-blue-700 mb-1">Suivis planifies:</div>{result.createdEvents.map((e: any, i: number) => <div key={i} className="text-xs">• {e.title}</div>)}</div>
                  )}
                  {result.compilation?.nextSteps?.length > 0 && (
                    <div><div className="text-xs font-semibold mb-1">Prochaines etapes:</div>{result.compilation.nextSteps.map((s: string, i: number) => <div key={i} className="text-xs ml-2"><ArrowRight className="h-3 w-3 inline mr-1" />{s}</div>)}</div>
                  )}
                  {result.compilation?.risks?.length > 0 && (
                    <div className="p-2 bg-red-50 rounded"><div className="text-xs font-semibold text-red-700">Risques:</div>{result.compilation.risks.map((r: string, i: number) => <div key={i} className="text-xs text-red-600">⚠ {r}</div>)}</div>
                  )}
                </div>
              ) : <p className="text-xs text-muted-foreground text-center py-8">Entrez les notes de reunion et compilez</p>}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TasksTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [interactionContent, setInteractionContent] = useState("");
  const [interactionType, setInteractionType] = useState("note");
  const [createResult, setCreateResult] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();

  const loadOverdue = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/overdue-reminders", { sendEmails: false });
      if (d.success) setData(d);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const sendReminders = async () => {
    try {
      const d = await apiPost("/commandant/overdue-reminders", { sendEmails: true });
      if (d.success) toast({ title: "Rappels envoyes", description: `${d.emailsSent} emails de rappel envoyes` });
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
  };

  const autoCreate = async () => {
    setCreating(true);
    try {
      const d = await apiPost("/commandant/auto-create-from-interaction", { interactionType, content: interactionContent });
      if (d.success) { setCreateResult(d); toast({ title: "Succes", description: `${d.createdTasks?.length || 0} taches et ${d.createdEvents?.length || 0} RDV crees` }); }
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setCreating(false);
  };

  useEffect(() => { loadOverdue(); }, []);

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" />Taches & factures en retard</CardTitle></CardHeader>
          <CardContent>
            {data ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 bg-red-50 rounded"><div className="text-lg font-bold text-red-600">{data.overdue?.tasks || 0}</div><div className="text-[10px]">Taches</div></div>
                  <div className="p-2 bg-orange-50 rounded"><div className="text-lg font-bold text-orange-600">{data.overdue?.invoices || 0}</div><div className="text-[10px]">Factures</div></div>
                  <div className="p-2 bg-blue-50 rounded"><div className="text-lg font-bold text-blue-600">{data.overdue?.events || 0}</div><div className="text-[10px]">Evenements</div></div>
                </div>
                {data.aiAnalysis?.dailySummary && <p className="text-xs bg-muted p-2 rounded">{data.aiAnalysis.dailySummary}</p>}
                {data.aiAnalysis?.criticalAlerts?.map((a: string, i: number) => <div key={i} className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{a}</div>)}
                <Button onClick={sendReminders} className="w-full bg-red-600 hover:bg-red-700"><Send className="h-4 w-4 mr-2" />Envoyer rappels email</Button>
              </div>
            ) : <Skeleton className="h-40" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" />Creation auto depuis interaction</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Select value={interactionType} onValueChange={setInteractionType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="appel">Appel</SelectItem>
              <SelectItem value="reunion">Reunion</SelectItem>
              <SelectItem value="note">Note</SelectItem>
            </SelectContent></Select>
            <Textarea value={interactionContent} onChange={e => setInteractionContent(e.target.value)} placeholder="Collez le contenu de l'interaction..." rows={5} />
            <Button onClick={autoCreate} disabled={creating} className="w-full">{creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}Extraire taches & RDV</Button>
            {createResult && (
              <div className="p-2 bg-emerald-50 rounded text-xs space-y-1">
                <div className="font-medium">{createResult.summary}</div>
                {createResult.createdTasks?.map((t: any, i: number) => <div key={i}>✓ Tache: {t.title}</div>)}
                {createResult.createdEvents?.map((e: any, i: number) => <div key={i}>📅 RDV: {e.title}</div>)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FinanceTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiGet("/commandant/payment-overview");
      if (d.success) setData(d);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><DollarSign className="h-5 w-5 text-emerald-500" />Vue financiere IA</h2>
        <Button onClick={load} variant="outline" disabled={loading}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {data ? (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Card className="text-center p-3"><div className="text-xl font-bold text-emerald-600">{data.overview?.totalPaid?.toFixed(0) || 0}</div><div className="text-[10px] text-muted-foreground">EUR Encaisses</div></Card>
            <Card className="text-center p-3"><div className="text-xl font-bold text-orange-600">{data.overview?.totalPending?.toFixed(0) || 0}</div><div className="text-[10px] text-muted-foreground">EUR En attente</div></Card>
            <Card className="text-center p-3"><div className="text-xl font-bold text-red-600">{data.overview?.totalOverdue?.toFixed(0) || 0}</div><div className="text-[10px] text-muted-foreground">EUR En retard</div></Card>
            <Card className="text-center p-3 border-2 border-amber-200"><div className="text-xl font-bold text-amber-600">{data.analysis?.healthScore || "?"}</div><div className="text-[10px] text-muted-foreground">Score Sante</div></Card>
          </div>

          {data.analysis?.summary && <Card className="p-4 bg-gradient-to-r from-emerald-50 to-blue-50"><p className="text-sm">{data.analysis.summary}</p></Card>}
          {data.analysis?.cashFlowForecast && <Card className="p-4"><CardTitle className="text-sm mb-2 flex items-center gap-1"><TrendingUp className="h-4 w-4 text-blue-500" />Prevision tresorerie</CardTitle><p className="text-xs text-muted-foreground">{data.analysis.cashFlowForecast}</p></Card>}

          {data.analysis?.criticalActions?.length > 0 && (
            <Card className="border-red-200">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-red-700">Actions critiques</CardTitle></CardHeader>
              <CardContent>{data.analysis.criticalActions.map((a: string, i: number) => <div key={i} className="text-xs flex items-center gap-1 mb-1"><AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />{a}</div>)}</CardContent>
            </Card>
          )}

          {data.overdueInvoices?.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600">Factures en retard</CardTitle></CardHeader>
              <CardContent><ScrollArea className="h-40">
                {data.overdueInvoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between p-2 text-xs border-b">
                    <div><span className="font-mono font-semibold">{inv.reference}</span> <span className="text-muted-foreground">{inv.clientName}</span></div>
                    <div className="flex items-center gap-2"><span className="font-bold text-red-600">{inv.remaining?.toFixed(2)} EUR</span><Badge variant="destructive" className="text-[10px]">{inv.daysOverdue}j retard</Badge></div>
                  </div>
                ))}
              </ScrollArea></CardContent>
            </Card>
          )}
        </>
      ) : <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>}
    </div>
  );
}

function DriveTab() {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachmentName, setAttachmentName] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const sendFile = async () => {
    setLoading(true);
    try {
      const d = await apiPost("/commandant/drive-send-file", { recipientEmail, subject, message, fileName });
      if (d.success) toast({ title: "Envoye", description: d.message });
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  const saveAttachment = async () => {
    setSaving(true);
    try {
      const d = await apiPost("/commandant/save-attachment-to-drive", { fileName: attachmentName, fileContent: "base64content", emailSubject });
      if (d.success) toast({ title: "Sauvegarde", description: d.message });
      else throw new Error(d.error);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setSaving(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Send className="h-4 w-4 text-blue-500" />Envoyer un fichier par email</CardTitle><CardDescription className="text-xs">Envoyez un fichier Google Drive par email avec onay</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">Email destinataire</Label><Input value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} placeholder="client@example.com" /></div>
            <div><Label className="text-xs">Objet</Label><Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Document demande" /></div>
            <div><Label className="text-xs">Nom du fichier</Label><Input value={fileName} onChange={e => setFileName(e.target.value)} placeholder="rapport-mensuel.pdf" /></div>
            <div><Label className="text-xs">Message</Label><Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Veuillez trouver ci-joint..." rows={2} /></div>
            <Button onClick={sendFile} disabled={loading} className="w-full">{loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}Envoyer</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><HardDrive className="h-4 w-4 text-emerald-500" />Sauvegarder piece jointe vers Drive</CardTitle><CardDescription className="text-xs">Transferez les pieces jointes email vers Google Drive</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">Nom du fichier</Label><Input value={attachmentName} onChange={e => setAttachmentName(e.target.value)} placeholder="contrat-signe.pdf" /></div>
            <div><Label className="text-xs">Email d'origine (objet)</Label><Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Re: Contrat de prestation" /></div>
            <Button onClick={saveAttachment} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700">{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <HardDrive className="h-4 w-4 mr-2" />}Sauvegarder vers Drive</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiGet("/commandant/employee-stats");
      if (d.success) setData(d);
    } catch (err: any) { toast({ title: "Erreur", description: err.message, variant: "destructive" }); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Users className="h-5 w-5 text-indigo-500" />Statistiques employes</h2>
        <Button onClick={load} variant="outline" disabled={loading}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      {data ? (
        <>
          {data.analysis?.teamInsights && <Card className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50"><p className="text-sm">{data.analysis.teamInsights}</p>{data.analysis.trends && <p className="text-xs text-muted-foreground mt-2">{data.analysis.trends}</p>}</Card>}

          <div className="grid grid-cols-2 gap-4">
            {data.analysis?.topPerformers?.length > 0 && (
              <Card className="border-emerald-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-emerald-700 flex items-center gap-1"><Star className="h-4 w-4" />Top Performers</CardTitle></CardHeader>
                <CardContent>{data.analysis.topPerformers.map((p: any, i: number) => <div key={i} className="text-xs mb-1"><strong>{p.name}</strong>: {p.reason}</div>)}</CardContent>
              </Card>
            )}
            {data.analysis?.needsAttention?.length > 0 && (
              <Card className="border-amber-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-700 flex items-center gap-1"><Eye className="h-4 w-4" />A surveiller</CardTitle></CardHeader>
                <CardContent>{data.analysis.needsAttention.map((p: any, i: number) => <div key={i} className="text-xs mb-1"><strong>{p.name}</strong>: {p.issue} — <span className="text-amber-600">{p.suggestion}</span></div>)}</CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Detail par employe</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-60">
                <div className="space-y-2">
                  {data.employees?.map((emp: any) => (
                    <div key={emp.id} className="flex items-center justify-between p-2 rounded border hover:bg-muted/50">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${emp.stats.productivityScore >= 70 ? "bg-emerald-500" : emp.stats.productivityScore >= 40 ? "bg-amber-500" : "bg-red-500"}`}>{emp.stats.productivityScore}</div>
                        <div><div className="text-sm font-medium">{emp.name}</div><div className="text-[10px] text-muted-foreground">{emp.role} - {emp.department || "N/A"}</div></div>
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>✓ {emp.stats.tasksCompleted}</span>
                        <span className={emp.stats.tasksOverdue > 0 ? "text-red-500 font-semibold" : ""}>⚠ {emp.stats.tasksOverdue}</span>
                        <span>📞 {emp.stats.callsMade}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {data.analysis?.recommendations?.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Sparkles className="h-4 w-4 text-amber-500" />Recommandations IA</CardTitle></CardHeader>
              <CardContent>{data.analysis.recommendations.map((r: string, i: number) => <div key={i} className="text-xs mb-1 flex items-center gap-1"><ArrowRight className="h-3 w-3 text-amber-500 shrink-0" />{r}</div>)}</CardContent>
            </Card>
          )}
        </>
      ) : <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>}
    </div>
  );
}
