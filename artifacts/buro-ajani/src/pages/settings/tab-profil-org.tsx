import { useState, useEffect } from "react";
import { Building2, Save, Loader2, Globe, Phone, Mail, MapPin, Bot, FileText, CreditCard, Landmark, Receipt, Image as ImageIcon, Info } from "lucide-react";
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
        toast({ title: "Profil mis a jour", description: "Les informations ont ete enregistrees." });
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

      <div className="text-xs text-muted-foreground flex items-center gap-1.5 pb-2">
        <Globe className="h-3.5 w-3.5" />
        Organisation creee le {new Date(profile.createdAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}
