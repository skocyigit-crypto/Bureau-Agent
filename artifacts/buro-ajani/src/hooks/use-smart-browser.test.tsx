/**
 * Le BatteryManager du navigateur survit au composant qui l'ecoute: tout
 * abonnement non retire s'accumule a chaque montage et continue d'appeler
 * setState sur un composant demonte. Ces tests verrouillent le retrait et le
 * cas de course (demontage pendant que la promesse getBattery est en vol).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBatteryStatus } from "./use-smart-browser";

interface FakeBattery {
  level: number;
  charging: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function installBattery(resolveNow = true): { battery: FakeBattery; resolve: () => void } {
  const battery: FakeBattery = {
    level: 0.42,
    charging: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  let release: () => void = () => {};
  const promise = resolveNow
    ? Promise.resolve(battery)
    : new Promise<FakeBattery>((res) => { release = () => res(battery); });
  (navigator as any).getBattery = () => promise;
  return { battery, resolve: release };
}

afterEach(() => {
  delete (navigator as any).getBattery;
  vi.restoreAllMocks();
});

describe("useBatteryStatus", () => {
  it("expose le niveau et l'etat de charge", async () => {
    installBattery();
    const { result } = renderHook(() => useBatteryStatus());

    await act(async () => { await Promise.resolve(); });

    expect(result.current).toEqual({ level: 42, charging: false });
  });

  it("retire ses deux abonnements au demontage", async () => {
    const { battery } = installBattery();
    const { unmount } = renderHook(() => useBatteryStatus());
    await act(async () => { await Promise.resolve(); });

    expect(battery.addEventListener).toHaveBeenCalledTimes(2);

    unmount();

    expect(battery.removeEventListener).toHaveBeenCalledTimes(2);
    const removed = battery.removeEventListener.mock.calls.map((c) => c[0]).sort();
    expect(removed).toEqual(["chargingchange", "levelchange"]);
    // Meme fonction retiree qu'ajoutee, sinon removeEventListener ne fait rien.
    for (const [event, handler] of battery.removeEventListener.mock.calls) {
      const added = battery.addEventListener.mock.calls.find((c) => c[0] === event);
      expect(handler).toBe(added?.[1]);
    }
  });

  it("ne s'abonne pas si le composant est demonte avant la resolution", async () => {
    const { battery, resolve } = installBattery(false);
    const { unmount } = renderHook(() => useBatteryStatus());

    unmount();
    await act(async () => { resolve(); await Promise.resolve(); });

    // Sans la garde, on s'abonnerait apres le demontage: plus personne pour
    // retirer, donc une fuite definitive.
    expect(battery.addEventListener).not.toHaveBeenCalled();
  });

  it("ne casse pas quand l'API batterie est absente", async () => {
    delete (navigator as any).getBattery;
    const { result, unmount } = renderHook(() => useBatteryStatus());

    await act(async () => { await Promise.resolve(); });

    expect(result.current).toBeNull();
    expect(() => unmount()).not.toThrow();
  });
});
