import { useState, useEffect } from "react";
import { Building2, Save, Loader2, Globe, Phone, Mail, MapPin, Bot, FileText, CreditCard, Landmark, Receipt, Image as ImageIcon, Info, ScanLine, CalendarClock, Clock, CalendarOff, Plus, Trash2, X, Download } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useWorkspaceUser } from "@/components/workspace-user";
import { useTranslation } from "@/i18n";

interface OrgProfile {
  id: number;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logo: string | null;
  aiAgentName: string | null;
  siret: string | null;
  tvaNumber: string | null;
  legalForm: string | null;
  capital: string | null;
  bankName: string | null;
  bankIban: string | null;
  bankBic: string | null;
  invoiceFooter: string | null;
  autoInvoiceEnabled: boolean;
  autoEmailInvoice: boolean;
  expenseAutoCaptureEnabled: boolean;
  workingDays: string;
  workingHoursStart: string;
  workingHoursEnd: string;
  appointmentTimezone: string;
  appointmentDurationMinutes: number;
  createdAt: string;
}

const WEEKDAYS: ReadonlyArray<{ value: number }> = [
  { value: 1 },
  { value: 2 },
  { value: 3 },
  { value: 4 },
  { value: 5 },
  { value: 6 },
  { value: 7 },
];

const TIMEZONE_OPTIONS: ReadonlyArray<{ value: string }> = [
  { value: "Europe/Paris" },
  { value: "Europe/Brussels" },
  { value: "Europe/Zurich" },
  { value: "Europe/Luxembourg" },
  { value: "Europe/London" },
  { value: "Europe/Madrid" },
  { value: "Europe/Lisbon" },
  { value: "Europe/Berlin" },
  { value: "Europe/Rome" },
  { value: "Europe/Istanbul" },
  { value: "Africa/Casablanca" },
  { value: "Africa/Algiers" },
  { value: "Africa/Tunis" },
  { value: "America/Montreal" },
  { value: "UTC" },
];

const DURATION_OPTIONS: ReadonlyArray<{ value: number }> = [
  { value: 15 },
  { value: 30 },
  { value: 45 },
  { value: 60 },
  { value: 90 },
  { value: 120 },
];

function parseWorkingDays(value: string | null | undefined): number[] {
  if (!value) return [1, 2, 3, 4, 5];
  const days = value
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return days.length > 0 ? Array.from(new Set(days)).sort((a, b) => a - b) : [1, 2, 3, 4, 5];
}

interface OrgClosure {
  id: number;
  dateStart: string;
  dateEnd: string;
  label: string | null;
  createdAt: string;
}

export function TabProfilOrg() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useWorkspaceUser();
  const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const isAdmin = user?.role === "super_admin" || user?.role === "administrateur";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [closures, setClosures] = useState<OrgClosure[]>([]);
  const [closuresLoading, setClosuresLoading] = useState(false);
  const [newClosure, setNewClosure] = useState({ dateStart: "", dateEnd: "", label: "" });
  const [addingClosure, setAddingClosure] = useState(false);
  const [showClosureForm, setShowClosureForm] = useState(false);
  const [importingHolidays, setImportingHolidays] = useState(false);
  const [importYear, setImportYear] = useState<number>(new Date().getFullYear());
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    logo: "",
    aiAgentName: "",
    siret: "",
    tvaNumber: "",
    legalForm: "",
    capital: "",
    bankName: "",
    bankIban: "",
    bankBic: "",
    invoiceFooter: "",
    autoInvoiceEnabled: true,
    autoEmailInvoice: true,
    expenseAutoCaptureEnabled: true,
    workingDays: [1, 2, 3, 4, 5] as number[],
    workingHoursStart: "09:00",
    workingHoursEnd: "18:00",
    appointmentTimezone: "Europe/Paris",
    appointmentDurationMinutes: 30,
  });

  const loadClosures = async () => {
    setClosuresLoading(true);
    try {
      const res = await fetch(`${BASE}/api/org-closures`, { credentials: "include" });
      if (res.ok) {
        const data: OrgClosure[] = await res.json();
        setClosures(data);
      }
    } catch {
      // best-effort — silencieux
    } finally {
      setClosuresLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [profileRes] = await Promise.all([
          fetch(`${BASE}/api/org-profile`, { credentials: "include" }),
        ]);
        if (profileRes.ok) {
          const data: OrgProfile = await profileRes.json();
          setProfile(data);
          setForm({
            name: data.name || "",
            email: data.email || "",
            phone: data.phone || "",
            address: data.address || "",
            logo: data.logo || "",
            aiAgentName: data.aiAgentName || "",
            siret: data.siret || "",
            tvaNumber: data.tvaNumber || "",
            legalForm: data.legalForm || "",
            capital: data.capital || "",
            bankName: data.bankName || "",
            bankIban: data.bankIban || "",
            bankBic: data.bankBic || "",
            invoiceFooter: data.invoiceFooter || "",
            autoInvoiceEnabled: data.autoInvoiceEnabled,
            autoEmailInvoice: data.autoEmailInvoice,
            expenseAutoCaptureEnabled: data.expenseAutoCaptureEnabled,
            workingDays: parseWorkingDays(data.workingDays),
            workingHoursStart: data.workingHoursStart || "09:00",
            workingHoursEnd: data.workingHoursEnd || "18:00",
            appointmentTimezone: data.appointmentTimezone || "Europe/Paris",
            appointmentDurationMinutes: data.appointmentDurationMinutes || 30,
          });
        } else {
          toast({ title: t("settingsProfilOrg.toast.error"), description: t("settingsProfilOrg.toast.loadProfileError"), variant: "destructive" });
        }
      } catch {
        toast({ title: t("settingsProfilOrg.toast.networkError"), description: t("settingsProfilOrg.toast.networkErrorDesc"), variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    load();
    loadClosures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [BASE, toast]);

  const save = async () => {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/org-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: t("settingsProfilOrg.toast.profileUpdated"), description: t("settingsProfilOrg.toast.profileUpdatedDesc") });
        if (data.organisation) {
          setProfile((prev) => prev ? { ...prev, ...data.organisation } : prev);
        }
      } else {
        toast({ title: t("settingsProfilOrg.toast.error"), description: data.error || t("settingsProfilOrg.toast.updateError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsProfilOrg.toast.networkError"), description: t("settingsProfilOrg.toast.networkErrorDesc"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const importHolidays = async (year: number) => {
    if (!isAdmin) return;
    setImportingHolidays(true);
    try {
      const res = await fetch(`${BASE}/api/org-closures/import-holidays`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ year }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.inserted === 0) {
          toast({ title: t("settingsProfilOrg.toast.alreadyUpToDate"), description: t("settingsProfilOrg.toast.holidaysAlreadyDesc", { year }) });
        } else {
          toast({
            title: data.inserted > 1
              ? t("settingsProfilOrg.toast.holidaysImportedMany", { count: data.inserted })
              : t("settingsProfilOrg.toast.holidaysImportedOne"),
            description: data.skipped > 0
              ? (data.skipped > 1
                  ? t("settingsProfilOrg.toast.skippedMany", { count: data.skipped })
                  : t("settingsProfilOrg.toast.skippedOne"))
              : undefined,
          });
          await loadClosures();
        }
      } else {
        toast({ title: t("settingsProfilOrg.toast.error"), description: data.error || t("settingsProfilOrg.toast.importHolidaysError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsProfilOrg.toast.networkError"), description: t("settingsProfilOrg.toast.networkErrorDesc"), variant: "destructive" });
    } finally {
      setImportingHolidays(false);
    }
  };

  const addClosure = async () => {
    if (!isAdmin || !newClosure.dateStart) return;
    setAddingClosure(true);
    try {
      const res = await fetch(`${BASE}/api/org-closures`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          dateStart: newClosure.dateStart,
          dateEnd: newClosure.dateEnd || newClosure.dateStart,
          label: newClosure.label || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setClosures((prev) => [...prev, data as OrgClosure].sort((a, b) => a.dateStart.localeCompare(b.dateStart)));
        setNewClosure({ dateStart: "", dateEnd: "", label: "" });
        setShowClosureForm(false);
        toast({ title: t("settingsProfilOrg.toast.closureAdded"), description: t("settingsProfilOrg.toast.closureAddedDesc") });
      } else {
        toast({ title: t("settingsProfilOrg.toast.error"), description: data.error || t("settingsProfilOrg.toast.addClosureError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsProfilOrg.toast.networkError"), description: t("settingsProfilOrg.toast.networkErrorDesc"), variant: "destructive" });
    } finally {
      setAddingClosure(false);
    }
  };

  const deleteClosure = async (id: number) => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`${BASE}/api/org-closures/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setClosures((prev) => prev.filter((c) => c.id !== id));
        toast({ title: t("settingsProfilOrg.toast.closureDeleted"), description: t("settingsProfilOrg.toast.closureDeletedDesc") });
      } else {
        const data = await res.json();
        toast({ title: t("settingsProfilOrg.toast.error"), description: data.error || t("settingsProfilOrg.toast.deleteError"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("settingsProfilOrg.toast.networkError"), description: t("settingsProfilOrg.toast.networkErrorDesc"), variant: "destructive" });
    }
  };

  function formatClosureDate(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            {t("settingsProfilOrg.title")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("settingsProfilOrg.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
            /{profile.slug}
          </Badge>
          {isAdmin && (
            <Button onClick={save} disabled={saving} size="sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              {t("settingsProfilOrg.common.save")}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-500" />
            {t("settingsProfilOrg.identity.title")}
          </CardTitle>
          <CardDescription>{t("settingsProfilOrg.identity.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("settingsProfilOrg.identity.name")}</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.name")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logo" className="flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" />
                {t("settingsProfilOrg.identity.logoUrl")}
              </Label>
              <Input
                id="logo"
                value={form.logo}
                onChange={(e) => setForm((f) => ({ ...f, logo: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.logo")}
              />
            </div>
          </div>

          {form.logo && (
            <div className="flex items-center gap-4 p-3 rounded-lg border bg-muted/30">
              <img
                src={form.logo}
                alt={t("settingsProfilOrg.identity.logoPreviewAlt")}
                className="h-12 w-12 rounded-lg object-contain border bg-white"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div>
                <p className="text-sm font-medium">{t("settingsProfilOrg.identity.logoPreviewTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("settingsProfilOrg.identity.logoPreviewHint")}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                {t("settingsProfilOrg.identity.email")}
              </Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.email")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                {t("settingsProfilOrg.identity.phone")}
              </Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.phone")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="address" className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {t("settingsProfilOrg.identity.address")}
            </Label>
            <Textarea
              id="address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              disabled={!isAdmin}
              placeholder={t("settingsProfilOrg.placeholders.address")}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-violet-500" />
            {t("settingsProfilOrg.ai.title")}
          </CardTitle>
          <CardDescription>{t("settingsProfilOrg.ai.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="aiAgentName">{t("settingsProfilOrg.ai.nameLabel")}</Label>
            <Input
              id="aiAgentName"
              value={form.aiAgentName}
              onChange={(e) => setForm((f) => ({ ...f, aiAgentName: e.target.value }))}
              disabled={!isAdmin}
              placeholder={t("settingsProfilOrg.placeholders.aiAgentName")}
            />
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              {t("settingsProfilOrg.ai.hint")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-indigo-500" />
            {t("settingsProfilOrg.hours.title")}
          </CardTitle>
          <CardDescription>
            {t("settingsProfilOrg.hours.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("settingsProfilOrg.hours.daysLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => {
                const active = form.workingDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    disabled={!isAdmin}
                    aria-pressed={active}
                    onClick={() =>
                      isAdmin &&
                      setForm((f) => ({
                        ...f,
                        workingDays: f.workingDays.includes(day.value)
                          ? f.workingDays.filter((d) => d !== day.value)
                          : [...f.workingDays, day.value].sort((a, b) => a - b),
                      }))
                    }
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-muted"
                    }`}
                    title={t(`settingsProfilOrg.weekdays.${day.value}.label`)}
                  >
                    {t(`settingsProfilOrg.weekdays.${day.value}.short`)}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settingsProfilOrg.hours.daysHint")}
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="workingHoursStart" className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {t("settingsProfilOrg.hours.openTime")}
              </Label>
              <Input
                id="workingHoursStart"
                type="time"
                value={form.workingHoursStart}
                onChange={(e) => setForm((f) => ({ ...f, workingHoursStart: e.target.value }))}
                disabled={!isAdmin}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workingHoursEnd" className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {t("settingsProfilOrg.hours.closeTime")}
              </Label>
              <Input
                id="workingHoursEnd"
                type="time"
                value={form.workingHoursEnd}
                onChange={(e) => setForm((f) => ({ ...f, workingHoursEnd: e.target.value }))}
                disabled={!isAdmin}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="appointmentTimezone" className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" />
                {t("settingsProfilOrg.hours.timezone")}
              </Label>
              <Select
                value={form.appointmentTimezone}
                onValueChange={(v) => isAdmin && setForm((f) => ({ ...f, appointmentTimezone: v }))}
                disabled={!isAdmin}
              >
                <SelectTrigger id="appointmentTimezone" aria-label={t("settingsProfilOrg.hours.timezone")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.some((tz) => tz.value === form.appointmentTimezone) ? null : (
                    <SelectItem value={form.appointmentTimezone}>{form.appointmentTimezone}</SelectItem>
                  )}
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {t(`settingsProfilOrg.timezones.${tz.value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appointmentDurationMinutes" className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                {t("settingsProfilOrg.hours.duration")}
              </Label>
              <Select
                value={String(form.appointmentDurationMinutes)}
                onValueChange={(v) => isAdmin && setForm((f) => ({ ...f, appointmentDurationMinutes: Number(v) }))}
                disabled={!isAdmin}
              >
                <SelectTrigger id="appointmentDurationMinutes" aria-label={t("settingsProfilOrg.hours.duration")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.some((d) => d.value === form.appointmentDurationMinutes) ? null : (
                    <SelectItem value={String(form.appointmentDurationMinutes)}>
                      {t("settingsProfilOrg.hours.durationMinutes", { count: form.appointmentDurationMinutes })}
                    </SelectItem>
                  )}
                  {DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>
                      {t(`settingsProfilOrg.durations.${d.value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            {t("settingsProfilOrg.hours.hint")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarOff className="h-4 w-4 text-orange-500" />
            {t("settingsProfilOrg.closures.title")}
          </CardTitle>
          <CardDescription>
            {t("settingsProfilOrg.closures.desc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {closuresLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("settingsProfilOrg.closures.loading")}
            </div>
          ) : closures.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settingsProfilOrg.closures.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {closures.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 bg-muted/30"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CalendarOff className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {c.dateStart === c.dateEnd
                          ? formatClosureDate(c.dateStart)
                          : `${formatClosureDate(c.dateStart)} → ${formatClosureDate(c.dateEnd)}`}
                      </p>
                      {c.label && (
                        <p className="text-xs text-muted-foreground truncate">{c.label}</p>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => deleteClosure(c.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      aria-label={t("settingsProfilOrg.closures.deleteAria")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && (
            <>
              {showClosureForm ? (
                <div className="rounded-md border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{t("settingsProfilOrg.closures.add")}</p>
                    <button
                      type="button"
                      onClick={() => { setShowClosureForm(false); setNewClosure({ dateStart: "", dateEnd: "", label: "" }); }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="closureDateStart">{t("settingsProfilOrg.closures.dateStart")}</Label>
                      <Input
                        id="closureDateStart"
                        type="date"
                        value={newClosure.dateStart}
                        onChange={(e) => setNewClosure((n) => ({ ...n, dateStart: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="closureDateEnd">
                        {t("settingsProfilOrg.closures.dateEnd")}{" "}
                        <span className="text-muted-foreground font-normal">{t("settingsProfilOrg.closures.optional")}</span>
                      </Label>
                      <Input
                        id="closureDateEnd"
                        type="date"
                        value={newClosure.dateEnd}
                        min={newClosure.dateStart || undefined}
                        onChange={(e) => setNewClosure((n) => ({ ...n, dateEnd: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="closureLabel">
                      {t("settingsProfilOrg.closures.description")}{" "}
                      <span className="text-muted-foreground font-normal">{t("settingsProfilOrg.closures.optional")}</span>
                    </Label>
                    <Input
                      id="closureLabel"
                      value={newClosure.label}
                      onChange={(e) => setNewClosure((n) => ({ ...n, label: e.target.value }))}
                      placeholder={t("settingsProfilOrg.closures.labelPlaceholder")}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={addClosure}
                      disabled={addingClosure || !newClosure.dateStart}
                    >
                      {addingClosure ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                      {t("settingsProfilOrg.common.save")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setShowClosureForm(false); setNewClosure({ dateStart: "", dateEnd: "", label: "" }); }}
                    >
                      {t("settingsProfilOrg.common.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 items-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowClosureForm(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t("settingsProfilOrg.closures.add")}
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={String(importYear)}
                      onValueChange={(v) => setImportYear(Number(v))}
                    >
                      <SelectTrigger className="h-9 w-24 text-sm" aria-label={t("settingsProfilOrg.closures.importAria")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[new Date().getFullYear(), new Date().getFullYear() + 1].map((y) => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => importHolidays(importYear)}
                      disabled={importingHolidays}
                    >
                      {importingHolidays
                        ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        : <Download className="h-4 w-4 mr-2" />}
                      {t("settingsProfilOrg.closures.import", { year: importYear })}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-amber-500" />
            {t("settingsProfilOrg.legal.title")}
          </CardTitle>
          <CardDescription>{t("settingsProfilOrg.legal.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="siret">{t("settingsProfilOrg.legal.siret")}</Label>
              <Input
                id="siret"
                value={form.siret}
                onChange={(e) => setForm((f) => ({ ...f, siret: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.siret")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tvaNumber">{t("settingsProfilOrg.legal.tva")}</Label>
              <Input
                id="tvaNumber"
                value={form.tvaNumber}
                onChange={(e) => setForm((f) => ({ ...f, tvaNumber: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.tva")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="legalForm">{t("settingsProfilOrg.legal.legalForm")}</Label>
              <Input
                id="legalForm"
                value={form.legalForm}
                onChange={(e) => setForm((f) => ({ ...f, legalForm: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.legalForm")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="capital">{t("settingsProfilOrg.legal.capital")}</Label>
              <Input
                id="capital"
                value={form.capital}
                onChange={(e) => setForm((f) => ({ ...f, capital: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.capital")}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="invoiceFooter">{t("settingsProfilOrg.legal.invoiceFooter")}</Label>
            <Textarea
              id="invoiceFooter"
              value={form.invoiceFooter}
              onChange={(e) => setForm((f) => ({ ...f, invoiceFooter: e.target.value }))}
              disabled={!isAdmin}
              placeholder={t("settingsProfilOrg.placeholders.invoiceFooter")}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-emerald-500" />
            {t("settingsProfilOrg.bank.title")}
          </CardTitle>
          <CardDescription>{t("settingsProfilOrg.bank.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bankName">{t("settingsProfilOrg.bank.bank")}</Label>
              <Input
                id="bankName"
                value={form.bankName}
                onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.bankName")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankIban">{t("settingsProfilOrg.bank.iban")}</Label>
              <Input
                id="bankIban"
                value={form.bankIban}
                onChange={(e) => setForm((f) => ({ ...f, bankIban: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.iban")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankBic">{t("settingsProfilOrg.bank.bic")}</Label>
              <Input
                id="bankBic"
                value={form.bankBic}
                onChange={(e) => setForm((f) => ({ ...f, bankBic: e.target.value }))}
                disabled={!isAdmin}
                placeholder={t("settingsProfilOrg.placeholders.bic")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-sky-500" />
            {t("settingsProfilOrg.invoicing.title")}
          </CardTitle>
          <CardDescription>{t("settingsProfilOrg.invoicing.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t("settingsProfilOrg.invoicing.autoGenerate")}</p>
              <p className="text-xs text-muted-foreground">{t("settingsProfilOrg.invoicing.autoGenerateHint")}</p>
            </div>
            <Switch
              checked={form.autoInvoiceEnabled}
              onCheckedChange={(v) => isAdmin && setForm((f) => ({ ...f, autoInvoiceEnabled: v }))}
              disabled={!isAdmin}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t("settingsProfilOrg.invoicing.autoEmail")}</p>
              <p className="text-xs text-muted-foreground">{t("settingsProfilOrg.invoicing.autoEmailHint")}</p>
            </div>
            <Switch
              checked={form.autoEmailInvoice}
              onCheckedChange={(v) => isAdmin && setForm((f) => ({ ...f, autoEmailInvoice: v }))}
              disabled={!isAdmin}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-rose-500" />
            {t("settingsProfilOrg.receipts.title")}
          </CardTitle>
          <CardDescription>{t("settingsProfilOrg.receipts.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t("settingsProfilOrg.receipts.autoAnalyze")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settingsProfilOrg.receipts.autoAnalyzeHint")}
              </p>
            </div>
            <Switch
              checked={form.expenseAutoCaptureEnabled}
              onCheckedChange={(v) => isAdmin && setForm((f) => ({ ...f, expenseAutoCaptureEnabled: v }))}
              disabled={!isAdmin}
              aria-label={t("settingsProfilOrg.receipts.switchAria")}
            />
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground flex items-center gap-1.5 pb-2">
        <Globe className="h-3.5 w-3.5" />
        {t("settingsProfilOrg.createdOn", { date: new Date(profile.createdAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" }) })}
      </div>
    </div>
  );
}
