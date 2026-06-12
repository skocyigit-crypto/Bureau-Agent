import { useState, useEffect } from "react";
import { Building2, Save, Loader2, Globe, Phone, Mail, MapPin, Bot, FileText, CreditCard, Landmark, Receipt, Image as ImageIcon, Info, ScanLine, CalendarClock, Clock } from "lucide-react";
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

export function TabProfilOrg() {
  const { toast } = useToast();
  const { user } = useWorkspaceUser();
  const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const isAdmin = user?.role === "super_admin" || user?.role === "administrateur";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<OrgProfile | null>(null);
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

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${BASE}/api/org-profile`, { credentials: "include" });
        if (res.ok) {
          const data: OrgProfile = await res.json();
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
