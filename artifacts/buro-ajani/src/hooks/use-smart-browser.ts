import { useState, useEffect, useCallback, useRef } from "react";

const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [connectionType, setConnectionType] = useState<string>("unknown");
  const [downlink, setDownlink] = useState<number | null>(null);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const updateConnection = () => {
      const conn = (navigator as any).connection;
      if (conn) {
        setConnectionType(conn.effectiveType || "unknown");
        setDownlink(conn.downlink || null);
      }
    };

    const goOnline = () => {
      setIsOnline(true);
      if (!navigator.onLine) return;
      setWasOffline(true);
      setTimeout(() => setWasOffline(false), 5000);
    };
    const goOffline = () => { setIsOnline(false); setWasOffline(false); };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    updateConnection();

    const conn = (navigator as any).connection;
    if (conn) conn.addEventListener("change", updateConnection);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      if (conn) conn.removeEventListener("change", updateConnection);
    };
  }, []);

  return { isOnline, connectionType, downlink, wasOffline };
}

export function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const [hiddenSince, setHiddenSince] = useState<Date | null>(null);
  const [idleMinutes, setIdleMinutes] = useState(0);

  useEffect(() => {
    const handler = () => {
      const visible = !document.hidden;
      setIsVisible(visible);
      if (!visible) {
        setHiddenSince(new Date());
      } else {
        setHiddenSince(null);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  useEffect(() => {
    let lastActivity = Date.now();
    const resetIdle = () => { lastActivity = Date.now(); setIdleMinutes(0); };
    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"];
    events.forEach(e => document.addEventListener(e, resetIdle, { passive: true }));

    const interval = setInterval(() => {
      setIdleMinutes(Math.floor((Date.now() - lastActivity) / 60000));
    }, 30000);

    return () => {
      events.forEach(e => document.removeEventListener(e, resetIdle));
      clearInterval(interval);
    };
  }, []);

  return { isVisible, hiddenSince, idleMinutes };
}

export function useBatteryStatus() {
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);

  useEffect(() => {
    const getBattery = async () => {
      try {
        const batt = await (navigator as any).getBattery?.();
        if (!batt) return;
        const update = () => setBattery({ level: Math.round(batt.level * 100), charging: batt.charging });
        update();
        batt.addEventListener("levelchange", update);
        batt.addEventListener("chargingchange", update);
      } catch {}
    };
    getBattery();
  }, []);

  return battery;
}

export function useSmartNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "denied";
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const sendNotification = useCallback((title: string, options?: NotificationOptions) => {
    if (permission !== "granted") return null;
    try {
      const notification = new Notification(title, {
        icon: `${baseUrl}/icons/icon-192x192.png`,
        badge: `${baseUrl}/icons/icon-72x72.png`,
        ...options,
      });
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      return notification;
    } catch { return null; }
  }, [permission]);

  return { permission, requestPermission, sendNotification };
}

export function useAutoSave(key: string, data: any, enabled = true) {
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const prevData = useRef<string>("");

  useEffect(() => {
    if (!enabled || !data) return;
    const serialized = JSON.stringify(data);
    if (serialized === prevData.current) return;
    prevData.current = serialized;
    setHasUnsaved(true);

    const timer = setTimeout(() => {
      try {
        localStorage.setItem(`adb-autosave-${key}`, serialized);
        localStorage.setItem(`adb-autosave-${key}-ts`, new Date().toISOString());
        setLastSaved(new Date());
        setHasUnsaved(false);
      } catch {}
    }, 2000);

    return () => clearTimeout(timer);
  }, [key, data, enabled]);

  const restore = useCallback(() => {
    try {
      const saved = localStorage.getItem(`adb-autosave-${key}`);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  }, [key]);

  const clear = useCallback(() => {
    localStorage.removeItem(`adb-autosave-${key}`);
    localStorage.removeItem(`adb-autosave-${key}-ts`);
    setHasUnsaved(false);
  }, [key]);

  const getSavedTimestamp = useCallback(() => {
    const ts = localStorage.getItem(`adb-autosave-${key}-ts`);
    return ts ? new Date(ts) : null;
  }, [key]);

  return { lastSaved, hasUnsaved, restore, clear, getSavedTimestamp };
}

export function useSmartClipboard() {
  const [clipboardContent, setClipboardContent] = useState<string | null>(null);
  const [detected, setDetected] = useState<{ type: string; value: string } | null>(null);

  const readClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setClipboardContent(text);
      detectContent(text);
      return text;
    } catch { return null; }
  }, []);

  const writeClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (navigator.vibrate) navigator.vibrate(50);
      return true;
    } catch { return false; }
  }, []);

  const detectContent = (text: string) => {
    if (!text) { setDetected(null); return; }
    const trimmed = text.trim();
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(trimmed)) {
      setDetected({ type: "email", value: trimmed });
    } else if (/^(\+?\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/.test(trimmed)) {
      setDetected({ type: "phone", value: trimmed });
    } else if (/^https?:\/\//.test(trimmed)) {
      setDetected({ type: "url", value: trimmed });
    } else if (/^FR\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{3}$/.test(trimmed.replace(/\s/g, ""))) {
      setDetected({ type: "iban", value: trimmed });
    } else if (/^\d{9,14}$/.test(trimmed)) {
      setDetected({ type: "siret", value: trimmed });
    } else {
      setDetected(null);
    }
  };

  return { clipboardContent, detected, readClipboard, writeClipboard };
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {}
  }, []);

  return { isFullscreen, toggleFullscreen };
}

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);
  }, []);

  const startListening = useCallback((lang = "fr-FR") => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (final) setTranscript(prev => prev + final);
      setInterimTranscript(interim);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
  }, []);

  return { isListening, transcript, interimTranscript, isSupported, startListening, stopListening, resetTranscript };
}

export function useSmartShortcuts(shortcuts: Record<string, () => void>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const keys: string[] = [];
      if (e.ctrlKey || e.metaKey) keys.push("mod");
      if (e.shiftKey) keys.push("shift");
      if (e.altKey) keys.push("alt");
      keys.push(e.key.toLowerCase());
      const combo = keys.join("+");

      if (shortcuts[combo]) {
        e.preventDefault();
        e.stopPropagation();
        shortcuts[combo]();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [shortcuts]);
}

export function useSmartPrefetch() {
  const prefetched = useRef(new Set<string>());

  const prefetch = useCallback((url: string) => {
    if (prefetched.current.has(url)) return;
    prefetched.current.add(url);

    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = `${baseUrl}/api${url}`;
    document.head.appendChild(link);
  }, []);

  const prefetchOnHover = useCallback((url: string) => {
    return {
      onMouseEnter: () => prefetch(url),
      onFocus: () => prefetch(url),
    };
  }, [prefetch]);

  return { prefetch, prefetchOnHover };
}

export function useDeviceCapabilities() {
  const [capabilities, setCapabilities] = useState({
    hasCamera: false,
    hasMicrophone: false,
    hasGeolocation: !!navigator.geolocation,
    hasBluetooth: !!(navigator as any).bluetooth,
    hasWebGL: false,
    hasTouchScreen: false,
    hasNotifications: typeof Notification !== "undefined",
    hasSpeechRecognition: !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition,
    hasSpeechSynthesis: !!window.speechSynthesis,
    hasClipboard: !!navigator.clipboard,
    hasShare: !!navigator.share,
    hasVibrate: !!navigator.vibrate,
    hasBarcodeDetector: !!(window as any).BarcodeDetector,
    hasFileSystem: !!(window as any).showOpenFilePicker,
    isPWA: window.matchMedia("(display-mode: standalone)").matches,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    platform: navigator.platform,
    language: navigator.language,
    memory: (navigator as any).deviceMemory || null,
    cores: navigator.hardwareConcurrency || null,
  });

  useEffect(() => {
    const checkMedia = async () => {
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices();
        if (devices) {
          setCapabilities(prev => ({
            ...prev,
            hasCamera: devices.some(d => d.kind === "videoinput"),
            hasMicrophone: devices.some(d => d.kind === "audioinput"),
          }));
        }
      } catch {}

      try {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
        setCapabilities(prev => ({ ...prev, hasWebGL: !!gl }));
      } catch {}

      setCapabilities(prev => ({
        ...prev,
        hasTouchScreen: "ontouchstart" in window || navigator.maxTouchPoints > 0,
      }));
    };
    checkMedia();
  }, []);

  return capabilities;
}

export function useSmartShare() {
  const canShare = !!navigator.share;

  const share = useCallback(async (data: { title?: string; text?: string; url?: string }) => {
    if (navigator.share) {
      try {
        await navigator.share(data);
        return true;
      } catch { return false; }
    }
    return false;
  }, []);

  return { canShare, share };
}

export function usePrintMode() {
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    const beforePrint = () => setIsPrinting(true);
    const afterPrint = () => setIsPrinting(false);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  const print = useCallback(() => window.print(), []);

  return { isPrinting, print };
}

export function useGeolocation() {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const getCurrentPosition = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocalisation non disponible");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLoading(false);
      },
      (err) => { setError(err.message); setLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return { position, error, loading, getCurrentPosition };
}

export function usePerformanceMonitor() {
  const [metrics, setMetrics] = useState({
    pageLoadTime: 0,
    domReady: 0,
    memoryUsed: 0,
    memoryTotal: 0,
    fps: 0,
  });

  useEffect(() => {
    const updateMetrics = () => {
      const timing = performance.timing || {};
      const memory = (performance as any).memory;
      setMetrics(prev => ({
        ...prev,
        pageLoadTime: timing.loadEventEnd ? timing.loadEventEnd - timing.navigationStart : 0,
        domReady: timing.domContentLoadedEventEnd ? timing.domContentLoadedEventEnd - timing.navigationStart : 0,
        memoryUsed: memory ? Math.round(memory.usedJSHeapSize / 1048576) : 0,
        memoryTotal: memory ? Math.round(memory.totalJSHeapSize / 1048576) : 0,
      }));
    };

    let frames = 0;
    let lastTime = performance.now();
    let rafId: number;
    const measureFps = () => {
      frames++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setMetrics(prev => ({ ...prev, fps: frames }));
        frames = 0;
        lastTime = now;
      }
      rafId = requestAnimationFrame(measureFps);
    };

    setTimeout(updateMetrics, 100);
    rafId = requestAnimationFrame(measureFps);

    return () => cancelAnimationFrame(rafId);
  }, []);

  return metrics;
}

export function useWakeLock() {
  const [isLocked, setIsLocked] = useState(false);
  const lockRef = useRef<any>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        lockRef.current = await (navigator as any).wakeLock.request("screen");
        setIsLocked(true);
        lockRef.current.addEventListener("release", () => setIsLocked(false));
      }
    } catch {}
  }, []);

  const releaseWakeLock = useCallback(() => {
    lockRef.current?.release();
    lockRef.current = null;
    setIsLocked(false);
  }, []);

  return { isLocked, requestWakeLock, releaseWakeLock };
}

export function useTabSync(channel: string) {
  const [lastMessage, setLastMessage] = useState<any>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    try {
      const bc = new BroadcastChannel(`adb-${channel}`);
      bcRef.current = bc;
      bc.onmessage = (e) => setLastMessage(e.data);
      return () => bc.close();
    } catch {
      return undefined;
    }
  }, [channel]);

  const broadcast = useCallback((data: any) => {
    bcRef.current?.postMessage(data);
  }, []);

  return { lastMessage, broadcast };
}
