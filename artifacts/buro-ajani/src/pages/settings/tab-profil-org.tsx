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

const WEEKDAYS: ReadonlyArray<{ value: number; label: string; short: string }> = [
  { value: 1, label: "Lundi", short: "Lun" },
  { value: 2, label: "Mardi", short: "Mar" },
  { value: 3, label: "Mercredi", short: "Mer" },
  { value: 4, label: "Jeudi", short: "Jeu" },
  { value: 5, label: "Vendredi", short: "Ven" },
  { value: 6, label: "Samedi", short: "Sam" },
  { value: 7, label: "Dimanche", short: "Dim" },
];

const TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Europe/Paris", label: "Europe/Paris (France)" },
  { value: "Europe/Brussels", label: "Europe/Bruxelles (Belgique)" },
  { value: "Europe/Zurich", label: "Europe/Zurich (Suisse)" },
  { value: "Europe/Luxembourg", label: "Europe/Luxembourg" },
  { value: "Europe/London", label: "Europe/Londres (Royaume-Uni)" },
  { value: "Europe/Madrid", label: "Europe/Madrid (Espagne)" },
  { value: "Europe/Lisbon", label: "Europe/Lisbonne (Portugal)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (Allemagne)" },
  { value: "Europe/Rome", label: "Europe/Rome (Italie)" },
  { value: "Europe/Istanbul", label: "Europe/Istanbul (Turquie)" },
  { value: "Africa/Casablanca", label: "Afrique/Casablanca (Maroc)" },
  { value: "Africa/Algiers", label: "Afrique/Alger (Algérie)" },
  { value: "Africa/Tunis", label: "Afrique/Tunis (Tunisie)" },
  { value: "America/Montreal", label: "Amérique/Montréal (Québec)" },
  { value: "UTC", label: "UTC (temps universel)" },
];

const DURATION_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "1 heure" },
  { value: 90, label: "1 h 30" },
  { value: 120, label: "2 heures" },
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
          toast({ title: "Erreur", description: "Impossible de charger le profil.", variant: "destructive" });
        }
      } catch {
        toast({ title: "Erreur reseau", description: "Verifiez votre connexion.", variant: "destructive" });
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
        toast({ title: "Profil mis à jour", description: "Les informations ont ete enregistrees." });
        if (data.organisation) {
          setProfile((prev) => prev ? { ...prev, ...data.organisation } : prev);
        }
      } else {
        toast({ title: "Erreur", description: data.error || "Echec de la mise a jour.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur reseau", description: "Verifiez votre connexion.", variant: "destructive" });
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
          toast({ title: "Déjà à jour", description: `Les jours fériés ${year} sont déjà enregistrés.` });
        } else {
          toast({
            title: `${data.inserted} jour${data.inserted > 1 ? "s" : ""} fér${data.inserted > 1 ? "iés" : "ié"} importé${data.inserted > 1 ? "s" : ""}`,
            description: data.skipped > 0 ? `${data.skipped} déjà présent${data.skipped > 1 ? "s" : ""}.` : undefined,
          });
          await loadClosures();
        }
      } else {
        toast({ title: "Erreur", description: data.error || "Impossible d'importer les jours feries.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur reseau", description: "Verifiez votre connexion.", variant: "destructive" });
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
        toast({ title: "Fermeture ajoutee", description: "La fermeture a ete enregistree." });
      } else {
        toast({ title: "Erreur", description: data.error || "Impossible d'ajouter la fermeture.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur reseau", description: "Verifiez votre connexion.", variant: "destructive" });
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
        toast({ title: "Fermeture supprimee", description: "La fermeture a ete retiree." });
      } else {
        const data = await res.json();
        toast({ title: "Erreur", description: data.error || "Impossible de supprimer.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur reseau", description: "Verifiez votre connexion.", variant: "destructive" });
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
            Profil de l'organisation
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Personnalisez les informations de votre espace de travail.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
            /{profile.slug}
          </Badge>
          {isAdmin && (
            <Button onClick={save} disabled={saving} size="sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Enregistrer
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-500" />
            Identite de l'organisation
          </CardTitle>
          <CardDescription>Nom, logo et informations de contact.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nom de l'organisation</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                disabled={!isAdmin}
                placeholder="Mon Entreprise SAS"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logo" className="flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" />
                URL du logo
              </Label>
              <Input
                id="logo"
                value={form.logo}
                onChange={(e) => setForm((f) => ({ ...f, logo: e.target.value }))}
                disabled={!isAdmin}
                placeholder="https://exemple.com/logo.png"
              />
            </div>
          </div>

          {form.logo && (
            <div className="flex items-center gap-4 p-3 rounded-lg border bg-muted/30">
              <img
                src={form.logo}
                alt="Logo apercu"
                className="h-12 w-12 rounded-lg object-contain border bg-white"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div>
                <p className="text-sm font-medium">Apercu du logo</p>
                <p className="text-xs text-muted-foreground">Visible dans la barre laterale</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                Email de contact
              </Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                disabled={!isAdmin}
                placeholder="contact@monentreprise.fr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                Telephone
              </Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                disabled={!isAdmin}
                placeholder="+33 1 23 45 67 89"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="address" className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Adresse
            </Label>
            <Textarea
              id="address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              disabled={!isAdmin}
              placeholder="123 Rue de la Paix, 75001 Paris"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4 text-violet-500" />
            Agent IA
          </CardTitle>
          <CardDescription>Personnalisez le nom de votre agent IA pour vos appels et interactions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="aiAgentName">Nom de l'agent IA</Label>
            <Input
              id="aiAgentName"
              value={form.aiAgentName}
              onChange={(e) => setForm((f) => ({ ...f, aiAgentName: e.target.value }))}
              disabled={!isAdmin}
              placeholder="Sophie Marchand"
            />
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Ce nom sera utilise lors des appels automatises et des reponses IA.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-indigo-500" />
            Horaires d'ouverture
          </CardTitle>
          <CardDescription>
            Definissent les creneaux de rendez-vous proposes et les disponibilites
            utilisees par le standard vocal IA.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Jours d'ouverture</Label>
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
                    title={day.label}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Selectionnez les jours ou votre entreprise prend des rendez-vous.
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="workingHoursStart" className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Heure d'ouverture
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
                Heure de fermeture
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
                Fuseau horaire
              </Label>
              <Select
                value={form.appointmentTimezone}
                onValueChange={(v) => isAdmin && setForm((f) => ({ ...f, appointmentTimezone: v }))}
                disabled={!isAdmin}
              >
                <SelectTrigger id="appointmentTimezone" aria-label="Fuseau horaire">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.some((t) => t.value === form.appointmentTimezone) ? null : (
                    <SelectItem value={form.appointmentTimezone}>{form.appointmentTimezone}</SelectItem>
                  )}
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appointmentDurationMinutes" className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                Duree par defaut d'un rendez-vous
              </Label>
              <Select
                value={String(form.appointmentDurationMinutes)}
                onValueChange={(v) => isAdmin && setForm((f) => ({ ...f, appointmentDurationMinutes: Number(v) }))}
                disabled={!isAdmin}
              >
                <SelectTrigger id="appointmentDurationMinutes" aria-label="Duree par defaut d'un rendez-vous">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.some((d) => d.value === form.appointmentDurationMinutes) ? null : (
                    <SelectItem value={String(form.appointmentDurationMinutes)}>
                      {form.appointmentDurationMinutes} minutes
                    </SelectItem>
                  )}
                  {DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={String(d.value)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            Ces reglages s'appliquent immediatement au calcul des creneaux libres et
            aux disponibilites annoncees par l'assistant telephonique.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarOff className="h-4 w-4 text-orange-500" />
            Fermetures exceptionnelles
          </CardTitle>
          <CardDescription>
            Jours feries, conges et fermetures ponctuelles. Aucun creneau ne sera
            propose sur ces dates par le moteur de disponibilites ni par l'assistant vocal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {closuresLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement...
            </div>
          ) : closures.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune fermeture enregistree.</p>
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
                      aria-label="Supprimer cette fermeture"
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
                    <p className="text-sm font-medium">Ajouter une fermeture</p>
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
                      <Label htmlFor="closureDateStart">Date de debut</Label>
                      <Input
                        id="closureDateStart"
                        type="date"
                        value={newClosure.dateStart}
                        onChange={(e) => setNewClosure((n) => ({ ...n, dateStart: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="closureDateEnd">
                        Date de fin{" "}
                        <span className="text-muted-foreground font-normal">(optionnelle)</span>
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
                      Description{" "}
                      <span className="text-muted-foreground font-normal">(optionnelle)</span>
                    </Label>
                    <Input
                      id="closureLabel"
                      value={newClosure.label}
                      onChange={(e) => setNewClosure((n) => ({ ...n, label: e.target.value }))}
                      placeholder="Ex : Fete nationale, Conges ete..."
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
                      Enregistrer
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setShowClosureForm(false); setNewClosure({ dateStart: "", dateEnd: "", label: "" }); }}
                    >
                      Annuler
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
                    Ajouter une fermeture
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={String(importYear)}
                      onValueChange={(v) => setImportYear(Number(v))}
                    >
                      <SelectTrigger className="h-9 w-24 text-sm" aria-label="Annee des jours feries">
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
                      Importer jours fériés {importYear}
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
            Informations legales
          </CardTitle>
          <CardDescription>SIRET, TVA, forme juridique — utilises sur les factures.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="siret">Numero SIRET</Label>
              <Input
                id="siret"
                value={form.siret}
                onChange={(e) => setForm((f) => ({ ...f, siret: e.target.value }))}
                disabled={!isAdmin}
                placeholder="123 456 789 00012"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tvaNumber">Numero de TVA intracommunautaire</Label>
              <Input
                id="tvaNumber"
                value={form.tvaNumber}
                onChange={(e) => setForm((f) => ({ ...f, tvaNumber: e.target.value }))}
                disabled={!isAdmin}
                placeholder="FR 12 345678901"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="legalForm">Forme juridique</Label>
              <Input
                id="legalForm"
                value={form.legalForm}
                onChange={(e) => setForm((f) => ({ ...f, legalForm: e.target.value }))}
                disabled={!isAdmin}
                placeholder="SAS, SARL, EI..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="capital">Capital social</Label>
              <Input
                id="capital"
                value={form.capital}
                onChange={(e) => setForm((f) => ({ ...f, capital: e.target.value }))}
                disabled={!isAdmin}
                placeholder="10 000 €"
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="invoiceFooter">Pied de page des factures</Label>
            <Textarea
              id="invoiceFooter"
              value={form.invoiceFooter}
              onChange={(e) => setForm((f) => ({ ...f, invoiceFooter: e.target.value }))}
              disabled={!isAdmin}
              placeholder="Paiement a 30 jours. En cas de retard, penalites de 3 fois le taux directeur BCE."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-emerald-500" />
            Informations bancaires
          </CardTitle>
          <CardDescription>Coordonnees bancaires pour vos factures et paiements.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="bankName">Banque</Label>
              <Input
                id="bankName"
                value={form.bankName}
                onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                disabled={!isAdmin}
                placeholder="BNP Paribas"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankIban">IBAN</Label>
              <Input
                id="bankIban"
                value={form.bankIban}
                onChange={(e) => setForm((f) => ({ ...f, bankIban: e.target.value }))}
                disabled={!isAdmin}
                placeholder="FR76 3000 6000 0112 3456 7890 189"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankBic">BIC / SWIFT</Label>
              <Input
                id="bankBic"
                value={form.bankBic}
                onChange={(e) => setForm((f) => ({ ...f, bankBic: e.target.value }))}
                disabled={!isAdmin}
                placeholder="BNPAFRPP"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4 text-sky-500" />
            Facturation automatique
          </CardTitle>
          <CardDescription>Configuration de la generation automatique des factures.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Generer les factures automatiquement</p>
              <p className="text-xs text-muted-foreground">Cree une facture a chaque renouvellement d'abonnement.</p>
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
              <p className="text-sm font-medium">Envoyer les factures par email</p>
              <p className="text-xs text-muted-foreground">Envoie automatiquement les factures a l'adresse de contact.</p>
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
            Capture automatique des recus
          </CardTitle>
          <CardDescription>Analyse IA des justificatifs de depense importes ou recus par email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Analyser automatiquement les recus et factures</p>
              <p className="text-xs text-muted-foreground">
                Lorsque cette option est activee, chaque fichier eligible importe ou recu par
                email (recu, facture fournisseur, justificatif) est analyse par l'IA pour en
                extraire la depense automatiquement. Pratique, mais chaque analyse consomme du
                quota IA. Desactivez cette option pour economiser votre quota : vous pourrez
                toujours lancer l'analyse manuellement quand vous le souhaitez.
              </p>
            </div>
            <Switch
              checked={form.expenseAutoCaptureEnabled}
              onCheckedChange={(v) => isAdmin && setForm((f) => ({ ...f, expenseAutoCaptureEnabled: v }))}
              disabled={!isAdmin}
              aria-label="Activer la capture automatique des recus"
            />
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground flex items-center gap-1.5 pb-2">
        <Globe className="h-3.5 w-3.5" />
        Organisation creee le {new Date(profile.createdAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}
