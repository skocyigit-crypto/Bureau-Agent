import { useMemo } from "react";

// Detects devices/contexts where heavy 3D scenes and continuous animations
// should be replaced by a lightweight static fallback: explicit user/system
// signals (prefers-reduced-motion, Save-Data), constrained hardware (low
// memory / few cores), slow networks, or small touch devices. Evaluated once
// per mount — these signals do not meaningfully change during a page view.
export function detectLowPowerMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean; effectiveType?: string };
    };

    const reducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const saveData = nav.connection?.saveData === true;
    const lowMemory =
      typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4;
    const fewCores =
      typeof nav.hardwareConcurrency === "number" &&
      nav.hardwareConcurrency <= 4;
    const slowNetwork = /(^|[^a-z])(slow-2g|2g|3g)$/.test(
      String(nav.connection?.effectiveType || ""),
    );
    const coarsePointer =
      window.matchMedia?.("(pointer: coarse)").matches === true;
    const smallScreen =
      window.matchMedia?.("(max-width: 768px)").matches === true;

    return (
      reducedMotion ||
      saveData ||
      lowMemory ||
      slowNetwork ||
      (coarsePointer && smallScreen && fewCores)
    );
  } catch {
    return false;
  }
}

export function useLowPowerMode(): boolean {
  return useMemo(detectLowPowerMode, []);
}
