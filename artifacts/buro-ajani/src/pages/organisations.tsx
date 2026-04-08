import { useState, useEffect } from "react";
import {
  Building2, Plus, Edit, Trash2, Crown, Users, Phone, Mail,
  MapPin, CheckCircle2, XCircle, Loader2, Key, AlertTriangle,
  Package, Shield, Zap, Brain, Search, RefreshCw, Copy, Check,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Icon3D } from "@/components/icon-3d";
import orgBanner from "@/assets/images/security-server.png";

const BASE = import.meta.env.BASE_URL || "/";

const PLAN_COLORS: Record<string, string> = {
  essai: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  starter: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  professionnel: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  entreprise: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

interface Organisation {
  id: number;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  maxUsers: number;
  actif: boolean;
  createdAt: string;
  subscription: {
    plan: string;
    status: string;
    licenseKey: string | null;
    maxContacts: number;
    maxCallsPerMonth: number;
    aiEnabled: boolean;
    stockEnabled: boolean;
    automationEnabled: boolean;
    price: string;
    trialEndsAt: string | null;
    isTrialExpired: boolean;
    planDetails: { name: string } | null;
  } | null;
  userCount: number;
}

export default function OrganisationsPage() {
  const { toast } = useToast();
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organisation | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<number | null>(null);

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formPlan, setFormPlan] = useState("essai");
  const [formActif, setFormActif] = useState(true);

  const loadOrganisations = async () => {
    try {
      const res = await fetch(`${BASE}api/organisations`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setOrganisations(data.organisations || []);
      } else if (res.status === 403) {
        toast({ title: "Acces refuse", description: "Seul le super administrateur peut gerer les organisations.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger les organisations.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOrganisations(); }, []);

  const resetForm = () => {
    setFormName(""); setFormEmail(""); setFormPhone(""); setFormAddress(""); setFormPlan("essai"); setFormActif(true);
  };

  const openCreate = () => { resetForm(); setShowCreate(true); };

  const openEdit = (org: Organisation) => {
    setSelectedOrg(org);
    setFormName(org.name);
    setFormEmail(org.email || "");
    setFormPhone(org.phone || "");
    setFormAddress(org.address || "");
    setFormActif(org.actif);
    setShowEdit(true);
  };

  const openPlanChange = (org: Organisation) => {
    setSelectedOrg(org);
    setFormPlan(org.subscription?.plan || "essai");
    setShowPlan(true);
  };

  const handleCreate = async () => {
    if (!formName.trim()) { toast({ title: "Erreur", description: "Le nom est requis.", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/organisations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: formName, email: formEmail, phone: formPhone, address: formAddress, plan: formPlan }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Organisation creee", description: `${formName} avec le plan ${data.subscription?.plan || formPlan}. Cle de licence: ${data.licenseKey}` });
        setShowCreate(false);
        loadOrganisations();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de la creation.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedOrg) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/organisations/${selectedOrg.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: formName, email: formEmail, phone: formPhone, address: formAddress, actif: formActif }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Mis a jour", description: data.message });
        setShowEdit(false);
        loadOrganisations();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de la mise a jour.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handlePlanChange = async () => {
    if (!selectedOrg) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/organisations/${selectedOrg.id}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ plan: formPlan }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Plan mis a jour", description: data.message });
        setShowPlan(false);
        loadOrganisations();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors du changement de plan.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedOrg) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/organisations/${selectedOrg.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Supprimee", description: data.message });
        setShowDelete(false);
        loadOrganisations();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de la suppression.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const copyLicenseKey = (key: string, orgId: number) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(orgId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filtered = organisations.filter(o =>
    o.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: organisations.length,
    active: organisations.filter(o => o.actif).length,
    trial: organisations.filter(o => o.subscription?.plan === "essai").length,
    paid: organisations.filter(o => o.subscription && o.subscription.plan !== "essai").length,
  };

  return (
    <div className="space-y-6 p-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0f1729] via-[#1a2744] to-[#0f1729] p-8">
        <img src={orgBanner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10" />
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Icon3D icon={Building2} variant="amber" size="lg" />
            <div>
              <h1 className="text-2xl font-bold text-white">Lisans Yonetimi</h1>
              <p className="text-white/60 mt-1">Creez et gerez les licences de vos clients</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={loadOrganisations}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Actualiser
            </Button>
            <Button className="bg-amber-500 hover:bg-amber-600 text-black" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Nouvelle Organisation
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30"><Building2 className="w-5 h-5 text-blue-600" /></div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30"><CheckCircle2 className="w-5 h-5 text-emerald-600" /></div>
            <div>
              <p className="text-2xl font-bold">{stats.active}</p>
              <p className="text-xs text-muted-foreground">Actives</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800"><AlertTriangle className="w-5 h-5 text-gray-600" /></div>
            <div>
              <p className="text-2xl font-bold">{stats.trial}</p>
              <p className="text-xs text-muted-foreground">En essai</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30"><Crown className="w-5 h-5 text-amber-600" /></div>
            <div>
              <p className="text-2xl font-bold">{stats.paid}</p>
              <p className="text-xs text-muted-foreground">Payantes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher une organisation..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Badge variant="outline">{filtered.length} organisation(s)</Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Building2 className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-2">{searchTerm ? "Aucun resultat" : "Aucune organisation"}</h3>
            <p className="text-muted-foreground mb-4">{searchTerm ? "Essayez un autre terme de recherche." : "Creez votre premiere organisation pour commencer."}</p>
            {!searchTerm && (
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-2" />
                Creer une organisation
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((org) => (
            <Card key={org.id} className={`transition-all hover:shadow-md ${!org.actif ? "opacity-60" : ""}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#1a2744] to-[#0f1729] flex items-center justify-center text-white font-bold text-sm">
                      {org.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {org.name}
                        {org.id === 1 && <Crown className="w-4 h-4 text-amber-500" />}
                      </CardTitle>
                      <CardDescription className="text-xs font-mono">{org.slug}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={org.actif ? "default" : "secondary"}>
                      {org.actif ? "Actif" : "Inactif"}
                    </Badge>
                    {org.subscription && (
                      <Badge className={PLAN_COLORS[org.subscription.plan] || ""}>
                        {org.subscription.planDetails?.name || org.subscription.plan}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {org.email && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="w-3.5 h-3.5" />
                      <span className="truncate">{org.email}</span>
                    </div>
                  )}
                  {org.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="w-3.5 h-3.5" />
                      {org.phone}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="w-3.5 h-3.5" />
                    {org.userCount} / {org.maxUsers} utilisateurs
                  </div>
                  {org.subscription && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Package className="w-3.5 h-3.5" />
                      {Number(org.subscription.price) > 0 ? `${org.subscription.price} EUR/mois` : "Gratuit"}
                    </div>
                  )}
                </div>

                {org.subscription?.licenseKey && (
                  <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                    <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <code className="text-xs font-mono flex-1 truncate">{org.subscription.licenseKey}</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => copyLicenseKey(org.subscription!.licenseKey!, org.id)}
                    >
                      {copiedKey === org.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                )}

                {org.subscription?.isTrialExpired && (
                  <div className="flex items-center gap-2 p-2 rounded bg-red-50 dark:bg-red-950/20 text-red-600 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Periode d'essai expiree
                  </div>
                )}

                <div className="flex items-center gap-1 flex-wrap">
                  {org.subscription?.aiEnabled && (
                    <Badge variant="outline" className="text-xs"><Brain className="w-3 h-3 mr-1" />IA</Badge>
                  )}
                  {org.subscription?.stockEnabled && (
                    <Badge variant="outline" className="text-xs"><Package className="w-3 h-3 mr-1" />Stock</Badge>
                  )}
                  {org.subscription?.automationEnabled && (
                    <Badge variant="outline" className="text-xs"><Zap className="w-3 h-3 mr-1" />Auto</Badge>
                  )}
                </div>

                <Separator />

                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => openPlanChange(org)}>
                    <Shield className="w-3.5 h-3.5 mr-1" />
                    Changer le plan
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(org)}>
                    <Edit className="w-3.5 h-3.5 mr-1" />
                    Modifier
                  </Button>
                  {org.id !== 1 && (
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => { setSelectedOrg(org); setShowDelete(true); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Nouvelle Organisation
            </DialogTitle>
            <DialogDescription>Creez une organisation et attribuez un plan de licence.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom de l'organisation *</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex: Societe ABC" />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="contact@societe.fr" />
            </div>
            <div>
              <Label>Telephone</Label>
              <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="+33 1 23 45 67 89" />
            </div>
            <div>
              <Label>Adresse</Label>
              <Input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} placeholder="123 rue de Paris, 75001 Paris" />
            </div>
            <div>
              <Label>Plan de licence</Label>
              <Select value={formPlan} onValueChange={setFormPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="essai">Essai Gratuit (14 jours)</SelectItem>
                  <SelectItem value="starter">Starter (29 EUR/mois)</SelectItem>
                  <SelectItem value="professionnel">Professionnel (79 EUR/mois)</SelectItem>
                  <SelectItem value="entreprise">Entreprise (199 EUR/mois)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Creer l'organisation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="w-5 h-5" />
              Modifier : {selectedOrg?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
            </div>
            <div>
              <Label>Telephone</Label>
              <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
            </div>
            <div>
              <Label>Adresse</Label>
              <Input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Organisation active</Label>
              <Switch checked={formActif} onCheckedChange={setFormActif} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Annuler</Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPlan} onOpenChange={setShowPlan}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Changer le plan : {selectedOrg?.name}
            </DialogTitle>
            <DialogDescription>Plan actuel : {selectedOrg?.subscription?.planDetails?.name || selectedOrg?.subscription?.plan}</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Nouveau plan</Label>
            <Select value={formPlan} onValueChange={setFormPlan}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="essai">Essai Gratuit</SelectItem>
                <SelectItem value="starter">Starter (29 EUR/mois)</SelectItem>
                <SelectItem value="professionnel">Professionnel (79 EUR/mois)</SelectItem>
                <SelectItem value="entreprise">Entreprise (199 EUR/mois)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPlan(false)}>Annuler</Button>
            <Button onClick={handlePlanChange} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Changer le plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              Supprimer l'organisation
            </DialogTitle>
            <DialogDescription>
              Etes-vous sur de vouloir supprimer <strong>{selectedOrg?.name}</strong> ? Cette action est irreversible et supprimera toutes les donnees associees.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Annuler</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
