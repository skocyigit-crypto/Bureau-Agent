import { useState } from "react";
import {
  Globe, CheckCircle2, Monitor, Laptop, Smartphone,
  CloudDownload, Share2, Package, Cpu, HardDrive, RefreshCcw,
  Download, Upload, Play, CheckCheck
} from "lucide-react";
import { PhoneSimulator, PhoneSimulatorDialog } from "@/components/phone-simulator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export function TabInstallation() {
  const { toast } = useToast();
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <Card className="border-blue-200 dark:border-blue-900/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Laptop className="w-5 h-5 text-blue-600" />
                Installation sur Mac
              </CardTitle>
              <CardDescription className="mt-1">
                Installez Agent de Bureau et Google Workspace sur votre Mac pour une experience native.
                Toutes les fonctionnalites, la securite et les integrations sont preservees.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs gap-1">
              <Monitor className="w-3 h-3" />
              macOS compatible
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-xl p-5 hover:border-blue-300 transition-colors relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 dark:bg-blue-950/20 rounded-bl-full" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Package className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Application native macOS</h3>
                    <p className="text-[10px] text-muted-foreground">Application universelle (Apple Silicon + Intel)</p>
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  {["Fonctionne hors connexion (mode degrade)", "Notifications natives macOS", "Integration Dock et barre des menus", "Raccourcis clavier Mac (Cmd+K, Cmd+N...)", "Synchronisation automatique avec le cloud"].map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <Button className="w-full gap-2" onClick={() => toast({ title: "Telechargement en cours", description: "Le fichier AgentDeBureau-v2.4.dmg est en cours de telechargement..." })}>
                  <CloudDownload className="w-4 h-4" />
                  Telecharger pour Mac (.dmg)
                </Button>
                <p className="text-[10px] text-muted-foreground text-center mt-2">Version 2.4.0 - macOS 13 Ventura ou superieur - 89 Mo</p>
              </div>
            </div>

            <div className="border rounded-xl p-5 hover:border-emerald-300 transition-colors relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 dark:bg-emerald-950/20 rounded-bl-full" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                    <Globe className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Application Web Progressive (PWA)</h3>
                    <p className="text-[10px] text-muted-foreground">Installation directe depuis le navigateur</p>
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  {["Installation en un clic depuis Safari/Chrome", "Mises a jour automatiques", "Apparait dans le Launchpad Mac", "Aucun telechargement supplementaire", "Toujours la derniere version"].map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <Button variant="outline" className="w-full gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30" onClick={() => toast({ title: "Installation PWA", description: "Cliquez sur 'Partager' dans votre navigateur puis 'Ajouter au Dock' pour installer l'application." })}>
                  <Share2 className="w-4 h-4" />
                  Installer comme application
                </Button>
                <p className="text-[10px] text-muted-foreground text-center mt-2">Safari : Partager &gt; Ajouter au Dock | Chrome : Menu &gt; Installer</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="w-5 h-5 text-blue-600" />
            Migration Google Workspace vers Mac
          </CardTitle>
          <CardDescription>Transferez l'ensemble de votre configuration Google Workspace sur votre Mac. Tous les parametres, connexions et donnees de securite sont migres automatiquement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 rounded-lg p-4">
            <h4 className="font-semibold text-sm text-blue-800 dark:text-blue-300 mb-2">Elements migres automatiquement :</h4>
            <div className="grid grid-cols-2 gap-2">
              {["Comptes Google connectes", "Parametres de securite", "Configuration antivirus", "Regles DLP et phishing", "Roles et permissions", "Historique des appels", "Contacts et taches", "Integrations logicielles"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium">Processus de migration</h4>
            {[
              { step: 1, title: "Exporter la configuration", desc: "Generer un fichier de configuration chiffre contenant tous vos parametres Workspace.", btn: "Exporter (.enc)", icon: Download, action: "Generation du fichier agent-bureau-config.enc en cours..." },
              { step: 2, title: "Installer sur Mac", desc: "Telecharger et installer l'application Agent de Bureau sur votre Mac.", multiBtn: true },
              { step: 3, title: "Importer la configuration", desc: "Ouvrez l'application sur Mac et importez le fichier de configuration chiffre. Vos identifiants Google seront automatiquement restaures.", btn: "Importer (.enc)", icon: Upload, action: "Selectionnez le fichier .enc exporte a l'etape 1 pour restaurer votre configuration." },
              { step: 4, title: "Verification et synchronisation", desc: "L'application verifie la connexion Google Workspace, restaure les services et synchronise les donnees. Le processus est entierement automatique.", btn: "Verifier la migration", icon: RefreshCcw, action: "Test de connexion et synchronisation avec Google Workspace...", highlight: true },
            ].map((s) => (
              <div key={s.step} className={`border rounded-lg p-4 ${s.highlight ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10" : ""}`}>
                <div className="flex items-start gap-4">
                  <div className={`w-8 h-8 rounded-full ${s.highlight ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"} flex items-center justify-center text-sm font-bold shrink-0`}>{s.step}</div>
                  <div className="flex-1">
                    <h5 className="text-sm font-medium">{s.title}</h5>
                    <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                    {s.multiBtn ? (
                      <div className="flex gap-2 mt-2">
                        <Button variant="outline" size="sm" className="gap-2" onClick={() => toast({ title: "Telechargement", description: "AgentDeBureau-v2.4-arm64.dmg (Apple Silicon) en cours..." })}>
                          <Cpu className="w-3.5 h-3.5" /> Apple Silicon (M1/M2/M3/M4)
                        </Button>
                        <Button variant="outline" size="sm" className="gap-2" onClick={() => toast({ title: "Telechargement", description: "AgentDeBureau-v2.4-x64.dmg (Intel) en cours..." })}>
                          <HardDrive className="w-3.5 h-3.5" /> Intel
                        </Button>
                      </div>
                    ) : s.btn && s.icon && (
                      <Button variant="outline" size="sm" className={`mt-2 gap-2 ${s.highlight ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : ""}`} onClick={() => toast({ title: s.step === 1 ? "Export en cours" : s.step === 3 ? "Import" : "Verification", description: s.action! })}>
                        <s.icon className="w-3.5 h-3.5" /> {s.btn}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="w-5 h-5" />
            Compatibilite des appareils
          </CardTitle>
          <CardDescription>Agent de Bureau est disponible sur toutes les plateformes. Google Workspace suit l'utilisateur.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded-lg p-4 text-center">
              <div className="mx-auto w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-3">
                <Laptop className="w-6 h-6 text-blue-600" />
              </div>
              <h4 className="font-semibold text-sm">macOS</h4>
              <p className="text-xs text-muted-foreground mt-1">Application native ou PWA</p>
              <div className="mt-3 space-y-1">
                {["Apple Silicon", "Intel x86_64", "macOS 13+"].map((f) => (
                  <div key={f} className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" /> <span>{f}</span>
                  </div>
                ))}
              </div>
              <Badge className="mt-3 bg-blue-100 text-blue-700 border-0 text-[10px]">Recommande</Badge>
            </div>

            <div className="border rounded-lg p-4 text-center">
              <div className="mx-auto w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-3">
                <Monitor className="w-6 h-6 text-purple-600" />
              </div>
              <h4 className="font-semibold text-sm">Windows</h4>
              <p className="text-xs text-muted-foreground mt-1">Application desktop ou PWA</p>
              <div className="mt-3 space-y-1">
                {["Windows 10/11", "x86_64 / ARM", ".msi installer"].map((f) => (
                  <div key={f} className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" /> <span>{f}</span>
                  </div>
                ))}
              </div>
              <Badge variant="outline" className="mt-3 text-[10px]">Disponible</Badge>
            </div>

            <div className="border rounded-lg p-4 text-center border-amber-200 dark:border-amber-800 bg-gradient-to-b from-amber-50/50 to-transparent dark:from-amber-950/10">
              <div className="mx-auto w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-3">
                <Smartphone className="w-6 h-6 text-amber-600" />
              </div>
              <h4 className="font-semibold text-sm">Mobile</h4>
              <p className="text-xs text-muted-foreground mt-1">iOS et Android</p>
              <div className="mt-3 space-y-1">
                {["iPhone / iPad", "Android 12+", "PWA ou App Store"].map((f) => (
                  <div key={f} className="flex items-center justify-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 className="w-3 h-3" /> <span>{f}</span>
                  </div>
                ))}
              </div>
              <Button size="sm" className="mt-3 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setPhoneDialogOpen(true)}>
                <Play className="w-3 h-3" /> Apercu mobile
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-200 dark:border-amber-900/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-amber-600" />
                Application mobile - Apercu interactif
              </CardTitle>
              <CardDescription className="mt-1">Decouvrez l'experience Agent de Bureau sur mobile. Naviguez entre les ecrans pour voir toutes les fonctionnalites.</CardDescription>
            </div>
            <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px] gap-1">
              <Smartphone className="w-3 h-3" /> iOS / Android
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col lg:flex-row items-start gap-8">
            <PhoneSimulator className="shrink-0" />
            <div className="flex-1 space-y-4">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Fonctionnalites mobiles</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: "Tableau de bord en temps reel", desc: "KPIs, activite recente, score IA" },
                    { label: "Gestion des appels", desc: "Journal d'appels, filtres, rappels rapides" },
                    { label: "Repertoire contacts", desc: "Recherche, categories, fiches completes" },
                    { label: "Suivi des taches", desc: "Statuts, priorites, echeances" },
                    { label: "Messages et notifications", desc: "Vocaux, notes, rappels, priorites" },
                    { label: "Gestion de stock", desc: "Inventaire, alertes seuils, categories" },
                    { label: "7 Agents IA embarques", desc: "Scores, alertes, suggestions en mobilite" },
                    { label: "58 integrations natives", desc: "Google, Microsoft, Apple synchronises" },
                    { label: "Notifications push", desc: "Appels manques, taches urgentes, alertes IA" },
                    { label: "Mode hors connexion", desc: "Acces aux donnees sans connexion Internet" },
                  ].map((f, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-medium">{f.label}</p>
                        <p className="text-[10px] text-muted-foreground">{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <PhoneSimulatorDialog open={phoneDialogOpen} onOpenChange={setPhoneDialogOpen} />
    </div>
  );
}
