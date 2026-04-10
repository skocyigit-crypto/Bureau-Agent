import { useState, useEffect } from "react";
import { CreditCard, Building2, Save, Loader2, CheckCircle2, FileText, Mail, ToggleLeft, ToggleRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function TabFacturation() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    bankName: "",
    bankIban: "",
    bankBic: "",
    siret: "",
    tvaNumber: "",
    legalForm: "",
    capital: "",
    invoiceFooter: "",
    autoInvoiceEnabled: true,
    autoEmailInvoice: true,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${BASE}/api/factures-client/bank-info`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setForm({
            bankName: data.bankName || "",
            bankIban: data.bankIban || "",
            bankBic: data.bankBic || "",
            siret: data.siret || "",
            tvaNumber: data.tvaNumber || "",
            legalForm: data.legalForm || "",
            capital: data.capital || "",
            invoiceFooter: data.invoiceFooter || "",
            autoInvoiceEnabled: data.autoInvoiceEnabled ?? true,
            autoEmailInvoice: data.autoEmailInvoice ?? true,
          });
        }
      } catch (e) {
        console.error("Erreur chargement bank info:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/factures-client/bank-info`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast({ title: "Informations enregistrees", description: "Vos informations de facturation ont ete mises a jour." });
      } else {
        toast({ title: "Erreur", description: "Impossible de sauvegarder.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur de connexion.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const formatIban = (value: string) => {
    const clean = value.replace(/\s/g, "").toUpperCase();
    return clean.replace(/(.{4})/g, "$1 ").trim();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-indigo-500" />
            Informations legales
          </CardTitle>
          <CardDescription>
            Ces informations apparaitront sur vos factures.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Forme juridique</Label>
              <Input placeholder="ex: SAS, SARL, Auto-entrepreneur..." value={form.legalForm} onChange={e => setForm({ ...form, legalForm: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Capital social</Label>
              <Input placeholder="ex: 10000" value={form.capital} onChange={e => setForm({ ...form, capital: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>SIRET</Label>
              <Input placeholder="ex: 123 456 789 00012" value={form.siret} onChange={e => setForm({ ...form, siret: e.target.value })} maxLength={20} />
            </div>
            <div className="space-y-2">
              <Label>Numero de TVA intracommunautaire</Label>
              <Input placeholder="ex: FR12345678901" value={form.tvaNumber} onChange={e => setForm({ ...form, tvaNumber: e.target.value })} maxLength={30} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-green-500" />
            Coordonnees bancaires (RIB)
          </CardTitle>
          <CardDescription>
            Les coordonnees bancaires seront incluses sur les factures pour faciliter le paiement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nom de la banque</Label>
            <Input placeholder="ex: BNP Paribas" value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>IBAN</Label>
            <Input placeholder="ex: FR76 1234 5678 9012 3456 7890 123" value={form.bankIban} onChange={e => setForm({ ...form, bankIban: formatIban(e.target.value) })} maxLength={42} className="font-mono tracking-wider" />
          </div>
          <div className="space-y-2">
            <Label>BIC / SWIFT</Label>
            <Input placeholder="ex: BNPAFRPP" value={form.bankBic} onChange={e => setForm({ ...form, bankBic: e.target.value.toUpperCase() })} maxLength={11} className="font-mono" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-500" />
            Parametres de facturation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Mail className="h-4 w-4 text-indigo-500" />
                Envoi automatique par email
              </div>
              <p className="text-xs text-muted-foreground">Envoyer automatiquement la facture par email au client apres paiement complet.</p>
            </div>
            <Switch checked={form.autoEmailInvoice} onCheckedChange={v => setForm({ ...form, autoEmailInvoice: v })} />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 font-medium text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Facturation automatique activee
              </div>
              <p className="text-xs text-muted-foreground">Generer automatiquement les factures lors de la reception des paiements.</p>
            </div>
            <Switch checked={form.autoInvoiceEnabled} onCheckedChange={v => setForm({ ...form, autoInvoiceEnabled: v })} />
          </div>

          <div className="space-y-2">
            <Label>Pied de page personnalise (factures)</Label>
            <Textarea placeholder="ex: Conditions de paiement: 30 jours net. En cas de retard, des penalites de 3 fois le taux d'interet legal seront appliquees." value={form.invoiceFooter} onChange={e => setForm({ ...form, invoiceFooter: e.target.value })} rows={3} />
            <p className="text-xs text-muted-foreground">Si vide, les informations legales de votre organisation seront utilisees.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg" className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Enregistrer les informations
        </Button>
      </div>
    </div>
  );
}
