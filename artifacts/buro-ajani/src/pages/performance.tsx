import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, TrendingUp, Clock, Award, BarChart3, Brain, Loader2,
  Target, Phone, CheckSquare, Mail, Calendar, UserCheck,
  ArrowUpRight, ArrowDownRight, Minus, Smile, RefreshCw, History,
  Shield, AlertTriangle, Lightbulb, Sparkles, Compass, Zap, Eye, Heart, Download, Printer
} from "lucide-react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const baseUrl = BASE;

async function fetchMetriques(periode: string) {
  const r = await fetch(`${baseUrl}/api/performance/metriques?periode=${periode}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Erreur ${r.status}`);
  return r.json();
}

async function fetchHistorique() {
  const r = await fetch(`${baseUrl}/api/performance/historique?limit=20`, { credentials: "include" });
  if (!r.ok) throw new Error(`Erreur ${r.status}`);
  return r.json();
}

async function genererRapport(periode: string) {
  const r = await fetch(`${baseUrl}/api/performance/rapport`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periode }),
  });
  if (!r.ok) throw new Error(`Erreur ${r.status}`);
  return r.json();
}

function ScoreGauge({ score, size = "lg" }: { score: number; size?: "sm" | "lg" }) {
  const color = score >= 80 ? "text-emerald-600" : score >= 60 ? "text-amber-600" : score >= 40 ? "text-orange-600" : "text-red-600";
  const bg = score >= 80 ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" :
    score >= 60 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" :
    score >= 40 ? "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800" :
    "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";

  if (size === "sm") {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${bg}`}>
        <span className={`text-sm font-bold ${color}`}>{score}</span>
        <span className="text-[10px] text-muted-foreground">/100</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center w-24 h-24 rounded-2xl border-2 ${bg}`}>
      <span className={`text-3xl font-bold ${color}`}>{score}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">score</span>
    </div>
  );
}

function NiveauBadge({ niveau }: { niveau: string }) {
  const config: Record<string, { bg: string; label: string }> = {
    excellent: { bg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200", label: "Excellent" },
    bon: { bg: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200", label: "Bon" },
    moyen: { bg: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200", label: "Moyen" },
    insuffisant: { bg: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 border-red-200", label: "Insuffisant" },
  };
  const c = config[niveau] || config.moyen;
  return <Badge className={`${c.bg} text-xs`}>{c.label}</Badge>;
}

function MetriqueCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const { toast } = useToast();
  const [periode, setPeriode] = useState("semaine");
  const [rapport, setRapport] = useState<any>(null);

  const metriquesQuery = useQuery({
    queryKey: ["performance-metriques", periode],
    queryFn: () => fetchMetriques(periode),
    refetchInterval: 60000,
  });

  const historiqueQuery = useQuery({
    queryKey: ["performance-historique"],
    queryFn: fetchHistorique,
  });

  const rapportMutation = useMutation({
    mutationFn: () => genererRapport(periode),
    onSuccess: (data) => setRapport(data),
    onError: () => toast({ title: "Erreur", description: "Impossible de generer le rapport IA", variant: "destructive" }),
  });

  const metriques = metriquesQuery.data?.metriques || [];
  const historique = historiqueQuery.data?.historique || [];

  const periodeLabel = periode === "jour" ? "aujourd'hui" : periode === "semaine" ? "cette semaine" : "ce mois";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            Performance de l'equipe
          </h1>
          <p className="text-muted-foreground mt-1">Analyse et rapport des activites des employes</p>
        </div>

        <div className="flex items-center gap-3">
          <Select value={periode} onValueChange={setPeriode}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="jour">Aujourd'hui</SelectItem>
              <SelectItem value="semaine">Cette semaine</SelectItem>
              <SelectItem value="mois">Ce mois</SelectItem>
            </SelectContent>
          </Select>

          <Button
            onClick={() => rapportMutation.mutate()}
            disabled={rapportMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {rapportMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Brain className="w-4 h-4 mr-2" />
            )}
            Analyser avec IA
          </Button>
          <a href={`${BASE}/api/performance/metriques/export/csv?periode=${periode}`} download={`performance_${periode}.csv`}>
            <Button variant="outline" size="icon" title="Exporter CSV"><Download className="w-4 h-4" /></Button>
          </a>
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
        </div>
      </div>

      {metriquesQuery.isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : metriques.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">Aucune donnee de performance</h3>
            <p className="text-muted-foreground text-sm max-w-md">
              Les metriques apparaitront ici au fur et a mesure que les employes utilisent l'application.
              Ajoutez des utilisateurs et commencez a travailler pour voir les statistiques.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Employes actifs</p>
                    <p className="text-2xl font-bold">{metriques.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Actions totales</p>
                    <p className="text-2xl font-bold">{metriques.reduce((s: number, m: any) => s + m.actionsTotal, 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Heures travaillees</p>
                    <p className="text-2xl font-bold">{metriques.reduce((s: number, m: any) => s + m.heuresTravaillees, 0).toFixed(1)}h</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                    <CheckSquare className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Taches terminees</p>
                    <p className="text-2xl font-bold">{metriques.reduce((s: number, m: any) => s + m.tachesTerminees, 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
            {metriques.map((emp: any) => (
              <Card key={emp.userId} className="overflow-hidden">
                <CardHeader className="bg-muted/30 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center border-2 border-indigo-200 dark:border-indigo-800">
                        <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">
                          {emp.prenom?.[0]}{emp.nom?.[0]}
                        </span>
                      </div>
                      <div>
                        <CardTitle className="text-base">{emp.prenom} {emp.nom}</CardTitle>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">{emp.email}</span>
                          <Badge variant="outline" className="text-[10px]">{emp.role}</Badge>
                          {emp.departement && <Badge variant="secondary" className="text-[10px]">{emp.departement}</Badge>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Activite {periodeLabel}</p>
                      <p className="text-lg font-bold">{emp.actionsTotal} actions</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    <MetriqueCard icon={UserCheck} label="Connexions" value={emp.connexions} color="bg-blue-100 dark:bg-blue-900/30 text-blue-600" />
                    <MetriqueCard icon={Phone} label="Appels traites" value={emp.appelsTraites} color="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600" />
                    <MetriqueCard icon={CheckSquare} label="Taches creees" value={emp.tachesCreees} color="bg-violet-100 dark:bg-violet-900/30 text-violet-600" />
                    <MetriqueCard icon={Target} label="Taches terminees" value={emp.tachesTerminees} color="bg-amber-100 dark:bg-amber-900/30 text-amber-600" />
                    <MetriqueCard icon={Mail} label="Messages" value={emp.messagesEnvoyes} color="bg-pink-100 dark:bg-pink-900/30 text-pink-600" />
                    <MetriqueCard icon={Users} label="Contacts ajoutes" value={emp.contactsAjoutes} color="bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600" />
                    <MetriqueCard icon={Calendar} label="Evenements" value={emp.evenementsCrees} color="bg-orange-100 dark:bg-orange-900/30 text-orange-600" />
                    <MetriqueCard icon={Clock} label="Heures" value={`${emp.heuresTravaillees}h`} color="bg-teal-100 dark:bg-teal-900/30 text-teal-600" />
                  </div>
                  {emp.derniereActivite && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Derniere activite : {new Date(emp.derniereActivite).toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {rapportMutation.isPending && (
        <Card className="border-indigo-200 dark:border-indigo-800">
          <CardContent className="flex items-center gap-4 py-8">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
              <Brain className="w-6 h-6 text-indigo-600 animate-pulse" />
            </div>
            <div>
              <p className="font-medium">Analyse multi-IA en cours...</p>
              <p className="text-sm text-muted-foreground">Gemini + OpenAI + Anthropic analysent les performances</p>
            </div>
          </CardContent>
        </Card>
      )}

      {rapport?.analyseIA && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            Rapport d'analyse IA
          </h2>

          {rapport.analyseIA.resumeExecutif && (
            <Card className="border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20">
              <CardContent className="pt-6">
                <p className="text-sm leading-relaxed">{rapport.analyseIA.resumeExecutif}</p>
              </CardContent>
            </Card>
          )}

          {rapport.analyseIA.employes?.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rapport.analyseIA.employes.map((emp: any, i: number) => (
                <Card key={i}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{emp.nom}</CardTitle>
                      <div className="flex items-center gap-2">
                        <NiveauBadge niveau={emp.niveau} />
                        <ScoreGauge score={emp.score} size="sm" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {emp.pointsForts?.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-1">Points forts</p>
                        <ul className="space-y-1">
                          {emp.pointsForts.map((p: string, j: number) => (
                            <li key={j} className="text-xs flex items-start gap-1.5">
                              <ArrowUpRight className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                              {p}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {emp.pointsAmelioration?.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">A ameliorer</p>
                        <ul className="space-y-1">
                          {emp.pointsAmelioration.map((p: string, j: number) => (
                            <li key={j} className="text-xs flex items-start gap-1.5">
                              <ArrowDownRight className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                              {p}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {emp.recommandation && (
                      <div className="bg-muted/50 rounded-lg p-2.5">
                        <p className="text-xs text-muted-foreground">{emp.recommandation}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {rapport.analyseIA.recommandationsEquipe?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4 text-indigo-600" />
                  Recommandations pour l'equipe
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {rapport.analyseIA.recommandationsEquipe.map((r: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                      <Badge className={`shrink-0 text-[10px] ${
                        r.priorite === "haute" ? "bg-red-100 text-red-700 border-red-200" :
                        r.priorite === "moyenne" ? "bg-amber-100 text-amber-700 border-amber-200" :
                        "bg-green-100 text-green-700 border-green-200"
                      }`}>
                        {r.priorite}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium">{r.action}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{r.impact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {rapport.analyseIA.comparaison && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-600" />
                  Comparaison de l'equipe
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {rapport.analyseIA.comparaison.plusProductif && (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
                      <TrendingUp className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Plus productif</p>
                        <p className="text-sm font-medium">{rapport.analyseIA.comparaison.plusProductif}</p>
                      </div>
                    </div>
                  )}
                  {rapport.analyseIA.comparaison.plusAssidu && (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                      <Clock className="w-5 h-5 text-blue-600 shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Plus assidu</p>
                        <p className="text-sm font-medium">{rapport.analyseIA.comparaison.plusAssidu}</p>
                      </div>
                    </div>
                  )}
                  {rapport.analyseIA.comparaison.meilleurScore && (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                      <Award className="w-5 h-5 text-amber-600 shrink-0" />
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Meilleur score</p>
                        <p className="text-sm font-medium">{rapport.analyseIA.comparaison.meilleurScore}</p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {rapport.analyseIA.blague && (
            <Card className="border-pink-200 dark:border-pink-800 bg-pink-50/50 dark:bg-pink-950/20">
              <CardContent className="pt-6 flex items-start gap-3">
                <Smile className="w-5 h-5 text-pink-600 shrink-0 mt-0.5" />
                <p className="text-sm italic text-pink-800 dark:text-pink-300">"{rapport.analyseIA.blague}"</p>
              </CardContent>
            </Card>
          )}

          {rapport.analyseIA.sourcesIA && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Sources IA :</span>
              {rapport.analyseIA.sourcesIA.map((s: string) => (
                <Badge key={s} variant="outline" className={`text-[10px] ${
                  s === "Gemini" ? "border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950/30" :
                  s === "OpenAI" ? "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30" :
                  "border-orange-300 text-orange-700 bg-orange-50 dark:bg-orange-950/30"
                }`}>
                  <Sparkles className="w-2.5 h-2.5 mr-1" />
                  {s}
                </Badge>
              ))}
              {rapport.analyseIA.analyseMultiIA && (
                <Badge className="text-[10px] bg-gradient-to-r from-blue-500 via-emerald-500 to-orange-500 text-white border-0">
                  Multi-IA
                </Badge>
              )}
            </div>
          )}

          {rapport.analyseIA.perspectiveOpenAI && (
            <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="w-4 h-4 text-emerald-600" />
                  Perspective OpenAI
                  <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">GPT</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed">{rapport.analyseIA.perspectiveOpenAI}</p>

                {rapport.analyseIA.conseilDirection && (
                  <div className="bg-emerald-100/50 dark:bg-emerald-900/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 mb-1">Conseil a la direction</p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">{rapport.analyseIA.conseilDirection}</p>
                  </div>
                )}

                {rapport.analyseIA.scoreMoralEquipe != null && (
                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs text-muted-foreground">Moral de l'equipe :</span>
                    <span className="text-sm font-bold text-emerald-700">{rapport.analyseIA.scoreMoralEquipe}/100</span>
                  </div>
                )}

                {rapport.analyseIA.risquesIdentifies?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Risques identifies
                    </p>
                    <div className="space-y-2">
                      {rapport.analyseIA.risquesIdentifies.map((r: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-red-50/50 dark:bg-red-950/20">
                          <Badge className={`shrink-0 text-[10px] ${
                            r.severite === "haute" ? "bg-red-100 text-red-700 border-red-200" :
                            r.severite === "moyenne" ? "bg-amber-100 text-amber-700 border-amber-200" :
                            "bg-green-100 text-green-700 border-green-200"
                          }`}>{r.severite}</Badge>
                          <div>
                            <p className="text-xs font-medium">{r.employe}</p>
                            <p className="text-xs text-muted-foreground">{r.risque}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rapport.analyseIA.opportunitesDeveloppement?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-1">
                      <Lightbulb className="w-3 h-3" /> Opportunites de developpement
                    </p>
                    <div className="space-y-2">
                      {rapport.analyseIA.opportunitesDeveloppement.map((o: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20">
                          <Zap className="w-3 h-3 text-emerald-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-medium">{o.employe}: {o.formation}</p>
                            <p className="text-xs text-muted-foreground">{o.beneficeAttendu}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rapport.analyseIA.alertes?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Alertes
                    </p>
                    <div className="space-y-1">
                      {rapport.analyseIA.alertes.map((a: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-amber-50/50 dark:bg-amber-950/20">
                          <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                          <span><strong>{a.type}:</strong> {a.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {rapport.analyseIA.perspectiveAnthropic && (
            <Card className="border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Compass className="w-4 h-4 text-orange-600" />
                  Vision strategique Anthropic
                  <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-700">Claude</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed">{rapport.analyseIA.perspectiveAnthropic}</p>

                {rapport.analyseIA.dynamiqueEquipe && (
                  <div className="bg-orange-100/50 dark:bg-orange-900/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-3.5 h-3.5 text-orange-600" />
                      <p className="text-xs font-medium text-orange-800 dark:text-orange-300">Dynamique d'equipe</p>
                      <Badge className={`text-[10px] ${
                        rapport.analyseIA.dynamiqueEquipe.cohesion === "forte" ? "bg-emerald-100 text-emerald-700" :
                        rapport.analyseIA.dynamiqueEquipe.cohesion === "moyenne" ? "bg-amber-100 text-amber-700" :
                        "bg-red-100 text-red-700"
                      }`}>{rapport.analyseIA.dynamiqueEquipe.cohesion}</Badge>
                    </div>
                    <p className="text-xs text-orange-700 dark:text-orange-400">{rapport.analyseIA.dynamiqueEquipe.analyse}</p>
                    {rapport.analyseIA.dynamiqueEquipe.recommandations?.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {rapport.analyseIA.dynamiqueEquipe.recommandations.map((r: string, i: number) => (
                          <li key={i} className="text-xs flex items-start gap-1.5">
                            <ArrowUpRight className="w-3 h-3 text-orange-500 mt-0.5 shrink-0" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {rapport.analyseIA.profilsComportementaux?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-2">Profils comportementaux</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {rapport.analyseIA.profilsComportementaux.map((p: any, i: number) => (
                        <div key={i} className="p-3 rounded-lg bg-orange-50/50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900">
                          <p className="text-xs font-medium">{p.employe}</p>
                          <p className="text-xs text-orange-700 dark:text-orange-400 mt-0.5">{p.profil}</p>
                          <p className="text-xs text-muted-foreground mt-1">{p.motivation}</p>
                          <p className="text-xs italic text-orange-600 mt-1">{p.conseil}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rapport.analyseIA.planAction30Jours?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-2 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Plan d'action 30 jours
                    </p>
                    <div className="space-y-2">
                      {rapport.analyseIA.planAction30Jours.map((a: any, i: number) => (
                        <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-orange-50/30 dark:bg-orange-950/10">
                          <Badge className="shrink-0 text-[10px] bg-orange-100 text-orange-700 border-orange-200">S{a.semaine}</Badge>
                          <div>
                            <p className="text-xs font-medium">{a.action}</p>
                            <p className="text-xs text-muted-foreground">{a.responsable} - {a.objectif}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rapport.analyseIA.benchmarkSectoriel && (
                  <div className="bg-orange-100/50 dark:bg-orange-900/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-1">Benchmark sectoriel</p>
                    <p className="text-xs text-orange-700 dark:text-orange-400">{rapport.analyseIA.benchmarkSectoriel}</p>
                  </div>
                )}

                {rapport.analyseIA.citationMotivante && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20 border border-orange-200/50 dark:border-orange-800/50">
                    <Sparkles className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                    <p className="text-sm italic text-orange-800 dark:text-orange-300">"{rapport.analyseIA.citationMotivante}"</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {historique.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              Historique des rapports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {historique.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                      <span className="text-xs font-bold text-indigo-600">{r.userName?.split(" ").map((n: string) => n[0]).join("") || "?"}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{r.userName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.periode} - {new Date(r.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <ScoreGauge score={r.scoreGlobal || 0} size="sm" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
