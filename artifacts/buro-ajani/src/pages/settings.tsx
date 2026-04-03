import { useState } from "react";
import {
  Globe, Shield, Bell, Link2, CheckCircle2,
  XCircle, ExternalLink, Calendar, Mail, FolderOpen, FileText, Table2,
  Presentation, RefreshCw, PhoneIncoming, Clock, Lock, ShieldAlert,
  ShieldCheck, ShieldBan, FileWarning, Download, Upload, Bug, Eye, UserCog,
  AlertTriangle, Server, KeyRound, Fingerprint, ScanSearch, FileX, Ban,
  TriangleAlert, CircleAlert
} from "lucide-react";
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

const BLOCKED_EXTENSIONS = [
  ".exe", ".bat", ".cmd", ".com", ".scr", ".pif", ".vbs", ".vbe", ".js",
  ".jse", ".wsf", ".wsh", ".msi", ".msp", ".mst", ".cpl", ".hta", ".inf",
  ".ins", ".isp", ".lnk", ".reg", ".rgs", ".sct", ".shb", ".shs", ".ps1",
  ".ps1xml", ".ps2", ".ps2xml", ".psc1", ".psc2", ".dll", ".sys", ".drv",
];

const SCAN_STATS = {
  totalScanned: 1247,
  threatsBlocked: 23,
  quarantined: 8,
  lastScan: "03/04/2026 14:32",
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("google");
  const [callRingDuration, setCallRingDuration] = useState("30");
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notifAppels, setNotifAppels] = useState(true);
  const [notifTaches, setNotifTaches] = useState(true);
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifIA, setNotifIA] = useState(true);

  const [blockExternalDownloads, setBlockExternalDownloads] = useState(true);
  const [superAdminOnlyDownload, setSuperAdminOnlyDownload] = useState(true);
  const [blockExternalUploads, setBlockExternalUploads] = useState(true);
  const [virusScanEmails, setVirusScanEmails] = useState(true);
  const [virusScanAttachments, setVirusScanAttachments] = useState(true);
  const [virusScanDrive, setVirusScanDrive] = useState(true);
  const [quarantineSuspicious, setQuarantineSuspicious] = useState(true);
  const [blockMacros, setBlockMacros] = useState(true);
  const [blockEncryptedFiles, setBlockEncryptedFiles] = useState(true);
  const [blockExecutables, setBlockExecutables] = useState(true);
  const [sandboxAnalysis, setSandboxAnalysis] = useState(true);
  const [dlpEnabled, setDlpEnabled] = useState(true);
  const [dlpBlockSensitiveData, setDlpBlockSensitiveData] = useState(true);
  const [dlpNotifyAdmin, setDlpNotifyAdmin] = useState(true);
  const [phishingProtection, setPhishingProtection] = useState(true);
  const [spoofingProtection, setSpoofingProtection] = useState(true);
  const [linkSafetyCheck, setLinkSafetyCheck] = useState(true);
  const [externalSharingBlocked, setExternalSharingBlocked] = useState(true);
  const [forceReauth, setForceReauth] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [maxFileSize, setMaxFileSize] = useState("25");
  const [aiThreatDetection, setAiThreatDetection] = useState(true);
  const [realTimeProtection, setRealTimeProtection] = useState(true);
  const [zeroTrustMode, setZeroTrustMode] = useState(true);

  const { simulateIncomingCall } = useSimulateCall();
  const { toast } = useToast();

  const handleConnect = (serviceId: string) => {
    toast({
      title: "Connexion en cours",
      description: `Redirection vers Google pour autoriser ${serviceId}...`,
    });
  };

  const handleSecurityAction = (action: string) => {
    toast({
      title: "Action de securite",
      description: action,
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

          <Card className="border-red-200 dark:border-red-900/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <ShieldAlert className="w-5 h-5" />
                    Securite Workspace - Protection des fichiers
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Controle strict des telechargements, envois et fichiers. Seul le Super Administrateur peut autoriser les telechargements.
                  </CardDescription>
                </div>
                <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0">
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  Protection maximale
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <ShieldBan className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-red-800 dark:text-red-300">Blocage des telechargements externes</h4>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Tous les fichiers provenant de sources externes (Drive, e-mails, liens partages) sont bloques par defaut.
                      Seul un Super Administrateur peut autoriser le telechargement apres verification.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Download className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer tous les telechargements externes</Label>
                    <p className="text-xs text-muted-foreground">Aucun fichier externe ne peut etre telecharge sans autorisation</p>
                  </div>
                </div>
                <Switch checked={blockExternalDownloads} onCheckedChange={setBlockExternalDownloads} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <UserCog className="w-4 h-4 text-amber-600 mt-0.5" />
                  <div>
                    <Label>Telechargement reserve au Super Administrateur</Label>
                    <p className="text-xs text-muted-foreground">Seul le super admin peut telecharger des fichiers apres verification manuelle</p>
                  </div>
                </div>
                <Switch checked={superAdminOnlyDownload} onCheckedChange={setSuperAdminOnlyDownload} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Upload className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer les envois de fichiers externes</Label>
                    <p className="text-xs text-muted-foreground">Empecher l'envoi de fichiers vers des destinations externes non autorisees</p>
                  </div>
                </div>
                <Switch checked={blockExternalUploads} onCheckedChange={setBlockExternalUploads} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Ban className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer le partage externe</Label>
                    <p className="text-xs text-muted-foreground">Interdire le partage de documents avec des utilisateurs hors de l'organisation</p>
                  </div>
                </div>
                <Switch checked={externalSharingBlocked} onCheckedChange={setExternalSharingBlocked} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <FileX className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Taille maximale des fichiers</Label>
                    <p className="text-xs text-muted-foreground">Limite de taille pour les fichiers autorises (en Mo)</p>
                  </div>
                </div>
                <Select value={maxFileSize} onValueChange={setMaxFileSize}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 Mo</SelectItem>
                    <SelectItem value="10">10 Mo</SelectItem>
                    <SelectItem value="25">25 Mo</SelectItem>
                    <SelectItem value="50">50 Mo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="border-orange-200 dark:border-orange-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                <Bug className="w-5 h-5" />
                Analyse antivirus et anti-malware
              </CardTitle>
              <CardDescription>
                Analyse automatique de tous les fichiers et pieces jointes. Detection des menaces en temps reel par IA.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{SCAN_STATS.totalScanned.toLocaleString("fr-FR")}</p>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-500">Fichiers analyses</p>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-red-700 dark:text-red-400">{SCAN_STATS.threatsBlocked}</p>
                  <p className="text-[10px] text-red-600 dark:text-red-500">Menaces bloquees</p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{SCAN_STATS.quarantined}</p>
                  <p className="text-[10px] text-amber-600 dark:text-amber-500">En quarantaine</p>
                </div>
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{SCAN_STATS.lastScan}</p>
                  <p className="text-[10px] text-blue-600 dark:text-blue-500">Derniere analyse</p>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-orange-500 mt-0.5" />
                  <div>
                    <Label>Analyser tous les e-mails entrants</Label>
                    <p className="text-xs text-muted-foreground">Scanner chaque e-mail pour detecter les virus, liens malveillants et tentatives de phishing</p>
                  </div>
                </div>
                <Switch checked={virusScanEmails} onCheckedChange={setVirusScanEmails} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <FileWarning className="w-4 h-4 text-orange-500 mt-0.5" />
                  <div>
                    <Label>Analyser toutes les pieces jointes</Label>
                    <p className="text-xs text-muted-foreground">Analyse approfondie de chaque piece jointe avant ouverture ou telechargement</p>
                  </div>
                </div>
                <Switch checked={virusScanAttachments} onCheckedChange={setVirusScanAttachments} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <FolderOpen className="w-4 h-4 text-orange-500 mt-0.5" />
                  <div>
                    <Label>Analyser les fichiers Google Drive</Label>
                    <p className="text-xs text-muted-foreground">Analyse en continu de tous les fichiers stockes et partages dans Drive</p>
                  </div>
                </div>
                <Switch checked={virusScanDrive} onCheckedChange={setVirusScanDrive} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Mise en quarantaine automatique</Label>
                    <p className="text-xs text-muted-foreground">Isoler automatiquement les fichiers suspects avant toute action humaine</p>
                  </div>
                </div>
                <Switch checked={quarantineSuspicious} onCheckedChange={setQuarantineSuspicious} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ScanSearch className="w-4 h-4 text-purple-500 mt-0.5" />
                  <div>
                    <Label>Analyse en bac a sable (Sandbox)</Label>
                    <p className="text-xs text-muted-foreground">Executer les fichiers suspects dans un environnement isole pour detecter les comportements malveillants</p>
                  </div>
                </div>
                <Switch checked={sandboxAnalysis} onCheckedChange={setSandboxAnalysis} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Eye className="w-4 h-4 text-purple-500 mt-0.5" />
                  <div>
                    <Label>Detection IA des menaces avancees</Label>
                    <p className="text-xs text-muted-foreground">L'intelligence artificielle analyse les patterns pour detecter les menaces zero-day et APT</p>
                  </div>
                </div>
                <Switch checked={aiThreatDetection} onCheckedChange={setAiThreatDetection} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 mt-0.5" />
                  <div>
                    <Label>Protection en temps reel</Label>
                    <p className="text-xs text-muted-foreground">Surveillance continue avec mise a jour des signatures toutes les 15 minutes</p>
                  </div>
                </div>
                <Switch checked={realTimeProtection} onCheckedChange={setRealTimeProtection} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-purple-200 dark:border-purple-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
                <FileX className="w-5 h-5" />
                Types de fichiers bloques
              </CardTitle>
              <CardDescription>
                Les fichiers avec ces extensions sont systematiquement bloques, meme pour le Super Administrateur.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Ban className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer les fichiers executables</Label>
                    <p className="text-xs text-muted-foreground">.exe, .bat, .cmd, .com, .scr, .pif, .msi, .dll et autres executables</p>
                  </div>
                </div>
                <Switch checked={blockExecutables} onCheckedChange={setBlockExecutables} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <FileWarning className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer les macros Office</Label>
                    <p className="text-xs text-muted-foreground">Empecher l'ouverture de fichiers contenant des macros VBA potentiellement dangereuses</p>
                  </div>
                </div>
                <Switch checked={blockMacros} onCheckedChange={setBlockMacros} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Lock className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Bloquer les fichiers chiffres/proteges</Label>
                    <p className="text-xs text-muted-foreground">Les fichiers chiffres ne peuvent pas etre analyses - bloques par precaution</p>
                  </div>
                </div>
                <Switch checked={blockEncryptedFiles} onCheckedChange={setBlockEncryptedFiles} />
              </div>
              <Separator />

              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs font-medium mb-2">Extensions systematiquement bloquees :</p>
                <div className="flex flex-wrap gap-1.5">
                  {BLOCKED_EXTENSIONS.map((ext) => (
                    <Badge key={ext} variant="outline" className="text-[10px] text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
                      {ext}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-blue-200 dark:border-blue-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                <AlertTriangle className="w-5 h-5" />
                Protection anti-phishing et anti-spoofing
              </CardTitle>
              <CardDescription>
                Detection avancee des tentatives de phishing, d'usurpation d'identite et de liens malveillants dans les e-mails.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-blue-500 mt-0.5" />
                  <div>
                    <Label>Protection anti-phishing</Label>
                    <p className="text-xs text-muted-foreground">Detecter et bloquer les e-mails de phishing (faux expediteurs, liens trompeurs)</p>
                  </div>
                </div>
                <Switch checked={phishingProtection} onCheckedChange={setPhishingProtection} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Fingerprint className="w-4 h-4 text-blue-500 mt-0.5" />
                  <div>
                    <Label>Protection anti-usurpation (Spoofing)</Label>
                    <p className="text-xs text-muted-foreground">Verifier SPF, DKIM et DMARC pour chaque e-mail entrant</p>
                  </div>
                </div>
                <Switch checked={spoofingProtection} onCheckedChange={setSpoofingProtection} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ExternalLink className="w-4 h-4 text-blue-500 mt-0.5" />
                  <div>
                    <Label>Verification de securite des liens</Label>
                    <p className="text-xs text-muted-foreground">Analyser chaque lien dans les e-mails avant de permettre l'acces</p>
                  </div>
                </div>
                <Switch checked={linkSafetyCheck} onCheckedChange={setLinkSafetyCheck} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200 dark:border-amber-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <Eye className="w-5 h-5" />
                Prevention des fuites de donnees (DLP)
              </CardTitle>
              <CardDescription>
                Empecher la fuite de donnees sensibles via e-mails, fichiers partages ou documents.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Shield className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div>
                    <Label>Protection DLP active</Label>
                    <p className="text-xs text-muted-foreground">Analyser le contenu sortant pour detecter les donnees sensibles (IBAN, CB, NIR, mots de passe)</p>
                  </div>
                </div>
                <Switch checked={dlpEnabled} onCheckedChange={setDlpEnabled} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Ban className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div>
                    <Label>Bloquer l'envoi de donnees sensibles</Label>
                    <p className="text-xs text-muted-foreground">Empecher automatiquement l'envoi d'e-mails contenant des donnees personnelles non autorisees</p>
                  </div>
                </div>
                <Switch checked={dlpBlockSensitiveData} onCheckedChange={setDlpBlockSensitiveData} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Bell className="w-4 h-4 text-amber-500 mt-0.5" />
                  <div>
                    <Label>Notifier le Super Administrateur</Label>
                    <p className="text-xs text-muted-foreground">Alerte immediate au super admin en cas de tentative de fuite de donnees</p>
                  </div>
                </div>
                <Switch checked={dlpNotifyAdmin} onCheckedChange={setDlpNotifyAdmin} />
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
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Alertes de securite Workspace</Label>
                  <p className="text-xs text-muted-foreground">Notification immediate en cas de menace detectee, fichier bloque ou tentative de phishing</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Rapport de securite quotidien</Label>
                  <p className="text-xs text-muted-foreground">Resume quotidien des evenements de securite envoye au Super Administrateur</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="securite" className="space-y-6 mt-6">
          <Card className="border-emerald-200 dark:border-emerald-900/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-600" />
                    Securite de l'application
                  </CardTitle>
                  <CardDescription>Protection multi-couches active en permanence.</CardDescription>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  Toutes les protections actives
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>HTTPS force</Label>
                  <p className="text-xs text-muted-foreground">Toutes les connexions utilisent le chiffrement TLS 1.3</p>
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

          <Card className="border-red-200 dark:border-red-900/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <ShieldAlert className="w-5 h-5" />
                Mode Zero Trust
              </CardTitle>
              <CardDescription>Architecture de securite ou aucun utilisateur, appareil ou reseau n'est considere comme fiable par defaut.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="font-semibold text-sm text-red-800 dark:text-red-300">Principe : ne jamais faire confiance, toujours verifier</h4>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Chaque requete est authentifiee, autorisee et chiffree independamment de sa source.
                      Les sessions sont limitees dans le temps et les privileges sont accorde au minimum necessaire.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <ShieldBan className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Mode Zero Trust actif</Label>
                    <p className="text-xs text-muted-foreground">Verifier chaque acces, meme depuis le reseau interne</p>
                  </div>
                </div>
                <Switch checked={zeroTrustMode} onCheckedChange={setZeroTrustMode} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <KeyRound className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Re-authentification obligatoire</Label>
                    <p className="text-xs text-muted-foreground">Exiger une re-authentification pour les actions sensibles (suppression, export, admin)</p>
                  </div>
                </div>
                <Switch checked={forceReauth} onCheckedChange={setForceReauth} />
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Expiration de session</Label>
                    <p className="text-xs text-muted-foreground">Delai d'inactivite avant deconnexion automatique</p>
                  </div>
                </div>
                <Select value={sessionTimeout} onValueChange={setSessionTimeout}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="60">1 heure</SelectItem>
                    <SelectItem value="120">2 heures</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Fingerprint className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Authentification multi-facteurs (MFA)</Label>
                    <p className="text-xs text-muted-foreground">Exiger un second facteur d'authentification pour tous les utilisateurs</p>
                  </div>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <Server className="w-4 h-4 text-red-500 mt-0.5" />
                  <div>
                    <Label>Micro-segmentation reseau</Label>
                    <p className="text-xs text-muted-foreground">Isoler chaque service pour limiter la propagation en cas de compromission</p>
                  </div>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 border-0">Actif</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserCog className="w-5 h-5" />
                Roles et permissions
              </CardTitle>
              <CardDescription>Gestion des niveaux d'acces par role.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-red-100 text-red-700 border-0">Super Admin</Badge>
                      <span className="text-sm font-medium">Acces total</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Niveau 4</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Seul role autorise a telecharger des fichiers externes, modifier les parametres de securite,
                    gerer les utilisateurs et acceder aux journaux d'audit. Peut lever les restrictions temporairement.
                  </p>
                </div>

                <div className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-amber-100 text-amber-700 border-0">Administrateur</Badge>
                      <span className="text-sm font-medium">Gestion avancee</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Niveau 3</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Gestion des contacts, taches et rapports. Pas d'acces aux telechargements externes
                    ni aux parametres de securite critiques. Peut consulter les alertes de securite.
                  </p>
                </div>

                <div className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-blue-100 text-blue-700 border-0">Agent</Badge>
                      <span className="text-sm font-medium">Operations courantes</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Niveau 2</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Gestion des appels, consultation des contacts et taches. Aucun acces aux fichiers externes,
                    aux exports de donnees ni aux parametres systeme.
                  </p>
                </div>

                <div className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-gray-100 text-gray-700 border-0">Lecture seule</Badge>
                      <span className="text-sm font-medium">Consultation uniquement</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">Niveau 1</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Consultation des tableaux de bord et rapports uniquement. Aucune modification,
                    aucun telechargement, aucun export. Acces le plus restreint.
                  </p>
                </div>
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
                  <p className="text-xs text-muted-foreground">Les donnees sensibles sont chiffrees dans la base de donnees (AES-256)</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Journal d'audit</Label>
                  <p className="text-xs text-muted-foreground">Enregistrer toutes les actions des utilisateurs avec horodatage et adresse IP</p>
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
                  <p className="text-xs text-muted-foreground">Permettre l'export des donnees au format standard (RGPD Art. 20)</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Conservation limitee des donnees</Label>
                  <p className="text-xs text-muted-foreground">Suppression automatique des donnees au-dela de la duree legale de conservation</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Consentement explicite</Label>
                  <p className="text-xs text-muted-foreground">Recueillir et enregistrer le consentement avant tout traitement de donnees</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CircleAlert className="w-5 h-5 text-amber-500" />
                Actions de securite
              </CardTitle>
              <CardDescription>Operations manuelles de securite reservees au Super Administrateur.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-1"
                  onClick={() => handleSecurityAction("Lancement de l'audit de securite complet...")}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ScanSearch className="w-4 h-4" />
                    Audit de securite complet
                  </div>
                  <p className="text-[10px] text-muted-foreground text-left">Analyser toutes les configurations et detecter les vulnerabilites</p>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-1"
                  onClick={() => handleSecurityAction("Export du journal d'audit en cours...")}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileText className="w-4 h-4" />
                    Exporter le journal d'audit
                  </div>
                  <p className="text-[10px] text-muted-foreground text-left">Telecharger le journal complet des actions (reserve super admin)</p>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-1 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => handleSecurityAction("Revocation de toutes les sessions actives...")}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                    <ShieldBan className="w-4 h-4" />
                    Revoquer toutes les sessions
                  </div>
                  <p className="text-[10px] text-muted-foreground text-left">Deconnecter immediatement tous les utilisateurs actifs</p>
                </Button>

                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-1 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => handleSecurityAction("Verrouillage d'urgence active. Seul le super admin peut deverrouiller.")}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                    <Lock className="w-4 h-4" />
                    Verrouillage d'urgence
                  </div>
                  <p className="text-[10px] text-muted-foreground text-left">Bloquer tout acces sauf super admin en cas d'incident critique</p>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
