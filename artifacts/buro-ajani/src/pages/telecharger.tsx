import { useState, useEffect, useCallback } from "react";
import {
  Smartphone, Monitor, Laptop, Globe, Download, CloudDownload,
  CheckCircle2, QrCode, Play, ExternalLink, Clock,
  Tablet, Wifi, Bell, Shield, Zap, Share, PlusSquare, MoreVertical, Info, Printer
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function TelechargerPage() {
  const { toast } = useToast();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [activeTab, setActiveTab] = useState<"desktop" | "mobile">("desktop");
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isMobile = isIOS || isAndroid;
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isChrome = /chrome/i.test(navigator.userAgent) && !/edge/i.test(navigator.userAgent);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true) {
      setIsInstalled(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (isMobile) setActiveTab("mobile");
  }, [isMobile]);

  const handlePwaInstall = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
        toast({ title: "Installation reussie !", description: "Agent de Bureau a ete installe sur votre appareil." });
      }
      setDeferredPrompt(null);
    } else {
      toast({
        title: "Installation manuelle",
        description: isIOS
          ? "Safari : Partager (↑) > Sur l'ecran d'accueil"
          : isAndroid
          ? "Chrome : Menu (⋮) > Ajouter a l'ecran d'accueil"
          : "Chrome : Menu (⋮) > Installer | Safari : Partager > Ajouter au Dock",
      });
    }
  }, [deferredPrompt, isIOS, isAndroid, toast]);

  const appUrl = typeof window !== "undefined"
    ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/`
    : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Telecharger l'application</h1>
          <p className="text-muted-foreground mt-1">
            Installez Agent de Bureau sur votre ordinateur ou telephone.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isInstalled && (
            <Badge className="bg-emerald-100 text-emerald-700 border-0 gap-1.5 h-7">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Application installee
            </Badge>
          )}
          <Button variant="outline" size="icon" title="Imprimer" onClick={() => window.print()}><Printer className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("desktop")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "desktop" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Monitor className="w-4 h-4" />
          Bureau (PC / Mac)
        </button>
        <button
          onClick={() => setActiveTab("mobile")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "mobile" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Smartphone className="w-4 h-4" />
          Mobile (iOS / Android)
        </button>
      </div>

      {activeTab === "desktop" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-2 border-amber-200 dark:border-amber-800 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-amber-100/50 dark:from-amber-900/20 to-transparent rounded-bl-full" />
              <CardHeader className="relative">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                    <Globe className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Application Web (PWA)</CardTitle>
                    <CardDescription>Installation directe depuis le navigateur</CardDescription>
                  </div>
                </div>
                <Badge className="absolute top-4 right-4 bg-amber-500 text-white border-0 text-[10px]">Recommande</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    "Installation instantanee",
                    "Mises a jour automatiques",
                    "Fonctionne hors connexion",
                    "Notifications natives",
                    "Acces depuis le Dock/Bureau",
                    "Aucun telechargement lourd",
                  ].map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>

                {isInstalled ? (
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 text-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Application deja installee !</p>
                    <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 mt-1">Vous utilisez Agent de Bureau en mode application.</p>
                  </div>
                ) : deferredPrompt ? (
                  <Button
                    size="lg"
                    className="w-full gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold h-12 text-base shadow-lg shadow-amber-500/20"
                    onClick={handlePwaInstall}
                  >
                    <Download className="w-5 h-5" />
                    Installer maintenant
                  </Button>
                ) : (
                  <>
                    <Button
                      size="lg"
                      variant="outline"
                      className="w-full gap-2 h-12 text-base border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                      onClick={handlePwaInstall}
                    >
                      <Info className="w-5 h-5" />
                      Voir les instructions d'installation
                    </Button>
                    <PwaInstructions isSafari={isSafari} isChrome={isChrome} />
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-blue-100/50 dark:from-blue-900/20 to-transparent rounded-bl-full" />
              <CardHeader className="relative">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/30">
                    <Laptop className="w-7 h-7 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Application native</CardTitle>
                    <CardDescription>macOS et Windows</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    "Performance optimale",
                    "Raccourcis clavier natifs",
                    "Integration systeme complete",
                    "Notifications systeme",
                    "Demarrage automatique",
                    "Menu systeme integre",
                  ].map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>

                <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-blue-600" />
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Bientot disponible</p>
                  </div>
                  <p className="text-xs text-blue-600/80 dark:text-blue-400/60">
                    L'application native pour macOS et Windows est en cours de developpement.
                    En attendant, utilisez l'installation PWA pour une experience quasi identique.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" className="gap-2 h-11 opacity-50 cursor-not-allowed" disabled>
                    <CloudDownload className="w-4 h-4" />
                    macOS (.dmg)
                  </Button>
                  <Button variant="outline" className="gap-2 h-11 opacity-50 cursor-not-allowed" disabled>
                    <CloudDownload className="w-4 h-4" />
                    Windows (.msi)
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {activeTab === "mobile" && (
        <div className="space-y-6">
          <Card className="border-2 border-amber-200 dark:border-amber-800 overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 dark:from-amber-900/20 dark:to-orange-900/20 p-6 flex flex-col lg:flex-row items-center gap-6">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-xl shadow-amber-500/30 shrink-0">
                <Smartphone className="w-10 h-10 text-white" />
              </div>
              <div className="text-center lg:text-left flex-1">
                <h2 className="text-xl font-bold">Agent de Bureau Mobile</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Gerez vos appels, contacts, taches et messages depuis votre telephone.
                </p>
                <div className="flex flex-wrap gap-2 mt-3 justify-center lg:justify-start">
                  <Badge variant="outline" className="gap-1"><Smartphone className="w-3 h-3" /> iOS 15+</Badge>
                  <Badge variant="outline" className="gap-1"><Smartphone className="w-3 h-3" /> Android 12+</Badge>
                  <Badge variant="outline" className="gap-1"><Tablet className="w-3 h-3" /> Tablette</Badge>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-2 border-emerald-200 dark:border-emerald-800 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-emerald-100/50 dark:from-emerald-900/20 to-transparent rounded-bl-full" />
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                    <Download className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>Installation PWA</CardTitle>
                    <CardDescription>Directement sur votre ecran d'accueil</CardDescription>
                  </div>
                </div>
                <Badge className="absolute top-4 right-4 bg-emerald-500 text-white border-0 text-[10px]">Disponible</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Ajoutez Agent de Bureau a votre ecran d'accueil en quelques secondes, sans passer par un store.
                </p>

                {isInstalled ? (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800 text-center">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Deja installe !</p>
                  </div>
                ) : deferredPrompt ? (
                  <Button
                    size="lg"
                    className="w-full gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white h-12 text-base"
                    onClick={handlePwaInstall}
                  >
                    <Download className="w-5 h-5" />
                    Installer maintenant
                  </Button>
                ) : (
                  <>
                    {isIOS && (
                      <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border">
                        <p className="text-xs font-semibold flex items-center gap-2">
                          <Share className="w-4 h-4 text-blue-500" />
                          Installation sur iPhone / iPad :
                        </p>
                        <ol className="space-y-2">
                          {[
                            { icon: <Globe className="w-4 h-4" />, text: "Ouvrez cette page dans Safari" },
                            { icon: <Share className="w-4 h-4" />, text: "Appuyez sur le bouton Partager (↑)" },
                            { icon: <PlusSquare className="w-4 h-4" />, text: "Selectionnez \"Sur l'ecran d'accueil\"" },
                            { icon: <CheckCircle2 className="w-4 h-4" />, text: "Appuyez sur \"Ajouter\"" },
                          ].map((step, i) => (
                            <li key={i} className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                              <span className="text-blue-600 dark:text-blue-400">{step.icon}</span>
                              {step.text}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {isAndroid && (
                      <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border">
                        <p className="text-xs font-semibold flex items-center gap-2">
                          <MoreVertical className="w-4 h-4 text-green-500" />
                          Installation sur Android :
                        </p>
                        <ol className="space-y-2">
                          {[
                            { text: "Ouvrez cette page dans Chrome" },
                            { text: "Appuyez sur le menu ⋮ (3 points)" },
                            { text: "Selectionnez \"Ajouter a l'ecran d'accueil\"" },
                            { text: "Confirmez l'installation" },
                          ].map((step, i) => (
                            <li key={i} className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                              {step.text}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {!isIOS && !isAndroid && (
                      <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                        <p className="text-xs font-medium">Depuis votre telephone :</p>
                        <p className="text-xs text-muted-foreground">
                          Ouvrez <strong>{appUrl || "cette adresse"}</strong> dans le navigateur de votre telephone, puis suivez les instructions d'installation PWA de votre appareil.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-blue-100/50 dark:from-blue-900/20 to-transparent rounded-bl-full" />
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <Smartphone className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>Application native mobile</CardTitle>
                    <CardDescription>App Store et Google Play</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-blue-600" />
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Publication en cours</p>
                  </div>
                  <p className="text-xs text-blue-600/80 dark:text-blue-400/60">
                    L'application native est en cours de validation sur l'App Store et Google Play.
                    En attendant, installez la version PWA qui offre les memes fonctionnalites.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" className="gap-2 h-11 opacity-50 cursor-not-allowed" disabled>
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                    </svg>
                    App Store
                  </Button>
                  <Button variant="outline" className="gap-2 h-11 opacity-50 cursor-not-allowed" disabled>
                    <Play className="w-4 h-4" />
                    Google Play
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {!isMobile && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-amber-600" />
                  Installer sur votre telephone
                </CardTitle>
                <CardDescription>
                  Scannez ce QR code avec votre telephone pour ouvrir Agent de Bureau et l'installer en PWA.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="w-44 h-44 bg-white p-4 rounded-xl border-2 border-amber-200 dark:border-amber-700 flex items-center justify-center">
                    <QrCodeDisplay url={appUrl} />
                  </div>
                  <div className="space-y-3 flex-1">
                    <p className="text-sm font-medium">Comment installer sur votre telephone :</p>
                    <ol className="space-y-2 text-xs text-muted-foreground">
                      {[
                        "Scannez le QR code avec l'appareil photo",
                        "Ouvrez le lien dans votre navigateur",
                        "Connectez-vous a votre compte",
                        "Ajoutez a l'ecran d'accueil (Partager > Ajouter)",
                      ].map((step, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                          {step}
                        </li>
                      ))}
                    </ol>
                    <div className="p-2 bg-muted/50 rounded text-xs text-muted-foreground flex items-center gap-2">
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{appUrl}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pourquoi installer l'application ?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Zap, title: "Acces rapide", desc: "Lancez en un clic depuis votre bureau ou ecran d'accueil", color: "text-amber-600 bg-amber-100 dark:bg-amber-900/30" },
              { icon: Wifi, title: "Mode hors ligne", desc: "Consultez vos donnees meme sans connexion Internet", color: "text-blue-600 bg-blue-100 dark:bg-blue-900/30" },
              { icon: Bell, title: "Notifications", desc: "Recevez les alertes d'appels et taches en temps reel", color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30" },
              { icon: Shield, title: "Securite", desc: "Connexion securisee et donnees chiffrees", color: "text-purple-600 bg-purple-100 dark:bg-purple-900/30" },
            ].map((item) => (
              <div key={item.title} className="text-center space-y-2 p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className={`w-10 h-10 rounded-xl ${item.color} flex items-center justify-center mx-auto`}>
                  <item.icon className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-semibold">{item.title}</h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PwaInstructions({ isSafari, isChrome }: { isSafari: boolean; isChrome: boolean }) {
  return (
    <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
      <p className="text-xs font-medium">Comment installer :</p>
      <div className="space-y-1.5">
        {isChrome && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="w-3.5 h-3.5 shrink-0 text-blue-500" />
            <span><strong>Chrome :</strong> Menu (⋮) &gt; Installer l'application</span>
          </div>
        )}
        {isSafari && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="w-3.5 h-3.5 shrink-0 text-blue-500" />
            <span><strong>Safari :</strong> Partager &gt; Ajouter au Dock</span>
          </div>
        )}
        {!isChrome && !isSafari && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="w-3.5 h-3.5 shrink-0 text-blue-500" />
              <span><strong>Chrome :</strong> Menu (⋮) &gt; Installer l'application</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="w-3.5 h-3.5 shrink-0 text-blue-500" />
              <span><strong>Safari :</strong> Partager &gt; Ajouter au Dock</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Globe className="w-3.5 h-3.5 shrink-0 text-blue-500" />
              <span><strong>Edge :</strong> Menu (...) &gt; Applications &gt; Installer</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QrCodeDisplay({ url }: { url: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 37 37" className="w-full h-full">
        <rect width="37" height="37" fill="white" />
        <rect x="1" y="1" width="7" height="7" fill="#0f1729" rx="1" />
        <rect x="29" y="1" width="7" height="7" fill="#0f1729" rx="1" />
        <rect x="1" y="29" width="7" height="7" fill="#0f1729" rx="1" />
        <rect x="2" y="2" width="5" height="5" fill="white" rx="0.5" />
        <rect x="30" y="2" width="5" height="5" fill="white" rx="0.5" />
        <rect x="2" y="30" width="5" height="5" fill="white" rx="0.5" />
        <rect x="3" y="3" width="3" height="3" fill="#0f1729" rx="0.5" />
        <rect x="31" y="3" width="3" height="3" fill="#0f1729" rx="0.5" />
        <rect x="3" y="31" width="3" height="3" fill="#0f1729" rx="0.5" />
        {[
          [9,1],[11,1],[13,1],[9,3],[13,3],[9,5],[11,5],[13,5],
          [1,9],[3,9],[5,9],[7,9],[9,9],[11,9],[13,9],
          [15,1],[15,3],[15,5],[17,1],[17,5],[19,1],[19,3],[19,5],
          [21,1],[23,1],[25,1],[21,3],[23,3],[25,3],[21,5],[23,5],[25,5],
          [1,11],[5,11],[9,11],[13,11],[1,13],[3,13],[7,13],[9,13],[13,13],
          [15,9],[17,9],[19,9],[21,9],[23,9],[25,9],[27,9],
          [29,9],[31,9],[33,9],[35,9],
          [15,11],[19,11],[23,11],[27,11],[31,11],[35,11],
          [15,13],[17,13],[21,13],[25,13],[29,13],[33,13],[35,13],
          [9,15],[11,15],[13,15],[15,15],[17,15],[19,15],[21,15],[23,15],[25,15],[27,15],
          [1,17],[5,17],[9,17],[13,17],[17,17],[21,17],[25,17],[29,17],[33,17],
          [9,19],[11,19],[13,19],[15,19],[17,19],[19,19],[21,19],[23,19],[25,19],[27,19],
          [1,21],[3,21],[5,21],[7,21],[9,21],[11,21],[13,21],
          [15,21],[19,21],[23,21],[27,21],[31,21],[35,21],
          [15,23],[17,23],[21,23],[25,23],[29,23],[33,23],[35,23],
          [15,25],[19,25],[23,25],[27,25],[31,25],[35,25],
          [1,23],[5,23],[9,23],[13,23],
          [1,25],[3,25],[7,25],[9,25],[13,25],
          [9,27],[11,27],[13,27],
          [29,15],[31,15],[33,15],[35,15],
          [29,17],[33,17],[35,17],
          [29,19],[31,19],[33,19],[35,19],
          [29,21],[31,21],[33,21],[35,21],
          [29,23],[31,23],[33,23],[35,23],
          [29,25],[31,25],[35,25],
          [29,27],[31,27],[33,27],[35,27],
          [29,29],[31,29],[33,29],[35,29],
          [29,31],[33,31],[35,31],
          [29,33],[31,33],[33,33],[35,33],
          [29,35],[31,35],[33,35],[35,35],
        ].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="1" height="1" fill="#0f1729" />
        ))}
        <rect x="17" y="17" width="3" height="3" fill="#f59e0b" rx="0.5" />
      </svg>
    </div>
  );
}
