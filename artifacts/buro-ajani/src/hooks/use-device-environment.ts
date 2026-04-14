import { useState, useEffect, useMemo, createContext, useContext, createElement, type ReactNode } from "react";

type Platform = "ios" | "android" | "macos" | "windows" | "linux" | "unknown";
type DisplayMode = "standalone" | "browser" | "fullscreen" | "minimal-ui";
type ScreenClass = "mobile" | "tablet" | "desktop" | "ultrawide";
type ConnectionTier = "offline" | "slow" | "moderate" | "fast";
type InputMode = "touch" | "pointer" | "hybrid";

export interface DeviceEnvironment {
  platform: Platform;
  displayMode: DisplayMode;
  screenClass: ScreenClass;
  connectionTier: ConnectionTier;
  inputMode: InputMode;
  isStandalone: boolean;
  isAppleDevice: boolean;
  hasNotch: boolean;
  prefersReducedMotion: boolean;
  supportsHaptic: boolean;
  supportsBackdropBlur: boolean;
  pixelRatio: number;
  isHighDensity: boolean;
  screenWidth: number;
  screenHeight: number;
  isLandscape: boolean;
  colorScheme: "light" | "dark";
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac/.test(navigator.platform)) return "macos";
  if (/Win/.test(navigator.platform)) return "windows";
  if (/Linux/.test(navigator.platform)) return "linux";
  return "unknown";
}

function detectDisplayMode(): DisplayMode {
  if (window.matchMedia("(display-mode: fullscreen)").matches) return "fullscreen";
  if (window.matchMedia("(display-mode: standalone)").matches) return "standalone";
  if (window.matchMedia("(display-mode: minimal-ui)").matches) return "minimal-ui";
  if ((navigator as any).standalone === true) return "standalone";
  return "browser";
}

function detectScreenClass(width: number): ScreenClass {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  if (width < 1920) return "desktop";
  return "ultrawide";
}

function detectConnectionTier(): ConnectionTier {
  if (!navigator.onLine) return "offline";
  const conn = (navigator as any).connection;
  if (!conn) return "fast";
  const ect = conn.effectiveType;
  if (ect === "slow-2g" || ect === "2g") return "slow";
  if (ect === "3g") return "moderate";
  return "fast";
}

function detectInputMode(): InputMode {
  const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
  if (hasTouch && hasFinePointer) return "hybrid";
  if (hasTouch) return "touch";
  return "pointer";
}

let _notchCached: boolean | null = null;
function detectNotch(): boolean {
  if (_notchCached !== null) return _notchCached;
  const vp = window.visualViewport;
  if (vp && vp.offsetTop > 0) { _notchCached = true; return true; }
  const test = document.createElement("div");
  test.style.paddingTop = "env(safe-area-inset-top, 0px)";
  document.body.appendChild(test);
  const val = parseInt(getComputedStyle(test).paddingTop);
  document.body.removeChild(test);
  _notchCached = val > 0;
  return _notchCached;
}

export function useDeviceEnvironment(): DeviceEnvironment {
  const [screenWidth, setScreenWidth] = useState(window.innerWidth);
  const [screenHeight, setScreenHeight] = useState(window.innerHeight);
  const [connectionTier, setConnectionTier] = useState<ConnectionTier>(detectConnectionTier);

  useEffect(() => {
    let rafId: number;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setScreenWidth(window.innerWidth);
        setScreenHeight(window.innerHeight);
      });
    };
    window.addEventListener("resize", handleResize);

    const conn = (navigator as any).connection;
    const updateConn = () => setConnectionTier(detectConnectionTier());
    if (conn) conn.addEventListener("change", updateConn);
    window.addEventListener("online", updateConn);
    window.addEventListener("offline", updateConn);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(rafId);
      if (conn) conn.removeEventListener("change", updateConn);
      window.removeEventListener("online", updateConn);
      window.removeEventListener("offline", updateConn);
    };
  }, []);

  const env = useMemo<DeviceEnvironment>(() => {
    const platform = detectPlatform();
    const displayMode = detectDisplayMode();
    const isApple = platform === "ios" || platform === "macos";
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    return {
      platform,
      displayMode,
      screenClass: detectScreenClass(screenWidth),
      connectionTier,
      inputMode: detectInputMode(),
      isStandalone: displayMode === "standalone" || displayMode === "fullscreen",
      isAppleDevice: isApple,
      hasNotch: detectNotch(),
      prefersReducedMotion,
      supportsHaptic: "vibrate" in navigator,
      supportsBackdropBlur: CSS.supports("backdrop-filter", "blur(1px)"),
      pixelRatio: window.devicePixelRatio || 1,
      isHighDensity: window.devicePixelRatio >= 2,
      screenWidth,
      screenHeight,
      isLandscape: screenWidth > screenHeight,
      colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    };
  }, [screenWidth, screenHeight, connectionTier]);

  return env;
}

const DeviceEnvContext = createContext<DeviceEnvironment | null>(null);

export function DeviceEnvironmentProvider({ children }: { children: ReactNode }) {
  const env = useDeviceEnvironment();
  return createElement(DeviceEnvContext.Provider, { value: env }, children);
}

export function useDeviceEnvContext(): DeviceEnvironment {
  const ctx = useContext(DeviceEnvContext);
  if (ctx) return ctx;
  return useDeviceEnvironment();
}

export function triggerHaptic(style: "light" | "medium" | "heavy" | "success" | "warning" | "error" = "light") {
  if (!("vibrate" in navigator)) return;
  const patterns: Record<string, number | number[]> = {
    light: 10,
    medium: 20,
    heavy: 40,
    success: [10, 30, 10],
    warning: [20, 40, 20],
    error: [40, 30, 40, 30, 40],
  };
  try { navigator.vibrate(patterns[style] as any); } catch {}
}
