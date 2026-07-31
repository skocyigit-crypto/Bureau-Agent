import { useCallback,useEffect,useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/";

interface LicenseStatus {
  allowed: boolean;
  reason: string;
  loading: boolean;
}

const CACHE_TTL_MS = 30_000;
let cachedStatus: { value: LicenseStatus; at: number } | null = null;

export function primeLicenseStatus(value: { allowed?: boolean; reason?: string } | undefined): void {
  if (!value || typeof value.allowed !== "boolean") return;
  cachedStatus = {
    value: { allowed: value.allowed, reason: value.reason || "", loading: false },
    at: Date.now(),
  };
}

function getCachedStatus(): LicenseStatus | null {
  if (!cachedStatus || Date.now() - cachedStatus.at >= CACHE_TTL_MS) return null;
  return cachedStatus.value;
}

export function useLicenseCheck(): LicenseStatus {
  const [status, setStatus] = useState<LicenseStatus>(
    // Server middleware is authoritative; never block the shell on this advisory check.
    () => getCachedStatus() ?? { allowed: true, reason: "", loading: false },
  );

  const check = useCallback(async () => {
    const cached = getCachedStatus();
    if (cached) {
      setStatus(cached);
      return;
    }
    try {
      // Delai maximal indispensable: tant que cet appel n'a pas repondu,
      // App.tsx n'affiche qu'un spinner. Sans limite, une base lente ou
      // saturee bloquait l'application entiere pendant des minutes, sans
      // aucun message — le symptome exact remonte par les utilisateurs des
      // organisations clientes.
      const res = await fetch(`${BASE}api/my-subscription/check-access`, {
        credentials: "include",
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        const next = { allowed: data.allowed, reason: data.reason || "", loading: false };
        cachedStatus = { value: next, at: Date.now() };
        setStatus(next);
      } else {
        setStatus({ allowed: true, reason: "", loading: false });
      }
    } catch {
      // En cas d'expiration ou d'erreur reseau on LAISSE PASSER: le controle de
      // licence est applique cote serveur sur chaque route de toute facon
      // (middleware/license-check.ts). Bloquer ici n'ajouterait aucune securite
      // et transformerait un incident reseau en application inutilisable.
      setStatus({ allowed: true, reason: "", loading: false });
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  return status;
}
