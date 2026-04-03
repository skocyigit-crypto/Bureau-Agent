import { useState } from "react";
import { Settings, Globe, Shield, Bell, Palette, Database, Link2, CheckCircle2, XCircle, ExternalLink, Calendar, Mail, FolderOpen, FileText, Table2, Presentation, RefreshCw, PhoneIncoming, Clock, Volume2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useSimulateCall } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";

interface GoogleService {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  status: "connecte" | "deconnecte" | "en_attente";
  features: string[];
}

const GOOGLE_SERVICES: GoogleService[] = [
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Synchroniser les rendez-vous, planifier des appels de suivi et consulter la disponibilite des contacts.",
    icon: Calendar,
    status: "deconnecte",
    features: [
      "Planification automatique des rappels",
      "Synchronisation bidirectionnelle des evenements",
      "Verification de disponibilite avant appel",
      "Rappels de suivi intelligents",
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Envoyer et recevoir des e-mails directement depuis l'application. Synchroniser les messages avec les contacts.",
    icon: Mail,
    status: "deconnecte",
    features: [
      "Envoi d'e-mails depuis la fiche contact",
      "Synchronisation des conversations",
      "Modeles d'e-mails professionnels",
      "Suivi des ouvertures",
    ],
  },
  {
    id: "drive",
    name: "Google Drive",
    description: "Joindre des documents aux appels et contacts. Stocker les comptes rendus automatiquement.",
    icon: FolderOpen,
    status: "deconnecte",
    features: [
      "Pieces jointes aux fiches contact",
      "Stockage des comptes rendus d'appel",
      "Partage de documents securise",
      "Recherche dans les documents",
    ],
  },
  {
    id: "docs",
    name: "Google Docs",
    description: "Creer des comptes rendus de reunion et rapports d'activite directement depuis l'application.",
    icon: FileText,
    status: "deconnecte",
    features: [
      "Generation de comptes rendus IA",
      "Modeles de rapports",
      "Collaboration en temps reel",
      "Export PDF automatique",
    ],
  },
  {
    id: "sheets",
    name: "Google Sheets",
    description: "Exporter des donnees vers des feuilles de calcul et importer des listes de contacts.",
    icon: Table2,
    status: "deconnecte",
    features: [
      "Export des rapports d'activite",
      "Import de contacts en masse",
      "Tableaux croises dynamiques",
      "Mise a jour en temps reel",
    ],
  },
  {
    id: "slides",
    name: "Google Slides",
    description: "Generer des presentations de performance et de synthese pour les reunions d'equipe.",
    icon: Presentation,
    status: "deconnecte",
    features: [
      "Rapports de performance hebdomadaires",
      "Presentations client automatisees",
      "Graphiques integres",
      "Export pour reunions",
    ],
  },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("google");
  const [callRingDuration, setCallRingDuration] = useState("30");
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notifAppels, setNotifAppels] = useState(true);
  const [notifTaches, setNotifTaches] = useState(true);
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifIA, setNotifIA] = useState(true);
  const { simulateIncomingCall } = useSimulateCall();
  const { toast } = useToast();

  const handleConnect = (serviceId: string) => {
    toast({
      title: "Connexion en cours",
      description: `Redirection vers Google pour autoriser ${serviceId}...`,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Parametres</h1>
        <p className="text-muted-foreground">Configuration de l'application et integrations.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="google" className="gap-2">
            <Globe className="w-4 h-4" />
            Google Workspace
          </TabsTrigger>
          <TabsTrigger value="appels" className="gap-2">
            <PhoneIncoming className="w-4 h-4" />
            Appels
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="w-4 h-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="securite" className="gap-2">
            <Shield className="w-4 h-4" />
            Securite
          </TabsTrigger>
        </TabsList>

        <TabsContent value="google" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="w-5 h-5 text-blue-600" />
                    Google Workspace
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Connectez vos services Google pour une experience integree. L'agent travaille directement avec votre Workspace.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs">
                  0 / {GOOGLE_SERVICES.length} connecte(s)
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {GOOGLE_SERVICES.map((service) => (
                  <div key={service.id} className="border rounded-xl p-4 hover:border-primary/30 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4">
                        <div className={`p-2.5 rounded-lg ${service.status === "connecte" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-muted"}`}>
                          <service.icon className={`w-5 h-5 ${service.status === "connecte" ? "text-emerald-600" : "text-muted-foreground"}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-sm">{service.name}</h3>
                            {service.status === "connecte" ? (
                              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px]">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Connecte
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">
                                <XCircle className="w-3 h-3 mr-1" />
                                Non connecte
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mb-3">{service.description}</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {service.features.map((feature, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <div className="w-1 h-1 rounded-full bg-primary/50" />
                                {feature}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant={service.status === "connecte" ? "outline" : "default"}
                        size="sm"
                        className="shrink-0"
                        onClick={() => handleConnect(service.id)}
                      >
                        {service.status === "connecte" ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                            Reconnecter
                          </>
                        ) : (
                          <>
                            <Link2 className="w-3.5 h-3.5 mr-1.5" />
                            Connecter
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Synchronisation</CardTitle>
              <CardDescription>Configurez la frequence et le sens de la synchronisation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Synchronisation automatique</Label>
                  <p className="text-xs text-muted-foreground">Synchroniser les donnees toutes les 15 minutes</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Synchronisation bidirectionnelle</Label>
                  <p className="text-xs text-muted-foreground">Les modifications dans Google se refletent ici et inversement</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Import automatique des contacts</Label>
                  <p className="text-xs text-muted-foreground">Importer les nouveaux contacts Google automatiquement</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appels" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PhoneIncoming className="w-5 h-5" />
                Gestion des appels entrants
              </CardTitle>
              <CardDescription>Configurez le comportement des appels entrants.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Duree de sonnerie</Label>
                  <p className="text-xs text-muted-foreground">Temps avant bascule en appel manque</p>
                </div>
                <Select value={callRingDuration} onValueChange={setCallRingDuration}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 secondes</SelectItem>
                    <SelectItem value="30">30 secondes</SelectItem>
                    <SelectItem value="45">45 secondes</SelectItem>
                    <SelectItem value="60">60 secondes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Son de sonnerie</Label>
                  <p className="text-xs text-muted-foreground">Jouer un son lors d'un appel entrant</p>
                </div>
                <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Identification automatique</Label>
                  <p className="text-xs text-muted-foreground">Rechercher le contact correspondant au numero</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enregistrement automatique</Label>
                  <p className="text-xs text-muted-foreground">Enregistrer automatiquement chaque appel dans l'historique</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div>
                <Label className="mb-2 block">Tester l'experience d'appel</Label>
                <p className="text-xs text-muted-foreground mb-3">Simulez un appel entrant pour tester l'interface.</p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => simulateIncomingCall()}
                    className="gap-2"
                  >
                    <PhoneIncoming className="w-4 h-4" />
                    Simuler un appel
                  </Button>
                  <Input placeholder="+33 1 XX XX XX XX" className="w-48" id="custom-phone" />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const input = document.getElementById("custom-phone") as HTMLInputElement;
                      if (input?.value) simulateIncomingCall(input.value);
                    }}
                  >
                    Appeler ce numero
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Intelligence IA pour les appels</CardTitle>
              <CardDescription>Fonctionnalites IA appliquees aux appels.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Analyse de sentiment en temps reel</Label>
                  <p className="text-xs text-muted-foreground">L'IA analyse le ton de la conversation</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Suggestions contextuelles pendant l'appel</Label>
                  <p className="text-xs text-muted-foreground">Afficher des suggestions basees sur l'historique du contact</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Resume automatique post-appel</Label>
                  <p className="text-xs text-muted-foreground">Generer un resume IA apres chaque appel</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Detection des rappels necessaires</Label>
                  <p className="text-xs text-muted-foreground">L'IA detecte si un rappel est necessaire et cree la tache</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Preferences de notification
              </CardTitle>
              <CardDescription>Choisissez les notifications que vous souhaitez recevoir.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Appels manques</Label>
                  <p className="text-xs text-muted-foreground">Notification pour chaque appel manque</p>
                </div>
                <Switch checked={notifAppels} onCheckedChange={setNotifAppels} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Taches en retard</Label>
                  <p className="text-xs text-muted-foreground">Alerte quand une tache depasse sa date limite</p>
                </div>
                <Switch checked={notifTaches} onCheckedChange={setNotifTaches} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Nouveaux messages</Label>
                  <p className="text-xs text-muted-foreground">Notification pour les messages urgents</p>
                </div>
                <Switch checked={notifMessages} onCheckedChange={setNotifMessages} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Alertes IA</Label>
                  <p className="text-xs text-muted-foreground">Notifications de la reconnaissance IA (detections critiques)</p>
                </div>
                <Switch checked={notifIA} onCheckedChange={setNotifIA} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="securite" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Securite de l'application
              </CardTitle>
              <CardDescription>Parametres de securite et de protection des donnees.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>HTTPS force</Label>
                  <p className="text-xs text-muted-foreground">Toutes les connexions utilisent le chiffrement TLS</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Protection CSRF</Label>
                  <p className="text-xs text-muted-foreground">Protection contre les attaques Cross-Site Request Forgery</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Limitation de debit (Rate Limiting)</Label>
                  <p className="text-xs text-muted-foreground">100 requetes/min standard, 20/min pour l'IA, 200/min pour les lectures</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>En-tetes de securite (Helmet)</Label>
                  <p className="text-xs text-muted-foreground">CSP, X-Frame-Options, HSTS et autres en-tetes de securite</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Protection HPP</Label>
                  <p className="text-xs text-muted-foreground">Protection contre la pollution des parametres HTTP</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>CORS configure</Label>
                  <p className="text-xs text-muted-foreground">Origines autorisees controlees par variable d'environnement</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Limite de taille du corps</Label>
                  <p className="text-xs text-muted-foreground">Maximum 1 Mo par requete</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conformite RGPD</CardTitle>
              <CardDescription>Parametres de conformite au Reglement General sur la Protection des Donnees.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Chiffrement des donnees au repos</Label>
                  <p className="text-xs text-muted-foreground">Les donnees sensibles sont chiffrees dans la base de donnees</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Journal d'audit</Label>
                  <p className="text-xs text-muted-foreground">Enregistrer toutes les actions des utilisateurs</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Droit a l'oubli</Label>
                  <p className="text-xs text-muted-foreground">Permettre la suppression complete des donnees d'un contact</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Export des donnees personnelles</Label>
                  <p className="text-xs text-muted-foreground">Permettre l'export des donnees au format standard</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
