import { useState } from "react";
import { Puzzle, Search, CheckCircle2, Settings2, Zap, RefreshCw, BarChart3, MessageSquare, Users, FolderOpen, Mail, CreditCard, Link2, Shield, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { AiSuggestionsCard } from "@/components/ai-suggestions-card";
import { useGetIntegrationsCatalog, useConnectIntegration, useTestIntegration, type SoftwareIntegration } from "@workspace/api-client-react";

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  crm: { label: "CRM", icon: Users, color: "text-blue-600 bg-blue-100" },
  communication: { label: "Communication", icon: MessageSquare, color: "text-green-600 bg-green-100" },
  gestion_projet: { label: "Gestion de projet", icon: BarChart3, color: "text-purple-600 bg-purple-100" },
  comptabilite: { label: "Comptabilite", icon: CreditCard, color: "text-amber-600 bg-amber-100" },
  documents: { label: "Documents", icon: FolderOpen, color: "text-orange-600 bg-orange-100" },
  messagerie: { label: "Messagerie", icon: Mail, color: "text-sky-600 bg-sky-100" },
  marketing: { label: "Marketing", icon: Zap, color: "text-pink-600 bg-pink-100" },
  automatisation: { label: "Automatisation", icon: RefreshCw, color: "text-indigo-600 bg-indigo-100" },
  support: { label: "Support client", icon: Shield, color: "text-teal-600 bg-teal-100" },
};

const LOGO_COLORS: Record<string, string> = {
  salesforce: "bg-[#00A1E0]",
  hubspot: "bg-[#FF7A59]",
  pipedrive: "bg-[#2D2D2D]",
  slack: "bg-[#4A154B]",
  teams: "bg-[#6264A7]",
  zoom: "bg-[#2D8CFF]",
  trello: "bg-[#0079BF]",
  asana: "bg-[#F06A6A]",
  notion: "bg-[#000000]",
  sage: "bg-[#00DC82]",
  quickbooks: "bg-[#2CA01C]",
  docusign: "bg-[#FFCD00]",
  dropbox: "bg-[#0061FF]",
  outlook: "bg-[#0078D4]",
  mailchimp: "bg-[#FFE01B]",
  sendinblue: "bg-[#0092FF]",
  zapier: "bg-[#FF4A00]",
  make: "bg-[#6D00CC]",
  jira: "bg-[#0052CC]",
  intercom: "bg-[#286EFA]",
  zendesk: "bg-[#03363D]",
};

function SoftwareLogo({ id, name }: { id: string; name: string }) {
  const bg = LOGO_COLORS[id] || "bg-gray-500";
  const initials = name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();
  const textColor = ["docusign", "mailchimp"].includes(id) ? "text-black" : "text-white";
  return (
    <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center ${textColor} font-bold text-sm shrink-0`}>
      {initials}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "connecte") return <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Connecte</Badge>;
  if (status === "en_attente") return <Badge className="bg-amber-100 text-amber-700 text-[10px]">En attente</Badge>;
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Non connecte</Badge>;
}

export default function Software() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [selectedIntegration, setSelectedIntegration] = useState<SoftwareIntegration | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

  const { data: catalog, isLoading } = useGetIntegrationsCatalog({
    query: { queryKey: ["integrations-catalog"] },
  });

  const connectMutation = useConnectIntegration();
  const testMutation = useTestIntegration();

  const integrations = catalog?.integrations ?? [];
  const categories = catalog?.categories ?? [];

  const filteredIntegrations = integrations.filter((i: SoftwareIntegration) => {
    const matchesSearch = !searchQuery || i.name.toLowerCase().includes(searchQuery.toLowerCase()) || i.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === "all" || i.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const handleOpenConfig = (integration: SoftwareIntegration) => {
    setSelectedIntegration(integration);
    setConfigValues({});
  };

  const handleConnect = () => {
    if (!selectedIntegration) return;

    const missingRequired = selectedIntegration.configFields
      .filter((f: any) => f.required && !configValues[f.key]?.trim())
      .map((f: any) => f.label);

    if (missingRequired.length > 0) {
      toast({
        title: "Champs requis manquants",
        description: `Veuillez renseigner : ${missingRequired.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    connectMutation.mutate(
      { integrationId: selectedIntegration.id, data: configValues },
      {
        onSuccess: (response) => {
          toast({
            title: `${selectedIntegration.name} configure`,
            description: response.message || `La connexion a ${selectedIntegration.name} a ete enregistree.`,
          });
          setSelectedIntegration(null);
          setConfigValues({});
        },
        onError: () => {
          toast({
            title: "Erreur de connexion",
            description: `Impossible de configurer ${selectedIntegration.name}. Verifiez vos identifiants.`,
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleTest = () => {
    if (!selectedIntegration) return;
    testMutation.mutate(
      { integrationId: selectedIntegration.id },
      {
        onSuccess: (response) => {
          toast({
            title: "Test reussi",
            description: response.message || `Connexion a ${selectedIntegration.name} verifiee.`,
          });
        },
        onError: () => {
          toast({
            title: "Test echoue",
            description: `Impossible de se connecter a ${selectedIntegration.name}.`,
            variant: "destructive",
          });
        },
      }
    );
  };

  const categoryCounts = [
    { id: "all", label: "Tous", count: integrations.length },
    ...categories.filter((c: any) => c.id !== "all").map((c: any) => ({
      ...c,
      count: integrations.filter((i: SoftwareIntegration) => i.category === c.id).length,
    })),
  ];

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 flex items-center justify-center gap-3 py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="text-muted-foreground">Chargement des logiciels...</span>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Logiciels & Integrations</h1>
          <p className="text-muted-foreground mt-1">
            Connectez vos outils professionnels pour que l'agent travaille dans votre ecosysteme.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-100 text-emerald-700 text-sm px-3 py-1">
            {catalog?.totalAvailable ?? 0} logiciels disponibles
          </Badge>
        </div>
      </div>

      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher un logiciel..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {categoryCounts.map(cat => {
          const meta = CATEGORY_META[cat.id];
          return (
            <Button
              key={cat.id}
              variant={activeCategory === cat.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveCategory(cat.id)}
              className={activeCategory === cat.id ? "" : "hover:bg-accent"}
            >
              {meta && <meta.icon className="w-3.5 h-3.5 mr-1.5" />}
              {cat.id === "all" && <Puzzle className="w-3.5 h-3.5 mr-1.5" />}
              {cat.label} ({cat.count})
            </Button>
          );
        })}
      </div>

      <AiSuggestionsCard page="logiciels" />

      {filteredIntegrations.length === 0 ? (
        <Card>
          <CardContent className="p-12 flex flex-col items-center justify-center gap-4 text-center">
            <Puzzle className="w-12 h-12 text-muted-foreground/30" />
            <h3 className="text-lg font-medium">Aucun logiciel trouve</h3>
            <p className="text-sm text-muted-foreground">Essayez de modifier votre recherche ou changez de categorie.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredIntegrations.map((integration: SoftwareIntegration) => {
            const catMeta = CATEGORY_META[integration.category];
            return (
              <Card key={integration.id} className="hover:shadow-md transition-shadow group">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <SoftwareLogo id={integration.id} name={integration.name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h3 className="font-semibold text-sm truncate">{integration.name}</h3>
                        <StatusBadge status={integration.status} />
                      </div>
                      {catMeta && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${catMeta.color}`}>
                            <catMeta.icon className="w-3 h-3" />
                            {catMeta.label}
                          </span>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{integration.description}</p>
                      <div className="space-y-1 mb-3">
                        {integration.features.slice(0, 2).map((f, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                            <span className="truncate">{f}</span>
                          </div>
                        ))}
                        {integration.features.length > 2 && (
                          <span className="text-[10px] text-muted-foreground">+{integration.features.length - 2} autres fonctionnalites</span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => handleOpenConfig(integration)}
                      >
                        <Settings2 className="w-3.5 h-3.5 mr-1.5" />
                        Configurer
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedIntegration} onOpenChange={(open) => { if (!open) { setSelectedIntegration(null); setConfigValues({}); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedIntegration && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <SoftwareLogo id={selectedIntegration.id} name={selectedIntegration.name} />
                  <div>
                    <DialogTitle>{selectedIntegration.name}</DialogTitle>
                    <DialogDescription>{selectedIntegration.description}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <Separator />

              <div>
                <h4 className="text-sm font-semibold mb-2">Fonctionnalites</h4>
                <div className="space-y-1.5">
                  {selectedIntegration.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="text-sm font-semibold">Configuration</h4>
                {selectedIntegration.configFields.map((field: any) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-xs">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </Label>
                    <Input
                      type={field.type === "password" ? "password" : "text"}
                      placeholder={field.type === "url" ? "https://..." : field.label}
                      value={configValues[field.key] || ""}
                      onChange={(e) => setConfigValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => handleTest()} disabled={testMutation.isPending}>
                  {testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Tester
                </Button>
                <Button onClick={handleConnect} disabled={connectMutation.isPending} className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white">
                  {connectMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Connexion...
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 mr-2" />
                      Connecter {selectedIntegration.name}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
