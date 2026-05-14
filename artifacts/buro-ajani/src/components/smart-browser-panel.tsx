import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Wifi, WifiOff, Battery, BatteryCharging, BatteryLow, Mic, MicOff, Maximize, Minimize,
  Bell, Clipboard, MapPin, Monitor, Share2, Printer, Moon, Sun, Zap,
  Signal, SignalLow, Cpu, MemoryStick, Eye, EyeOff, Keyboard, Globe, Smartphone,
  Camera, Bluetooth, Fingerprint, Sparkles, ChevronUp, ChevronDown, Copy, Check,
  Volume2, AlertTriangle, Clock, RefreshCw, Radio, BrainCircuit, Activity
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  useNetworkStatus,
  usePageVisibility,
  useBatteryStatus,
  useSpeechRecognition,
  useFullscreen,
  useSmartClipboard,
  usePerformanceMonitor,
  useDeviceCapabilities,
  useSmartShare,
  useGeolocation,
  useWakeLock,
  useTabSync,
} from "@/hooks/use-smart-browser";

function SmartStatusBar() {
  const network = useNetworkStatus();
  const battery = useBatteryStatus();
  const visibility = usePageVisibility();
  const perf = usePerformanceMonitor();

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`flex items-center gap-0.5 px-1 py-0.5 rounded ${network.isOnline ? "text-green-600" : "text-red-600"}`}>
              {network.isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span className="hidden sm:inline">{network.connectionType !== "unknown" ? network.connectionType.toUpperCase() : ""}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {network.isOnline ? `En ligne - ${network.connectionType}` : "Hors ligne"}
            {network.downlink ? ` (${network.downlink} Mbps)` : ""}
          </TooltipContent>
        </Tooltip>

        {battery && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`flex items-center gap-0.5 px-1 py-0.5 rounded ${battery.level <= 15 ? "text-red-600 animate-pulse" : battery.level <= 30 ? "text-amber-600" : "text-green-600"}`}>
                {battery.charging ? <BatteryCharging className="h-3 w-3" /> : battery.level <= 15 ? <BatteryLow className="h-3 w-3" /> : <Battery className="h-3 w-3" />}
                <span>{battery.level}%</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              Batterie: {battery.level}% {battery.charging ? "(en charge)" : ""}
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`flex items-center gap-0.5 px-1 py-0.5 rounded ${perf.fps >= 50 ? "text-green-600" : perf.fps >= 30 ? "text-amber-600" : "text-red-600"}`}>
              <Activity className="h-3 w-3" />
              <span>{perf.fps}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {perf.fps} FPS | RAM: {perf.memoryUsed}MB/{perf.memoryTotal}MB
          </TooltipContent>
        </Tooltip>

        {visibility.idleMinutes >= 5 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-0.5 px-1 py-0.5 rounded text-amber-600">
                <Clock className="h-3 w-3" />
                <span>{visibility.idleMinutes}m</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>Inactif depuis {visibility.idleMinutes} min</TooltipContent>
          </Tooltip>
        )}
      </TooltipProvider>
    </div>
  );
}

function NetworkAlert() {
  const { isOnline, wasOffline } = useNetworkStatus();

  if (isOnline && !wasOffline) return null;

  if (!isOnline) {
    return (
      <div className="fixed top-14 left-0 right-0 z-50 bg-red-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-sm shadow-lg animate-in slide-in-from-top">
        <WifiOff className="h-4 w-4" />
        <span className="font-medium">Connexion perdue</span>
        <span className="opacity-75">— Mode hors ligne active. Vos modifications seront synchronisees au retour.</span>
      </div>
    );
  }

  if (wasOffline) {
    return (
      <div className="fixed top-14 left-0 right-0 z-50 bg-green-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-sm shadow-lg animate-in slide-in-from-top">
        <Wifi className="h-4 w-4" />
        <span className="font-medium">Connexion retablie</span>
        <RefreshCw className="h-3 w-3 animate-spin ml-1" />
        <span className="opacity-75">Synchronisation en cours...</span>
      </div>
    );
  }

  return null;
}

function BatteryAlert() {
  const battery = useBatteryStatus();
  const [dismissed, setDismissed] = useState(false);

  if (!battery || battery.level > 15 || battery.charging || dismissed) return null;

  return (
    <div className="fixed bottom-20 right-4 z-50 bg-red-600 text-white px-4 py-3 rounded-lg shadow-xl max-w-xs animate-in slide-in-from-bottom">
      <div className="flex items-center gap-2">
        <BatteryLow className="h-5 w-5 animate-pulse" />
        <div>
          <p className="font-medium text-sm">Batterie faible ({battery.level}%)</p>
          <p className="text-xs opacity-80">Branchez votre appareil pour eviter la perte de donnees</p>
        </div>
        <button onClick={() => setDismissed(true)} className="ml-2 text-white/60 hover:text-white text-xs">
          OK
        </button>
      </div>
    </div>
  );
}

function VoiceCommandButton() {
  const { isListening, transcript, interimTranscript, isSupported, startListening, stopListening, resetTranscript } = useSpeechRecognition();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (!transcript) return;
    const text = transcript.toLowerCase().trim();

    const commands: [RegExp, () => void][] = [
      [/tableau de bord|dashboard|accueil/, () => navigate("/")],
      [/appels?|calls?/, () => navigate("/appels")],
      [/contacts?/, () => navigate("/contacts")],
      [/t[aâ]ches?|tasks?/, () => navigate("/taches")],
      [/messages?/, () => navigate("/messages")],
      [/calendrier|agenda|calendar/, () => navigate("/calendrier")],
      [/rapports?|reports?/, () => navigate("/rapports")],
      [/param[eè]tres?|settings?/, () => navigate("/parametres")],
      [/agents?\s*ia|intelligence/, () => navigate("/agents-ia")],
      [/utilisateurs?|users?/, () => navigate("/utilisateurs")],
    ];

    for (const [regex, action] of commands) {
      if (regex.test(text)) {
        action();
        toast({ title: "Commande vocale", description: `Navigation: ${text}` });
        resetTranscript();
        stopListening();
        return;
      }
    }
  }, [transcript, navigate, toast, resetTranscript, stopListening]);

  if (!isSupported) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isListening ? "default" : "ghost"}
            size="icon"
            className={`relative ${isListening ? "bg-red-500 hover:bg-red-600 text-white" : ""}`}
            onClick={() => isListening ? stopListening() : startListening("fr-FR")}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {isListening && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-400 rounded-full animate-ping" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isListening ? (
            <div>
              <p className="font-medium">Ecoute en cours...</p>
              {(transcript || interimTranscript) && (
                <p className="text-xs opacity-80 mt-1 max-w-[200px]">{transcript}{interimTranscript}</p>
              )}
            </div>
          ) : "Commande vocale (Francais)"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SmartQuickActions() {
  const { isFullscreen, toggleFullscreen } = useFullscreen();
  const { canShare, share } = useSmartShare();
  const { isLocked, requestWakeLock, releaseWakeLock } = useWakeLock();
  const { toast } = useToast();
  const [location] = useLocation();

  // NOTE: l'autorisation de notification (Notification.requestPermission) est
  // volontairement DESACTIVEE cote web — par decision produit, ce prompt
  // n'apparait QUE dans l'app mobile (LocationConsentGate + expo-notifications).
  // Le web s'appuie sur le SSE realtime + toasts in-app.

  const handleShare = async () => {
    const success = await share({
      title: "Agent de Bureau",
      text: "Decouvrez Agent de Bureau - Solution de gestion de bureau intelligente",
      url: window.location.href,
    });
    if (success) toast({ title: "Partage reussi" });
  };

  return (
    <div className="flex items-center gap-0.5">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isFullscreen ? "Quitter plein ecran" : "Mode plein ecran (Focus)"}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${isLocked ? "text-amber-600" : ""}`}
              onClick={() => isLocked ? releaseWakeLock() : requestWakeLock()}
            >
              {isLocked ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isLocked ? "Ecran reste allume (actif)" : "Garder l'ecran allume"}</TooltipContent>
        </Tooltip>

        {canShare && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleShare}>
                <Share2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Partager</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Imprimer / Exporter PDF</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function ClipboardDetector() {
  const { detected, readClipboard } = useSmartClipboard();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const [lastDetected, setLastDetected] = useState<string>("");

  useEffect(() => {
    const handler = () => {
      readClipboard();
    };
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [readClipboard]);

  useEffect(() => {
    if (detected && detected.value !== lastDetected) {
      setLastDetected(detected.value);
      setShow(true);
      const timer = setTimeout(() => setShow(false), 8000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [detected, lastDetected]);

  if (!show || !detected) return null;

  const typeLabels: Record<string, string> = {
    email: "Email detecte",
    phone: "Telephone detecte",
    url: "URL detectee",
    iban: "IBAN detecte",
    siret: "SIRET detecte",
  };

  const actions: Record<string, { label: string; action: () => void }> = {
    email: { label: "Ajouter contact", action: () => navigate("/contacts") },
    phone: { label: "Ajouter contact", action: () => navigate("/contacts") },
    url: { label: "Ouvrir", action: () => window.open(detected.value, "_blank") },
    iban: { label: "Voir facturation", action: () => navigate("/parametres") },
    siret: { label: "Voir facturation", action: () => navigate("/parametres") },
  };

  const actionInfo = actions[detected.type];

  return (
    <div className="fixed bottom-20 left-4 z-50 bg-card border shadow-xl rounded-lg p-3 max-w-xs animate-in slide-in-from-bottom">
      <div className="flex items-center gap-2 mb-1">
        <Clipboard className="h-4 w-4 text-indigo-500" />
        <span className="text-xs font-medium">{typeLabels[detected.type]}</span>
        <button onClick={() => setShow(false)} className="ml-auto text-muted-foreground text-xs hover:text-foreground">x</button>
      </div>
      <p className="text-xs text-muted-foreground truncate mb-2">{detected.value}</p>
      {actionInfo && (
        <Button size="sm" variant="outline" className="text-xs h-7 w-full" onClick={() => { actionInfo.action(); setShow(false); }}>
          {actionInfo.label}
        </Button>
      )}
    </div>
  );
}

function SmartKeyboardShortcutsHelp() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setShow(prev => !prev);
      }
      if (e.key === "Escape") setShow(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (!show) return null;

  const shortcuts = [
    { keys: "Ctrl+K", desc: "Palette de commandes" },
    { keys: "Ctrl+/", desc: "Aide raccourcis" },
    { keys: "Ctrl+Shift+F", desc: "Recherche globale" },
    { keys: "Ctrl+Shift+N", desc: "Nouveau contact" },
    { keys: "Ctrl+Shift+T", desc: "Nouvelle tache" },
    { keys: "Ctrl+P", desc: "Imprimer / PDF" },
    { keys: "F11", desc: "Plein ecran" },
    { keys: "Escape", desc: "Fermer les dialogues" },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center animate-in fade-in" onClick={() => setShow(false)}>
      <div className="bg-card rounded-xl shadow-2xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Keyboard className="h-5 w-5 text-indigo-500" />
          <h3 className="font-semibold">Raccourcis Clavier</h3>
        </div>
        <div className="space-y-2">
          {shortcuts.map(s => (
            <div key={s.keys} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-muted-foreground">{s.desc}</span>
              <kbd className="bg-muted px-2 py-0.5 rounded text-xs font-mono">{s.keys}</kbd>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-4 text-center">Appuyez sur Escape pour fermer</p>
      </div>
    </div>
  );
}

function DeviceCapabilitiesPanel() {
  const caps = useDeviceCapabilities();
  const [show, setShow] = useState(false);

  if (!show) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShow(true)}>
              <Monitor className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Capacites du navigateur</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const features = [
    { name: "Camera", icon: Camera, active: caps.hasCamera },
    { name: "Microphone", icon: Mic, active: caps.hasMicrophone },
    { name: "GPS", icon: MapPin, active: caps.hasGeolocation },
    { name: "Notifications", icon: Bell, active: caps.hasNotifications },
    { name: "Reconnaissance vocale", icon: Volume2, active: caps.hasSpeechRecognition },
    { name: "Synthese vocale", icon: Volume2, active: caps.hasSpeechSynthesis },
    { name: "Presse-papier", icon: Clipboard, active: caps.hasClipboard },
    { name: "Partage natif", icon: Share2, active: caps.hasShare },
    { name: "Vibration", icon: Smartphone, active: caps.hasVibrate },
    { name: "Barcode/QR", icon: Fingerprint, active: caps.hasBarcodeDetector },
    { name: "WebGL", icon: Sparkles, active: caps.hasWebGL },
    { name: "Bluetooth", icon: Bluetooth, active: caps.hasBluetooth },
    { name: "Tactile", icon: Smartphone, active: caps.hasTouchScreen },
    { name: "PWA installe", icon: Monitor, active: caps.isPWA },
  ];

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center animate-in fade-in" onClick={() => setShow(false)}>
      <div className="bg-card rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <BrainCircuit className="h-5 w-5 text-indigo-500" />
          <h3 className="font-semibold">Capacites du Navigateur</h3>
          <button onClick={() => setShow(false)} className="ml-auto text-muted-foreground hover:text-foreground">x</button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {features.map(f => (
            <div key={f.name} className={`flex items-center gap-2 p-2 rounded border text-xs ${f.active ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900" : "bg-muted/30 border-border opacity-50"}`}>
              <f.icon className={`h-3.5 w-3.5 ${f.active ? "text-green-600" : "text-muted-foreground"}`} />
              <span>{f.name}</span>
              {f.active && <Check className="h-3 w-3 text-green-600 ml-auto" />}
            </div>
          ))}
        </div>

        <div className="border-t pt-3 space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between"><span>Ecran</span><span>{caps.screenWidth}x{caps.screenHeight} @{caps.devicePixelRatio}x</span></div>
          <div className="flex justify-between"><span>Plateforme</span><span>{caps.platform}</span></div>
          <div className="flex justify-between"><span>Langue</span><span>{caps.language}</span></div>
          {caps.memory && <div className="flex justify-between"><span>Memoire</span><span>{caps.memory} GB</span></div>}
          {caps.cores && <div className="flex justify-between"><span>Coeurs CPU</span><span>{caps.cores}</span></div>}
          {caps.maxTouchPoints > 0 && <div className="flex justify-between"><span>Points tactiles</span><span>{caps.maxTouchPoints}</span></div>}
        </div>
      </div>
    </div>
  );
}

function GeolocationButton() {
  const { position, loading, getCurrentPosition } = useGeolocation();
  const { toast } = useToast();

  const handleClick = () => {
    getCurrentPosition();
    if (position) {
      toast({ title: "Position actuelle", description: `Lat: ${position.lat.toFixed(4)}, Lng: ${position.lng.toFixed(4)}` });
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${position ? "text-blue-600" : ""}`}
            onClick={handleClick}
            disabled={loading}
          >
            <MapPin className={`h-3.5 w-3.5 ${loading ? "animate-pulse" : ""}`} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {position ? `Position: ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}` : "Localiser ma position"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function TabSyncIndicator() {
  const { lastMessage, broadcast } = useTabSync("session");

  useEffect(() => {
    broadcast({ type: "heartbeat", timestamp: Date.now() });
    const interval = setInterval(() => {
      broadcast({ type: "heartbeat", timestamp: Date.now() });
    }, 30000);
    return () => clearInterval(interval);
  }, [broadcast]);

  useEffect(() => {
    if (lastMessage?.type === "data_changed") {
      window.dispatchEvent(new CustomEvent("adb-tab-sync", { detail: lastMessage }));
    }
  }, [lastMessage]);

  return null;
}

export function SmartBrowserToolbar() {
  return (
    <div className="flex items-center gap-1">
      <SmartStatusBar />
      <div className="w-px h-4 bg-border mx-0.5" />
      <VoiceCommandButton />
      <SmartQuickActions />
      <GeolocationButton />
      <DeviceCapabilitiesPanel />
      <TabSyncIndicator />
    </div>
  );
}

export function SmartBrowserOverlays() {
  return (
    <>
      <NetworkAlert />
      <BatteryAlert />
      <ClipboardDetector />
      <SmartKeyboardShortcutsHelp />
    </>
  );
}

export function SmartBrowserShortcuts() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case "f":
            e.preventDefault();
            const searchInput = document.querySelector('[data-global-search]') as HTMLInputElement;
            if (searchInput) searchInput.focus();
            break;
          case "n":
            e.preventDefault();
            navigate("/contacts");
            toast({ title: "Nouveau contact", description: "Utilisez le bouton + pour creer" });
            break;
          case "t":
            e.preventDefault();
            navigate("/taches");
            toast({ title: "Nouvelle tache", description: "Utilisez le bouton + pour creer" });
            break;
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate, toast]);

  return null;
}
