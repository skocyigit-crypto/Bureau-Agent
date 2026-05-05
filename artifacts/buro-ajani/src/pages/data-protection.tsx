import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, Download, FileText, Users, Phone, CheckSquare, Clock,
  AlertTriangle, CheckCircle2, XCircle, ExternalLink, Send, Eye,
  Trash2, Edit, Lock, Database, Globe, ChevronRight, Info, FileDown
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Icon3D } from "@/components/icon-3d";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useWorkspaceUser } from "@/components/workspace-user";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`${BASE}/api${path}`, { credentials: "include", ...opts });

const RIGHT_ICONS: Record<string, any> = {
  access: Eye,
  portability: Download,
  rectification: Edit,
  erasure: Trash2,
  restriction: Lock,
  objection: AlertTriangle,
};

const RIGHT_COLORS: Record<string, string> = {
  access: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
  portability: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
  rectification: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
  erasure: "text-red-600 bg-red-50 dark:bg-red-950/30",
  restriction: "text-purple-600 bg-purple-50 dark:bg-purple-950/30",
  objection: "text-orange-600 bg-orange-50 dark:bg-orange-950/30",
};

const DATA_ICONS: Record<string, any> = {
  "Utilisateurs & agents": Users,
  "Contacts & clients": Users,
  "Appels téléphoniques": Phone,
  "Tâches & activités": CheckSquare,
  "Prospects": Globe,
  "Pointages & présences": Clock,
  "Notes internes": FileText,
};

export default function DataProtectionPage() {
  const { user } = useWorkspaceUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [requestType, setRequestType] = useState("");
  const [requestDetails, setRequestDetails] = useState("");
  const isAdmin = user.role === "super_admin" || user.role === "administrateur";

  const { data, isLoading } = useQuery({
    queryKey: ["data-protection-summary"],
    queryFn: () => apiFetch("/data-protection/summary").then(r => r.json()),
  });

  const submitMutation = useMutation({
    mutationFn: (body: { requestType: string; details: string }) =>
      apiFetch("/data-protection/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json()),
    onSuccess: (res) => {
      if (res.success) {
        toast({ title: "Demande envoyée", description: res.message });
        setRequestType("");
        setRequestDetails("");
        qc.invalidateQueries({ queryKey: ["data-protection-summary"] });
      } else {
        toast({ title: "Erreur", description: res.error, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Erreur réseau", variant: "destructive" }),
  });

  const acceptMutation = useMutation({
    mutationFn: (documentType: string) =>
      apiFetch("/data-protection/accept-legal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType }),
      }).then(r => r.json()),
    onSuccess: (res) => {
      if (res.success) {
        toast({ title: "Document accepté", description: res.message });
        qc.invalidateQueries({ queryKey: ["data-protection-summary"] });
      } else {
        toast({ title: "Erreur", description: res.error, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Erreur réseau", variant: "destructive" }),
  });

  const handleExport = async () => {
    try {
      const res = await apiFetch("/data-protection/export", { method: "POST" });
      if (!res.ok) { toast({ title: "Erreur export", variant: "destructive" }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `agent-de-bureau-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export téléchargé", description: "Vos données ont été exportées avec succès (Art. 20 RGPD)." });
    } catch {
      toast({ title: "Erreur lors de l'export", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const compliance = data?.compliance;
  const dpo = data?.dpo;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Icon3D icon={Shield} variant="navy" size="lg" />
          <div>
            <h1 className="text-2xl font-bold">Protection des données personnelles</h1>
            <p className="text-muted-foreground text-sm">Conformité RGPD — Gérez vos droits et vos données</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {compliance?.isCompliant ? (
            <Badge className="bg-emerald-500 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Conforme RGPD</Badge>
          ) : (
            <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Non-conformité détectée</Badge>
          )}
        </div>
      </div>

      {!compliance?.isCompliant && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300 text-sm">Documents légaux en attente</p>
              <p className="text-amber-700 dark:text-amber-400 text-xs mt-0.5">
                {compliance?.missingMandatory?.length} document(s) obligatoire(s) non accepté(s). Rendez-vous dans l'onglet "Documents légaux".
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Conformité légale</p>
            <Progress value={compliance?.percent || 0} className="h-2" />
            <p className="text-lg font-bold">{compliance?.percent || 0}%</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Documents acceptés</p>
          <p className="text-2xl font-bold mt-1">{compliance?.acceptedCount || 0}<span className="text-sm text-muted-foreground">/{compliance?.totalCount || 0}</span></p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Catégories de données</p>
          <p className="text-2xl font-bold mt-1">{data?.dataInventory?.length || 0}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Demandes en cours</p>
          <p className="text-2xl font-bold mt-1">{data?.myRequests?.filter((r: any) => r.status === "pending")?.length || 0}</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="rights">
        <TabsList>
          <TabsTrigger value="rights">Mes droits</TabsTrigger>
          <TabsTrigger value="inventory">Données collectées</TabsTrigger>
          <TabsTrigger value="documents">Documents légaux</TabsTrigger>
          <TabsTrigger value="requests">Mes demandes</TabsTrigger>
          <TabsTrigger value="contact">Contact DPO</TabsTrigger>
        </TabsList>

        <TabsContent value="rights" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Vos droits en tant que personne concernée</CardTitle>
              <CardDescription>Conformément au Règlement Général sur la Protection des Données (UE 2016/679), vous disposez des droits suivants :</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data?.requestTypes && Object.entries(data.requestTypes).map(([key, rt]: [string, any]) => {
                const Icon = RIGHT_ICONS[key] || Eye;
                return (
                  <div key={key} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                    <div className={`p-2 rounded-lg shrink-0 ${RIGHT_COLORS[key]}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{rt.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{rt.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-[10px]">{rt.article}</Badge>
                        <span className="text-[10px] text-muted-foreground">Délai de réponse : {rt.responseTime}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Exercer un droit</CardTitle>
              <CardDescription>Soumettez une demande — nous y répondrons dans un délai maximum de 30 jours.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {key === "portability" && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Export immédiat disponible</p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">Téléchargez toutes vos données maintenant (Art. 20 RGPD)</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleExport} className="gap-2 shrink-0">
                    <FileDown className="h-4 w-4" /> Exporter mes données
                  </Button>
                </div>
              )}
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Export immédiat de vos données (Art. 20)</p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">Téléchargez toutes vos données en format JSON</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleExport} className="gap-2 shrink-0">
                    <FileDown className="h-4 w-4" /> Exporter
                  </Button>
                </div>

                <Separator />

                <div className="space-y-3">
                  <Label>Type de demande</Label>
                  <Select value={requestType} onValueChange={setRequestType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionnez un droit à exercer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {data?.requestTypes && Object.entries(data.requestTypes).map(([key, rt]: [string, any]) => (
                        <SelectItem key={key} value={key}>{rt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Label>Détails de votre demande (optionnel)</Label>
                  <Textarea
                    placeholder="Précisez votre demande si nécessaire..."
                    value={requestDetails}
                    onChange={e => setRequestDetails(e.target.value)}
                    rows={3}
                  />

                  <Button
                    onClick={() => submitMutation.mutate({ requestType, details: requestDetails })}
                    disabled={!requestType || submitMutation.isPending}
                    className="gap-2"
                  >
                    <Send className="h-4 w-4" />
                    {submitMutation.isPending ? "Envoi en cours..." : "Soumettre la demande"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" /> Inventaire des données personnelles</CardTitle>
              <CardDescription>Toutes les catégories de données personnelles que nous traitons vous concernant</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {(data?.dataInventory || []).map((item: any) => {
                  const Icon = DATA_ICONS[item.category] || Database;
                  return (
                    <div key={item.category} className="p-4 hover:bg-muted/20 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="font-medium text-sm">{item.category}</p>
                            <Badge variant="secondary" className="text-[10px] shrink-0">{item.count.toLocaleString()} enregistrements</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground">Conservation : {item.retention}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Info className="h-3 w-3 text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground">Base légale : {item.legalBasis}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4 flex items-start gap-3">
              <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-blue-800 dark:text-blue-300 text-sm">Sous-traitants et transferts</p>
                <p className="text-blue-700 dark:text-blue-400 text-xs mt-1">
                  Vos données sont hébergées en Europe (UE). Nos sous-traitants principaux : hébergement cloud (UE), service email Resend (USA — clauses contractuelles types UE applicables), Google Workspace (si connecté — données traitées conformément au DPA Google). Aucun transfert vers des pays tiers sans garanties adéquates.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <div className="grid gap-3">
            {(data?.legalDocuments || []).map((doc: any) => (
              <Card key={doc.code} className={doc.accepted ? "border-emerald-200 dark:border-emerald-800/50" : "border-amber-200 dark:border-amber-800/50"}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-lg shrink-0 ${doc.accepted ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
                        {doc.accepted
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          : <XCircle className="h-4 w-4 text-amber-600" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{doc.title}</p>
                          {doc.mandatory && <Badge variant="destructive" className="text-[10px]">Obligatoire</Badge>}
                          <Badge variant="outline" className="text-[10px]">v{doc.version}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{doc.description}</p>
                        {doc.accepted && doc.acceptedAt && (
                          <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
                            Accepté le {new Date(doc.acceptedAt).toLocaleDateString("fr-FR")} par {doc.acceptedBy}
                          </p>
                        )}
                      </div>
                    </div>
                    {!doc.accepted && isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={acceptMutation.isPending}
                        onClick={() => acceptMutation.mutate(doc.code)}
                      >
                        Accepter
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          {(data?.myRequests || []).length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Shield className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>Aucune demande enregistrée</p>
                <p className="text-xs mt-1">Utilisez l'onglet "Mes droits" pour soumettre une demande</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(data?.myRequests || []).map((req: any) => (
                <Card key={req.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={req.status === "completed" ? "default" : req.status === "pending" ? "secondary" : "outline"}>
                            {req.status === "completed" ? "Traité" : req.status === "pending" ? "En attente" : req.status}
                          </Badge>
                          <span className="text-sm font-medium">{data?.requestTypes?.[req.requestType]?.label || req.requestType}</span>
                        </div>
                        {req.details && <p className="text-xs text-muted-foreground mt-1">{req.details}</p>}
                        {req.responseNotes && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{req.responseNotes}</p>}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{new Date(req.createdAt).toLocaleDateString("fr-FR")}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="contact" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Délégué à la Protection des Données (DPO)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                  <div className="p-2 rounded-lg bg-primary/10"><Users className="h-4 w-4 text-primary" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fonction</p>
                    <p className="font-medium text-sm">{dpo?.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                  <div className="p-2 rounded-lg bg-primary/10"><Send className="h-4 w-4 text-primary" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Email DPO</p>
                    <a href={`mailto:${dpo?.email}`} className="font-medium text-sm text-primary hover:underline">{dpo?.email}</a>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                  <div className="p-2 rounded-lg bg-primary/10"><Globe className="h-4 w-4 text-primary" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground">Adresse</p>
                    <p className="font-medium text-sm">{dpo?.address}</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-semibold mb-2">Autorité de contrôle</p>
                <div className="flex items-center gap-3 p-3 rounded-lg border">
                  <Shield className="h-5 w-5 text-blue-500 shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{dpo?.supervisoryAuthority?.name}</p>
                    <p className="text-xs text-muted-foreground">Commission Nationale de l'Informatique et des Libertés</p>
                    <p className="text-xs text-muted-foreground">{dpo?.supervisoryAuthority?.phone}</p>
                  </div>
                  <a href={dpo?.supervisoryAuthority?.url} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm" className="gap-1">
                      <ExternalLink className="h-3 w-3" /> Contacter la CNIL
                    </Button>
                  </a>
                </div>
              </div>

              <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                <CardContent className="p-4">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      Si vous estimez que vos droits n'ont pas été respectés après nous avoir contactés, vous avez le droit de déposer une réclamation auprès de la CNIL (pour les résidents français) ou de l'autorité de protection des données compétente de votre pays.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

