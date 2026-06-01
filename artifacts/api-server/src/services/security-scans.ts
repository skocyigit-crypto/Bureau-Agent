// Journal in-memory des scans de securite cote client (URL / fichiers /
// WhatsApp / appels), scope par organisation.
//
// Choix in-memory volontaire: aligne sur le journal d'evenements existant
// (middleware/security.ts) qui conserve aussi ses evenements en memoire. Pas
// de migration DB requise pour cette premiere version. Si une persistance
// multi-instance devient necessaire, basculer ce module vers une table Drizzle
// (security_scans) sans changer la signature publique.

export type ScanKind = "url" | "file" | "whatsapp" | "call" | "email";
export type ScanVerdict = "safe" | "suspicious" | "dangerous";

export interface SecurityScan {
  id: string;
  orgId: number;
  userId: number | null;
  kind: ScanKind;
  target: string;
  verdict: ScanVerdict;
  details: string;
  at: string;
}

const MAX_PER_ORG = 500;
const scansByOrg = new Map<number, SecurityScan[]>();

export function recordSecurityScan(input: {
  orgId: number;
  userId: number | null;
  kind: ScanKind;
  target: string;
  verdict: ScanVerdict;
  details: string;
}): SecurityScan {
  const scan: SecurityScan = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    orgId: input.orgId,
    userId: input.userId,
    kind: input.kind,
    target: input.target.slice(0, 300),
    verdict: input.verdict,
    details: input.details.slice(0, 600),
    at: new Date().toISOString(),
  };
  const list = scansByOrg.get(input.orgId) ?? [];
  list.push(scan);
  if (list.length > MAX_PER_ORG) list.splice(0, list.length - MAX_PER_ORG);
  scansByOrg.set(input.orgId, list);
  return scan;
}

export function getRecentSecurityScans(orgId: number, limit = 50): SecurityScan[] {
  const list = scansByOrg.get(orgId) ?? [];
  return list.slice(-limit).reverse();
}

export function getOrgScanSummary(orgId: number): {
  total: number;
  dangerous: number;
  suspicious: number;
  last24h: number;
} {
  const list = scansByOrg.get(orgId) ?? [];
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return {
    total: list.length,
    dangerous: list.filter((s) => s.verdict === "dangerous").length,
    suspicious: list.filter((s) => s.verdict === "suspicious").length,
    last24h: list.filter((s) => s.at >= dayAgo).length,
  };
}
