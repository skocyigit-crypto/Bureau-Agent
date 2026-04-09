import { useState, useEffect, useCallback } from "react";
import {
  Building2, Plus, Edit, Trash2, Crown, Users, Phone, Mail,
  MapPin, CheckCircle2, XCircle, Loader2, Key, AlertTriangle,
  Package, Shield, Zap, Brain, Search, RefreshCw, Copy, Check, Send,
  Receipt, CreditCard, Upload, TrendingUp, Clock, FileText, ArrowUpDown,
  BarChart3, CircleDollarSign, AlertCircle, Scale, ShieldCheck, Lock, Eye, FileCheck, BookOpen,
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
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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

const INVOICE_STATUS_COLORS: Record<string, string> = {
  en_attente: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  payee: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  partiel: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  retard: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  annulee: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  en_attente: "En attente",
  payee: "Payee",
  partiel: "Partiel",
  retard: "En retard",
  annulee: "Annulee",
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
  contactCount: number;
  callCount: number;
}

interface Invoice {
  id: number;
  organisationId: number;
  periodLabel: string;
  plan: string;
  baseAmount: string;
  overageAmount: string;
  totalAmount: string;
  status: string;
  usageSnapshot: {
    users: { current: number; max: number; overage: number };
    contacts: { current: number; max: number; overage: number };
    calls: { current: number; max: number; overage: number };
    overageDetails: {
      extraUsers: number; extraUsersAmount: number;
      extraContacts: number; extraContactsAmount: number;
      extraCalls: number; extraCallsAmount: number;
    };
  } | null;
  notes: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface BillingSummary {
  totalDue: string;
  totalDueCount: number;
  totalPaid: string;
  totalPaidCount: number;
  overdue: string;
  overdueCount: number;
  pendingPayments: number;
}

interface OrgBilling {
  invoices: Invoice[];
  totalDue: string;
  totalPaid: string;
  lastInvoice: Invoice | null;
}

interface LegalDocument {
  code: string;
  title: string;
  description: string;
  version: string;
  mandatory: boolean;
  category: string;
  status: "accepted" | "pending";
  agreement: {
    id: number;
    acceptedAt: string;
    acceptedBy: string;
    acceptedIp: string;
    documentVersion: string;
    expiresAt: string | null;
    notes: string | null;
  } | null;
}

interface LegalCompliance {
  id: number;
  name: string;
  actif: boolean;
  agreements: { id: number; documentType: string; acceptedAt: string; acceptedBy: string }[];
  missingDocuments: string[];
  acceptedCount: number;
  totalDocuments: number;
  mandatoryTotal: number;
  isCompliant: boolean;
  compliancePercent: number;
}

interface LegalSummary {
  totalOrgs: number;
  compliantOrgs: number;
  nonCompliantOrgs: number;
  complianceRate: number;
  mandatoryDocuments: number;
  totalDocuments: number;
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
  const [formAdminPrenom, setFormAdminPrenom] = useState("");
  const [formAdminNom, setFormAdminNom] = useState("");
  const [formAdminEmail, setFormAdminEmail] = useState("");

  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [showBilling, setShowBilling] = useState(false);
  const [billingOrg, setBillingOrg] = useState<Organisation | null>(null);
  const [orgBilling, setOrgBilling] = useState<OrgBilling | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [bankLines, setBankLines] = useState("");
  const [uploading, setUploading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [activeTab, setActiveTab] = useState("organisations");

  const [legalCompliance, setLegalCompliance] = useState<LegalCompliance[]>([]);
  const [legalSummary, setLegalSummary] = useState<LegalSummary | null>(null);
  const [legalLoading, setLegalLoading] = useState(false);
  const [showLegalDetail, setShowLegalDetail] = useState(false);
  const [legalDetailOrg, setLegalDetailOrg] = useState<LegalCompliance | null>(null);
  const [legalDetailDocs, setLegalDetailDocs] = useState<LegalDocument[]>([]);
  const [legalDetailLoading, setLegalDetailLoading] = useState(false);
  const [acceptingLegal, setAcceptingLegal] = useState<string | null>(null);
  const [acceptingAll, setAcceptingAll] = useState(false);

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

  const loadBillingSummary = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}api/billing/summary`, { credentials: "include" });
      if (res.ok) {
        setBillingSummary(await res.json());
      }
    } catch {}
  }, []);

  const loadLegalCompliance = useCallback(async () => {
    setLegalLoading(true);
    try {
      const res = await fetch(`${BASE}api/legal/compliance`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLegalCompliance(data.compliance || []);
        setLegalSummary(data.summary || null);
      }
    } catch {} finally {
      setLegalLoading(false);
    }
  }, []);

  const openLegalDetail = async (org: LegalCompliance) => {
    setLegalDetailOrg(org);
    setShowLegalDetail(true);
    setLegalDetailLoading(true);
    try {
      const res = await fetch(`${BASE}api/legal/org/${org.id}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLegalDetailDocs(data.documents || []);
      }
    } catch {} finally {
      setLegalDetailLoading(false);
    }
  };

  const handleAcceptDocument = async (orgId: number, documentType: string) => {
    setAcceptingLegal(documentType);
    try {
      const res = await fetch(`${BASE}api/legal/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organisationId: orgId, documentType }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Document accepte", description: data.message });
        loadLegalCompliance().then(() => {
          if (legalDetailOrg) openLegalDetail({ ...legalDetailOrg, id: legalDetailOrg.id });
        });
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de l'acceptation.", variant: "destructive" });
    } finally {
      setAcceptingLegal(null);
    }
  };

  const handleAcceptAll = async (orgId: number) => {
    setAcceptingAll(true);
    try {
      const res = await fetch(`${BASE}api/legal/accept-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ organisationId: orgId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Tous les documents acceptes", description: data.message });
        loadLegalCompliance().then(() => {
          if (legalDetailOrg) openLegalDetail({ ...legalDetailOrg, id: legalDetailOrg.id });
        });
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur.", variant: "destructive" });
    } finally {
      setAcceptingAll(false);
    }
  };

  const handleRevokeLegal = async (agreementId: number, docTitle: string) => {
    if (!confirm(`Revoquer l'acceptation de "${docTitle}" ? Cette action peut affecter la conformite de l'organisation.`)) return;
    try {
      const res = await fetch(`${BASE}api/legal/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agreementId, reason: "Revocation manuelle par l'administrateur" }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Accord revoque", description: data.message });
        loadLegalCompliance().then(() => {
          if (legalDetailOrg) openLegalDetail({ ...legalDetailOrg, id: legalDetailOrg.id });
        });
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur.", variant: "destructive" });
    }
  };

  useEffect(() => { loadOrganisations(); loadBillingSummary(); loadLegalCompliance(); }, [loadBillingSummary, loadLegalCompliance]);

  const resetForm = () => {
    setFormName(""); setFormEmail(""); setFormPhone(""); setFormAddress(""); setFormPlan("essai"); setFormActif(true);
    setFormAdminPrenom(""); setFormAdminNom(""); setFormAdminEmail("");
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

  const openBilling = async (org: Organisation) => {
    setBillingOrg(org);
    setShowBilling(true);
    setBillingLoading(true);
    try {
      const res = await fetch(`${BASE}api/billing/invoices/${org.id}`, { credentials: "include" });
      if (res.ok) {
        setOrgBilling(await res.json());
      }
    } catch {} finally {
      setBillingLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formName.trim()) { toast({ title: "Erreur", description: "Le nom est requis.", variant: "destructive" }); return; }
    if (formAdminPrenom || formAdminNom || formAdminEmail) {
      if (!formAdminPrenom || !formAdminNom || !formAdminEmail) {
        toast({ title: "Erreur", description: "Pour creer un administrateur, remplissez prenom, nom et email.", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}api/organisations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: formName, email: formEmail, phone: formPhone, address: formAddress, plan: formPlan,
          adminPrenom: formAdminPrenom || undefined,
          adminNom: formAdminNom || undefined,
          adminEmail: formAdminEmail || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const adminMsg = data.adminUser ? ` Identifiants envoyes a ${data.adminUser.email}.` : "";
        toast({ title: "Organisation creee", description: `${formName} avec le plan ${data.subscription?.plan || formPlan}.${adminMsg}` });
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

  const [sendingEmail, setSendingEmail] = useState<number | null>(null);

  const resendLicense = async (org: Organisation, resetPassword = false) => {
    if (!org.email) {
      toast({ title: "Erreur", description: "Aucun email associe a cette organisation.", variant: "destructive" });
      return;
    }
    if (resetPassword && !confirm(`Reinitialiser le mot de passe de l'administrateur de ${org.name} et envoyer les nouveaux identifiants ?`)) return;
    setSendingEmail(org.id);
    try {
      const res = await fetch(`${BASE}api/organisations/${org.id}/resend-license`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ resetPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Email envoye", description: data.message || `Licence envoyee a ${org.email}` });
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de l'envoi.", variant: "destructive" });
    } finally {
      setSendingEmail(null);
    }
  };

  const handleGenerateInvoices = async () => {
    setGenerating(true);
    try {
      const now = new Date();
      const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
      const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const res = await fetch(`${BASE}api/billing/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ year: prevYear, month: prevMonth }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Factures generees", description: data.message });
        loadBillingSummary();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de la generation.", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleUploadBank = async () => {
    if (!bankLines.trim()) return;
    setUploading(true);
    try {
      const lines = bankLines.trim().split("\n").map(line => {
        const parts = line.split(/[;\t,]/).map(p => p.trim());
        return {
          date: parts[0] || null,
          payerName: parts[1] || null,
          ref: parts[2] || null,
          amount: parseFloat(parts[3] || "0") || 0,
          iban: parts[4] || null,
        };
      }).filter(l => l.amount > 0);

      if (lines.length === 0) {
        toast({ title: "Erreur", description: "Aucune ligne valide trouvee.", variant: "destructive" });
        setUploading(false);
        return;
      }

      const res = await fetch(`${BASE}api/billing/upload-bank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ lines }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Import reussi", description: data.message });
        setBankLines("");
        setShowUpload(false);
        loadBillingSummary();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors de l'import.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleMatchPayments = async () => {
    setMatching(true);
    try {
      const res = await fetch(`${BASE}api/billing/match-payments`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Rapprochement", description: data.message });
        loadBillingSummary();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur lors du rapprochement.", variant: "destructive" });
    } finally {
      setMatching(false);
    }
  };

  const updateInvoiceStatus = async (invoiceId: number, status: string) => {
    try {
      const res = await fetch(`${BASE}api/billing/invoices/${invoiceId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Statut mis a jour", description: data.message });
        if (billingOrg) openBilling(billingOrg);
        loadBillingSummary();
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur.", variant: "destructive" });
    }
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

  function UsageBar({ label, current, max, icon }: { label: string; current: number; max: number; icon: React.ReactNode }) {
    const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
    const isOver = current > max;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">{icon}{label}</span>
          <span className={isOver ? "text-red-600 font-semibold" : "text-muted-foreground"}>
            {current.toLocaleString()} / {max.toLocaleString()}
            {isOver && <span className="ml-1">(+{(current - max).toLocaleString()})</span>}
          </span>
        </div>
        <Progress value={pct} className={`h-1.5 ${isOver ? "[&>div]:bg-red-500" : pct > 80 ? "[&>div]:bg-amber-500" : ""}`} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0f1729] via-[#1a2744] to-[#0f1729] p-8">
        <img src={orgBanner} alt="" className="absolute inset-0 w-full h-full object-cover opacity-10" />
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Icon3D icon={Building2} variant="amber" size="lg" />
            <div>
              <h1 className="text-2xl font-bold text-white">Lisans Yonetimi</h1>
              <p className="text-white/60 mt-1">Creez et gerez les licences et la facturation de vos clients</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => { loadOrganisations(); loadBillingSummary(); }}>
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="organisations" className="gap-2"><Building2 className="w-4 h-4" />Organisations</TabsTrigger>
          <TabsTrigger value="facturation" className="gap-2"><Receipt className="w-4 h-4" />Facturation</TabsTrigger>
          <TabsTrigger value="juridique" className="gap-2"><Scale className="w-4 h-4" />Juridique</TabsTrigger>
        </TabsList>

        <TabsContent value="organisations" className="space-y-4 mt-4">
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

                    {org.subscription && org.subscription.plan !== "essai" && (
                      <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" />Utilisation forfait</span>
                        </div>
                        <UsageBar label="Utilisateurs" current={org.userCount} max={org.maxUsers} icon={<Users className="w-3 h-3" />} />
                        <UsageBar label="Contacts" current={org.contactCount} max={org.subscription.maxContacts} icon={<Phone className="w-3 h-3" />} />
                        <UsageBar label="Appels/mois" current={org.callCount} max={org.subscription.maxCallsPerMonth} icon={<Phone className="w-3 h-3" />} />
                      </div>
                    )}

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

                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      {org.subscription && org.subscription.plan !== "essai" && (
                        <Button variant="outline" size="sm" onClick={() => openBilling(org)} className="text-emerald-600 hover:text-emerald-700">
                          <Receipt className="w-3.5 h-3.5 mr-1" />
                          Facturation
                        </Button>
                      )}
                      {org.email && org.subscription?.licenseKey && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resendLicense(org)}
                            disabled={sendingEmail === org.id}
                            className="text-amber-600 hover:text-amber-700"
                          >
                            {sendingEmail === org.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                            Envoyer la licence
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => resendLicense(org, true)}
                            disabled={sendingEmail === org.id}
                            className="text-blue-600 hover:text-blue-700"
                          >
                            {sendingEmail === org.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Key className="w-3.5 h-3.5 mr-1" />}
                            Reinitialiser MDP
                          </Button>
                        </>
                      )}
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
        </TabsContent>

        <TabsContent value="facturation" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30"><Clock className="w-5 h-5 text-yellow-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{billingSummary ? `${Number(billingSummary.totalDue).toFixed(0)} EUR` : "..."}</p>
                  <p className="text-xs text-muted-foreground">{billingSummary?.totalDueCount || 0} facture(s) en attente</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30"><CheckCircle2 className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{billingSummary ? `${Number(billingSummary.totalPaid).toFixed(0)} EUR` : "..."}</p>
                  <p className="text-xs text-muted-foreground">{billingSummary?.totalPaidCount || 0} payee(s)</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30"><AlertCircle className="w-5 h-5 text-red-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{billingSummary ? `${Number(billingSummary.overdue).toFixed(0)} EUR` : "..."}</p>
                  <p className="text-xs text-muted-foreground">{billingSummary?.overdueCount || 0} en retard</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30"><ArrowUpDown className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{billingSummary?.pendingPayments || 0}</p>
                  <p className="text-xs text-muted-foreground">Paiement(s) a rapprocher</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleGenerateInvoices} disabled={generating} className="bg-emerald-600 hover:bg-emerald-700">
              {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Receipt className="w-4 h-4 mr-2" />}
              Generer les factures du mois
            </Button>
            <Button variant="outline" onClick={() => setShowUpload(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Importer un releve bancaire
            </Button>
            <Button variant="outline" onClick={handleMatchPayments} disabled={matching}>
              {matching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowUpDown className="w-4 h-4 mr-2" />}
              Rapprochement automatique
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><FileText className="w-5 h-5" />Factures par organisation</CardTitle>
              <CardDescription>Cliquez sur "Facturation" dans la carte d'une organisation pour voir ses factures detaillees.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {organisations.filter(o => o.subscription && o.subscription.plan !== "essai").map(org => (
                  <div key={org.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-gradient-to-br from-[#1a2744] to-[#0f1729] flex items-center justify-center text-white font-bold text-xs">
                        {org.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{org.name}</p>
                        <p className="text-xs text-muted-foreground">{org.subscription?.planDetails?.name} - {org.subscription?.price} EUR/mois</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openBilling(org)}>
                      <Receipt className="w-3.5 h-3.5 mr-1" />
                      Voir les factures
                    </Button>
                  </div>
                ))}
                {organisations.filter(o => o.subscription && o.subscription.plan !== "essai").length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">Aucune organisation avec un plan payant.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="juridique" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30"><ShieldCheck className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{legalSummary?.compliantOrgs ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Conformes</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30"><AlertTriangle className="w-5 h-5 text-red-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{legalSummary?.nonCompliantOrgs ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Non conformes</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30"><Scale className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{legalSummary?.complianceRate ?? 0}%</p>
                  <p className="text-xs text-muted-foreground">Taux de conformite</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30"><FileCheck className="w-5 h-5 text-purple-600" /></div>
                <div>
                  <p className="text-2xl font-bold">{legalSummary?.mandatoryDocuments ?? 0}/{legalSummary?.totalDocuments ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Documents obligatoires</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {legalSummary && legalSummary.nonCompliantOrgs > 0 && (
            <Card className="border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/10">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                      {legalSummary.nonCompliantOrgs} organisation(s) ne sont pas en conformite juridique
                    </p>
                    <p className="text-xs text-red-600/80 dark:text-red-400/60 mt-0.5">
                      Des documents obligatoires n'ont pas ete acceptes. Cliquez sur une organisation pour gerer ses accords.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="w-5 h-5" />
                Conformite juridique par organisation
              </CardTitle>
              <CardDescription>
                Suivi des documents legaux acceptes par chaque client. Les documents obligatoires doivent etre acceptes pour une conformite totale.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {legalLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  {legalCompliance.map(org => (
                    <div
                      key={org.id}
                      className={`border rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow ${
                        org.isCompliant
                          ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10"
                          : "border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10"
                      }`}
                      onClick={() => openLegalDetail(org)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full ${org.isCompliant ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                            {org.isCompliant
                              ? <ShieldCheck className="w-5 h-5 text-emerald-600" />
                              : <AlertTriangle className="w-5 h-5 text-red-600" />
                            }
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{org.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {org.acceptedCount}/{org.totalDocuments} documents acceptes
                              {org.missingDocuments.length > 0 && (
                                <span className="text-red-600 ml-2">
                                  ({org.missingDocuments.length} obligatoire(s) manquant(s))
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <Badge className={org.isCompliant
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }>
                              {org.isCompliant ? "Conforme" : "Non conforme"}
                            </Badge>
                          </div>
                          <div className="w-16">
                            <Progress value={org.compliancePercent} className={`h-2 ${org.isCompliant ? "" : "[&>div]:bg-red-500"}`} />
                            <p className="text-[10px] text-center text-muted-foreground mt-0.5">{org.compliancePercent}%</p>
                          </div>
                          <Eye className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  ))}
                  {legalCompliance.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">Aucune organisation trouvee.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="w-5 h-5" />
                Documents juridiques requis
              </CardTitle>
              <CardDescription>
                Liste des documents contractuels et reglementaires integres a la plateforme.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { code: "cgu", title: "CGU", desc: "Conditions Generales d'Utilisation", icon: FileText, cat: "Usage", mandatory: true },
                  { code: "cgv", title: "CGV", desc: "Conditions Generales de Vente", icon: Receipt, cat: "Commercial", mandatory: true },
                  { code: "rgpd", title: "RGPD", desc: "Politique de Confidentialite", icon: Lock, cat: "Confidentialite", mandatory: true },
                  { code: "dpa", title: "DPA", desc: "Accord de Traitement des Donnees", icon: Shield, cat: "Confidentialite", mandatory: true },
                  { code: "sla", title: "SLA", desc: "Contrat de Niveau de Service", icon: Clock, cat: "Service", mandatory: false },
                  { code: "propriete", title: "Propriete Intellectuelle", desc: "Licence de Propriete Intellectuelle", icon: Key, cat: "Legal", mandatory: true },
                  { code: "securite", title: "Securite", desc: "Politique de Securite des Donnees", icon: ShieldCheck, cat: "Securite", mandatory: false },
                ].map(doc => (
                  <div key={doc.code} className="border rounded-lg p-3 flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 shrink-0">
                      <doc.icon className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{doc.title}</p>
                        {doc.mandatory ? (
                          <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">Obligatoire</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Optionnel</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{doc.desc}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Categorie : {doc.cat} | Version 1.0</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Legal Detail Dialog */}
      <Dialog open={showLegalDetail} onOpenChange={setShowLegalDetail}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="w-5 h-5" />
              Conformite juridique : {legalDetailOrg?.name}
            </DialogTitle>
            <DialogDescription>
              {legalDetailOrg?.isCompliant
                ? "Cette organisation est en conformite avec tous les documents obligatoires."
                : `${legalDetailOrg?.missingDocuments.length} document(s) obligatoire(s) manquant(s).`
              }
            </DialogDescription>
          </DialogHeader>

          {legalDetailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  {legalDetailOrg?.isCompliant
                    ? <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    : <AlertTriangle className="w-5 h-5 text-red-600" />
                  }
                  <span className="text-sm font-semibold">
                    {legalDetailDocs.filter(d => d.status === "accepted").length}/{legalDetailDocs.length} documents acceptes
                  </span>
                </div>
                {!legalDetailOrg?.isCompliant && legalDetailOrg && (
                  <Button size="sm" onClick={() => handleAcceptAll(legalDetailOrg.id)} disabled={acceptingAll}>
                    {acceptingAll ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileCheck className="w-3.5 h-3.5 mr-1" />}
                    Accepter tous
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                {legalDetailDocs.map(doc => (
                  <div key={doc.code} className={`border rounded-lg p-4 ${
                    doc.status === "accepted"
                      ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10"
                      : doc.mandatory
                        ? "border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/10"
                        : "border-gray-200 dark:border-gray-800"
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm">{doc.title}</p>
                          {doc.mandatory && (
                            <Badge variant="outline" className="text-[10px] border-red-300 text-red-600">Obligatoire</Badge>
                          )}
                          <Badge className={doc.status === "accepted"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }>
                            {doc.status === "accepted" ? "Accepte" : "En attente"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{doc.description}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Version {doc.version} | Categorie : {doc.category}</p>

                        {doc.agreement && (
                          <div className="mt-2 p-2 rounded bg-emerald-50 dark:bg-emerald-950/20 text-xs space-y-0.5">
                            <p className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Accepte par : <strong>{doc.agreement.acceptedBy}</strong></p>
                            <p>Date : {new Date(doc.agreement.acceptedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                            <p>Adresse IP : {doc.agreement.acceptedIp}</p>
                            {doc.agreement.notes && <p>Notes : {doc.agreement.notes}</p>}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0">
                        {doc.status === "accepted" ? (
                          <Button size="sm" variant="outline" className="text-red-600 text-xs" onClick={() => doc.agreement && handleRevokeLegal(doc.agreement.id, doc.title)}>
                            <XCircle className="w-3.5 h-3.5 mr-1" />
                            Revoquer
                          </Button>
                        ) : legalDetailOrg && (
                          <Button size="sm" className="text-xs" onClick={() => handleAcceptDocument(legalDetailOrg.id, doc.code)} disabled={acceptingLegal === doc.code}>
                            {acceptingLegal === doc.code ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                            Accepter
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Billing Detail Dialog */}
      <Dialog open={showBilling} onOpenChange={setShowBilling}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Facturation : {billingOrg?.name}
            </DialogTitle>
            <DialogDescription>
              Plan {billingOrg?.subscription?.planDetails?.name} - {billingOrg?.subscription?.price} EUR/mois
            </DialogDescription>
          </DialogHeader>

          {billingLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : orgBilling ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900">
                  <p className="text-xs text-yellow-600">Total du</p>
                  <p className="text-xl font-bold text-yellow-700">{orgBilling.totalDue} EUR</p>
                </div>
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
                  <p className="text-xs text-emerald-600">Total paye</p>
                  <p className="text-xl font-bold text-emerald-700">{orgBilling.totalPaid} EUR</p>
                </div>
              </div>

              {orgBilling.invoices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Aucune facture pour cette organisation.</p>
                  <p className="text-xs mt-1">Generez les factures du mois via l'onglet Facturation.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orgBilling.invoices.map(inv => (
                    <div key={inv.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-sm">Periode : {inv.periodLabel}</p>
                          <p className="text-xs text-muted-foreground">Plan : {inv.plan}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={INVOICE_STATUS_COLORS[inv.status] || ""}>
                            {INVOICE_STATUS_LABELS[inv.status] || inv.status}
                          </Badge>
                          <p className="font-bold text-lg">{Number(inv.totalAmount).toFixed(2)} EUR</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="p-2 rounded bg-muted/50">
                          <p className="text-muted-foreground">Forfait</p>
                          <p className="font-semibold">{Number(inv.baseAmount).toFixed(2)} EUR</p>
                        </div>
                        <div className="p-2 rounded bg-muted/50">
                          <p className="text-muted-foreground">Depassement</p>
                          <p className={`font-semibold ${Number(inv.overageAmount) > 0 ? "text-red-600" : ""}`}>
                            {Number(inv.overageAmount).toFixed(2)} EUR
                          </p>
                        </div>
                        <div className="p-2 rounded bg-muted/50">
                          <p className="text-muted-foreground">Total</p>
                          <p className="font-bold">{Number(inv.totalAmount).toFixed(2)} EUR</p>
                        </div>
                      </div>

                      {inv.usageSnapshot && (
                        <div className="space-y-1.5 p-2 rounded bg-muted/30">
                          <p className="text-xs font-semibold text-muted-foreground">Utilisation du forfait</p>
                          <UsageBar label="Utilisateurs" current={inv.usageSnapshot.users.current} max={inv.usageSnapshot.users.max} icon={<Users className="w-3 h-3" />} />
                          <UsageBar label="Contacts" current={inv.usageSnapshot.contacts.current} max={inv.usageSnapshot.contacts.max} icon={<Phone className="w-3 h-3" />} />
                          <UsageBar label="Appels" current={inv.usageSnapshot.calls.current} max={inv.usageSnapshot.calls.max} icon={<Phone className="w-3 h-3" />} />
                          {inv.usageSnapshot.overageDetails && (Number(inv.overageAmount) > 0) && (
                            <div className="mt-2 p-2 rounded bg-red-50 dark:bg-red-950/20 text-xs text-red-600 space-y-0.5">
                              <p className="font-semibold">Detail du depassement :</p>
                              {inv.usageSnapshot.overageDetails.extraUsers > 0 && (
                                <p>+{inv.usageSnapshot.overageDetails.extraUsers} utilisateur(s) : {inv.usageSnapshot.overageDetails.extraUsersAmount} EUR</p>
                              )}
                              {inv.usageSnapshot.overageDetails.extraContacts > 0 && (
                                <p>+{inv.usageSnapshot.overageDetails.extraContacts} contact(s) : {inv.usageSnapshot.overageDetails.extraContactsAmount} EUR</p>
                              )}
                              {inv.usageSnapshot.overageDetails.extraCalls > 0 && (
                                <p>+{inv.usageSnapshot.overageDetails.extraCalls} appel(s) : {inv.usageSnapshot.overageDetails.extraCallsAmount} EUR</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {inv.status !== "payee" && inv.status !== "annulee" && (
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => updateInvoiceStatus(inv.id, "payee")}>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Marquer payee
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600" onClick={() => updateInvoiceStatus(inv.id, "retard")}>
                            <AlertCircle className="w-3.5 h-3.5 mr-1" />En retard
                          </Button>
                          <Button size="sm" variant="outline" className="text-gray-500" onClick={() => updateInvoiceStatus(inv.id, "annulee")}>
                            <XCircle className="w-3.5 h-3.5 mr-1" />Annuler
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">Aucune donnee.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Bank Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Importer un releve bancaire
            </DialogTitle>
            <DialogDescription>
              Collez les lignes du releve bancaire. Format : date;nom_payeur;reference;montant;iban (separateur: ; ou tabulation)
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={bankLines}
            onChange={(e) => setBankLines(e.target.value)}
            placeholder={"2025-03-15;Societe ABC;FAC-2025-03;79.00;FR7612345\n2025-03-16;Entreprise XYZ;FAC-2025-03;199.00;FR7698765"}
            rows={8}
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Apres l'import, utilisez "Rapprochement automatique" pour associer les paiements aux factures.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)}>Annuler</Button>
            <Button onClick={handleUploadBank} disabled={uploading || !bankLines.trim()}>
              {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Importer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Nouvelle Organisation
            </DialogTitle>
            <DialogDescription>Creez une organisation, attribuez un plan et un administrateur.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground"><Building2 className="w-4 h-4" /> Organisation</h4>
              <div>
                <Label>Nom de l'organisation *</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex: Societe ABC" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Telephone</Label>
                  <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="+33 1 23 45 67 89" />
                </div>
                <div>
                  <Label>Email de contact</Label>
                  <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="contact@societe.fr" />
                </div>
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
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground"><Crown className="w-4 h-4" /> Administrateur (mot de passe genere et envoye par email)</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Prenom *</Label>
                  <Input value={formAdminPrenom} onChange={(e) => setFormAdminPrenom(e.target.value)} placeholder="Jean" />
                </div>
                <div>
                  <Label>Nom *</Label>
                  <Input value={formAdminNom} onChange={(e) => setFormAdminNom(e.target.value)} placeholder="Dupont" />
                </div>
              </div>
              <div>
                <Label>Email de connexion *</Label>
                <Input type="email" value={formAdminEmail} onChange={(e) => setFormAdminEmail(e.target.value)} placeholder="jean.dupont@societe.fr" />
              </div>
              <p className="text-[11px] text-muted-foreground">Un mot de passe securise sera genere automatiquement et envoye avec la licence par email.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Creer et envoyer
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
