import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

// ── Types ─────────────────────────────────────────────────────────────────────
interface GmailProfile {
  email: string;
  name?: string;
  messagesTotal: number;
  threadsTotal: number;
}

interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  read: boolean;
  starred: boolean;
  hasAttachment: boolean;
  labelIds: string[];
  body?: string;
  bodyHtml?: string;
  bodyPlain?: string;
  attachments?: AttachmentMeta[];
  aiPriority?: string;
  aiSummary?: string;
  aiAction?: string;
}

interface AttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

interface ComposeData {
  to: string;
  subject: string;
  body: string;
  replyToId?: string;
}

// ── Security scan types ───────────────────────────────────────────────────────
interface UrlScanResult {
  url: string;
  displayUrl: string;
  domain: string;
  risk: "safe" | "suspicious" | "dangerous";
  reasons: string[];
  isShortener: boolean;
  isHttps: boolean;
}

interface AttachmentScanResult {
  filename: string;
  mimeType: string;
  size: number;
  safe: boolean;
  threats: string[];
  sha256: string;
  fileType: string | null;
  scannedAt: string;
  engine?: string;
}

interface AiPhishingAnalysis {
  phishingScore: number;
  socialEngineering: string[];
  impersonation: string | null;
  verdict: "legitime" | "suspect" | "phishing";
  summary: string;
  recommendation: string;
}

type AuthVerdict =
  | "pass" | "fail" | "softfail" | "neutral" | "none"
  | "temperror" | "permerror" | "unknown";

interface SenderAuth {
  spf: AuthVerdict;
  dkim: AuthVerdict;
  dmarc: AuthVerdict;
  suspicious: boolean;
  reasons: string[];
}

interface EmailScanReport {
  messageId: string;
  overallRisk: "safe" | "suspicious" | "dangerous";
  riskScore: number;
  attachments: AttachmentScanResult[];
  links: UrlScanResult[];
  senderAuth?: SenderAuth;
  aiAnalysis: AiPhishingAnalysis | null;
  stats: {
    attachmentsScanned: number;
    attachmentsThreatened: number;
    linksScanned: number;
    linksDangerous: number;
    linksSuspicious: number;
  };
  scannedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PRIORITY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  critique: { bg: "#fef2f2", text: "#ef4444", label: "Critique" },
  haute:    { bg: "#fff7ed", text: "#f97316", label: "Haute"    },
  normale:  { bg: "#eff6ff", text: "#3b82f6", label: "Normale"  },
  basse:    { bg: "#f9fafb", text: "#6b7280", label: "Basse"    },
};

const RISK_CFG = {
  safe:       { color: "#22c55e", bg: "#f0fdf4", border: "#86efac", icon: "shield" as const,     label: "Sûr",      labelFr: "Aucune menace détectée"       },
  suspicious: { color: "#f59e0b", bg: "#fffbeb", border: "#fcd34d", icon: "alert-triangle" as const, label: "Suspect",  labelFr: "Éléments suspects détectés"   },
  dangerous:  { color: "#ef4444", bg: "#fef2f2", border: "#fca5a5", icon: "alert-octagon" as const, label: "Dangereux",labelFr: "Menaces actives détectées !"   },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  if (!d) return "";
  const date = new Date(d);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 86400000 && date.getDate() === now.getDate())
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.getDate() === yesterday.getDate()) return "Hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function parseEmailName(str: string) {
  const m = str.match(/^"?([^"<]+)"?\s*<?([^>]*)>?$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() || str };
  return { name: str, email: str };
}
function fmtSize(bytes: number) {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} Mo`;
  return `${Math.ceil(bytes / 1024)} Ko`;
}

function AvatarInitials({ name, size = 36, color = "#dc2626" }: { name: string; size?: number; color?: string }) {
  const initials = name.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color + "22", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.38, fontFamily: "Inter_700Bold", color }}>{initials || "?"}</Text>
    </View>
  );
}

// ── Security panel ────────────────────────────────────────────────────────────
function SecurityPanel({ scan, scanning }: { scan: EmailScanReport | null; scanning: boolean }) {
  const colors = useColors();
  const [showLinks, setShowLinks] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);

  if (scanning) {
    return (
      <View style={[sp.card, { backgroundColor: "#f8fafc", borderColor: "#cbd5e1" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <ActivityIndicator size="small" color="#6366f1" />
          <View>
            <Text style={[sp.title, { color: "#1e293b" }]}>Analyse de sécurité en cours...</Text>
            <Text style={[sp.sub, { color: "#64748b" }]}>Scan des pièces jointes + liens + IA phishing</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!scan) return null;

  const cfg = RISK_CFG[scan.overallRisk];
  const { stats, aiAnalysis } = scan;

  return (
    <View style={[sp.card, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={[sp.iconWrap, { backgroundColor: cfg.color + "20" }]}>
          <Feather name={cfg.icon} size={18} color={cfg.color} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[sp.title, { color: cfg.color }]}>{cfg.label}</Text>
            <View style={[sp.scorePill, { backgroundColor: cfg.color + "20" }]}>
              <Text style={[{ fontSize: 10, fontFamily: "Inter_700Bold", color: cfg.color }]}>
                Risque {scan.riskScore}/100
              </Text>
            </View>
          </View>
          <Text style={[sp.sub, { color: cfg.color + "cc" }]}>{cfg.labelFr}</Text>
        </View>
      </View>

      {/* Stats row */}
      <View style={sp.statsRow}>
        <View style={sp.stat}>
          <Feather name="paperclip" size={12} color={stats.attachmentsThreatened > 0 ? "#ef4444" : "#22c55e"} />
          <Text style={[sp.statText, { color: stats.attachmentsThreatened > 0 ? "#ef4444" : "#22c55e" }]}>
            {stats.attachmentsScanned} pièce{stats.attachmentsScanned !== 1 ? "s" : ""} jointe{stats.attachmentsScanned !== 1 ? "s" : ""}
            {stats.attachmentsThreatened > 0 ? ` (${stats.attachmentsThreatened} ⚠)` : " ✓"}
          </Text>
        </View>
        <View style={sp.stat}>
          <Feather name="link" size={12} color={stats.linksDangerous > 0 ? "#ef4444" : stats.linksSuspicious > 0 ? "#f59e0b" : "#22c55e"} />
          <Text style={[sp.statText, { color: stats.linksDangerous > 0 ? "#ef4444" : stats.linksSuspicious > 0 ? "#f59e0b" : "#22c55e" }]}>
            {stats.linksScanned} lien{stats.linksScanned !== 1 ? "s" : ""}
            {stats.linksDangerous > 0 ? ` (${stats.linksDangerous} dangereux)` : stats.linksSuspicious > 0 ? ` (${stats.linksSuspicious} suspects)` : " ✓"}
          </Text>
        </View>
      </View>

      {/* AI analysis */}
      {aiAnalysis && (
        <View style={[sp.aiBlock, { backgroundColor: aiAnalysis.verdict === "phishing" ? "#fef2f2" : aiAnalysis.verdict === "suspect" ? "#fffbeb" : "#f0fdf4" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Feather name="cpu" size={12} color="#6366f1" />
            <Text style={[sp.aiTitle, { color: "#6366f1" }]}>Analyse IA — Score phishing {aiAnalysis.phishingScore}/10</Text>
          </View>
          <Text style={[sp.aiSummary, { color: "#374151" }]}>{aiAnalysis.summary}</Text>
          {aiAnalysis.impersonation && (
            <View style={[sp.tagRow, { marginTop: 6 }]}>
              <View style={[sp.tag, { backgroundColor: "#fef2f2" }]}>
                <Feather name="user-x" size={9} color="#ef4444" />
                <Text style={[sp.tagText, { color: "#ef4444" }]}>Usurpation : {aiAnalysis.impersonation}</Text>
              </View>
            </View>
          )}
          {aiAnalysis.socialEngineering.length > 0 && (
            <View style={[sp.tagRow, { marginTop: 4 }]}>
              {aiAnalysis.socialEngineering.slice(0, 4).map((tactic, i) => (
                <View key={i} style={[sp.tag, { backgroundColor: "#fff7ed" }]}>
                  <Text style={[sp.tagText, { color: "#d97706" }]}>{tactic}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={[sp.recommendation, { color: "#374151" }]}>→ {aiAnalysis.recommendation}</Text>
        </View>
      )}

      {/* Sender authentication (SPF/DKIM/DMARC) */}
      {scan.senderAuth && (
        <View style={[sp.aiBlock, { backgroundColor: scan.senderAuth.suspicious ? "#fef2f2" : "#f0fdf4" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Feather name={scan.senderAuth.suspicious ? "user-x" : "user-check"} size={12} color={scan.senderAuth.suspicious ? "#ef4444" : "#22c55e"} />
            <Text style={[sp.aiTitle, { color: scan.senderAuth.suspicious ? "#ef4444" : "#16a34a" }]}>
              Authentification de l'expéditeur
            </Text>
          </View>
          <View style={[sp.tagRow]}>
            {(["spf", "dkim", "dmarc"] as const).map((mech) => {
              const v = scan.senderAuth![mech];
              const ok = v === "pass";
              const bad = v === "fail" || v === "softfail";
              const col = ok ? "#16a34a" : bad ? "#ef4444" : "#94a3b8";
              return (
                <View key={mech} style={[sp.tag, { backgroundColor: col + "1a" }]}>
                  <Text style={[sp.tagText, { color: col }]}>{mech.toUpperCase()} : {v}</Text>
                </View>
              );
            })}
          </View>
          {scan.senderAuth.reasons.map((r, ri) => (
            <Text key={ri} style={[sp.threat, { color: "#ef4444", marginTop: 4 }]}>⚠ {r}</Text>
          ))}
        </View>
      )}

      {/* Attachments detail */}
      {scan.attachments.length > 0 && (
        <Pressable onPress={() => setShowAttachments(e => !e)} style={sp.expandRow}>
          <Feather name="paperclip" size={12} color="#64748b" />
          <Text style={[sp.expandText, { color: "#64748b" }]}>Pièces jointes scannées ({scan.attachments.length})</Text>
          <Feather name={showAttachments ? "chevron-up" : "chevron-down"} size={12} color="#64748b" />
        </Pressable>
      )}
      {showAttachments && scan.attachments.map((att, i) => (
        <View key={i} style={[sp.itemRow, { backgroundColor: att.safe ? "#f0fdf4" : "#fef2f2", borderColor: att.safe ? "#86efac" : "#fca5a5" }]}>
          <Feather name={att.safe ? "check-circle" : "x-circle"} size={14} color={att.safe ? "#22c55e" : "#ef4444"} />
          <View style={{ flex: 1 }}>
            <Text style={[sp.itemName, { color: "#1e293b" }]} numberOfLines={1}>{att.filename}</Text>
            <Text style={[sp.itemSub, { color: "#64748b" }]}>{fmtSize(att.size)} · {att.fileType ?? att.mimeType}</Text>
            {att.engine ? (
              <View style={sp.engineRow}>
                <Feather name="cpu" size={9} color="#64748b" />
                <Text style={[sp.engineText, { color: "#64748b" }]} numberOfLines={1}>{att.engine}</Text>
              </View>
            ) : null}
            {att.threats.map((t, ti) => (
              <Text key={ti} style={[sp.threat, { color: "#ef4444" }]}>⚠ {t}</Text>
            ))}
          </View>
        </View>
      ))}

      {/* Links detail */}
      {scan.links.length > 0 && (
        <Pressable onPress={() => setShowLinks(e => !e)} style={sp.expandRow}>
          <Feather name="link" size={12} color="#64748b" />
          <Text style={[sp.expandText, { color: "#64748b" }]}>Liens analysés ({scan.links.length})</Text>
          <Feather name={showLinks ? "chevron-up" : "chevron-down"} size={12} color="#64748b" />
        </Pressable>
      )}
      {showLinks && scan.links.map((link, i) => {
        const lc = RISK_CFG[link.risk];
        return (
          <View key={i} style={[sp.itemRow, { backgroundColor: lc.bg, borderColor: lc.border }]}>
            <Feather name={link.isHttps ? "lock" : "unlock"} size={13} color={link.isHttps ? "#22c55e" : "#f59e0b"} />
            <View style={{ flex: 1 }}>
              <Text style={[sp.itemName, { color: "#1e293b" }]} numberOfLines={1}>{link.domain}</Text>
              <Text style={[sp.itemSub, { color: "#64748b" }]} numberOfLines={1}>{link.displayUrl}</Text>
              {link.reasons.map((r, ri) => (
                <Text key={ri} style={[sp.threat, { color: lc.color }]}>• {r}</Text>
              ))}
            </View>
            <View style={[sp.riskBadge, { backgroundColor: lc.color + "20" }]}>
              <Text style={[{ fontSize: 9, fontFamily: "Inter_700Bold", color: lc.color }]}>{lc.label}</Text>
            </View>
          </View>
        );
      })}

      <Text style={[sp.footer, { color: "#94a3b8" }]}>
        Analysé le {new Date(scan.scannedAt).toLocaleString("fr-FR")}
      </Text>
    </View>
  );
}

const sp = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1.5, padding: 14, marginBottom: 12, gap: 10 },
  iconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  scorePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  statsRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  stat: { flexDirection: "row", alignItems: "center", gap: 5 },
  statText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  aiBlock: { borderRadius: 10, padding: 10, gap: 2 },
  aiTitle: { fontSize: 11, fontFamily: "Inter_700Bold" },
  aiSummary: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  tag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  tagText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  recommendation: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  expandRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  expandText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 8, borderRadius: 8, borderWidth: 1 },
  itemName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  itemSub: { fontSize: 10, fontFamily: "Inter_400Regular" },
  engineRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  engineText: { fontSize: 9, fontFamily: "Inter_500Medium" },
  threat: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  riskBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start" },
  footer: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function GmailAgentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [profile, setProfile] = useState<GmailProfile | null>(null);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GmailMessage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [compose, setCompose] = useState<ComposeData>({ to: "", subject: "", body: "" });
  const [sendLoading, setSendLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);

  // Security scan state
  const [scanReport, setScanReport] = useState<EmailScanReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scannedIds, setScannedIds] = useState<Record<string, EmailScanReport>>({});

  const load = useCallback(async () => {
    try {
      const [profileRes, inboxRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/gmail/profile`),
        fetchAuth(`${API_BASE}/api/gmail/inbox?maxResults=30`),
      ]);
      if (profileRes.status === 401 || profileRes.status === 403 || inboxRes.status === 401 || inboxRes.status === 403) {
        setNotConnected(true); setLoading(false); setRefreshing(false); return;
      }
      if (profileRes.ok) setProfile(await profileRes.json());
      if (inboxRes.ok) {
        const d = await inboxRes.json();
        setMessages(d.messages ?? d ?? []);
        setNotConnected(false);
      }
    } catch { setNotConnected(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  // Auto-scan email when opened if it has attachments or body with links
  async function runScan(msgId: string, bodyText: string, hasAttachment: boolean) {
    // Skip if no potential threat vectors
    const hasLinks = /https?:\/\//i.test(bodyText);
    if (!hasAttachment && !hasLinks) return;

    // Use cached result if available
    if (scannedIds[msgId]) { setScanReport(scannedIds[msgId]); return; }

    setScanning(true);
    setScanReport(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/gmail/message/${msgId}/scan`, { method: "POST" });
      if (res.ok) {
        const report: EmailScanReport = await res.json();
        setScanReport(report);
        setScannedIds(prev => ({ ...prev, [msgId]: report }));
      }
    } catch {}
    finally { setScanning(false); }
  }

  async function openMessage(msg: GmailMessage) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setScanReport(scannedIds[msg.id] ?? null);
    setScanning(false);
    setSelected({ ...msg });

    if (!msg.body && !msg.bodyPlain) {
      setDetailLoading(true);
      try {
        const res = await fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}`);
        if (res.ok) {
          const d = await res.json();
          const merged = { ...msg, ...d };
          setSelected(merged);
          // Auto-scan after body is loaded
          const body = d.bodyPlain || d.bodyHtml || d.snippet || "";
          runScan(msg.id, body, msg.hasAttachment || (d.attachments?.length ?? 0) > 0);
        }
      } finally { setDetailLoading(false); }
    } else {
      const body = msg.bodyPlain || msg.body || msg.snippet || "";
      runScan(msg.id, body, msg.hasAttachment);
    }

    if (!msg.read) {
      fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}/read`, { method: "PATCH" }).catch(() => {});
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m));
    }
  }

  async function handleStar(msg: GmailMessage) {
    setActionLoading("star-" + msg.id);
    try {
      await fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}/star`, { method: "PATCH" });
      const next = !msg.starred;
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, starred: next } : m));
      if (selected?.id === msg.id) setSelected(prev => prev ? { ...prev, starred: next } : prev);
    } finally { setActionLoading(null); }
  }

  async function handleArchive(msg: GmailMessage) {
    setActionLoading("archive-" + msg.id);
    try {
      const res = await fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}/archive`, { method: "POST" });
      if (res.ok) { setMessages(prev => prev.filter(m => m.id !== msg.id)); setSelected(null); setScanReport(null); }
    } finally { setActionLoading(null); }
  }

  async function handleTrash(msg: GmailMessage) {
    const doTrash = async () => {
      setActionLoading("trash-" + msg.id);
      try {
        await fetchAuth(`${API_BASE}/api/gmail/message/${msg.id}/trash`, { method: "DELETE" });
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        setSelected(null); setScanReport(null);
      } finally { setActionLoading(null); }
    };
    if (Platform.OS === "web") { doTrash(); return; }
    Alert.alert("Supprimer", "Déplacer cet email dans la corbeille ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Corbeille", style: "destructive", onPress: doTrash },
    ]);
  }

  async function handleSend() {
    if (!compose.to.trim() || !compose.subject.trim() || !compose.body.trim()) return;
    setSendLoading(true);
    try {
      const endpoint = compose.replyToId ? "/api/gmail/reply" : "/api/gmail/send";
      const body = compose.replyToId
        ? { messageId: compose.replyToId, to: compose.to, subject: compose.subject, body: compose.body }
        : { to: compose.to, subject: compose.subject, body: compose.body };
      const res = await fetchAuth(`${API_BASE}${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (res.ok) { setShowCompose(false); setCompose({ to: "", subject: "", body: "" }); load(); }
    } finally { setSendLoading(false); }
  }

  function openReply(msg: GmailMessage) {
    const { email } = parseEmailName(msg.from);
    setCompose({
      to: email,
      subject: msg.subject.startsWith("Re:") ? msg.subject : `Re: ${msg.subject}`,
      body: `\n\n---\nDe: ${msg.from}\nDate: ${fmtDate(msg.date)}\n\n${msg.snippet}`,
      replyToId: msg.id,
    });
    setSelected(null);
    setShowCompose(true);
  }

  async function rescan() {
    if (!selected) return;
    if (scannedIds[selected.id]) {
      setScannedIds(prev => { const n = { ...prev }; delete n[selected.id]; return n; });
    }
    setScanReport(null);
    const body = selected.bodyPlain || selected.body || selected.snippet || "";
    await runScan(selected.id + "__force", body, selected.hasAttachment);
    // Actually force re-scan
    setScanning(true);
    setScanReport(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/gmail/message/${selected.id}/scan`, { method: "POST" });
      if (res.ok) {
        const report: EmailScanReport = await res.json();
        setScanReport(report);
        setScannedIds(prev => ({ ...prev, [selected.id]: report }));
      }
    } catch {}
    finally { setScanning(false); }
  }

  const unread = messages.filter(m => !m.read).length;
  const starredCount = messages.filter(m => m.starred).length;

  // ── Risk badge for list items
  function getRiskBadge(msgId: string) {
    const r = scannedIds[msgId];
    if (!r) return null;
    const cfg = RISK_CFG[r.overallRisk];
    return cfg;
  }

  if (notConnected) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}><Feather name="arrow-left" size={20} color="#fff" /></Pressable>
          <Text style={styles.headerTitle}>Gmail Agent</Text>
        </View>
        <View style={styles.notConnected}>
          <View style={[styles.notConnectedIcon, { backgroundColor: "#fee2e2" }]}>
            <Feather name="mail" size={40} color="#ef4444" />
          </View>
          <Text style={[styles.notConnectedTitle, { color: colors.foreground }]}>Gmail non connecté</Text>
          <Text style={[styles.notConnectedSub, { color: colors.mutedForeground }]}>
            Connectez votre compte Gmail dans les paramètres Google Workspace pour accéder à votre boîte mail depuis l'app.
          </Text>
          <Pressable onPress={() => router.push("/integrations" as any)} style={styles.connectBtn}>
            <Feather name="settings" size={16} color="#fff" />
            <Text style={styles.connectBtnText}>Gérer les intégrations</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Gmail Agent</Text>
            {profile && <Text style={styles.headerSub}>{profile.email}</Text>}
          </View>
          <View style={styles.headerActions}>
            {unread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{unread}</Text>
              </View>
            )}
            <Pressable onPress={() => { setCompose({ to: "", subject: "", body: "" }); setShowCompose(true); }}
              style={[styles.composeBtn, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <Feather name="edit" size={16} color="#fff" />
            </Pressable>
          </View>
        </View>

        {profile && (
          <View style={styles.statsRow}>
            <View style={styles.statChip}><Feather name="mail" size={12} color="rgba(255,255,255,0.7)" /><Text style={styles.statText}>{messages.length} messages</Text></View>
            <View style={styles.statChip}><Feather name="bell" size={12} color="rgba(255,255,255,0.7)" /><Text style={styles.statText}>{unread} non lus</Text></View>
            <View style={styles.statChip}><Feather name="star" size={12} color="rgba(255,255,255,0.7)" /><Text style={styles.statText}>{starredCount} étoilés</Text></View>
          </View>
        )}

        <View style={[styles.searchBox, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
          <Feather name="search" size={14} color="rgba(255,255,255,0.6)" />
          <TextInput style={styles.searchInput} placeholder="Rechercher..." placeholderTextColor="rgba(255,255,255,0.5)" value={search} onChangeText={setSearch} />
          {search ? <Feather name="x" size={14} color="rgba(255,255,255,0.6)" onPress={() => setSearch("")} /> : null}
        </View>
      </View>

      {/* Email list */}
      {loading ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#dc2626" /></View>
      ) : (
        <FlatList
          data={messages.filter(m =>
            !search ||
            m.subject.toLowerCase().includes(search.toLowerCase()) ||
            m.from.toLowerCase().includes(search.toLowerCase()) ||
            m.snippet.toLowerCase().includes(search.toLowerCase())
          )}
          keyExtractor={m => m.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#dc2626" />}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          ListEmptyComponent={
            <EmptyState icon="mail" title="Aucun email" subtitle={search ? "Aucun résultat." : "Boîte vide."} />
          }
          renderItem={({ item }) => {
            const { name } = parseEmailName(item.from);
            const prio = item.aiPriority ? PRIORITY_COLORS[item.aiPriority] : null;
            const riskCfg = getRiskBadge(item.id);
            return (
              <Pressable
                onPress={() => openMessage(item)}
                style={({ pressed }) => [
                  styles.msgRow,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
                  !item.read && { borderLeftWidth: 3, borderLeftColor: "#dc2626" },
                  riskCfg?.color === "#ef4444" && { borderLeftWidth: 3, borderLeftColor: "#ef4444" },
                ]}
              >
                <AvatarInitials name={name} size={40} color="#dc2626" />
                <View style={{ flex: 1 }}>
                  <View style={styles.msgRowTop}>
                    <Text style={[styles.msgFrom, { color: colors.foreground, fontFamily: item.read ? "Inter_400Regular" : "Inter_700Bold" }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      {/* Security risk badge */}
                      {riskCfg && (
                        <View style={[styles.riskBadgeSm, { backgroundColor: riskCfg.color + "18" }]}>
                          <Feather name={riskCfg.icon} size={9} color={riskCfg.color} />
                        </View>
                      )}
                      {item.starred && <Feather name="star" size={11} color="#f59e0b" />}
                      {item.hasAttachment && <Feather name="paperclip" size={11} color={colors.mutedForeground} />}
                      <Text style={[styles.msgDate, { color: colors.mutedForeground }]}>{fmtDate(item.date)}</Text>
                    </View>
                  </View>
                  <Text style={[styles.msgSubject, { color: colors.foreground, fontFamily: item.read ? "Inter_500Medium" : "Inter_700Bold" }]} numberOfLines={1}>
                    {item.subject || "(Sans objet)"}
                  </Text>
                  <View style={styles.msgRowBottom}>
                    <Text style={[styles.msgSnippet, { color: colors.mutedForeground }]} numberOfLines={1}>{item.snippet}</Text>
                    {prio && (
                      <View style={[styles.prioPill, { backgroundColor: prio.bg }]}>
                        <Text style={[styles.prioText, { color: prio.text }]}>{prio.label}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {/* ── Email Detail Modal ── */}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setSelected(null); setScanReport(null); }}>
        {selected && (
          <View style={[styles.detailContainer, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.detailHeader, { backgroundColor: "#dc2626", paddingTop: isWeb ? 20 : insets.top + 8 }]}>
              <View style={styles.detailHeaderTop}>
                <Pressable onPress={() => { setSelected(null); setScanReport(null); }} style={styles.backBtn}>
                  <Feather name="x" size={20} color="#fff" />
                </Pressable>
                <Text style={[styles.headerTitle, { flex: 1 }]} numberOfLines={1}>{selected.subject || "(Sans objet)"}</Text>
                {/* Scan status indicator */}
                {scanning ? (
                  <ActivityIndicator size="small" color="#fff" style={{ marginRight: 4 }} />
                ) : scanReport ? (
                  <View style={[styles.scanBadgeHeader, { backgroundColor: RISK_CFG[scanReport.overallRisk].color + "30" }]}>
                    <Feather name={RISK_CFG[scanReport.overallRisk].icon} size={13} color="#fff" />
                  </View>
                ) : null}
                <Pressable onPress={() => handleStar(selected)} style={styles.backBtn}>
                  {actionLoading === "star-" + selected.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Feather name="star" size={18} color={selected.starred ? "#fbbf24" : "#fff"} />
                  }
                </Pressable>
              </View>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {/* Sender info */}
              <View style={[styles.senderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <AvatarInitials name={parseEmailName(selected.from).name} size={44} color="#dc2626" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.senderName, { color: colors.foreground }]}>{parseEmailName(selected.from).name}</Text>
                    <Text style={[styles.senderEmail, { color: colors.mutedForeground }]}>{parseEmailName(selected.from).email}</Text>
                    <Text style={[styles.senderDate, { color: colors.mutedForeground }]}>{fmtDate(selected.date)}</Text>
                  </View>
                </View>
                {selected.to && (
                  <Text style={[styles.senderTo, { color: colors.mutedForeground }]}>À : {selected.to}</Text>
                )}
              </View>

              {/* ─── SECURITY PANEL ─── */}
              <SecurityPanel scan={scanReport} scanning={scanning} />

              {/* Rescan button */}
              {!scanning && (
                <Pressable onPress={rescan} style={[styles.rescanBtn, { borderColor: "#6366f140" }]}>
                  <Feather name="shield" size={12} color="#6366f1" />
                  <Text style={[styles.rescanText, { color: "#6366f1" }]}>
                    {scanReport ? "Rescanner" : "Scanner cet email"}
                  </Text>
                </Pressable>
              )}

              {/* AI Summary */}
              {selected.aiSummary && (
                <View style={[styles.aiCard, { borderColor: "#6366f1" }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Feather name="cpu" size={13} color="#6366f1" />
                    <Text style={[styles.aiCardTitle, { color: "#6366f1" }]}>Résumé IA</Text>
                    {selected.aiPriority && (
                      <View style={[styles.prioPill, { backgroundColor: PRIORITY_COLORS[selected.aiPriority]?.bg ?? "#f9fafb", marginLeft: "auto" }]}>
                        <Text style={[styles.prioText, { color: PRIORITY_COLORS[selected.aiPriority]?.text ?? "#6b7280" }]}>
                          {PRIORITY_COLORS[selected.aiPriority]?.label}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.aiCardBody, { color: "#374151" }]}>{selected.aiSummary}</Text>
                  {selected.aiAction && (
                    <Text style={[styles.aiCardAction, { color: "#6366f1" }]}>Action suggérée : {selected.aiAction}</Text>
                  )}
                </View>
              )}

              {/* Attachments list */}
              {selected.attachments && selected.attachments.length > 0 && (
                <View style={[styles.attachList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.attachTitle, { color: colors.foreground }]}>
                    <Feather name="paperclip" size={12} /> Pièces jointes ({selected.attachments.length})
                  </Text>
                  {selected.attachments.map((att, i) => {
                    const scanned = scanReport?.attachments.find(a => a.filename === att.filename);
                    return (
                      <View key={i} style={[styles.attachRow, { borderTopColor: colors.border }]}>
                        <View style={[styles.attachIcon, { backgroundColor: scanned?.safe === false ? "#fef2f215" : "#f0fdf415" }]}>
                          <Feather name={scanned?.safe === false ? "alert-triangle" : "file"} size={14} color={scanned?.safe === false ? "#ef4444" : "#22c55e"} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.attachName, { color: colors.foreground }]} numberOfLines={1}>{att.filename}</Text>
                          <Text style={[styles.attachSize, { color: colors.mutedForeground }]}>{fmtSize(att.size)}</Text>
                        </View>
                        {scanned && (
                          <View style={[styles.scanBadgeSm, { backgroundColor: (scanned.safe ? "#22c55e" : "#ef4444") + "15" }]}>
                            <Feather name={scanned.safe ? "check" : "x"} size={10} color={scanned.safe ? "#22c55e" : "#ef4444"} />
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Email body */}
              {detailLoading ? (
                <ActivityIndicator color="#dc2626" style={{ marginTop: 24 }} />
              ) : (
                <View style={[styles.bodyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.bodyText, { color: colors.foreground }]} selectable>
                    {selected.bodyPlain || selected.body || selected.snippet}
                  </Text>
                </View>
              )}

              {/* Actions */}
              <View style={styles.detailActions}>
                <Pressable onPress={() => openReply(selected)} style={[styles.actionBtn, { backgroundColor: "#dc2626" }]}>
                  <Feather name="corner-down-left" size={15} color="#fff" />
                  <Text style={styles.actionBtnText}>Répondre</Text>
                </Pressable>
                <Pressable onPress={() => handleArchive(selected)} style={[styles.actionBtn, { backgroundColor: "#6366f1" }]} disabled={!!actionLoading}>
                  {actionLoading === "archive-" + selected.id ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="archive" size={15} color="#fff" />}
                  <Text style={styles.actionBtnText}>Archiver</Text>
                </Pressable>
                <Pressable onPress={() => handleTrash(selected)} style={[styles.actionBtn, { backgroundColor: "#ef4444" }]} disabled={!!actionLoading}>
                  {actionLoading === "trash-" + selected.id ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="trash-2" size={15} color="#fff" />}
                  <Text style={styles.actionBtnText}>Corbeille</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* ── Compose Modal ── */}
      <Modal visible={showCompose} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCompose(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.detailContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.detailHeader, { backgroundColor: "#dc2626", paddingTop: isWeb ? 20 : insets.top + 8 }]}>
              <View style={styles.detailHeaderTop}>
                <Pressable onPress={() => setShowCompose(false)} style={styles.backBtn}><Feather name="x" size={20} color="#fff" /></Pressable>
                <Text style={styles.headerTitle}>{compose.replyToId ? "Répondre" : "Nouveau message"}</Text>
                <Pressable onPress={handleSend} disabled={sendLoading || !compose.to || !compose.subject || !compose.body}
                  style={[styles.sendActionBtn, { opacity: sendLoading || !compose.to || !compose.subject || !compose.body ? 0.5 : 1 }]}>
                  {sendLoading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={18} color="#fff" />}
                </Pressable>
              </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
              <View style={[styles.composeField, { borderColor: colors.border }]}>
                <Text style={[styles.composeLabel, { color: colors.mutedForeground }]}>À</Text>
                <TextInput style={[styles.composeInput, { color: colors.foreground }]} value={compose.to} onChangeText={v => setCompose(p => ({ ...p, to: v }))} placeholder="email@example.com" placeholderTextColor={colors.mutedForeground} keyboardType="email-address" autoCapitalize="none" />
              </View>
              <View style={[styles.composeField, { borderColor: colors.border }]}>
                <Text style={[styles.composeLabel, { color: colors.mutedForeground }]}>Objet</Text>
                <TextInput style={[styles.composeInput, { color: colors.foreground }]} value={compose.subject} onChangeText={v => setCompose(p => ({ ...p, subject: v }))} placeholder="Objet du message" placeholderTextColor={colors.mutedForeground} />
              </View>
              <View style={[styles.composeBodyField, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <TextInput style={[styles.composeBodyInput, { color: colors.foreground }]} value={compose.body} onChangeText={v => setCompose(p => ({ ...p, body: v }))} placeholder="Écrivez votre message..." placeholderTextColor={colors.mutedForeground} multiline numberOfLines={12} textAlignVertical="top" />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#dc2626", paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 6 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  unreadBadge: { backgroundColor: "#fbbf24", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  unreadText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#7c2d12" },
  composeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)" },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 10, height: 38, gap: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, fontFamily: "Inter_400Regular" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12, gap: 1 },
  msgRow: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  msgRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  msgFrom: { fontSize: 13, flex: 1, marginRight: 8 },
  msgDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  msgSubject: { fontSize: 13, marginBottom: 2 },
  msgRowBottom: { flexDirection: "row", alignItems: "center", gap: 6 },
  msgSnippet: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  prioPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  prioText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  riskBadgeSm: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  notConnected: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  notConnectedIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  notConnectedTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  notConnectedSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, maxWidth: 300 },
  connectBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#dc2626", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 4 },
  connectBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  detailContainer: { flex: 1 },
  detailHeader: { paddingHorizontal: 16, paddingBottom: 12 },
  detailHeaderTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  scanBadgeHeader: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  senderCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12, gap: 8 },
  senderName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  senderEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  senderDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  senderTo: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  rescanBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  rescanText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  aiCard: { borderRadius: 12, borderWidth: 1.5, padding: 14, marginBottom: 12, backgroundColor: "#f5f3ff" },
  aiCardTitle: { fontSize: 12, fontFamily: "Inter_700Bold" },
  aiCardBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  aiCardAction: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 6 },
  attachList: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 12, gap: 2 },
  attachTitle: { fontSize: 12, fontFamily: "Inter_700Bold", marginBottom: 8 },
  attachRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  attachIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  attachName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  attachSize: { fontSize: 10, fontFamily: "Inter_400Regular" },
  scanBadgeSm: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  bodyCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  bodyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  detailActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, flex: 1 },
  actionBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sendActionBtn: { padding: 6 },
  composeField: { borderBottomWidth: 1, flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 10 },
  composeLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", width: 44 },
  composeInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  composeBodyField: { borderRadius: 12, borderWidth: 1, padding: 12, minHeight: 200 },
  composeBodyInput: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, flex: 1, minHeight: 180 },
});
