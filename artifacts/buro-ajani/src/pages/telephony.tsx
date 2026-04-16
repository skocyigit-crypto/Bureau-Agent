import { useState, useEffect, useCallback } from "react";
import { Phone, Plus, Settings, Trash2, Star, Check, MessageSquare, PhoneCall, PhoneOff, Send, RefreshCw, ExternalLink, Shield, Zap, Users, Clock, FileText, CalendarClock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ProviderInfo {
  name: string;
  displayName: string;
  website: string;
  capabilities: string[];
  configFields: { key: string; label: string; required: boolean; secret: boolean }[];
  pricing: { description: string };
}

interface ConfiguredProvider {
  id: number;
  provider: string;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  config: Record<string, string>;
  phoneNumbers: string[];
  capabilities: string[];
  createdAt: string;
}

interface Stats {
  calls: { total: number; successful: number; failed: number; totalDuration: number };
  sms: { total: number; successful: number; failed: number };
  providers: { total: number; active: number };
}

interface CallLog {
  id: number;
  direction: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  duration: number;
  createdAt: string;
}

interface SmsLog {
  id: number;
  direction: string;
  fromNumber: string;
  toNumber: string;
  body: string;
  status: string;
  createdAt: string;
}

export default function TelephonyPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"providers" | "call" | "sms" | "bulk" | "schedule" | "logs" | "stats">("providers");
  const [bulkNumbers, setBulkNumbers] = useState("");
  const [bulkBody, setBulkBody] = useState("");
  const [bulkResult, setBulkResult] = useState<{ sent: number; failed: number } | null>(null);
  const [scheduleCallTo, setScheduleCallTo] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");
  const [scheduledCalls, setScheduledCalls] = useState<{ id: number; toNumber: string; scheduledAt: string; note: string; status: string }[]>([]);
  const [callNotes, setCallNotes] = useState("");
  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<ConfiguredProvider[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configLabel, setConfigLabel] = useState("");
  const [callTo, setCallTo] = useState("");
  const [smsTo, setSmsTo] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [actionResult, setActionResult] = useState<{ type: string; success: boolean; message: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [avRes, confRes, statsRes] = await Promise.all([
        fetch(`${API}/api/telephony/providers/available`, { credentials: "include" }),
        fetch(`${API}/api/telephony/providers`, { credentials: "include" }),
        fetch(`${API}/api/telephony/stats`, { credentials: "include" }),
      ]);
      if (avRes.ok) { const d = await avRes.json(); setAvailableProviders(d.providers || []); }
      if (confRes.ok) { const d = await confRes.json(); setConfiguredProviders(d.providers || []); }
      if (statsRes.ok) { const d = await statsRes.json(); setStats(d); }
    } catch (e) {
      console.error("Telephony fetch error:", e);
      toast({ title: "Erreur", description: "Impossible de charger les donnees telephoniques.", variant: "destructive" });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function fetchLogs() {
    try {
      const [clRes, slRes] = await Promise.all([
        fetch(`${API}/api/telephony/call-logs?limit=30`, { credentials: "include" }),
        fetch(`${API}/api/telephony/sms-logs?limit=30`, { credentials: "include" }),
      ]);
      if (clRes.ok) { const d = await clRes.json(); setCallLogs(d.logs || []); }
      if (slRes.ok) { const d = await slRes.json(); setSmsLogs(d.logs || []); }
    } catch (e) {
      console.error("Telephony fetchLogs error:", e);
      toast({ title: "Erreur", description: "Impossible de charger les journaux.", variant: "destructive" });
    }
  }

  async function addProvider() {
    if (!selectedProvider) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API}/api/telephony/providers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider.name,
          label: configLabel || selectedProvider.displayName,
          config: configValues,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddForm(false);
        setSelectedProvider(null);
        setConfigValues({});
        setConfigLabel("");
        fetchData();
        setActionResult({ type: "add", success: true, message: data.message });
      } else {
        setActionResult({ type: "add", success: false, message: data.error || "Erreur" });
      }
    } catch (e: any) {
      setActionResult({ type: "add", success: false, message: e.message });
    }
    setActionLoading(false);
  }

  async function deleteProvider(id: number) {
    if (!confirm("Supprimer ce fournisseur ?")) return;
    try {
      const res = await fetch(`${API}/api/telephony/providers/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { toast({ title: "Erreur", description: "Impossible de supprimer le fournisseur.", variant: "destructive" }); return; }
      toast({ title: "Fournisseur supprime" });
      fetchData();
    } catch (e) {
      toast({ title: "Erreur", description: "Erreur de connexion.", variant: "destructive" });
    }
  }

  async function setDefault(id: number) {
    try {
      const res = await fetch(`${API}/api/telephony/providers/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!res.ok) { toast({ title: "Erreur", description: "Impossible de definir par defaut.", variant: "destructive" }); return; }
      fetchData();
    } catch (e) {
      toast({ title: "Erreur", description: "Erreur de connexion.", variant: "destructive" });
    }
  }

  async function toggleActive(id: number, current: boolean) {
    try {
      const res = await fetch(`${API}/api/telephony/providers/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !current }),
      });
      if (!res.ok) { toast({ title: "Erreur", description: "Impossible de modifier le statut.", variant: "destructive" }); return; }
      fetchData();
    } catch (e) {
      toast({ title: "Erreur", description: "Erreur de connexion.", variant: "destructive" });
    }
  }

  async function testProvider(id: number) {
    setActionLoading(true);
    try {
      const res = await fetch(`${API}/api/telephony/providers/${id}/test`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      setActionResult({
        type: "test",
        success: res.ok,
        message: res.ok ? `${data.label}: ${data.message} (Voice: ${data.voiceReady ? "OK" : "Non"}, SMS: ${data.smsReady ? "OK" : "Non"})` : data.error,
      });
    } catch (e: any) {
      setActionResult({ type: "test", success: false, message: e.message });
    }
    setActionLoading(false);
  }

  async function doCall() {
    if (!callTo.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API}/api/telephony/call`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: callTo, record: true }),
      });
      const data = await res.json();
      setActionResult({
        type: "call",
        success: data.success,
        message: data.success ? `Appel lance via ${data.provider} (SID: ${data.callSid})` : `Echec: ${data.error}`,
      });
      if (data.success) setCallTo("");
    } catch (e: any) {
      setActionResult({ type: "call", success: false, message: e.message });
    }
    setActionLoading(false);
  }

  async function doSms() {
    if (!smsTo.trim() || !smsBody.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API}/api/telephony/sms`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: smsTo, body: smsBody }),
      });
      const data = await res.json();
      setActionResult({
        type: "sms",
        success: data.success,
        message: data.success ? `SMS envoye via ${data.provider}` : `Echec: ${data.error}`,
      });
      if (data.success) { setSmsTo(""); setSmsBody(""); }
    } catch (e: any) {
      setActionResult({ type: "sms", success: false, message: e.message });
    }
    setActionLoading(false);
  }

  function formatDuration(s: number) { return s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; }
  function formatDate(d: string) { return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }

  const CAPABILITY_LABELS: Record<string, string> = {
    voice: "Voix", sms: "SMS", mms: "MMS", whatsapp: "WhatsApp", video: "Video",
    recording: "Enregistrement", ivr: "SVI/IVR", transcription: "Transcription",
    fax: "Fax", verify: "Verification", rcs: "RCS", emergency: "Urgence",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Phone className="h-6 w-6 text-primary" />
            Telephonie
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Gerez vos fournisseurs telephoniques et passez des appels/SMS</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Ajouter un fournisseur
        </button>
      </div>

      {actionResult && (
        <div className={`p-4 rounded-lg border ${actionResult.success ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300" : "bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300"}`}>
          <div className="flex items-center justify-between">
            <p className="text-sm">{actionResult.message}</p>
            <button onClick={() => setActionResult(null)} className="text-xs opacity-60 hover:opacity-100">Fermer</button>
          </div>
        </div>
      )}

      <div className="flex gap-2 border-b pb-2 overflow-x-auto">
        {[
          { key: "providers" as const, label: "Fournisseurs", icon: Settings },
          { key: "call" as const, label: "Appeler", icon: PhoneCall },
          { key: "sms" as const, label: "SMS", icon: MessageSquare },
          { key: "bulk" as const, label: "SMS Campagne", icon: Users },
          { key: "schedule" as const, label: "Planifier", icon: CalendarClock },
          { key: "logs" as const, label: "Historique", icon: RefreshCw },
          { key: "stats" as const, label: "Statistiques", icon: Zap },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); if (t.key === "logs") fetchLogs(); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "providers" && (
        <div className="space-y-4">
          {configuredProviders.length === 0 ? (
            <div className="text-center py-12 bg-card rounded-xl border">
              <PhoneOff className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">Aucun fournisseur configure</h3>
              <p className="text-sm text-muted-foreground mt-2">Ajoutez un fournisseur telephonique pour commencer a passer des appels et envoyer des SMS</p>
              <button onClick={() => setShowAddForm(true)} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg">
                <Plus className="h-4 w-4 inline mr-2" /> Ajouter
              </button>
            </div>
          ) : (
            configuredProviders.map(p => (
              <div key={p.id} className={`p-4 rounded-xl border bg-card ${!p.isActive ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${p.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Phone className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold flex items-center gap-2">
                        {p.label}
                        {p.isDefault && <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full dark:bg-yellow-900/30 dark:text-yellow-300">Par defaut</span>}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${p.isActive ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"}`}>
                          {p.isActive ? "Actif" : "Inactif"}
                        </span>
                      </h3>
                      <p className="text-xs text-muted-foreground">{p.provider} · {p.phoneNumbers.join(", ") || "Pas de numero"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => testProvider(p.id)} className="p-2 hover:bg-muted rounded-lg" title="Tester">
                      <Shield className="h-4 w-4" />
                    </button>
                    {!p.isDefault && (
                      <button onClick={() => setDefault(p.id)} className="p-2 hover:bg-muted rounded-lg" title="Definir par defaut">
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={() => toggleActive(p.id, p.isActive)} className="p-2 hover:bg-muted rounded-lg" title={p.isActive ? "Desactiver" : "Activer"}>
                      {p.isActive ? <PhoneOff className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button onClick={() => deleteProvider(p.id)} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg text-red-600" title="Supprimer">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.capabilities.map(c => (
                    <span key={c} className="text-xs px-2 py-1 bg-muted rounded-full">{CAPABILITY_LABELS[c] || c}</span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "call" && (
        <div className="max-w-md mx-auto">
          <div className="bg-card rounded-xl border p-6 space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2"><PhoneCall className="h-5 w-5 text-green-500" /> Passer un appel</h3>
            {configuredProviders.filter(p => p.isActive).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun fournisseur actif. Configurez un fournisseur d'abord.</p>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium">Numero de destination</label>
                  <input
                    type="tel"
                    value={callTo}
                    onChange={e => setCallTo(e.target.value)}
                    placeholder="+33612345678"
                    className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground"
                  />
                </div>
                <button
                  onClick={doCall}
                  disabled={actionLoading || !callTo.trim()}
                  className="w-full py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                  Appeler
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "sms" && (
        <div className="max-w-md mx-auto">
          <div className="bg-card rounded-xl border p-6 space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2"><MessageSquare className="h-5 w-5 text-blue-500" /> Envoyer un SMS</h3>
            {configuredProviders.filter(p => p.isActive).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun fournisseur actif.</p>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium">Numero de destination</label>
                  <input
                    type="tel"
                    value={smsTo}
                    onChange={e => setSmsTo(e.target.value)}
                    placeholder="+33612345678"
                    className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Message</label>
                  <textarea
                    value={smsBody}
                    onChange={e => setSmsBody(e.target.value)}
                    placeholder="Votre message..."
                    rows={3}
                    className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground resize-none"
                  />
                </div>
                <button
                  onClick={doSms}
                  disabled={actionLoading || !smsTo.trim() || !smsBody.trim()}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Envoyer
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "bulk" && (
        <div className="max-w-lg mx-auto">
          <div className="bg-card rounded-xl border p-6 space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2"><Users className="h-5 w-5 text-purple-500" /> Campagne SMS</h3>
            <p className="text-sm text-muted-foreground">Envoyez un SMS a plusieurs destinataires en une seule fois.</p>
            {configuredProviders.filter(p => p.isActive).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun fournisseur actif.</p>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium">Numeros (un par ligne ou separes par virgule)</label>
                  <textarea
                    value={bulkNumbers}
                    onChange={e => setBulkNumbers(e.target.value)}
                    placeholder={"+33612345678\n+33698765432\n+33611223344"}
                    rows={4}
                    className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground resize-none font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {bulkNumbers.split(/[\n,]/).filter(n => n.trim()).length} destinataire(s)
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Message</label>
                  <textarea
                    value={bulkBody}
                    onChange={e => setBulkBody(e.target.value)}
                    placeholder="Votre message de campagne..."
                    rows={3}
                    className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground resize-none"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{bulkBody.length}/160 caracteres</p>
                </div>
                <button
                  onClick={async () => {
                    const numbers = bulkNumbers.split(/[\n,]/).map(n => n.trim()).filter(Boolean);
                    if (!numbers.length || !bulkBody.trim()) return;
                    setActionLoading(true);
                    setBulkResult(null);
                    let sent = 0, failed = 0;
                    for (const num of numbers) {
                      try {
                        const res = await fetch(`${API}/api/telephony/sms`, {
                          method: "POST", credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ to: num, body: bulkBody }),
                        });
                        const d = await res.json();
                        if (d.success) sent++; else failed++;
                      } catch { failed++; }
                    }
                    setBulkResult({ sent, failed });
                    setActionResult({ type: "bulk", success: true, message: `Campagne terminee: ${sent} envoyes, ${failed} echoues` });
                    setActionLoading(false);
                  }}
                  disabled={actionLoading || !bulkNumbers.trim() || !bulkBody.trim()}
                  className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Envoyer la campagne
                </button>
                {bulkResult && (
                  <div className="flex gap-4 text-sm">
                    <span className="text-green-600">{bulkResult.sent} envoyes</span>
                    {bulkResult.failed > 0 && <span className="text-red-600">{bulkResult.failed} echoues</span>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "schedule" && (
        <div className="max-w-lg mx-auto space-y-4">
          <div className="bg-card rounded-xl border p-6 space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2"><CalendarClock className="h-5 w-5 text-orange-500" /> Planifier un appel</h3>
            <p className="text-sm text-muted-foreground">Programmez un rappel pour passer un appel a une heure precise.</p>
            <div>
              <label className="text-sm font-medium">Numero de destination</label>
              <input
                type="tel"
                value={scheduleCallTo}
                onChange={e => setScheduleCallTo(e.target.value)}
                placeholder="+33612345678"
                className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Date</label>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Heure</label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={e => setScheduleTime(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Note / Objet de l'appel</label>
              <textarea
                value={scheduleNote}
                onChange={e => setScheduleNote(e.target.value)}
                placeholder="Objet de l'appel, points a aborder..."
                rows={2}
                className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground resize-none"
              />
            </div>
            <button
              onClick={async () => {
                if (!scheduleCallTo.trim() || !scheduleDate || !scheduleTime) return;
                setActionLoading(true);
                try {
                  const res = await fetch(`${API}/api/telephony/schedule`, {
                    method: "POST", credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      toNumber: scheduleCallTo,
                      scheduledAt: `${scheduleDate}T${scheduleTime}:00`,
                      note: scheduleNote,
                    }),
                  });
                  const data = await res.json();
                  if (res.ok) {
                    setActionResult({ type: "schedule", success: true, message: "Appel planifie avec succes" });
                    setScheduleCallTo(""); setScheduleDate(""); setScheduleTime(""); setScheduleNote("");
                    const listRes = await fetch(`${API}/api/telephony/schedule`, { credentials: "include" });
                    if (listRes.ok) { const d = await listRes.json(); setScheduledCalls(d.scheduled || []); }
                  } else {
                    setActionResult({ type: "schedule", success: false, message: data.error || "Erreur" });
                  }
                } catch (e: any) {
                  setActionResult({ type: "schedule", success: false, message: e.message });
                }
                setActionLoading(false);
              }}
              disabled={actionLoading || !scheduleCallTo.trim() || !scheduleDate || !scheduleTime}
              className="w-full py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              Planifier
            </button>
          </div>

          {scheduledCalls.length > 0 && (
            <div className="bg-card rounded-xl border p-4">
              <h4 className="font-medium mb-3">Appels planifies</h4>
              <div className="space-y-2">
                {scheduledCalls.map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <CalendarClock className="h-4 w-4 text-orange-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{s.toNumber}</p>
                      <p className="text-xs text-muted-foreground">{s.note}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(s.scheduledAt).toLocaleString("fr-FR")}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
                      {s.status === "pending" ? "En attente" : "Termine"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2"><PhoneCall className="h-4 w-4" /> Appels ({callLogs.length})</h3>
            {callLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground bg-card p-4 rounded-lg border">Aucun appel telephonique enregistre</p>
            ) : (
              <div className="space-y-2">
                {callLogs.map(l => (
                  <div key={l.id} className="flex items-center gap-3 p-3 bg-card rounded-lg border">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${l.status === "failed" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"}`}>
                      {l.direction === "sortant" ? <PhoneCall className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{l.direction === "sortant" ? l.toNumber : l.fromNumber}</p>
                      <p className="text-xs text-muted-foreground">{l.status} · {l.duration > 0 ? formatDuration(l.duration) : "0s"}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(l.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2"><MessageSquare className="h-4 w-4" /> SMS ({smsLogs.length})</h3>
            {smsLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground bg-card p-4 rounded-lg border">Aucun SMS enregistre</p>
            ) : (
              <div className="space-y-2">
                {smsLogs.map(l => (
                  <div key={l.id} className="flex items-center gap-3 p-3 bg-card rounded-lg border">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${l.status === "failed" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
                      <MessageSquare className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{l.toNumber}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-xs">{l.body}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatDate(l.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "stats" && stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card rounded-xl border p-5">
            <h3 className="text-sm text-muted-foreground mb-1">Fournisseurs</h3>
            <p className="text-2xl font-bold">{stats.providers.active} <span className="text-sm font-normal text-muted-foreground">/ {stats.providers.total} actifs</span></p>
          </div>
          <div className="bg-card rounded-xl border p-5">
            <h3 className="text-sm text-muted-foreground mb-1">Appels</h3>
            <p className="text-2xl font-bold text-green-600">{stats.calls.successful}</p>
            <p className="text-xs text-muted-foreground">{stats.calls.failed} echoues · {formatDuration(stats.calls.totalDuration)} total</p>
          </div>
          <div className="bg-card rounded-xl border p-5">
            <h3 className="text-sm text-muted-foreground mb-1">SMS</h3>
            <p className="text-2xl font-bold text-blue-600">{stats.sms.successful}</p>
            <p className="text-xs text-muted-foreground">{stats.sms.failed} echoues</p>
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
            <h3 className="text-lg font-semibold mb-4">Ajouter un fournisseur telephonique</h3>

            {!selectedProvider ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground mb-4">Choisissez votre fournisseur :</p>
                {availableProviders.map(p => (
                  <button
                    key={p.name}
                    onClick={() => { setSelectedProvider(p); setConfigLabel(p.displayName); }}
                    className="w-full flex items-center gap-4 p-4 border rounded-xl hover:bg-muted transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Phone className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">{p.displayName}</h4>
                      <p className="text-xs text-muted-foreground">{p.pricing.description}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {p.capabilities.slice(0, 5).map(c => (
                          <span key={c} className="text-[10px] px-1.5 py-0.5 bg-muted rounded">{CAPABILITY_LABELS[c] || c}</span>
                        ))}
                        {p.capabilities.length > 5 && <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded">+{p.capabilities.length - 5}</span>}
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
                <div className="flex justify-end mt-4">
                  <button onClick={() => setShowAddForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Annuler</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <Phone className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">{selectedProvider.displayName}</p>
                    <a href={selectedProvider.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{selectedProvider.website}</a>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Nom personnalise</label>
                  <input
                    value={configLabel}
                    onChange={e => setConfigLabel(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground"
                    placeholder={selectedProvider.displayName}
                  />
                </div>

                {selectedProvider.configFields.map(f => (
                  <div key={f.key}>
                    <label className="text-sm font-medium">{f.label} {f.required && <span className="text-red-500">*</span>}</label>
                    <input
                      type={f.secret ? "password" : "text"}
                      value={configValues[f.key] || ""}
                      onChange={e => setConfigValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full mt-1 px-3 py-2 rounded-lg border bg-background text-foreground"
                      placeholder={f.label}
                    />
                  </div>
                ))}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => { setSelectedProvider(null); setConfigValues({}); }}
                    className="px-4 py-2 border rounded-lg hover:bg-muted text-sm"
                  >
                    Retour
                  </button>
                  <button
                    onClick={addProvider}
                    disabled={actionLoading}
                    className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {actionLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Configurer
                  </button>
                </div>

                <button onClick={() => setShowAddForm(false)} className="w-full text-center text-sm text-muted-foreground hover:text-foreground py-2">Annuler</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
