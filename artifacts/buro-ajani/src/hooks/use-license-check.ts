import { useState, useEffect, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/";

interface LicenseStatus {
  allowed: boolean;
  reason: string;
  loading: boolean;
}

export function useLicenseCheck(): LicenseStatus {
  const [status, setStatus] = useState<LicenseStatus>({ allowed: true, reason: "", loading: true });

  const check = useCallback(async () => {
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
        setStatus({ allowed: data.allowed, reason: data.reason || "", loading: false });
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
