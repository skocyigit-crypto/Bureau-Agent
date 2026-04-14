import { useState, useEffect } from "react";
import {
  Smartphone, Monitor, Laptop, Globe, Download, CloudDownload,
  Share2, CheckCircle2, QrCode, Apple, Chrome, Play,
  Tablet, Wifi, Bell, Shield, Zap, ArrowRight
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

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handlePwaInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
        toast({ title: "Installation reussie", description: "Agent de Bureau a ete installe sur votre appareil." });
      }
      setDeferredPrompt(null);
    } else {
      toast({
        title: "Installation manuelle",
        description: "Safari : Partager > Ajouter au Dock | Chrome : Menu (⋮) > Installer l'application",
      });
    }
  };

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Telecharger l'application</h1>
          <p className="text-muted-foreground mt-1">
            Installez Agent de Bureau sur votre ordinateur ou telephone pour un acces rapide et permanent.
          </p>
        </div>
        {isInstalled && (
          <Badge className="bg-emerald-100 text-emerald-700 border-0 gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Deja installe
          </Badge>
        )}
      </div>

      <div className="flex gap-2 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("desktop")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "desktop"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Monitor className="w-4 h-4" />
          Bureau (PC / Mac)
        </button>
        <button
          onClick={() => setActiveTab("mobile")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "mobile"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
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
                    <CardDescription>Installation en un clic — Recommande</CardDescription>
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
                    <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 mt-1">Vous utilisez deja l'application en mode standalone.</p>
                  </div>
                ) : (
                  <Button
                    size="lg"
                    className="w-full gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold h-12 text-base shadow-lg shadow-amber-500/20"
                    onClick={handlePwaInstall}
                  >
                    <Download className="w-5 h-5" />
                    {deferredPrompt ? "Installer maintenant" : "Comment installer"}
                  </Button>
                )}

                {!isInstalled && !deferredPrompt && (
                  <div className="space-y-2 p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs font-medium">Installation manuelle :</p>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Chrome className="w-3.5 h-3.5 shrink-0" />
                        <span><strong>Chrome :</strong> Menu (⋮) &gt; Installer l'application</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Globe className="w-3.5 h-3.5 shrink-0" />
                        <span><strong>Safari :</strong> Partager &gt; Ajouter au Dock</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Globe className="w-3.5 h-3.5 shrink-0" />
                        <span><strong>Edge :</strong> Menu (...) &gt; Applications &gt; Installer</span>
                      </div>
                    </div>
                  </div>
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
                    <CardTitle className="text-lg">Application native macOS</CardTitle>
                    <CardDescription>Telechargement .dmg pour Mac</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    "Application native optimisee",
                    "Raccourcis clavier Mac",
                    "Integration Dock & Spotlight",
                    "Notifications macOS",
                    "Touch Bar supportee",
                    "macOS 13+ requis",
                  ].map((f) => (
                    <div key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="gap-2 h-11"
                    onClick={() => toast({ title: "Telechargement", description: "AgentDeBureau-v2.4-arm64.dmg (Apple Silicon) en cours..." })}
                  >
                    <CloudDownload className="w-4 h-4" />
                    Apple Silicon
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 h-11"
                    onClick={() => toast({ title: "Telechargement", description: "AgentDeBureau-v2.4-x64.dmg (Intel) en cours..." })}
                  >
                    <CloudDownload className="w-4 h-4" />
                    Intel Mac
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground text-center">Version 2.4.0 — macOS 13 Ventura ou superieur — 89 Mo</p>

                <div className="border-t pt-4">
                  <h4 className="text-xs font-semibold mb-2">Windows</h4>
                  <Button
                    variant="outline"
                    className="w-full gap-2 h-11"
                    onClick={() => toast({ title: "Telechargement", description: "AgentDeBureau-v2.4-setup.msi en cours..." })}
                  >
                    <Monitor className="w-4 h-4" />
                    Telecharger pour Windows (.msi)
                  </Button>
                  <p className="text-[10px] text-muted-foreground text-center mt-1">Windows 10/11 — 78 Mo</p>
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
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-xl shadow-amber-500/30 shrink-0">
                <Smartphone className="w-12 h-12 text-white" />
              </div>
              <div className="text-center lg:text-left flex-1">
                <h2 className="text-xl font-bold">Agent de Bureau Mobile</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Gerez vos appels, contacts, taches et messages depuis votre telephone.
                  Disponible sur iOS et Android.
                </p>
                <div className="flex flex-wrap gap-2 mt-3 justify-center lg:justify-start">
                  <Badge variant="outline" className="gap-1">
                    <Smartphone className="w-3 h-3" /> iOS 15+
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Smartphone className="w-3 h-3" /> Android 12+
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <Tablet className="w-3 h-3" /> iPad / Tablette
                  </Badge>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-gray-100 dark:from-gray-800/50 to-transparent rounded-bl-full" />
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-black flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="currentColor">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                    </svg>
                  </div>
                  <div>
                    <CardTitle>App Store (iOS)</CardTitle>
                    <CardDescription>iPhone, iPad, iPod touch</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  size="lg"
                  className="w-full gap-2 bg-black hover:bg-gray-800 text-white h-12 text-base"
                  onClick={() => toast({ title: "App Store", description: "Redirection vers l'App Store..." })}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                  </svg>
                  Telecharger sur l'App Store
                </Button>

                {isIOS && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                    <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">Alternative rapide : PWA</p>
                    <p className="text-xs text-blue-600/70 dark:text-blue-400/60">
                      Safari &gt; Partager (↑) &gt; Ajouter a l'ecran d'accueil
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-green-100/50 dark:from-green-900/20 to-transparent rounded-bl-full" />
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                    <Play className="w-6 h-6 text-white fill-white" />
                  </div>
                  <div>
                    <CardTitle>Google Play (Android)</CardTitle>
                    <CardDescription>Smartphones et tablettes Android</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  size="lg"
                  className="w-full gap-2 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white h-12 text-base"
                  onClick={() => toast({ title: "Google Play", description: "Redirection vers Google Play Store..." })}
                >
                  <Play className="w-5 h-5 fill-white" />
                  Telecharger sur Google Play
                </Button>

                {isAndroid && (
                  <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
                    <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">Alternative rapide : PWA</p>
                    <p className="text-xs text-green-600/70 dark:text-green-400/60">
                      Chrome &gt; Menu (⋮) &gt; Ajouter a l'ecran d'accueil
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <QrCode className="w-5 h-5 text-amber-600" />
                Scanner pour installer
              </CardTitle>
              <CardDescription>
                Scannez le QR code avec votre telephone pour telecharger directement l'application mobile.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="w-40 h-40 bg-white p-3 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center">
                  <div className="w-full h-full bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IndoaXRlIi8+PHJlY3QgeD0iOCIgeT0iOCIgd2lkdGg9IjM2IiBoZWlnaHQ9IjM2IiBmaWxsPSIjMGYxNzI5IiByeD0iNCIvPjxyZWN0IHg9Ijg0IiB5PSI4IiB3aWR0aD0iMzYiIGhlaWdodD0iMzYiIGZpbGw9IiMwZjE3MjkiIHJ4PSI0Ii8+PHJlY3QgeD0iOCIgeT0iODQiIHdpZHRoPSIzNiIgaGVpZ2h0PSIzNiIgZmlsbD0iIzBmMTcyOSIgcng9IjQiLz48cmVjdCB4PSIxNCIgeT0iMTQiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgZmlsbD0id2hpdGUiIHJ4PSIyIi8+PHJlY3QgeD0iOTAiIHk9IjE0IiB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIGZpbGw9IndoaXRlIiByeD0iMiIvPjxyZWN0IHg9IjE0IiB5PSI5MCIgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSJ3aGl0ZSIgcng9IjIiLz48cmVjdCB4PSIyMCIgeT0iMjAiIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiIgZmlsbD0iIzBmMTcyOSIgcng9IjIiLz48cmVjdCB4PSI5NiIgeT0iMjAiIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiIgZmlsbD0iIzBmMTcyOSIgcng9IjIiLz48cmVjdCB4PSIyMCIgeT0iOTYiIHdpZHRoPSIxMiIgaGVpZ2h0PSIxMiIgZmlsbD0iIzBmMTcyOSIgcng9IjIiLz48cmVjdCB4PSI1MiIgeT0iOCIgd2lkdGg9IjgiIGhlaWdodD0iOCIgZmlsbD0iIzBmMTcyOSIvPjxyZWN0IHg9IjUyIiB5PSIyNCIgd2lkdGg9IjgiIGhlaWdodD0iOCIgZmlsbD0iIzBmMTcyOSIvPjxyZWN0IHg9IjUyIiB5PSI0MCIgd2lkdGg9IjgiIGhlaWdodD0iOCIgZmlsbD0iIzBmMTcyOSIvPjxyZWN0IHg9IjY4IiB5PSI4IiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjMGYxNzI5Ii8+PHJlY3QgeD0iNTIiIHk9IjU2IiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZjU5ZTBiIi8+PHJlY3QgeD0iNjAiIHk9IjYwIiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZjU5ZTBiIi8+PHJlY3QgeD0iNjgiIHk9IjU2IiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZjU5ZTBiIi8+PHJlY3QgeD0iNTIiIHk9IjcyIiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjMGYxNzI5Ii8+PHJlY3QgeD0iOCIgeT0iNTIiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiMwZjE3MjkiLz48cmVjdCB4PSIyNCIgeT0iNTIiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiMwZjE3MjkiLz48cmVjdCB4PSI0MCIgeT0iNTIiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiMwZjE3MjkiLz48cmVjdCB4PSI4NCIgeT0iNTIiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiMwZjE3MjkiLz48cmVjdCB4PSIxMDAiIHk9IjUyIiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjMGYxNzI5Ii8+PHJlY3QgeD0iMTE2IiB5PSI1MiIgd2lkdGg9IjgiIGhlaWdodD0iOCIgZmlsbD0iIzBmMTcyOSIvPjxyZWN0IHg9Ijg0IiB5PSI2OCIgd2lkdGg9IjgiIGhlaWdodD0iOCIgZmlsbD0iIzBmMTcyOSIvPjxyZWN0IHg9IjEwMCIgeT0iNjgiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiMwZjE3MjkiLz48cmVjdCB4PSI4NCIgeT0iODQiIHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiMwZjE3MjkiLz48cmVjdCB4PSIxMDAiIHk9Ijg0IiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjMGYxNzI5Ii8+PHJlY3QgeD0iMTE2IiB5PSI4NCIgd2lkdGg9IjgiIGhlaWdodD0iOCIgZmlsbD0iIzBmMTcyOSIvPjxyZWN0IHg9IjExNiIgeT0iMTAwIiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjMGYxNzI5Ii8+PHJlY3QgeD0iODQiIHk9IjExNiIgd2lkdGg9IjgiIGhlaWdodD0iOCIgZmlsbD0iIzBmMTcyOSIvPjxyZWN0IHg9IjEwMCIgeT0iMTAwIiB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjMGYxNzI5Ii8+PC9zdmc+')] bg-contain bg-no-repeat bg-center" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Comment faire :</p>
                  <ol className="space-y-2 text-xs text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                      Ouvrez l'appareil photo de votre telephone
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                      Pointez vers le QR code ci-contre
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">3</span>
                      Appuyez sur la notification pour ouvrir le lien
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0">4</span>
                      Installez l'application depuis le Store
                    </li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>

          {isMobile && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="p-6">
                <div className="text-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto shadow-lg shadow-amber-500/30">
                    <Download className="w-7 h-7 text-white" />
                  </div>
                  <h3 className="text-lg font-bold">Installation rapide (PWA)</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Ajoutez Agent de Bureau directement a votre ecran d'accueil sans passer par le store.
                  </p>
                  <Button
                    size="lg"
                    className="gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white h-12 text-base"
                    onClick={handlePwaInstall}
                  >
                    <Download className="w-5 h-5" />
                    Ajouter a l'ecran d'accueil
                  </Button>
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
              { icon: Shield, title: "Securite", desc: "Connexion securisee et donnees chiffrees de bout en bout", color: "text-purple-600 bg-purple-100 dark:bg-purple-900/30" },
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
