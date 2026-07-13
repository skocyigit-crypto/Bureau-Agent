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
      const res = await fetch(`${BASE}api/my-subscription/check-access`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setStatus({ allowed: data.allowed, reason: data.reason || "", loading: false });
      } else {
        setStatus({ allowed: true, reason: "", loading: false });
      }
    } catch {
      setStatus({ allowed: true, reason: "", loading: false });
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  return status;
}
